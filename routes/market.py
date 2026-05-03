"""
routes/market.py — Market data, stock information, Finviz, and watchlist endpoints.

Blueprint: market_bp

Routes
------
  GET  /api/market-indicators              S&P 500 (125-day MA) + NASDAQ + VIX, cached 30 min
  GET  /api/market-sp500-insights          YTD daily S&P 500 performance, cached 15 min
  GET  /api/market-status                  NASDAQ + LSE session state from T212 exchange metadata
  GET  /api/market/sector-performance      SPDR ETF sector performance, cached 5 min
  GET  /api/market-digest                  Daily market digest from Finviz (?provider=finviz)
  GET  /api/news                           General market news from Finnhub, cached 5 min
  GET  /api/earnings                       Upcoming earnings for held US stocks (Finnhub)
  GET  /api/stock-tickers                  Live price + today's change for all held stocks
  GET  /api/stock-sparklines               Hourly sparklines for multiple tickers
  GET  /api/stock-chart/<ticker>           OHLCV candles  (?period=1d|1w|1m|1y|5y)
  GET  /api/stock-metrics/<ticker>         Fundamental metrics from Finnhub
  GET  /api/stock-news/<ticker>            Company news from Finnhub
  GET  /api/stock-historical-returns       Batch 1d–5y returns for arbitrary tickers
  GET  /api/analyst-ratings                TradingView analyst consensus for held stocks
  GET  /api/watchlist/signals              TradingView analyst targets for arbitrary ticker
  GET  /api/watchlist/fundamentals         Market cap, revenue, P/E ratios, returns
  GET  /api/watchlist/price                Current price + company name for any ticker
  GET  /api/watchlist/tickers  (GET/POST)  Persist the watchlist ticker list
  GET  /api/finviz/news                    Market news from Finviz

Internal helpers exported for background threads
------------------------------------------------
  fetch_and_cache_market_indicators()  — called by background market-refresh thread
  fetch_and_cache_news()               — called by background news-refresh thread
  _market_ind_valid(data)              — used by portfolio home_data route
"""

import concurrent.futures
import logging
import os
import re
import time
from datetime import date, datetime, timedelta, timezone

import finviz_data as fvd
import requests
from cache import TTL_NEWS, kv_delete, kv_get, kv_set, rows_get
from flask import Blueprint, jsonify, request as flask_request

import ai_digest as _ai_digest
from helpers import API_KEYS, fetch_and_cache_portfolio
from yf import _YF_TRADING_DAYS_5Y, _YF_UA, _build_yf_symbol, _yf_crumb, _yf_fetch_points, _yf_summary

logger = logging.getLogger("market")

market_bp = Blueprint("market", __name__)

# ── Constants ──────────────────────────────────────────────────────────────────

FINNHUB_TOKEN   = os.environ.get("FINNHUB_TOKEN")
TTL_EARNINGS    = 86400   # 1 day
TTL_STOCK_NEWS  = 1800    # 30 min — per-ticker company news

_YT_API_KEY     = os.environ.get("YOUTUBE_API_KEY", "")
_YT_MIN_SECS    = 121     # filter out videos ≤ 2 min (Shorts + very short clips)

_SECTOR_ETFS = {
    "XLK":  "Technology",        "XLF":  "Financial Services",
    "XLE":  "Energy",            "XLV":  "Healthcare",
    "XLI":  "Industrials",       "XLP":  "Consumer Staples",
    "XLY":  "Consumer Cyclical", "XLB":  "Basic Materials",
    "XLRE": "Real Estate",       "XLU":  "Utilities",
    "XLC":  "Communication Services",
}

_WL_TTL = 10 * 365 * 24 * 3600  # ~10 years — effectively permanent for watchlist

_WL_DEFAULT_CATEGORIES = [
    {"id": "stock", "label": "Stock", "tabLabel": "Stocks", "icon": "trending_up", "noCountry": False, "placeholder": "Ticker (e.g. AAPL, NVDA)"},
    {"id": "etf", "label": "ETF", "tabLabel": "ETFs", "icon": "account_balance", "noCountry": False, "placeholder": "Ticker (e.g. VOO, QQQ)"},
    {"id": "crypto", "label": "Crypto", "tabLabel": "Crypto", "icon": "currency_bitcoin", "noCountry": True, "placeholder": "Ticker (e.g. BTC, ETH, SOL)", "autoCryptoSuffix": True},
    {"id": "commodity", "label": "Commodity", "tabLabel": "Commodities", "icon": "diamond", "noCountry": True, "placeholder": "Yahoo symbol (e.g. GC=F Gold, SI=F Silver, CL=F Oil)"},
]


# ── Market indicator helpers ───────────────────────────────────────────────────

def _fetch_market_symbol(cfg: tuple) -> tuple:
    """Fetch and process one Yahoo Finance index symbol. Returns (key, data_or_None)."""
    symbol, label, ma_period = cfg
    key = symbol.replace("^", "")
    try:
        resp = requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"range": "5y", "interval": "1d"},
            headers={"User-Agent": _YF_UA},
            timeout=10,
        )
        resp.raise_for_status()
        chart      = resp.json()["chart"]["result"][0]
        timestamps = chart["timestamp"]
        closes     = chart["indicators"]["quote"][0]["close"]

        pairs = [(t, c) for t, c in zip(timestamps, closes) if c is not None]
        if len(pairs) < ma_period + 10:
            return key, None

        ts_list = [p[0] for p in pairs]
        c_list  = [p[1] for p in pairs]
        ma_list = [
            sum(c_list[i - ma_period + 1: i + 1]) / ma_period if i >= ma_period - 1 else None
            for i in range(len(c_list))
        ]

        n      = _YF_TRADING_DAYS_5Y
        c_out  = [round(v, 2) for v in c_list[-n:]]
        ma_out = [round(m, 2) if m is not None else None for m in ma_list[-n:]]
        current, current_ma = c_out[-1], ma_out[-1]

        return key, {
            "label":      label,
            "ma_period":  ma_period,
            "timestamps": ts_list[-n:],
            "values":     c_out,
            "ma":         ma_out,
            "current":    current,
            "current_ma": current_ma,
            "pct_vs_ma":  round((current / current_ma - 1) * 100, 2) if current_ma else None,
        }
    except Exception as exc:
        logger.warning("market_indicators fetch failed for %s: %s", symbol, exc)
        return key, None


def fetch_and_cache_market_indicators() -> dict:
    """Fetch GSPC, IXIC, VIX in parallel and cache the result.

    Called by both the /api/market-indicators endpoint and the background refresh thread.
    Only writes to cache when at least one symbol returned valid data — prevents a
    transient all-None result from blocking successful retries for the full TTL window.
    """
    configs = [
        ("^GSPC", "S&P 500", 125),
        ("^IXIC", "NASDAQ",   50),
        ("^VIX",  "VIX",      50),
    ]
    result: dict = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        for key, data in ex.map(_fetch_market_symbol, configs):
            result[key] = data
    if any(v is not None for v in result.values()):
        kv_set("market_indicators", result)
    return result


def _market_ind_valid(data) -> bool:
    """True only if data is a dict with at least one non-None symbol."""
    return isinstance(data, dict) and any(v is not None for v in data.values())


# ── Market indicator routes ────────────────────────────────────────────────────

@market_bp.route("/api/market-indicators")
def market_indicators():
    """S&P 500 (125-day MA), NASDAQ, and VIX from Yahoo Finance. Cached 30 min."""
    cached = kv_get("market_indicators", 1800)
    if _market_ind_valid(cached):
        return jsonify({"status": "ok", "data": cached})
    if cached is not None:
        kv_delete("market_indicators")
    result = fetch_and_cache_market_indicators()
    return jsonify({"status": "ok", "data": result})


