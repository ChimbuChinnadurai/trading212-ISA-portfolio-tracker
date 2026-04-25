"""
app.py — Application entry point and background orchestration.

Creates the Flask app, registers all route blueprints, starts background
daemon threads, runs one-time startup migrations, and exposes the WSGI
callable for Gunicorn.

Blueprint layout
────────────────
  routes/portfolio.py   — holdings, dividends, activity, overview
  routes/market.py      — market data, news, Finviz, watchlist, stock info
  routes/performance.py — monthly/daily/yearly perf, risk metrics, attribution
  routes/ai.py          — TradingView signals, Trump posts, Gemini AI
  routes/alerts.py      — price alerts, notifications, cache admin

Background threads
──────────────────
  portfolio-refresh  — force-refreshes all portfolios every AUTO_REFRESH_SECONDS
  div-refresh        — pre-fetches dividend calendar via Snowball Analytics every 6 h
  market-refresh     — keeps market-indicators cache warm every 25 min
  news-refresh       — keeps Finnhub news cache warm every 5 min
"""

import logging
import os
import threading
import time

import config  # noqa: F401 — must be imported before any local module reads os.environ

from flask import Flask

from cache import (
    alert_mark_triggered, alerts_get_all, init_db, kv_get, kv_set,
    notification_add, rows_get, snapshot_add,
)
from helpers import API_KEYS, fetch_and_cache_portfolio
from routes import alerts_bp, ai_bp, market_bp, performance_bp, portfolio_bp
from routes.market import fetch_and_cache_market_indicators, fetch_and_cache_news
import snowball_dividends as _sdiv

# ── Flask app ─────────────────────────────────────────────────────────────────

app = Flask(__name__)
init_db()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("app")

# ── Blueprint registration ────────────────────────────────────────────────────

app.register_blueprint(portfolio_bp)
app.register_blueprint(market_bp)
app.register_blueprint(performance_bp)
app.register_blueprint(ai_bp)
app.register_blueprint(alerts_bp)


# ── Price alert checker (called by portfolio refresh thread) ──────────────────

def _check_price_alerts(rows: list) -> None:
    """Check active price alerts against current portfolio prices."""
    try:
        active = [a for a in alerts_get_all() if a["enabled"]]
        if not active:
            return

        price_gbp    = {r["ticker"]: r.get("current_price", 0) for r in rows}
        price_native = {r["ticker"]: r.get("native_price", 0)  for r in rows}

        for alert in active:
            ticker         = alert["ticker"]
            alert_currency = alert.get("currency", "GBP").upper()
            price          = price_gbp.get(ticker) if alert_currency == "GBP" else price_native.get(ticker)

            if price is None:
                for t in price_native:
                    if t.startswith(ticker):
                        price = price_gbp.get(t) if alert_currency == "GBP" else price_native.get(t)
                        break

            if price is None:
                continue

            triggered = (
                (alert["condition"] == "above" and price >= alert["threshold"]) or
                (alert["condition"] == "below" and price <= alert["threshold"])
            )

            if triggered:
                alert_mark_triggered(alert["id"])
                direction = "above" if alert["condition"] == "above" else "below"
                notification_add(
                    type_="alert",
                    title=f"Price Alert: {ticker}",
                    message=f"{ticker} is now {direction} {alert['threshold']:.2f} {alert_currency} (current: {price:.2f})",
                    data={"ticker": ticker, "price": price, "threshold": alert["threshold"], "currency": alert_currency},
                )
    except Exception as exc:
        logging.getLogger("alerts").warning("Alert check failed: %s", exc)


# ── Background threads ────────────────────────────────────────────────────────

_REFRESH_INTERVAL = int(os.environ.get("AUTO_REFRESH_SECONDS", 300))


