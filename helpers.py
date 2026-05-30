"""
helpers.py — Shared portfolio helpers used across multiple route modules.

Centralises the multi-portfolio configuration (API_KEYS / PORTFOLIO_NAMES) and
the core fetch-and-cache pipeline so every blueprint can call the same functions
without duplicating logic or creating circular imports.

Public API
----------
  API_KEYS                — {pid: api_key} for all configured portfolios
  PORTFOLIO_NAMES         — {pid: display_name}
  fetch_and_cache_portfolio(pid, force) — enrich + cache a single portfolio
  _top_sector(rows)       — dominant sector by portfolio value
  _get_combined_rows_map() — merge all portfolios into a ticker-keyed dict
  _build_overview_data(force) — aggregate overview metrics for all portfolios
"""

import logging
import os
import re

from cache import TTL_DIV, kv_age, kv_get, kv_set, rows_get, rows_set, snapshot_add
from fx import get_gbpusd_rate
from portfolio import build_rows
from t212 import get_account_summary, get_dividends, get_instruments, get_portfolio
from yf import enrich_rows_with_performance

logger = logging.getLogger("helpers")

# ── Multi-portfolio config ─────────────────────────────────────────────────────

def _load_portfolios() -> tuple[dict, dict]:
    """Discover all configured portfolios from environment variables.

    Scans os.environ for TRADING212_API_KEY_<id> entries.  The suffix becomes
    the portfolio pid (e.g. "1", "2", "alice").  Display names are read from
    PORTFOLIO_NAME_<id> and default to "Portfolio <id>".

    Portfolios are ordered: numeric suffixes first (ascending), then
    non-numeric suffixes alphabetically.
    """
    found: list[str] = []
    for env_key, env_val in os.environ.items():
        m = re.match(r"^TRADING212_API_KEY_(.+)$", env_key)
        if m and env_val and env_val.strip():
            found.append(m.group(1))

    found.sort(key=lambda p: (0, int(p)) if p.isdigit() else (1, p))

    keys: dict[str, str] = {}
    names: dict[str, str] = {}
    for pid in found:
        keys[pid] = os.environ[f"TRADING212_API_KEY_{pid}"].strip()
        names[pid] = os.environ.get(f"PORTFOLIO_NAME_{pid}", f"Portfolio {pid}")

    if not keys:
        keys["demo"] = "DEMO_KEY"
        names["demo"] = "Demo Portfolio"

    return keys, names


API_KEYS, PORTFOLIO_NAMES = _load_portfolios()



# ── Core fetch pipeline ────────────────────────────────────────────────────────

def fetch_and_cache_portfolio(pid: str, force: bool = False) -> tuple:
    """Fetch and enrich a single portfolio, caching the result.

    Returns (rows, total_dividends_gbp).  Returns (None, 0.0) when no API key
    is configured for the given pid.
    """
    api_key = API_KEYS.get(pid)
    if not api_key:
        return None, 0.0

    if not force:
        cached_rows, _ = rows_get(pid)
        if cached_rows is not None:
            total_div = kv_get("total_dividends", TTL_DIV, pid=pid) or 0.0
            return cached_rows, total_div

    positions   = get_portfolio(api_key, pid)
    instruments = get_instruments(api_key)
    gbpusd      = get_gbpusd_rate()
    dividends   = get_dividends(api_key, pid)

    total_div = round(sum(dividends.values()), 2)
    rows      = build_rows(positions, instruments, dividends, gbpusd)
    rows      = enrich_rows_with_performance(rows)

    rows_set(rows, pid=pid)
    kv_set("total_dividends", total_div, pid=pid)
    return rows, total_div


# ── Portfolio aggregation helpers ──────────────────────────────────────────────

def _top_sector(rows: list) -> str | None:
    """Return the sector name with the highest total current_value, or None."""
    buckets: dict = {}
    for r in rows:
        s = r.get("sector") or "Other"
        buckets[s] = buckets.get(s, 0) + r.get("current_value", 0)
    return max(buckets, key=buckets.get) if buckets else None


def _get_combined_rows_map() -> dict:
    """Merge cached portfolio rows from all PIDs into a ticker-keyed dict.

    Financial fields (invested, current_value, total_returns) are summed across
    portfolios when the same ticker appears in more than one.
    """
    combined: dict = {}
    for pid, key in API_KEYS.items():
        if not key:
            continue
        rows, _ = rows_get(pid)
        if not rows:
            continue
        for r in rows:
            t = r["ticker"]
            if t not in combined:
                combined[t] = r.copy()
                combined[t]["_pid"] = pid
            else:
                curr = combined[t]
                curr["invested"]      = (curr.get("invested") or 0)      + (r.get("invested") or 0)
                curr["current_value"] = (curr.get("current_value") or 0) + (r.get("current_value") or 0)
                curr["total_returns"] = (curr.get("total_returns") or 0) + (r.get("total_returns") or 0)
    return combined


def _build_overview_data(force: bool = False) -> tuple:
    """Build aggregated overview metrics for all configured portfolios.

    Returns (res_dict, metadata_dict) where res_dict has keys "1", "2", "combined".
    """
    res: dict = {}
    total_value = total_returns = total_invested = 0.0
    total_cash  = total_realized = 0.0

    for pid, api_key in API_KEYS.items():
        rows, _ = fetch_and_cache_portfolio(pid, force=force)
        summary: dict = {}
        if api_key:
            try:
                summary = get_account_summary(api_key, pid)
            except Exception:
                pass

        if rows:
            p_val = sum(r["current_value"] for r in rows)
            p_inv = sum(r["invested"] for r in rows)
            total_value    += p_val
            total_invested += p_inv
            snapshot_add(pid, round(p_val, 2))

            cash       = summary.get("cash", 0)
            realized   = summary.get("realized_pnl", 0)
            # Prefer T212's own unrealized figure; fall back to computed value when absent.
            unrealized = summary.get("unrealized_pnl") if summary else None
            if unrealized is None:
                unrealized = round(p_val - p_inv, 2)
            total_cash     += cash
            total_realized += realized
            total_returns  += unrealized

            res[pid] = {
                "value":          round(p_val, 2),
                "returns":        unrealized,
                "returns_pct":    round((unrealized / p_inv) * 100, 2) if p_inv > 0 else 0,
                "invested":       round(p_inv, 2),
                "positions":      len(rows),
                "top_sector":     _top_sector(rows),
                "cash":           cash,
                "realized_pnl":   realized,
                "unrealized_pnl": unrealized,
            }

    all_combined: list = []
    for pid in API_KEYS:
        r, _ = rows_get(pid)
        if r:
            all_combined.extend(r)

    res["combined"] = {
        "value":          round(total_value, 2),
        "returns":        round(total_returns, 2),
        "returns_pct":    round((total_returns / total_invested) * 100, 2) if total_invested > 0 else 0,
        "invested":       round(total_invested, 2),
        "positions":      sum(p["positions"] for p in res.values() if isinstance(p, dict) and "positions" in p),
        "top_sector":     _top_sector(all_combined),
        "cash":           round(total_cash, 2),
        "realized_pnl":   round(total_realized, 2),
        "unrealized_pnl": round(total_returns, 2),
    }

    _sample_pid = next(iter(API_KEYS), None)
    metadata = {
        "names": PORTFOLIO_NAMES,
        "freshness": {
            "prices":    (kv_age(f"{_sample_pid}:rows") if _sample_pid else None) or 0,
            "dividends": (kv_age("total_dividends", pid=_sample_pid) if _sample_pid else None) or 0,
            "fx":        kv_age("gbpusd") or 0,
        },
    }
    return res, metadata
