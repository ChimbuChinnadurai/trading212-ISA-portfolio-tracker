"""
yf.py — Yahoo Finance API utilities shared across route modules.

Provides symbol construction, authenticated quote/summary fetching,
per-ticker historical return computation, and portfolio performance enrichment.
All results are cached in the shared kv store to avoid redundant network calls.
"""

import bisect
import concurrent.futures
import logging
import time

import requests

from cache import kv_get, kv_set

logger = logging.getLogger("yf")

# ── Constants ──────────────────────────────────────────────────────────────────

_COUNTRY_YF_SUFFIX: dict = {
    "UK": ".L",  "DE": ".DE", "FR": ".PA", "NL": ".AS",
    "IE": ".L",  "CH": ".SW", "AU": ".AX", "JP": ".T",
    "ES": ".L",  "IT": ".MI", "SE": ".ST", "DK": ".CO",
    "NO": ".OL", "FI": ".HE", "BE": ".BR", "HK": ".HK",
}

_YF_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)

# Approx 252 trading days/year × 5 — used to cap 5-year chart payloads.
_YF_TRADING_DAYS_5Y = 1300


# ── Symbol utilities ───────────────────────────────────────────────────────────

def _build_yf_symbol(ticker: str, country: str) -> tuple:
    """Return (clean_ticker, yf_symbol) for Yahoo Finance requests.

    clean_ticker — LSE 'l' suffix stripped; dots preserved (safe for display/dict keys).
    yf_symbol    — dots replaced with hyphens + exchange suffix appended (ready for YF API).
    """
    suffix = _COUNTRY_YF_SUFFIX.get(country.upper(), "")
    clean  = ticker[:-1] if suffix == ".L" and ticker.lower().endswith("l") else ticker
    yf_clean = clean.replace(".", "-")
    yf_sym   = f"{yf_clean}{suffix}" if suffix and not yf_clean.endswith(suffix) else yf_clean
    return clean, yf_sym


# ── Raw chart data ─────────────────────────────────────────────────────────────

def _yf_fetch_points(symbol: str, range_: str, interval_: str) -> list:
    """Fetch close prices from Yahoo Finance chart API.  Returns [{ts, price}]."""
    resp = requests.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
        params={"range": range_, "interval": interval_, "includePrePost": "true"},
        headers={"User-Agent": _YF_UA},
        timeout=8,
    )
    resp.raise_for_status()
    chart   = resp.json()["chart"]["result"][0]
    ts_list = chart.get("timestamp", [])
    closes  = chart["indicators"]["quote"][0].get("close", [])
    return [
        {"ts": int(t), "price": round(float(c), 4)}
        for t, c in zip(ts_list, closes) if c is not None
    ]


# ── Authenticated summary ──────────────────────────────────────────────────────

def _yf_crumb() -> tuple:
    """Return (crumb, cookie_str) for Yahoo Finance v10 requests, cached 1 h."""
    cached = kv_get("yf:crumb:v3", 3600)
    if cached:
        return cached["crumb"], cached["cookies"]

    sess = requests.Session()
    sess.get("https://fc.yahoo.com", headers={"User-Agent": _YF_UA}, timeout=8)
    r = sess.get(
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
        headers={"User-Agent": _YF_UA, "Accept": "text/plain"},
        timeout=8,
    )
    r.raise_for_status()
    crumb   = r.text.strip()
    cookies = "; ".join(f"{k}={v}" for k, v in sess.cookies.items())
    kv_set("yf:crumb:v3", {"crumb": crumb, "cookies": cookies})
    return crumb, cookies


def _yf_summary(yf_sym: str, modules: str = "financialData,defaultKeyStatistics,summaryDetail") -> dict:
    """Fetch Yahoo Finance quoteSummary with crumb auth; retries once on 401."""
    for attempt in range(2):
        crumb, cookies = _yf_crumb()
        resp = requests.get(
            f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{yf_sym}",
            params={"modules": modules, "crumb": crumb},
            headers={"User-Agent": _YF_UA, "Cookie": cookies},
            timeout=10,
        )
        if resp.status_code == 401 and attempt == 0:
            try:
                kv_set("yf:crumb:v3", None)
            except Exception:
                pass
            continue
        resp.raise_for_status()
        result_list = resp.json().get("quoteSummary", {}).get("result") or []
        return result_list[0] if result_list else {}
    return {}


