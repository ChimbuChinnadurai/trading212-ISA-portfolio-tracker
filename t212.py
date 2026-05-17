"""Trading212 API client with per-endpoint caching."""
import os
import time
from collections import defaultdict

import requests

from cache import TTL_DIV, TTL_INSTR, TTL_ORDERS, kv_get, kv_set

TTL_ORDERS_ALL = int(os.environ.get("CACHE_TTL_ORDERS_ALL", 3600))  # 1 hour
TTL_TICKERS    = int(os.environ.get("CACHE_TTL_TICKERS",    600))   # 10 min

# Removed global API_KEY and HEADERS to support multiple portfolios.
# Base URL is still shared.
TRADING212_BASE_URL = os.environ.get("TRADING212_BASE_URL", "https://live.trading212.com")

def _get_headers(api_key: str) -> dict:
    return {
        "Authorization": "Basic " + api_key,
        "Content-Type":  "application/json",
    }

_API_SLEEP = 0.4  # seconds between per-ticker requests


# ── Internal helpers ───────────────────────────────────────────────────────────

def _fetch_all_pages(endpoint: str, ticker: str, api_key: str, limit: int = 50) -> list:
    """Fetch every cursor page for a history endpoint + ticker."""
    items: list = []
    cursor: int | None = None
    headers = _get_headers(api_key)
    while True:
        params: dict = {"ticker": ticker, "limit": limit}
        if cursor is not None:
            params["cursor"] = cursor
        resp = requests.get(endpoint, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        data     = resp.json()
        page     = data.get("items", [])
        items.extend(page)
        cursor   = data.get("nextCursor")
        if not cursor or len(page) < limit:
            break
        time.sleep(0.2)  # small delay between pages of the same ticker
    return items


def _cache_tickers(positions: list) -> None:
    tickers = [p["ticker"] for p in positions if p.get("ticker")]
    kv_set("portfolio_tickers", tickers)


def _get_cached_tickers() -> list:
    return kv_get("portfolio_tickers", TTL_TICKERS) or []


# ── Core API calls ─────────────────────────────────────────────────────────────

def get_portfolio(api_key: str, pid: str) -> list:
    """Fetch open positions (always live)."""
    headers = _get_headers(api_key)
    resp = requests.get(
        f"{TRADING212_BASE_URL}/api/v0/equity/portfolio",
        headers=headers, timeout=15,
    )
    resp.raise_for_status()
    positions = resp.json()
    return positions


def get_instruments(api_key: str) -> dict:
    """Return {ticker: instrument} mapping, cached globally (shared across portfolios)."""
    cached = kv_get("instruments", TTL_INSTR)
    if cached is not None:
        return cached
    headers = _get_headers(api_key)
    resp = requests.get(
        f"{TRADING212_BASE_URL}/api/v0/equity/metadata/instruments",
        headers=headers, timeout=40,
    )
    resp.raise_for_status()
    result = {inst["ticker"]: inst for inst in resp.json()}
    kv_set("instruments", result)
    return result


def get_dividends(api_key: str, pid: str) -> defaultdict:
    """Return {ticker: total_dividends_gbp}, cached for TTL_DIV seconds per portfolio."""
    cached = kv_get("dividends", TTL_DIV, pid=pid)
    if cached is not None:
        return defaultdict(float, cached)

    headers = _get_headers(api_key)
    totals: defaultdict = defaultdict(float)
    all_items: list = []
    url    = f"{TRADING212_BASE_URL}/api/v0/history/dividends"
    params: dict = {"limit": 50}
    while url:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        data  = resp.json()
        items = data.get("items", [])
        all_items.extend(items)
        for div in items:
            totals[div.get("ticker", "")] += float(div.get("amount") or 0)
        nxt = data.get("nextPagePath")
        url, params = (f"{TRADING212_BASE_URL}{nxt}", {}) if nxt else (None, {})

    kv_set("dividends",     dict(totals), pid=pid)
    kv_set("dividends_raw", all_items,    pid=pid)
    kv_set("total_dividends", round(sum(totals.values()), 2), pid=pid)
    return totals


def get_dividends_raw(api_key: str, pid: str) -> list:
    """Return raw dividend history items. Triggers full fetch if cache is cold."""
    cached = kv_get("dividends_raw", TTL_DIV, pid=pid)
    if cached is not None:
        return cached
    get_dividends(api_key, pid)
    return kv_get("dividends_raw", TTL_DIV, pid=pid) or []


def get_recent_dividends(api_key: str, pid: str, n: int = 10) -> list:
    """Return the n most-recent paid dividend items, newest first."""
    items = get_dividends_raw(api_key, pid)
    paid  = [it for it in items if it.get("paidOn") or it.get("date")]
    paid.sort(key=lambda x: str(x.get("paidOn") or x.get("date") or ""), reverse=True)
    return paid[:n]


def _normalize_order(item: dict) -> dict:
    """
    T212 history/orders returns each item as {order: {...}, fill: {...}}.
    Flatten into the flat format the rest of the app expects.
    """
    order = item.get("order") or item        # handle already-flat legacy cache entries
    fill  = item.get("fill")  or {}
    wi    = fill.get("walletImpact") or {}
    inst  = order.get("instrument") or {}

    # Quantity: fill.quantity is signed (negative = sell); use abs everywhere
    fill_qty  = fill.get("quantity")
    order_qty = order.get("filledQuantity") or order.get("quantity") or 0
    qty = abs(float(fill_qty if fill_qty is not None else order_qty))

    return {
        "ticker":          order.get("ticker") or inst.get("ticker", ""),
        "company_name":    inst.get("name") or order.get("ticker", "").split("_")[0],
        "side":            order.get("side", ""),
        "type":            order.get("type", ""),
        "status":          order.get("status", ""),
        "filledQuantity":  qty,
        "fillPrice":       fill.get("price") or 0,
        "dateCreated":     order.get("createdAt", ""),
        "dateExecuted":    fill.get("filledAt") or order.get("createdAt", ""),
        "filledValue":     abs(float(
            order.get("filledValue") or wi.get("netValue") or order.get("value") or 0
        )),
    }


def get_account_summary(api_key: str, pid: str) -> dict:
    """Fetch account summary (cash + realized/unrealized P&L). Cached 5 min per portfolio."""
    cached = kv_get("account_summary", 300, pid=pid)
    if cached is not None:
        return cached
    headers = _get_headers(api_key)
    resp = requests.get(
        f"{TRADING212_BASE_URL}/api/v0/equity/account/summary",
        headers=headers, timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    result = {
        "cash":         round(float(data.get("cash", {}).get("availableToTrade", 0)), 2),
        "reserved":     round(float(data.get("cash", {}).get("reservedForOrders", 0)), 2),
        "in_pies":      round(float(data.get("cash", {}).get("inPies", 0)), 2),
        "realized_pnl": round(float(data.get("investments", {}).get("realizedProfitLoss", 0)), 2),
        "unrealized_pnl": round(float(data.get("investments", {}).get("unrealizedProfitLoss", 0)), 2),
        "total_value":  round(float(data.get("totalValue", 0)), 2),
    }
    kv_set("account_summary", result, pid=pid)
    return result


def get_orders(api_key: str, pid: str, limit: int = 15) -> list:
    """
    Return recent orders across all holdings, cached for TTL_ORDERS seconds.
    """
    cached = kv_get("orders", TTL_ORDERS, pid=pid)
    if cached is not None:
        return cached
    headers = _get_headers(api_key)
    resp = requests.get(
        f"{TRADING212_BASE_URL}/api/v0/equity/history/orders",
        headers=headers, params={"limit": limit}, timeout=15,
    )
    resp.raise_for_status()
    raw    = resp.json().get("items", [])
    result = [_normalize_order(item) for item in raw]
    kv_set("orders", result, pid=pid)
    return result


def get_all_orders_history(api_key: str, pid: str, tickers: list | None = None) -> list:
    """
    Return full order history for all portfolio tickers, cached for 1 hour.
    """
    cached = kv_get("orders_all", TTL_ORDERS_ALL, pid=pid)
    if cached is not None:
        return cached

    if tickers is None:
        # Tickers are no longer cached globally in a reliable way,
        # but build_rows usually provides them or we can grab them from living portfolio.
        # For full history, we typically fetch it once during intensive indexing.
        return []

    endpoint  = f"{TRADING212_BASE_URL}/api/v0/equity/history/orders"
    all_items: list = []

    for i, ticker in enumerate(tickers):
        if i > 0:
            time.sleep(_API_SLEEP)
        try:
            items = _fetch_all_pages(endpoint, ticker, api_key)
            for item in items:
                item.setdefault("ticker", ticker)
            all_items.extend(items)
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 429:
                time.sleep(5)
            continue
        except Exception:
            continue

    kv_set("orders_all", all_items, pid=pid)
    return all_items
