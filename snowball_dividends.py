"""
snowball_dividends.py — Dividend calendar data via Snowball Analytics (public API).

Covers both US stocks (*.US.USD / type=nyse) and UK stocks (*.LSE.GBP / type=lse).
Called by the background refresh thread in app.py every 6 hours.
Results are stored in the shared kv cache under key  snowball:div:<TICKER>.
"""

import logging
import os
import time

import requests

from cache import kv_set, rows_get

# ── Config ────────────────────────────────────────────────────────────────────
DIV_REFRESH_INTERVAL = int(os.environ.get("DIV_REFRESH_SECONDS", 21600))  # 6 hours
DIV_CACHE_KEY_PREFIX  = "snowball:div"
LAST_REFRESH_KEY      = "snowball:div:last_refresh"
TTL_DIVIDENDS_CAL     = 86400   # serve cached data for up to 24 h
_CALL_SLEEP_SECS      = 10      # polite delay between each Snowball request


# ---------------------------------------------------------------------------
# Portfolio helpers — collect held tickers from the kv-cache rows
# ---------------------------------------------------------------------------

def build_ticker_info(api_keys: dict) -> dict:
    """Return {ticker: {quantity, company_name, pid}} for all held US stocks."""
    info: dict = {}
    for pid, key in api_keys.items():
        if not key:
            continue
        rows, _ = rows_get(pid)
        if not rows:
            continue
        for r in rows:
            if r.get("country") != "US":
                continue
            ticker = r["ticker"].upper()
            if ticker not in info:
                info[ticker] = {
                    "quantity":     0.0,
                    "company_name": r.get("company_name") or ticker,
                    "pid":          pid,
                }
            info[ticker]["quantity"] += r.get("quantity", 0.0)
    return info


def build_uk_ticker_info(api_keys: dict) -> dict:
    """Return {clean_ticker: {quantity, company_name, pid}} for all held UK stocks.
    UK tickers stored in the portfolio have a trailing lowercase 'l' (e.g. 'BARCl');
    that is stripped to produce the bare ticker used by Snowball Analytics."""
    info: dict = {}
    for pid, key in api_keys.items():
        if not key:
            continue
        rows, _ = rows_get(pid)
        if not rows:
            continue
        for r in rows:
            if r.get("country") != "UK":
                continue
            raw   = r["ticker"]
            clean = (raw[:-1] if raw.endswith("l") else raw).upper()
            if clean not in info:
                info[clean] = {
                    "quantity":     0.0,
                    "company_name": r.get("company_name") or clean,
                    "pid":          pid,
                }
            info[clean]["quantity"] += r.get("quantity", 0.0)
    return info


# ---------------------------------------------------------------------------
# Snowball Analytics helpers
# ---------------------------------------------------------------------------
_SNOWBALL_BASE = (
    "https://snowball-analytics.com/extapi/api/public/dividend-calendar/paged"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}


def _snowball_fetch(ticker: str, asset_suffix: str, exchange_type: str) -> list:
    """Fetch dividend entries for one ticker from Snowball Analytics.
    Returns the raw list from ``data`` key, or [] on any error."""
    _log = logging.getLogger("snowball-api")
    url = (
        f"{_SNOWBALL_BASE}"
        f"?assets={ticker}.{asset_suffix}"
        f"&type={exchange_type}"
        f"&dateType=payment&pageSize=50&page=1"
        f"&sortBy=paymentDate&sortDirection=asc"
    )
    try:
        resp = requests.get(url, timeout=12, headers=_HEADERS)
        if resp.status_code != 200:
            _log.warning("Snowball HTTP %d for %s", resp.status_code, ticker)
            return []
        body = resp.json()
        entries = body.get("data", [])
        return entries if isinstance(entries, list) else []
    except Exception as exc:
        _log.error("Snowball fetch error for %s: %s", ticker, exc)
        return []


def parse_snowball_date(val) -> str:
    """Extract 'YYYY-MM-DD' from a Snowball ISO datetime string, or ''."""
    return str(val)[:10] if val else ""


def format_snowball_entries(ticker: str, info: dict, entries: list, today_str: str) -> list:
    """Convert raw Snowball Analytics entries into frontend-ready dicts.
    Keeps only entries whose payment_date >= today."""
    qty, out = info["quantity"], []
    for d in entries:
        pay_date = parse_snowball_date(d.get("paymentDate"))
        if not pay_date or pay_date < today_str:
            continue
        amount = float(d.get("perShare") or 0)
        out.append({
            "ticker":           ticker,
            "company_name":     info["company_name"],
            "pid":              info["pid"],
            "ex_dividend_date": parse_snowball_date(d.get("exDividendDate")),
            "declaration_date": parse_snowball_date(d.get("declareDate")),
            "record_date":      "",
            "payment_date":     pay_date,
            "amount_per_share": amount,
            "frequency":        d.get("frequency"),
            "currency":         d.get("currency") or d.get("divCurrency") or "GBP",
            "quantity":         round(qty, 4),
            "expected_payout":  round(amount * qty, 4),
            "source":           "snowball",
        })
    return out


# ---------------------------------------------------------------------------
# Main refresh — called by background thread in app.py
# ---------------------------------------------------------------------------

def fetch_all_dividends(api_keys: dict) -> None:
    """Fetch upcoming dividends for all held tickers via Snowball Analytics.
    Sleeps 10 s between requests to be polite to the public API.
    Results stored in kv cache under  snowball:div:<TICKER>."""
    _log = logging.getLogger("div-refresh")

    # Build one combined list: (ticker, asset_suffix, exchange_type, info)
    tasks = []

    us_info = build_ticker_info(api_keys)
    for ticker, info in us_info.items():
        tasks.append((ticker, "US.USD", "nyse", info))

    uk_info = build_uk_ticker_info(api_keys)
    for ticker, info in uk_info.items():
        tasks.append((ticker, "LSE.GBP", "lse", info))

    if not tasks:
        _log.warning("No tickers found in portfolio cache — skipping dividend refresh")
        return

    _log.info("Starting Snowball dividend refresh for %d tickers", len(tasks))
    success, errors = 0, 0

    for i, (ticker, asset_suffix, exchange_type, _info) in enumerate(tasks):
        cache_key = f"{DIV_CACHE_KEY_PREFIX}:{ticker}"
        entries = _snowball_fetch(ticker, asset_suffix, exchange_type)
        # Cache even empty lists so the endpoint doesn't mark the ticker as missing
        kv_set(cache_key, entries)
        _log.debug("Snowball: cached %d entries for %s", len(entries), ticker)
        if entries:
            success += 1
        else:
            errors += 1

        # Polite delay between calls — skip after the last one
        if i < len(tasks) - 1:
            time.sleep(_CALL_SLEEP_SECS)

    kv_set(LAST_REFRESH_KEY, int(time.time()))
    _log.info("Snowball refresh complete — %d with data, %d empty/errors out of %d",
              success, errors, len(tasks))