@market_bp.route("/api/market-sp500-insights")
def market_sp500_insights_api():
    """YTD daily performance for S&P 500 (^GSPC), cached 15 min."""
    cache_key = "sp500_ytd_v1"
    cached = kv_get(cache_key, 900)
    if cached:
        return jsonify({"status": "ok", "data": cached})

    try:
        ytd_resp = requests.get(
            "https://query1.finance.yahoo.com/v8/finance/chart/^GSPC",
            params={"range": "1y", "interval": "1d"},
            headers={"User-Agent": _YF_UA},
            timeout=10,
        )
        ytd_resp.raise_for_status()
        chart_ytd   = ytd_resp.json()["chart"]["result"][0]
        ts_ytd      = chart_ytd.get("timestamp", [])
        closes_ytd  = list(chart_ytd["indicators"]["quote"][0].get("close", []))
        cur_px      = chart_ytd.get("meta", {}).get("regularMarketPrice")
        if cur_px and closes_ytd:
            closes_ytd[-1] = cur_px

        current_year = datetime.now().year
        base_price   = None
        for t, c in zip(ts_ytd, closes_ytd):
            if c is None:
                continue
            if datetime.fromtimestamp(t).year < current_year:
                base_price = c

        year_points = [
            (t, c) for t, c in zip(ts_ytd, closes_ytd)
            if c is not None and datetime.fromtimestamp(t).year == current_year
        ]

        ytd_performance: list = []
        if base_price and year_points:
            for t, c in year_points:
                ytd_performance.append({
                    "date": datetime.fromtimestamp(t).strftime("%Y-%m-%d"),
                    "pct":  round((c / base_price - 1) * 100, 2),
                })

        result = {"ytd": ytd_performance}
        kv_set(cache_key, result)
        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        logger.error("Failed to fetch S&P 500 YTD: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


# ── Market status ──────────────────────────────────────────────────────────────

def _pick_exchange_schedule(exchange_data: dict) -> dict | None:
    """Pick the main working schedule — skip 1-second OPEN/CLOSE heartbeat schedules."""
    best, best_count = None, 0
    for schedule in exchange_data.get("workingSchedules", []):
        events = schedule.get("timeEvents", [])
        opens  = [e for e in events if e["type"] == "OPEN"]
        closes = [e for e in events if e["type"] == "CLOSE"]
        if opens and closes:
            o_ts = datetime.fromisoformat(opens[0]["date"].replace("Z", "+00:00")).timestamp()
            c_ts = datetime.fromisoformat(closes[0]["date"].replace("Z", "+00:00")).timestamp()
            if abs(c_ts - o_ts) < 60:
                continue
        if len(events) > best_count:
            best, best_count = schedule, len(events)
    return best


def _session_from_schedule(schedule: dict, now_ts: float) -> str:
    """Return current session label by finding the most recent timeEvent <= now."""
    SESSION_MAP = {
        "OPEN":              "open",
        "PRE_MARKET_OPEN":   "pre-market",
        "AFTER_HOURS_OPEN":  "after-hours",
        "OVERNIGHT_OPEN":    "after-hours",
        "AFTER_HOURS_CLOSE": "closed",
        "CLOSE":             "closed",
    }
    events  = sorted(schedule.get("timeEvents", []), key=lambda e: e["date"])
    current = None
    for ev in events:
        ev_ts = datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).timestamp()
        if ev_ts <= now_ts:
            current = ev
        else:
            break
    return SESSION_MAP.get(current["type"], "closed") if current else "closed"


def _schedule_details(schedule: dict, now_dt: datetime) -> dict:
    """Extract today's open/close times and upcoming day-pairs for the tooltip."""
    from collections import defaultdict as _dd

    events = sorted(schedule.get("timeEvents", []), key=lambda e: e["date"])
    today  = now_dt.date()

    def _parse(e):
        return datetime.fromisoformat(e["date"].replace("Z", "+00:00"))

    CLOSE_TYPES = ("CLOSE", "AFTER_HOURS_OPEN")
    today_open  = next((e for e in events if e["type"] == "OPEN"      and _parse(e).date() == today), None)
    today_close = next((e for e in events if e["type"] in CLOSE_TYPES and _parse(e).date() == today), None)

    by_day: dict = _dd(dict)
    for e in events:
        day = _parse(e).date()
        if day <= today or e["type"] not in ("OPEN",) + CLOSE_TYPES:
            continue
        if e["type"] == "OPEN" and "open" not in by_day[day]:
            by_day[day]["open"] = e["date"]
        elif e["type"] in CLOSE_TYPES and "close" not in by_day[day]:
            by_day[day]["close"] = e["date"]

    return {
        "today_open":  today_open["date"]  if today_open  else None,
        "today_close": today_close["date"] if today_close else None,
        "upcoming":    [{"open": v.get("open"), "close": v.get("close")} for _, v in sorted(by_day.items())][:5],
    }


@market_bp.route("/api/market-status")
def market_status_api():
    """NASDAQ and LSE session state from T212 exchange metadata. Session cached 60s, metadata 6h."""
    cached = kv_get("market_status", 60)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})

    TARGET = {53: "NASDAQ", 42: "LSE"}
    result: dict = {}
    try:
        exchanges_raw = kv_get("t212_exchange_meta", 21600)
        if exchanges_raw is None:
            api_key = next(iter(v for v in API_KEYS.values() if v), None)
            base    = os.environ.get("TRADING212_BASE_URL", "https://live.trading212.com")
            resp    = requests.get(
                f"{base}/api/v0/equity/metadata/exchanges",
                headers={"Authorization": f"Basic {api_key}"},
                timeout=10,
            )
            resp.raise_for_status()
            exchanges_raw = resp.json()
            kv_set("t212_exchange_meta", exchanges_raw)

        now_dt = datetime.now(timezone.utc)
        now_ts = now_dt.timestamp()
        for exch in exchanges_raw:
            if exch.get("id") in TARGET:
                name     = TARGET[exch["id"]]
                schedule = _pick_exchange_schedule(exch)
                session  = _session_from_schedule(schedule, now_ts) if schedule else "closed"
                details  = _schedule_details(schedule, now_dt)      if schedule else {}
                result[name] = {"session": session, "schedule": details}
    except Exception as exc:
        logger.warning("market_status: %s", exc)
        return jsonify({"status": "error"}), 500

    kv_set("market_status", result)
    return jsonify({"status": "ok", "data": result})


# ── Sector performance ─────────────────────────────────────────────────────────

@market_bp.route("/api/market/sector-performance")
def market_sector_performance():
    """Sector performance via SPDR ETFs (Yahoo Finance). Cached 5 min."""
    cache_key = "market:sector_perf"
    cached = kv_get(cache_key, 300)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "cached": True})

    def _fetch_etf(ticker: str) -> dict | None:
        try:
            resp = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
                params={"range": "1d", "interval": "1d", "includePrePost": "true"},
                headers={"User-Agent": _YF_UA},
                timeout=8,
            )
            resp.raise_for_status()
            meta         = resp.json()["chart"]["result"][0]["meta"]
            market_state = meta.get("marketState", "REGULAR")

            price = change_pct = None
            if market_state == "PRE":
                price      = meta.get("preMarketPrice")
                change_pct = meta.get("preMarketChangePercent")
            elif market_state in ("POST", "POSTPOST", "PREPRE", "CLOSED"):
                price = meta.get("postMarketPrice")
                prev  = meta.get("chartPreviousClose") or meta.get("previousClose")
                if price is not None and prev and prev != 0:
                    change_pct = (price - prev) / prev * 100
            if price is None:
                price      = meta.get("regularMarketPrice")
                change_pct = meta.get("regularMarketChangePercent")
            if price is not None and change_pct is None:
                prev = meta.get("chartPreviousClose") or meta.get("previousClose")
                if prev and prev != 0:
                    change_pct = (price - prev) / prev * 100
            return {
                "ticker":     ticker,
                "sector":     _SECTOR_ETFS[ticker],
                "change_pct": round(change_pct, 4) if change_pct is not None else 0.0,
                "price":      round(price,      4) if price      is not None else None,
            }
        except Exception as exc:
            logger.warning("sector ETF fetch failed for %s: %s", ticker, exc)
            return None

    result: list = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=11) as ex:
        for entry in ex.map(_fetch_etf, list(_SECTOR_ETFS.keys())):
            if entry is not None:
                result.append(entry)

    if result:
        kv_set(cache_key, result)
    return jsonify({"status": "ok", "data": result, "cached": False})


# ── News & market digest ───────────────────────────────────────────────────────

def fetch_and_cache_news() -> list | None:
    """Fetch general market news from Finnhub and store in cache.

    Called by both the /api/news endpoint and the background news-refresh thread.
    Returns the news list, or None if FINNHUB_TOKEN is not configured.
    """
    if not FINNHUB_TOKEN:
        return None
    resp = requests.get(
        f"https://finnhub.io/api/v1/news?category=general&token={FINNHUB_TOKEN}",
        timeout=10,
    )
    resp.raise_for_status()
    news = resp.json()
    kv_set("general_market_news", news)
    return news