def _background_refresh() -> None:
    """Daemon thread: keep portfolio cache warm by force-refreshing every 5 minutes."""
    _log = logging.getLogger("portfolio-refresh")
    time.sleep(5)
    while True:
        for pid, key in API_KEYS.items():
            if not key:
                continue
            try:
                rows, _ = fetch_and_cache_portfolio(pid, force=True)
                if rows:
                    total_value = sum(r.get("current_value", 0) for r in rows)
                    snapshot_add(pid, total_value)
                    _check_price_alerts(rows)
                _log.info("Portfolio %s refreshed (%d holdings)", pid, len(rows or []))
            except Exception as exc:
                _log.error("Portfolio refresh failed for pid=%s: %s", pid, exc)
        time.sleep(_REFRESH_INTERVAL)


def _background_dividend_refresh() -> None:
    """Daemon thread: pre-fetch dividend data every 6 hours via Snowball Analytics."""
    _log = logging.getLogger("div-refresh")
    time.sleep(30)
    while True:
        try:
            _sdiv.fetch_all_dividends(API_KEYS)
        except Exception as exc:
            _log.error("Unhandled error in dividend refresh: %s", exc)
        time.sleep(_sdiv.DIV_REFRESH_INTERVAL)


def _background_market_refresh() -> None:
    """Daemon thread: keep market-indicators cache warm every 25 min (TTL is 30 min)."""
    _log = logging.getLogger("market-refresh")
    time.sleep(10)
    while True:
        try:
            fetch_and_cache_market_indicators()
            _log.info("Market indicators cache refreshed")
        except Exception as exc:
            _log.error("Market indicators refresh failed: %s", exc)
        time.sleep(1500)


def _background_news_refresh() -> None:
    """Daemon thread: keep Finnhub news cache warm every 5 min."""
    _log = logging.getLogger("news-refresh")
    time.sleep(15)
    while True:
        try:
            fetch_and_cache_news()
            _log.info("News cache refreshed")
        except Exception as exc:
            _log.error("News refresh failed: %s", exc)
        time.sleep(300)


_refresh_thread = threading.Thread(target=_background_refresh,          daemon=True, name="portfolio-refresh")
_div_thread     = threading.Thread(target=_background_dividend_refresh, daemon=True, name="div-refresh")
_market_thread  = threading.Thread(target=_background_market_refresh,   daemon=True, name="market-refresh")
_news_thread    = threading.Thread(target=_background_news_refresh,     daemon=True, name="news-refresh")

_refresh_thread.start()
_div_thread.start()
_market_thread.start()
_news_thread.start()


# ── One-time startup migration ────────────────────────────────────────────────

def _migrate_price_alerts() -> None:
    """Convert GBP alerts for non-UK stocks to their native currency (runs once on startup)."""
    try:
        if kv_get("migration_alerts_native_v1", 9999999):
            return

        alerts = alerts_get_all()
        if not alerts:
            return

        all_rows = []
        for pid in API_KEYS:
            rows, _ = rows_get(pid)
            if rows:
                all_rows.extend(rows)

        if not all_rows:
            return

        from fx import get_gbpusd_rate
        ticker_map = {r["ticker"]: r for r in all_rows}
        gbpusd     = get_gbpusd_rate()

        from cache import _db
        with _db() as conn:
            for alert in alerts:
                ticker           = alert["ticker"]
                current_currency = alert.get("currency", "GBP")
                if current_currency != "GBP":
                    continue
                stock = ticker_map.get(ticker)
                if not stock:
                    continue
                native_currency = stock.get("native_currency", "GBP")
                if native_currency in ("GBP", "GBX"):
                    continue
                if native_currency != "USD":
                    continue
                new_threshold = round(alert["threshold"] * gbpusd, 2)
                conn.execute(
                    "UPDATE price_alerts SET threshold = ?, currency = ? WHERE id = ?",
                    (new_threshold, "USD", alert["id"]),
                )
                logger.info(
                    "Migrated alert %d for %s: %.2f GBP -> %.2f USD",
                    alert["id"], ticker, alert["threshold"], new_threshold,
                )

        kv_set("migration_alerts_native_v1", True)
    except Exception as e:
        logger.error("Alert migration failed: %s", e)


_migrate_price_alerts()


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