# ── Historical returns ─────────────────────────────────────────────────────────

def _fetch_hist_returns_one(ticker: str, country: str) -> tuple:
    """Fetch 1d–5y historical returns for a single ticker. Returns (ticker, data, error)."""
    _, symbol = _build_yf_symbol(ticker, country)

    cached = kv_get(f"hist_ret_v1:{symbol}", 86400)
    if cached is not None:
        return ticker, cached, None

    try:
        resp = requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"range": "5y", "interval": "1d"},
            headers={"User-Agent": _YF_UA},
            timeout=10,
        )
        if resp.status_code != 200:
            return ticker, None, f"HTTP {resp.status_code}"

        resp_json = resp.json()
        if "chart" not in resp_json or not resp_json["chart"]["result"]:
            return ticker, None, "No chart result"

        chart = resp_json["chart"]["result"][0]
        ts_list    = chart.get("timestamp", [])
        indicators = chart.get("indicators", {}).get("quote", [])
        if not indicators or not indicators[0].get("close"):
            return ticker, None, "No close prices"

        closes = indicators[0]["close"]
        valid_points = [(int(t), float(c)) for t, c in zip(ts_list, closes) if c is not None]
        if not valid_points:
            return ticker, None, "No valid price points"

        now_ts        = time.time()
        current_price = valid_points[-1][1]
        if current_price == 0:
            return ticker, None, "Current price is zero"

        windows = {
            "ret1d": 86400,       "ret1w": 7 * 86400,
            "ret1m": 30 * 86400,  "ret3m": 90 * 86400,
            "ret6m": 180 * 86400, "ret1y": 365 * 86400,
            "ret3y": 1095 * 86400, "ret5y": 1825 * 86400,
        }
        ts_arr    = [p[0] for p in valid_points]
        price_arr = [p[1] for p in valid_points]

        res = {}
        for key, offset in windows.items():
            target     = now_ts - offset
            idx        = bisect.bisect_left(ts_arr, target)
            candidates = [i for i in (idx - 1, idx) if 0 <= i < len(ts_arr)]
            if not candidates:
                res[key] = None
                continue
            best_i   = min(candidates, key=lambda i: abs(ts_arr[i] - target))
            min_dist = abs(ts_arr[best_i] - target)
            best_p   = price_arr[best_i]
            res[key] = (
                round((current_price - best_p) / best_p * 100, 2)
                if best_p != 0 and min_dist < 4 * 86400 else None
            )

        kv_set(f"hist_ret_v1:{symbol}", res)
        return ticker, res, None
    except Exception as e:
        logger.error("hist_returns failed for %s: %s", symbol, e)
        return ticker, None, str(e)


def enrich_rows_with_performance(rows: list) -> list:
    """Parallel-fetch historical performance for all unique tickers and merge into rows."""
    if not rows:
        return rows

    seen, unique_pairs = set(), []
    for r in rows:
        t = r.get("ticker")
        c = r.get("country") or "US"
        if t and t not in seen:
            seen.add(t)
            unique_pairs.append((t, c))

    if not unique_pairs:
        return rows

    perf_data: dict = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(unique_pairs), 15)) as ex:
        futures = {ex.submit(_fetch_hist_returns_one, t, c): t for t, c in unique_pairs}
        for future in concurrent.futures.as_completed(futures):
            try:
                ticker, data, _ = future.result()
                if data:
                    perf_data[ticker] = data
            except Exception:
                pass

    for r in rows:
        data = perf_data.get(r.get("ticker"), {})
        for k in ["ret1d", "ret1w", "ret1m", "ret3m", "ret6m", "ret1y", "ret3y", "ret5y"]:
            r[k] = data.get(k)

    return rows