@market_bp.route("/api/news")
def api_news():
    """General market news from Finnhub. ?force=1 bypasses cache."""
    if flask_request.args.get("force") != "1":
        cached = kv_get("general_market_news", TTL_NEWS)
        if cached:
            return jsonify({"status": "ok", "data": cached})
    try:
        news = fetch_and_cache_news()
        if news is None:
            return jsonify({"status": "error", "message": "Finnhub token not configured"}), 500
        return jsonify({"status": "ok", "data": news})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@market_bp.route("/api/market-digest")
def market_digest():
    """Daily market digest from Finviz. ?provider=finviz  ?refresh=1 — bypass cache."""
    provider = flask_request.args.get("provider", "finviz").lower()
    if provider not in ("finviz", "claude", "gemini"):
        return jsonify({"status": "error", "message": f"Unknown provider '{provider}'"}), 400

    force     = flask_request.args.get("refresh", "0") == "1"
    cache_key = f"ai_digest:{provider}"
    TTL_DIGEST = 300

    if not force:
        cached = kv_get(cache_key, TTL_DIGEST)
        if cached is not None:
            return jsonify({"status": "ok", "provider": provider, "digest": cached, "cached": True})

    context = {
        "indicators": kv_get("market_indicators", TTL_DIGEST) or {},
        "gainers":    (kv_get("finviz:signals:gainers", 600) or [])[:10],
        "losers":     (kv_get("finviz:signals:losers",  600) or [])[:10],
        "news":       (kv_get("news", TTL_NEWS) or [])[:8],
    }
    try:
        text = _ai_digest.generate_digest(provider, context)
    except Exception as exc:
        logger.error("AI digest failed (provider=%s): %s", provider, exc)
        return jsonify({"status": "error", "message": str(exc)}), 500

    kv_set(cache_key, text)
    return jsonify({"status": "ok", "provider": provider, "digest": text, "cached": False})


# ── Macro economic calendar ───────────────────────────────────────────────────

# Hardcoded schedule — central banks publish dates ~1 year in advance.
# Update this list each January when institutions release their annual schedule.
_MACRO_CALENDAR = [
    # ── FOMC (US Federal Reserve) ────────────────────────────────────────────
    {"date": "2025-01-29", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2025-03-19", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2025-05-07", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2025-06-18", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2025-07-30", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2025-09-17", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2025-10-29", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2025-12-10", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2026-01-28", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2026-03-18", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2026-04-29", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2026-06-17", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2026-07-29", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2026-09-16", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2026-10-28", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    {"date": "2026-12-09", "category": "fomc", "label": "Fed Rate Decision", "country": "US", "description": "Federal Open Market Committee interest rate decision"},
    # ── BoE (Bank of England) ────────────────────────────────────────────────
    {"date": "2025-02-06", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2025-03-20", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2025-05-08", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2025-06-19", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2025-08-07", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2025-09-18", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2025-11-06", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2025-12-18", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2026-02-05", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2026-03-19", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2026-05-07", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2026-06-18", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2026-08-06", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2026-09-17", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2026-11-05", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    {"date": "2026-12-17", "category": "boe", "label": "BoE Rate Decision", "country": "UK", "description": "Bank of England Monetary Policy Committee rate decision"},
    # ── ECB (European Central Bank) ──────────────────────────────────────────
    {"date": "2025-01-30", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2025-03-06", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2025-04-17", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2025-06-05", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2025-07-24", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2025-09-11", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2025-10-30", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2025-12-18", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2026-01-22", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2026-03-05", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2026-04-23", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2026-06-04", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2026-07-23", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2026-09-10", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2026-10-29", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    {"date": "2026-12-17", "category": "ecb", "label": "ECB Rate Decision", "country": "EU", "description": "European Central Bank Governing Council interest rate decision"},
    # ── US CPI (BLS Consumer Price Index release) ────────────────────────────
    {"date": "2025-02-12", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Jan 2025"},
    {"date": "2025-03-12", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Feb 2025"},
    {"date": "2025-04-10", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Mar 2025"},
    {"date": "2025-05-13", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Apr 2025"},
    {"date": "2025-06-11", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — May 2025"},
    {"date": "2025-07-15", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Jun 2025"},
    {"date": "2025-08-12", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Jul 2025"},
    {"date": "2025-09-10", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Aug 2025"},
    {"date": "2025-10-15", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Sep 2025"},
    {"date": "2025-11-12", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Oct 2025"},
    {"date": "2025-12-10", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Nov 2025"},
    {"date": "2026-01-14", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Dec 2025"},
    {"date": "2026-02-11", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Jan 2026"},
    {"date": "2026-03-11", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Feb 2026"},
    {"date": "2026-04-09", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Mar 2026"},
    {"date": "2026-05-13", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Apr 2026"},
    {"date": "2026-06-10", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — May 2026"},
    {"date": "2026-07-15", "category": "cpi", "label": "US CPI", "country": "US", "description": "Bureau of Labor Statistics Consumer Price Index — Jun 2026"},
    # ── US NFP (BLS Non-Farm Payrolls / Jobs Report) ─────────────────────────
    {"date": "2025-02-07", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Jan 2025"},
    {"date": "2025-03-07", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Feb 2025"},
    {"date": "2025-04-04", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Mar 2025"},
    {"date": "2025-05-02", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Apr 2025"},
    {"date": "2025-06-06", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — May 2025"},
    {"date": "2025-07-03", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Jun 2025"},
    {"date": "2025-08-01", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Jul 2025"},
    {"date": "2025-09-05", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Aug 2025"},
    {"date": "2025-10-03", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Sep 2025"},
    {"date": "2025-11-07", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Oct 2025"},
    {"date": "2025-12-05", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Nov 2025"},
    {"date": "2026-01-09", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Dec 2025"},
    {"date": "2026-02-06", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Jan 2026"},
    {"date": "2026-03-06", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Feb 2026"},
    {"date": "2026-04-03", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Mar 2026"},
    {"date": "2026-05-01", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Apr 2026"},
    {"date": "2026-06-05", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — May 2026"},
    {"date": "2026-07-02", "category": "nfp", "label": "US Jobs Report", "country": "US", "description": "Bureau of Labor Statistics Non-Farm Payrolls — Jun 2026"},
    # ── US GDP Advance Estimate (BEA, ~4 weeks after quarter end) ────────────
    {"date": "2025-04-30", "category": "gdp", "label": "US GDP (Advance)", "country": "US", "description": "Bureau of Economic Analysis advance GDP estimate — Q1 2025"},
    {"date": "2025-07-30", "category": "gdp", "label": "US GDP (Advance)", "country": "US", "description": "Bureau of Economic Analysis advance GDP estimate — Q2 2025"},
    {"date": "2025-10-29", "category": "gdp", "label": "US GDP (Advance)", "country": "US", "description": "Bureau of Economic Analysis advance GDP estimate — Q3 2025"},
    {"date": "2026-01-28", "category": "gdp", "label": "US GDP (Advance)", "country": "US", "description": "Bureau of Economic Analysis advance GDP estimate — Q4 2025"},
    {"date": "2026-04-29", "category": "gdp", "label": "US GDP (Advance)", "country": "US", "description": "Bureau of Economic Analysis advance GDP estimate — Q1 2026"},
    {"date": "2026-07-29", "category": "gdp", "label": "US GDP (Advance)", "country": "US", "description": "Bureau of Economic Analysis advance GDP estimate — Q2 2026"},
    # ── UK CPI (ONS Consumer Price Index) ────────────────────────────────────
    {"date": "2025-02-19", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Jan 2025"},
    {"date": "2025-03-26", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Feb 2025"},
    {"date": "2025-04-16", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Mar 2025"},
    {"date": "2025-05-21", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Apr 2025"},
    {"date": "2025-06-18", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — May 2025"},
    {"date": "2025-07-16", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Jun 2025"},
    {"date": "2025-08-20", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Jul 2025"},
    {"date": "2025-09-17", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Aug 2025"},
    {"date": "2025-10-15", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Sep 2025"},
    {"date": "2025-11-19", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Oct 2025"},
    {"date": "2025-12-17", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Nov 2025"},
    {"date": "2026-01-21", "category": "cpi", "label": "UK CPI", "country": "UK", "description": "ONS Consumer Price Index — Dec 2025"},
]


@market_bp.route("/api/macro-events")
def macro_events():
    """Hardcoded macro economic calendar filtered to next 60 days. Cached 24h."""
    cache_key = "macro:calendar:v1"
    cached = kv_get(cache_key, 86400)
    if cached:
        return jsonify({"status": "ok", "data": cached})

    today = date.today().isoformat()
    cutoff = (date.today() + timedelta(days=60)).isoformat()
    filtered = [e for e in _MACRO_CALENDAR if today <= e["date"] <= cutoff]
    filtered.sort(key=lambda x: x["date"])

    kv_set(cache_key, filtered)
    return jsonify({"status": "ok", "data": filtered})


# ── Earnings & stock data ──────────────────────────────────────────────────────

@market_bp.route("/api/earnings")
def earnings():
    """Upcoming earnings for held US stocks over the next 6 months. Per-symbol cache 1 day.

    Data source: Savvy Trader (https://api.savvytrader.com/pricing/assets/{symbol}/earnings).
    Returns full history; filtered here to today → +183 days.
    """
    def _hour_from_time(t: str) -> str:
        """Derive AMC/BMO/DMH from earningsTime (HH:MM:SS, US Eastern)."""
        if not t:
            return ""
        if t >= "16:00:00":
            return "amc"
        if t < "09:30:00":
            return "bmo"
        return "dmh"

    try:
        us_tickers: dict = {}
        for pid, key in API_KEYS.items():
            if not key:
                continue
            rows, _ = rows_get(pid)
            if rows:
                for r in rows:
                    if r.get("country") == "US":
                        symbol = r["ticker"].upper()
                        if symbol not in us_tickers:
                            us_tickers[symbol] = r.get("company_name") or symbol

        today_str = str(date.today())
        end_str   = str(date.today() + timedelta(days=183))
        all_earnings: list = []

        for symbol, company_name in us_tickers.items():
            cache_key = f"savvy:earnings:{symbol}"
            data      = kv_get(cache_key, TTL_EARNINGS)
            if data is None:
                try:
                    resp = requests.get(
                        f"https://api.savvytrader.com/pricing/assets/{symbol}/earnings",
                        timeout=10,
                    )
                    data = resp.json() if resp.status_code == 200 else []
                    if not isinstance(data, list):
                        data = []
                except Exception:
                    data = []
                kv_set(cache_key, data)

            for e in data:
                d = e.get("earningsDate", "")
                if not d or d < today_str or d > end_str:
                    continue
                period  = e.get("period", "")
                quarter = int(period[1]) if period and period.startswith("Q") and len(period) > 1 else None
                all_earnings.append({
                    "date":            d,
                    "symbol":          symbol,
                    "quarter":         quarter,
                    "year":            e.get("periodYear"),
                    "hour":            _hour_from_time(e.get("earningsTime", "")),
                    "epsEstimate":     e.get("epsEstimate"),
                    "revenueEstimate": e.get("revenueEstimate"),
                    "isDateConfirmed": e.get("isDateConfirmed", False),
                    "_company_name":   company_name,
                })

        all_earnings.sort(key=lambda x: x.get("date", ""))
        return jsonify({"status": "ok", "data": all_earnings})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@market_bp.route("/api/stock-earnings/<ticker>")
def stock_earnings_history(ticker):
    """Full earnings history for one ticker from Savvy Trader. Cached 24h.

    Shares the same cache key as the portfolio /api/earnings route so a warm
    portfolio fetch avoids a duplicate network call here.
    """
    ticker    = ticker.upper().strip()
    cache_key = f"savvy:earnings:{ticker}"
    try:
        data = kv_get(cache_key, TTL_EARNINGS)
        if data is None:
            resp = requests.get(
                f"https://api.savvytrader.com/pricing/assets/{ticker}/earnings",
                timeout=10,
            )
            data = resp.json() if resp.status_code == 200 else []
            if not isinstance(data, list):
                data = []
            kv_set(cache_key, data)
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@market_bp.route("/api/stock-tickers")
def stock_tickers_api():
    """Live price + today's change for all held stocks. Per-ticker cache 5s (very short)."""
    all_rows: list = []
    for pid in API_KEYS:
        rows, _ = fetch_and_cache_portfolio(pid)
        if rows:
            all_rows.extend(rows)

    seen, unique = set(), []
    for row in all_rows:
        t = row["ticker"]
        if t not in seen:
            seen.add(t)
            unique.append(row)

    result_map:  dict = {}
    needs_fetch: list = []
    for row in unique:
        ticker    = row["ticker"]
        cache_key = f"tick:{ticker}"
        cached    = kv_get(cache_key, 5)
        if cached is not None:
            result_map[ticker] = cached
        else:
            needs_fetch.append(row)

    if needs_fetch:
        sym_to_row: dict = {}
        for row in needs_fetch:
            ticker        = row["ticker"]
            country       = row.get("country", "US")
            clean, yf_sym = _build_yf_symbol(ticker, country)
            sym_to_row[yf_sym] = (ticker, clean, row)

        quotes: list = []
        for attempt in range(2):
            try:
                crumb, cookies = _yf_crumb()
                resp = requests.get(
                    "https://query1.finance.yahoo.com/v7/finance/quote",
                    params={"symbols": ",".join(sym_to_row.keys()), "crumb": crumb},
                    headers={"User-Agent": _YF_UA, "Cookie": cookies},
                    timeout=12,
                )
                if resp.status_code == 401 and attempt == 0:
                    kv_set("yf:crumb:v3", None)
                    continue
                resp.raise_for_status()
                quotes = resp.json().get("quoteResponse", {}).get("result", [])
                break
            except Exception as exc:
                logger.warning("stock_tickers batch quote failed: %s", exc)
                break

        for q in quotes:
            yf_sym = q.get("symbol", "")
            if yf_sym not in sym_to_row:
                continue
            ticker, clean_ticker, row = sym_to_row[yf_sym]
            market_state = q.get("marketState", "REGULAR")

            price = change = change_pct = None
            if market_state == "PRE":
                price      = q.get("preMarketPrice")
                change     = q.get("preMarketChange")
                change_pct = q.get("preMarketChangePercent")
            elif market_state in ("POST", "POSTPOST", "PREPRE", "CLOSED"):
                price = q.get("postMarketPrice")
                prev  = q.get("regularMarketPreviousClose") or q.get("chartPreviousClose")
                if price is not None and prev and prev != 0:
                    change     = price - prev
                    change_pct = (change / prev) * 100
            if price is None:
                price      = q.get("regularMarketPrice")
                change     = q.get("regularMarketChange")
                change_pct = q.get("regularMarketChangePercent")
            if price is not None and (change is None or change_pct is None):
                prev = q.get("regularMarketPreviousClose") or q.get("chartPreviousClose")
                if prev and prev != 0 and prev != price:
                    change     = price - prev
                    change_pct = (change / prev) * 100

            info = {
                "ticker":        clean_ticker,
                "company_name":  row.get("company_name", ticker),
                "price":         round(price,      4) if price      is not None else None,
                "change":        round(change,     4) if change     is not None else None,
                "change_pct":    round(change_pct, 4) if change_pct is not None else None,
                "currency":      q.get("currency", ""),
                "market_state":  market_state,
                "current_value": row.get("current_value"),
                "sector":        row.get("sector", "Other"),
                "quantity":      row.get("quantity"),
                "avg_price":     row.get("avg_price"),
                "invested":      row.get("invested"),
                "total_returns": row.get("total_returns"),
                "returns_pct":   row.get("returns_pct"),
                "country":       row.get("country"),
            }
            if change is not None and change_pct is not None:
                kv_set(f"tick:{ticker}", info)
            result_map[ticker] = info

    result = [result_map[row["ticker"]] for row in unique if row["ticker"] in result_map]
    return jsonify({"status": "ok", "data": result})


@market_bp.route("/api/stock-sparklines")
def stock_sparklines():
    """Hourly price sparklines for multiple tickers via Yahoo Finance. Cached 15 min.
    ?range=2d (default, 48h) or ?range=5d"""
    tickers_raw   = flask_request.args.get("tickers", "")
    countries_raw = flask_request.args.get("countries", "")
    range_req     = flask_request.args.get("range", "2d")
    if not tickers_raw:
        return jsonify({"status": "ok", "data": {}})

    tickers   = [t.strip() for t in tickers_raw.split(",") if t.strip()]
    countries = [c.strip().upper() for c in countries_raw.split(",")]
    if len(countries) < len(tickers):
        countries += ["US"] * (len(tickers) - len(countries))

    yf_range = "5d" if range_req == "5d" else "2d"
    result:  dict = {}
    for ticker, country in zip(tickers, countries):
        cache_key = f"stock_spark:{ticker}:{country}:{yf_range}"
        cached    = kv_get(cache_key, 900)
        if cached is not None:
            result[ticker] = cached
            continue
        _, yf_symbol = _build_yf_symbol(ticker, country)
        try:
            points = _yf_fetch_points(yf_symbol, yf_range, "1h")
            if len(points) < 2:
                points = _yf_fetch_points(yf_symbol, yf_range, "1d")
            if len(points) >= 2:
                kv_set(cache_key, points)
            result[ticker] = points
        except Exception as exc:
            logger.warning("stock_sparkline failed for %s: %s", yf_symbol, exc)
            result[ticker] = []
    return jsonify({"status": "ok", "data": result})


@market_bp.route("/api/stock-chart/<ticker>")
def stock_chart(ticker):
    """OHLCV candle data. ?period=1d|1w|1m|1y|5y  ?country=US|UK|..."""
    ticker  = ticker.upper()
    period  = flask_request.args.get("period", "1w").strip()
    country = flask_request.args.get("country", "US").strip().upper()

    PERIOD_MAP = {
        "1d": ("1d",  "5m"),  "1w": ("5d", "1h"),
        "1m": ("1mo", "1d"),  "1y": ("1y", "1d"),  "5y": ("5y", "1wk"),
    }
    if period not in PERIOD_MAP:
        period = "1w"
    range_, interval_ = PERIOD_MAP[period]
    _, symbol         = _build_yf_symbol(ticker, country)

    cache_key        = f"stock:chart:v2:{symbol}:{period}"
    TTL              = 60 if period == "1d" else 300 if period == "1w" else 3600
    include_pre_post = "true" if period in ("1d", "1w") else "false"

    try:
        data = kv_get(cache_key, TTL)
        if data is None:
            resp = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
                params={"range": range_, "interval": interval_, "includePrePost": include_pre_post},
                headers={"User-Agent": _YF_UA},
                timeout=10,
            )
            resp.raise_for_status()
            result   = resp.json()["chart"]["result"][0]
            meta     = result.get("meta", {})
            ts_list  = result.get("timestamp", [])
            q        = result["indicators"]["quote"][0]
            candles: list = []
            for i, t in enumerate(ts_list):
                o = q.get("open",   [])[i] if i < len(q.get("open",   [])) else None
                h = q.get("high",   [])[i] if i < len(q.get("high",   [])) else None
                l = q.get("low",    [])[i] if i < len(q.get("low",    [])) else None
                c = q.get("close",  [])[i] if i < len(q.get("close",  [])) else None
                v = q.get("volume", [])[i] if i < len(q.get("volume", [])) else None
                if None in (o, h, l, c):
                    continue
                candles.append({
                    "ts": int(t),
                    "o": round(float(o), 4), "h": round(float(h), 4),
                    "l": round(float(l), 4), "c": round(float(c), 4),
                    "v": int(v) if v else 0,
                })
            market_state = meta.get("marketState", "REGULAR")
            ext_price    = None
            if market_state == "PRE":
                ext_price = meta.get("preMarketPrice")
            elif market_state in ("POST", "POSTPOST", "PREPRE", "CLOSED"):
                ext_price = meta.get("postMarketPrice")
            data = {
                "candles":      candles,
                "currency":     meta.get("currency", ""),
                "market_state": market_state,
                "ext_price":    round(ext_price, 4) if ext_price is not None else None,
            }
            if candles:
                kv_set(cache_key, data)
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@market_bp.route("/api/stock-metrics/<ticker>")
def stock_metrics(ticker):
    """Fundamental metrics for a ticker from Finnhub. Cached 24h."""
    if not FINNHUB_TOKEN:
        return jsonify({"status": "error", "message": "Finnhub token not configured"}), 503
    ticker    = ticker.upper()
    cache_key = f"finnhub:metrics:{ticker}"
    try:
        data = kv_get(cache_key, TTL_EARNINGS)
        if data is None:
            resp = requests.get(
                f"https://finnhub.io/api/v1/stock/metric?symbol={ticker}&metric=all&token={FINNHUB_TOKEN}",
                timeout=10,
            )
            data = resp.json() if resp.status_code == 200 else {}
            if not isinstance(data, dict):
                data = {}
            kv_set(cache_key, data)
        return jsonify({"status": "ok", "data": data.get("metric", {})})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@market_bp.route("/api/stock-news/<ticker>")
def stock_news(ticker):
    """Company news for a ticker from Finnhub (up to 1 year). Cached 30 min."""
    if not FINNHUB_TOKEN:
        return jsonify({"status": "error", "message": "Finnhub token not configured"}), 503
    ticker    = ticker.upper()
    cache_key = f"finnhub:news:{ticker}"
    try:
        data = kv_get(cache_key, TTL_STOCK_NEWS)
        if data is None:
            today     = date.today()
            from_date = today - timedelta(days=365)
            resp      = requests.get(
                f"https://finnhub.io/api/v1/company-news"
                f"?symbol={ticker}&from={from_date}&to={today}&token={FINNHUB_TOKEN}",
                timeout=10,
            )
            data = resp.json() if resp.status_code == 200 else []
            if not isinstance(data, list):
                data = []
            kv_set(cache_key, data)
        data.sort(key=lambda x: x.get("datetime", 0), reverse=True)
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@market_bp.route("/api/stock-historical-returns")
def stock_historical_returns():
    """Batch fetch 1d–5y performance for arbitrary tickers. Returns {ticker: {ret1d, ...}}."""
    from yf import _fetch_hist_returns_one

    tickers_str   = flask_request.args.get("tickers", "")
    countries_str = flask_request.args.get("countries", "")
    if not tickers_str:
        return jsonify({"status": "ok", "data": {}})

    tickers   = [t.strip().upper() for t in tickers_str.split(",") if t.strip()]
    countries = [c.strip().upper() for c in countries_str.split(",") if c.strip()]
    if len(countries) < len(tickers):
        pad = countries[-1] if countries else "US"
        countries += [pad] * (len(tickers) - len(countries))

    results: dict = {}
    errors:  dict = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(tickers), 15)) as ex:
        futures = {ex.submit(_fetch_hist_returns_one, t, c): t for t, c in zip(tickers, countries)}
        for future in concurrent.futures.as_completed(futures):
            try:
                ticker, data, err = future.result()
                if data:
                    results[ticker] = data
                if err:
                    errors[ticker] = err
            except Exception as e:
                logger.error("future failed: %s", e)

    return jsonify({"status": "ok", "data": results, "errors": errors or None})


# ── TradingView forecast scraper ───────────────────────────────────────────────

def _get_tv_forecast(ticker: str, country: str = "US") -> dict | None:
    """Scrape analyst price targets and recommendation from TradingView.

    Tries multiple exchanges for the given country.  Returns a dict with avg/high/low
    price targets and the recommendation text, or None if the page could not be fetched.
    """
    exchange_mapping = {
        "US": ["NASDAQ", "NYSE", "AMEX", "OTC"],
        "UK": ["LSE"],      "GB": ["LSE"],
        "DE": ["XETR"],     "FR": ["EURONEXT"],
        "CA": ["TSX", "TSXV", "OTC", "NASDAQ", "NYSE"],
        "ES": ["LSE", "BME"], "NL": ["EURONEXT"],
        "IE": ["LSE", "EURONEXT", "MIL"],
    }

    clean_ticker = ticker[:-1] if ticker.endswith("l") and len(ticker) > 1 and ticker[:-1].isupper() else ticker
    exchanges    = exchange_mapping.get(country.upper(), ["NASDAQ", "NYSE", "AMEX", "OTC"])
    headers      = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"}

    html = ""
    for ex in exchanges:
        url = f"https://www.tradingview.com/symbols/{ex}-{clean_ticker}/forecast/"
        for attempt in range(3):
            try:
                resp = requests.get(url, headers=headers, timeout=5)
                if resp.status_code == 200:
                    html = resp.text
                    break
                if resp.status_code == 429:
                    time.sleep(0.5 * (attempt + 1))
            except Exception:
                pass
        if html:
            break
    if not html:
        return None

    avg_target = max_target = min_target = None

    m1 = re.search(
        r'price target is.*?([\d,\.]+).*?with a max estimate of.*?([\d,\.]+).*?and a min estimate of.*?([\d,\.]+)',
        html, re.IGNORECASE,
    )
    if m1:
        avg_target = float(m1.group(1).replace(",", ""))
        max_target = float(m1.group(2).replace(",", ""))
        min_target = float(m1.group(3).replace(",", ""))

    if avg_target is None:
        m2 = re.search(
            r'"priceTarget"\s*:\s*\{[^}]*"mean"\s*:\s*([\d\.]+)[^}]*"high"\s*:\s*([\d\.]+)[^}]*"low"\s*:\s*([\d\.]+)',
            html, re.DOTALL,
        )
        if not m2:
            m2 = re.search(
                r'"priceTarget"\s*:\s*\{[^}]*"low"\s*:\s*([\d\.]+)[^}]*"mean"\s*:\s*([\d\.]+)[^}]*"high"\s*:\s*([\d\.]+)',
                html, re.DOTALL,
            )
        if m2:
            try:
                avg_target = float(m2.group(2)) if m2.lastindex == 3 else float(m2.group(1))
                max_target = float(m2.group(3)) if m2.lastindex == 3 else float(m2.group(2))
                min_target = float(m2.group(1)) if m2.lastindex == 3 else float(m2.group(3))
            except Exception:
                pass

    if avg_target is None:
        fq_raw = re.search(r'"initForecastQuotes"\s*:\s*\{(.{10,3000})', html, re.DOTALL)
        if fq_raw:
            fq_text = fq_raw.group(1)
            def _gf(pat, t):
                mm = re.search(pat, t)
                return float(mm.group(1)) if mm else None
            avg_target = _gf(r'"targetMean"\s*:\s*([\d\.]+)', fq_text) or _gf(r'"targetPrice"\s*:\s*([\d\.]+)', fq_text)
            max_target = _gf(r'"targetHigh"\s*:\s*([\d\.]+)', fq_text)
            min_target = _gf(r'"targetLow"\s*:\s*([\d\.]+)', fq_text)

    rec_text = "NEUTRAL"
    m3 = re.search(r'(?i)rating was calculated as\s+([A-Za-z\s]+)\.', html)
    if m3:
        rec_text = m3.group(1).strip().upper()
    else:
        m_fq = re.search(r'"initForecastQuotes":({.*?})', html)
        if m_fq:
            try:
                mark_match = re.search(r'"recommendation_mark"\s*:\s*([\d\.]+)', m_fq.group(1))
                if mark_match:
                    rec_mark = float(mark_match.group(1))
                    if rec_mark < 1.5:   rec_text = "STRONG BUY"
                    elif rec_mark < 2.5: rec_text = "BUY"
                    elif rec_mark < 3.5: rec_text = "HOLD"
                    elif rec_mark < 4.5: rec_text = "SELL"
                    else:                rec_text = "STRONG SELL"
            except Exception:
                pass

    analyst_total = strong_buy = buy_count = hold_count = sell_count = strong_sell = 0
    fq_match = re.search(r'"initForecastQuotes"\s*:\s*\{(.{10,2000})', html, re.DOTALL)
    if fq_match:
        fq = fq_match.group(1)
        def _gi(pat, t):
            mm = re.search(pat, t)
            return int(mm.group(1)) if mm else 0
        analyst_total = _gi(r'"recommendation_total"\s*:\s*(\d+)', fq)
        strong_buy    = _gi(r'"strongBuy"\s*:\s*(\d+)', fq)
        buy_count     = _gi(r'"buy"\s*:\s*(\d+)', fq)
        hold_count    = _gi(r'"hold"\s*:\s*(\d+)', fq)
        sell_count    = _gi(r'"sell"\s*:\s*(\d+)', fq)
        strong_sell   = _gi(r'"strongSell"\s*:\s*(\d+)', fq)

    counts_total = strong_buy + buy_count + hold_count + sell_count + strong_sell
    return {
        "ticker":       ticker,
        "avg":          avg_target,
        "high":         max_target,
        "low":          min_target,
        "rec_text":     rec_text,
        "strongBuy":    strong_buy,
        "buy":          buy_count,
        "hold":         hold_count,
        "sell":         sell_count,
        "strongSell":   strong_sell,
        "total":        counts_total if counts_total > 0 else analyst_total,
        "hasBreakdown": counts_total > 0,
    }


# ── Analyst ratings ────────────────────────────────────────────────────────────

@market_bp.route("/api/analyst-ratings")
def analyst_ratings():
    """TradingView analyst consensus for all held stocks. Cached 24h per ticker."""
    try:
        all_tickers: dict = {}
        for pid in ["1", "2"]:
            rows, _ = fetch_and_cache_portfolio(pid)
            if rows:
                for r in rows:
                    ticker = r.get("ticker")
                    sector = (r.get("sector") or "").lower()
                    if ticker and ticker not in all_tickers and "index" not in sector:
                        all_tickers[ticker] = r.get("country", "US")

        if not all_tickers:
            return jsonify({"status": "ok", "data": {}})

        result: dict = {}
        for ticker, country in sorted(all_tickers.items()):
            cache_key = f"tv:analyst:v4:{ticker}"
            data      = kv_get(cache_key, TTL_EARNINGS)
            if data is None:
                data = _get_tv_forecast(ticker, country) or {}
                kv_set(cache_key, data)

            rec_text = (data.get("rec_text") or "NEUTRAL").upper()
            total    = data.get("total", 0)
            if not data or (total == 0 and rec_text == "NEUTRAL"):
                continue

            strong_buy  = data.get("strongBuy", 0)
            buy         = data.get("buy", 0)
            hold        = data.get("hold", 0)
            sell        = data.get("sell", 0)
            strong_sell = data.get("strongSell", 0)
            has_breakdown = data.get("hasBreakdown", False)

            if has_breakdown and total > 0:
                score = (strong_buy * 1 + buy * 2 + hold * 3 + sell * 4 + strong_sell * 5) / total
                if score <= 1.5:   consensus = "Strong Buy"
                elif score <= 2.5: consensus = "Buy"
                elif score <= 3.5: consensus = "Hold"
                elif score <= 4.5: consensus = "Sell"
                else:              consensus = "Strong Sell"
            else:
                _map = {
                    "STRONG BUY": "Strong Buy", "BUY": "Buy",
                    "NEUTRAL": "Hold", "HOLD": "Hold",
                    "SELL": "Sell", "STRONG SELL": "Strong Sell",
                }
                consensus = _map.get(rec_text, "Hold")

            result[ticker] = {
                "strongBuy": strong_buy, "buy": buy, "hold": hold,
                "sell": sell, "strongSell": strong_sell, "total": total,
                "hasBreakdown": has_breakdown, "period": "past 3 months",
                "consensus": consensus,
                "avgTarget":  data.get("avg"),
                "highTarget": data.get("high"),
                "lowTarget":  data.get("low"),
            }

        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ── Watchlist ──────────────────────────────────────────────────────────────────

@market_bp.route("/api/watchlist/signals")
def watchlist_signals():
    """TradingView analyst targets for any arbitrary ticker (watchlist use)."""
    ticker  = flask_request.args.get("ticker", "").strip().upper()
    country = flask_request.args.get("country", "US").strip().upper()
    if not ticker:
        return jsonify({"status": "error", "message": "ticker required"}), 400
    try:
        cache_key = f"tv:analyst:v4:{ticker}"
        data      = kv_get(cache_key, TTL_EARNINGS)
        if data is None:
            data = _get_tv_forecast(ticker, country) or {}
            if data:
                kv_set(cache_key, data)
        return jsonify({
            "status": "ok",
            "data": {
                "avg":      data.get("avg"),
                "high":     data.get("high"),
                "low":      data.get("low"),
                "rec_text": data.get("rec_text", "NEUTRAL"),
            },
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@market_bp.route("/api/watchlist/fundamentals")
def watchlist_fundamentals():
    """Market cap, LTM revenue, P/E ratios, and 6m/1y/YTD returns for a ticker. Cached 24h."""
    ticker  = flask_request.args.get("ticker", "").strip().upper()
    country = flask_request.args.get("country", "US").strip().upper()
    if not ticker:
        return jsonify({"status": "error", "message": "ticker required"}), 400
    try:
        cache_key = f"wl:fundamentals4:{ticker}:{country}"
        cached    = kv_get(cache_key, TTL_EARNINGS)
        if cached is not None:
            return jsonify({"status": "ok", "data": cached})

        clean_ticker, yf_sym = _build_yf_symbol(ticker, country)
        summary = _yf_summary(
            yf_sym,
            modules="financialData,defaultKeyStatistics,summaryDetail,incomeStatementHistory",
        )
        fin    = summary.get("financialData", {})
        stats  = summary.get("defaultKeyStatistics", {})
        detail = summary.get("summaryDetail", {})

        def _raw(d, key):
            v = d.get(key)
            return v.get("raw") if isinstance(v, dict) else v

        market_cap      = _raw(stats, "marketCap") or _raw(detail, "marketCap")
        total_revenue   = _raw(fin, "totalRevenue")
        trailing_pe     = _raw(detail, "trailingPE") or _raw(stats, "trailingPE")
        forward_pe_val  = _raw(stats, "forwardPE") or _raw(detail, "forwardPE")

        rev_multiple = (round(market_cap / total_revenue, 1)
                        if market_cap and total_revenue and total_revenue > 0 else None)
        pe_ratio  = round(trailing_pe,   1) if trailing_pe   and trailing_pe   > 0 else None
        forward_pe = round(forward_pe_val, 1) if forward_pe_val and forward_pe_val > 0 else None

        pe_5yr_avg = None
        try:
            statements = summary.get("incomeStatementHistory", {}).get("incomeStatementHistory", [])
            if statements:
                price_points = _yf_fetch_points(yf_sym, "5y", "1mo")
                if price_points:
                    pe_values: list = []
                    for stmt in statements[:5]:
                        end_date = stmt.get("endDate")
                        end_ts   = end_date.get("raw") if isinstance(end_date, dict) else None
                        eps_raw  = stmt.get("basicEps")
                        eps_val  = eps_raw.get("raw") if isinstance(eps_raw, dict) else eps_raw
                        if not end_ts or not eps_val or eps_val <= 0:
                            continue
                        closest = min(price_points, key=lambda p: abs(p["ts"] - end_ts))
                        if abs(closest["ts"] - end_ts) < 120 * 86400:
                            pe = closest["price"] / eps_val
                            if 0 < pe < 2000:
                                pe_values.append(pe)
                    if pe_values:
                        pe_5yr_avg = round(sum(pe_values) / len(pe_values), 1)
        except Exception:
            pass

        return_6m = return_1y = return_ytd = None
        try:
            pts = _yf_fetch_points(yf_sym, "1y", "1d")
            if pts:
                latest = pts[-1]["price"]
                def _ret_at(days):
                    target_ts = pts[-1]["ts"] - days * 86400
                    closest   = min(pts, key=lambda p: abs(p["ts"] - target_ts))
                    if abs(closest["ts"] - target_ts) < 10 * 86400 and closest["price"] > 0:
                        return round((latest / closest["price"] - 1) * 100, 2)
                    return None
                return_6m  = _ret_at(182)
                return_1y  = _ret_at(365)
                days_ytd   = (date.today() - date(date.today().year, 1, 1)).days
                if days_ytd > 0:
                    return_ytd = _ret_at(days_ytd)
        except Exception:
            pass

        data = {
            "market_cap":   market_cap,
            "revenue":      total_revenue,
            "rev_multiple": rev_multiple,
            "pe_ratio":     pe_ratio,
            "forward_pe":   forward_pe,
            "pe_5yr_avg":   pe_5yr_avg,
            "return_6m":    return_6m,
            "return_1y":    return_1y,
            "return_ytd":   return_ytd,
        }
        kv_set(cache_key, data)
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        logger.warning("watchlist_fundamentals error for %s: %s", ticker, e)
        return jsonify({"status": "error", "message": str(e)}), 500


@market_bp.route("/api/watchlist/price")
def watchlist_price():
    """Current price + company name for any ticker. Cached 60s."""
    ticker  = flask_request.args.get("ticker", "").strip()
    country = flask_request.args.get("country", "US").strip().upper()
    if not ticker:
        return jsonify({"status": "error", "message": "ticker required"}), 400
    try:
        cache_key = f"wl:price:{ticker}:{country}"
        cached    = kv_get(cache_key, 60)
        if cached is not None:
            return jsonify({"status": "ok", "data": cached})

        clean_ticker, yf_sym = _build_yf_symbol(ticker, country)
        quotes: list = []
        for attempt in range(2):
            crumb, cookies = _yf_crumb()
            resp = requests.get(
                "https://query1.finance.yahoo.com/v7/finance/quote",
                params={"symbols": yf_sym, "crumb": crumb},
                headers={"User-Agent": _YF_UA, "Cookie": cookies},
                timeout=8,
            )
            if resp.status_code == 401 and attempt == 0:
                kv_set("yf:crumb:v3", None)
                continue
            resp.raise_for_status()
            quotes = resp.json().get("quoteResponse", {}).get("result", [])
            break
        q = quotes[0] if quotes else {}

        market_state = q.get("marketState", "REGULAR")
        price = change_pct = None
        if market_state == "PRE":
            price      = q.get("preMarketPrice")
            change_pct = q.get("preMarketChangePercent")
        elif market_state in ("POST", "POSTPOST", "PREPRE", "CLOSED"):
            price = q.get("postMarketPrice")
            prev  = q.get("regularMarketPreviousClose") or q.get("chartPreviousClose")
            if price is not None and prev and prev != 0:
                change_pct = ((price - prev) / prev) * 100
        if price is None:
            price      = q.get("regularMarketPrice")
            change_pct = q.get("regularMarketChangePercent")
        if price is not None and change_pct is None:
            prev = q.get("regularMarketPreviousClose") or q.get("chartPreviousClose")
            if prev and prev != 0:
                change_pct = ((price - prev) / prev) * 100

        result = {
            "ticker":       clean_ticker,
            "company":      q.get("longName") or q.get("shortName") or clean_ticker,
            "price":        round(price,      4) if price      is not None else None,
            "change_pct":   round(change_pct, 4) if change_pct is not None else None,
            "currency":     q.get("currency", ""),
            "market_state": market_state,
        }
        kv_set(cache_key, result)
        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@market_bp.route("/api/watchlist/prices")
def watchlist_prices_bulk():
    """Bulk live price for watchlist tickers. Per-ticker cache 5s (matches home heatmap cadence).
    ?tickers=AAPL,NVDA&countries=US,US"""
    tickers_raw   = flask_request.args.get("tickers", "").strip()
    countries_raw = flask_request.args.get("countries", "").strip()
    if not tickers_raw:
        return jsonify({"status": "ok", "data": {}})

    tickers   = [t.strip().upper() for t in tickers_raw.split(",") if t.strip()]
    countries = [c.strip().upper() for c in countries_raw.split(",") if c.strip()]
    if len(countries) < len(tickers):
        countries += ["US"] * (len(tickers) - len(countries))

    result_map:  dict = {}
    needs_fetch: list = []
    for ticker, country in zip(tickers, countries):
        cache_key = f"wl:tick:{ticker}:{country}"
        cached    = kv_get(cache_key, 5)
        if cached is not None:
            result_map[ticker] = cached
        else:
            needs_fetch.append((ticker, country))

    if needs_fetch:
        sym_to_key: dict = {}
        for ticker, country in needs_fetch:
            clean, yf_sym = _build_yf_symbol(ticker, country)
            sym_to_key[yf_sym] = (ticker, clean, country)

        quotes: list = []
        for attempt in range(2):
            try:
                crumb, cookies = _yf_crumb()
                resp = requests.get(
                    "https://query1.finance.yahoo.com/v7/finance/quote",
                    params={"symbols": ",".join(sym_to_key.keys()), "crumb": crumb},
                    headers={"User-Agent": _YF_UA, "Cookie": cookies},
                    timeout=12,
                )
                if resp.status_code == 401 and attempt == 0:
                    kv_set("yf:crumb:v3", None)
                    continue
                resp.raise_for_status()
                quotes = resp.json().get("quoteResponse", {}).get("result", [])
                break
            except Exception as exc:
                logger.warning("watchlist_prices_bulk failed: %s", exc)
                break

        for q in quotes:
            yf_sym = q.get("symbol", "")
            if yf_sym not in sym_to_key:
                continue
            ticker, clean_ticker, country = sym_to_key[yf_sym]
            market_state = q.get("marketState", "REGULAR")

            price = change_pct = None
            if market_state == "PRE":
                price      = q.get("preMarketPrice")
                change_pct = q.get("preMarketChangePercent")
            elif market_state in ("POST", "POSTPOST", "PREPRE", "CLOSED"):
                price = q.get("postMarketPrice")
                prev  = q.get("regularMarketPreviousClose") or q.get("chartPreviousClose")
                if price is not None and prev and prev != 0:
                    change_pct = ((price - prev) / prev) * 100
            if price is None:
                price      = q.get("regularMarketPrice")
                change_pct = q.get("regularMarketChangePercent")
            if price is not None and change_pct is None:
                prev = q.get("regularMarketPreviousClose") or q.get("chartPreviousClose")
                if prev and prev != 0:
                    change_pct = ((price - prev) / prev) * 100

            info = {
                "ticker":       clean_ticker,
                "company":      q.get("longName") or q.get("shortName") or clean_ticker,
                "price":        round(price,      4) if price      is not None else None,
                "change_pct":   round(change_pct, 4) if change_pct is not None else None,
                "currency":     q.get("currency", ""),
                "market_state": market_state,
            }
            cache_key = f"wl:tick:{ticker}:{country}"
            kv_set(cache_key, info)
            result_map[ticker] = info

    return jsonify({"status": "ok", "data": result_map})


@market_bp.route("/api/watchlist/tickers", methods=["GET"])
def get_watchlist_tickers():
    """Return the persisted watchlist ticker list."""
    return jsonify({"status": "ok", "data": kv_get("watchlist_tickers", _WL_TTL) or []})


@market_bp.route("/api/watchlist/tickers", methods=["POST"])
def save_watchlist_tickers():
    """Persist the full watchlist ticker list."""
    body    = flask_request.get_json(silent=True) or {}
    tickers = body.get("tickers", [])
    if not isinstance(tickers, list):
        return jsonify({"status": "error", "message": "tickers must be a list"}), 400
    kv_set("watchlist_tickers", tickers)
    return jsonify({"status": "ok"})


@market_bp.route("/api/watchlist/categories", methods=["GET"])
def get_watchlist_categories():
    """Return persisted watchlist categories (falls back to built-in defaults)."""
    stored = kv_get("watchlist_categories", _WL_TTL)
    return jsonify({"status": "ok", "data": stored if stored is not None else _WL_DEFAULT_CATEGORIES})


@market_bp.route("/api/watchlist/categories", methods=["POST"])
def save_watchlist_categories():
    """Persist the full watchlist categories list."""
    body = flask_request.get_json(silent=True) or {}
    cats = body.get("categories", [])
    if not isinstance(cats, list):
        return jsonify({"status": "error", "message": "categories must be a list"}), 400
    kv_set("watchlist_categories", cats)
    return jsonify({"status": "ok"})


# ── Finviz routes ──────────────────────────────────────────────────────────────

@market_bp.route("/api/finviz/news")
def finviz_news():
    """Market news and blog posts from Finviz. Cached 5 min."""
    cache_key = "finviz:news"
    cached    = kv_get(cache_key, 300)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "cached": True})
    data = fvd.get_market_news()
    kv_set(cache_key, data)
    return jsonify({"status": "ok", "data": data, "cached": False})


# ── YouTube Videos ────────────────────────────────────────────────────────────

def _parse_iso8601_duration(s: str) -> int:
    """Convert ISO 8601 duration (e.g. PT15M10S) to total seconds."""
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s or "")
    if not m:
        return 0
    return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)


def _yt_fetch_channel_videos(channel_id: str, channel_name: str) -> list:
    """
    Fetch the 15 most recent uploads from a channel, filter out Shorts
    (duration ≤ _YT_MIN_SECS), and return video dicts.
    """
    if not _YT_API_KEY:
        return []

    # Use the channel's uploads playlist instead of the search API:
    # - search costs 100 quota units per call; playlistItems costs 1
    # - search has a multi-hour indexing delay for new videos; playlist is immediate
    uploads_playlist_id = "UU" + channel_id[2:]
    playlist_resp = requests.get(
        "https://www.googleapis.com/youtube/v3/playlistItems",
        params={
            "key": _YT_API_KEY,
            "playlistId": uploads_playlist_id,
            "part": "contentDetails",
            "maxResults": 15,
        },
        timeout=12,
    )
    playlist_resp.raise_for_status()
    ids = [item["contentDetails"]["videoId"] for item in playlist_resp.json().get("items", [])]
    if not ids:
        return []

    # Step 2 — fetch snippet + contentDetails for each ID
    detail_resp = requests.get(
        "https://www.googleapis.com/youtube/v3/videos",
        params={
            "key": _YT_API_KEY,
            "id": ",".join(ids),
            "part": "snippet,contentDetails",
        },
        timeout=12,
    )
    detail_resp.raise_for_status()

    videos = []
    for item in detail_resp.json().get("items", []):
        secs = _parse_iso8601_duration(item["contentDetails"]["duration"])
        if secs <= _YT_MIN_SECS:
            continue  # skip Shorts / very short clips
        snip = item["snippet"]
        thumb = (
            snip.get("thumbnails", {}).get("medium", {}).get("url")
            or snip.get("thumbnails", {}).get("default", {}).get("url", "")
        )
        videos.append({
            "video_id":        item["id"],
            "channel_id":      channel_id,
            "channel_name":    channel_name,
            "title":           snip["title"],
            "description":     snip.get("description", "")[:3000],
            "thumbnail":       thumb,
            "published_at":    snip["publishedAt"],
            "duration_seconds": secs,
        })
    return videos


def _yt_analyze_video(video_id: str, title: str, description: str, channel_name: str) -> str:
    """
    Send video metadata to Gemini for investment-focused analysis.
    Returns the analysis string, or "" on any failure.
    """
    if not os.environ.get("GEMINI_API_KEY"):
        return ""

    prompt = (
        f"Analyze this financial/investment YouTube video and provide a structured summary.\n\n"
        f"Channel: {channel_name}\n"
        f"Title: {title}\n"
        f"Description: {description or '(no description)'}\n\n"
        "Provide the following sections:\n"
        "**Key Topics** — 2-3 bullets on what the video covers\n"
        "**Key Insights** — 2-4 investor takeaways\n"
        "**Assets Mentioned** — specific tickers, stocks, ETFs, or crypto referenced (or 'None identified')\n"
        "**Market Sentiment** — Bullish / Bearish / Neutral with a one-line reason\n"
        "**Watch Worthiness** — one sentence on who should watch this video"
    )

    try:
        import gemini_utils
        return gemini_utils._generate(prompt)
    except Exception as exc:
        logger.warning("Gemini analysis failed for %s: %s", video_id, exc)
        return ""


def _yt_analyze_bg(videos: list) -> None:
    """Run Gemini analysis for a list of new videos in a background thread."""
    import threading
    from cache import yt_video_set_analysis

    def _worker():
        for v in videos:
            try:
                analysis = _yt_analyze_video(
                    v["video_id"], v["title"], v.get("description", ""), v["channel_name"]
                )
                if analysis:
                    yt_video_set_analysis(v["video_id"], analysis)
            except Exception as exc:
                logger.warning("BG analysis failed for %s: %s", v["video_id"], exc)

    threading.Thread(target=_worker, daemon=True, name="yt-analyze").start()


def yt_refresh_all_channels() -> None:
    """
    Fetch new videos from every configured channel and analyze new ones with Gemini.
    Called every 15 min by the background thread in app.py.
    """
    from cache import yt_channels_get, yt_video_upsert

    channels = yt_channels_get()
    if not channels:
        return

    for ch in channels:
        try:
            videos = _yt_fetch_channel_videos(ch["channel_id"], ch["name"])
            new_videos = []
            for v in videos:
                if yt_video_upsert(v):
                    new_videos.append(v)
            if new_videos and (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
                _yt_analyze_bg(new_videos)
        except Exception as exc:
            logger.error("YT channel refresh failed (%s): %s", ch["channel_id"], exc)


# ── YouTube routes ────────────────────────────────────────────────────────────

@market_bp.route("/api/yt/channels", methods=["GET"])
def api_yt_channels_get():
    from cache import yt_channels_get
    return jsonify({"status": "ok", "channels": yt_channels_get()})


@market_bp.route("/api/yt/channels", methods=["POST"])
def api_yt_channels_add():
    from cache import yt_channel_add, yt_video_upsert
    body = flask_request.get_json(force=True, silent=True) or {}
    channel_id = (body.get("channel_id") or "").strip()
    name = (body.get("name") or "").strip()
    if not channel_id or not name:
        return jsonify({"status": "error", "message": "channel_id and name are required"}), 400

    yt_channel_add(channel_id, name)

    # Fetch recent videos immediately; analyze in background
    try:
        videos = _yt_fetch_channel_videos(channel_id, name)
        new_videos = []
        for v in videos:
            if yt_video_upsert(v):
                new_videos.append(v)
        if new_videos and (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
            _yt_analyze_bg(new_videos)
    except Exception as exc:
        logger.warning("Initial YT fetch failed for channel %s: %s", channel_id, exc)

    return jsonify({"status": "ok"})


@market_bp.route("/api/yt/channel/<channel_id>", methods=["DELETE"])
def api_yt_channel_delete(channel_id):
    from cache import yt_channel_delete
    yt_channel_delete(channel_id)
    return jsonify({"status": "ok"})


@market_bp.route("/api/yt/videos", methods=["GET"])
def api_yt_videos():
    from cache import yt_videos_get
    return jsonify({"status": "ok", "videos": yt_videos_get(limit=60)})

