"""
routes/ai.py — AI-driven insights and trade signal endpoints.

Covers three areas:

1. TradingView trade signals — scrapes analyst price targets and
   recommendation grades from TradingView for every held ticker.
   Results are cached 12 hours.  Tickers can be individually excluded
   via the /exclude and /excluded sub-routes.

2. Trump posts — fetches the RSS feed from trumpstruth.org and runs
   per-post Gemini sentiment analysis (results persisted in the DB so
   only new posts hit the Gemini API).

3. Gemini AI endpoints — thin wrappers around gemini_utils.py for
   market digest generation, AI trade signal generation, and free-form
   portfolio chat.

Note: the Finviz-based /api/market-digest is in routes/market.py.
"""

import concurrent.futures
import logging
import re
import time
import xml.etree.ElementTree as ET

import requests
from flask import Blueprint, jsonify, request

import gemini_utils as _gemini
from cache import (
    TTL_NEWS, get_excluded_tickers, kv_get, kv_set, rows_get,
    set_ticker_excluded, trump_sentiment_get, trump_sentiment_set,
)
from helpers import API_KEYS

logger = logging.getLogger("ai")

ai_bp = Blueprint("ai", __name__)


# ── TradingView forecast helper ───────────────────────────────────────────────

def _get_tv_forecast(ticker: str, country: str = "US") -> dict | None:
    """Scrape analyst price target and recommendation from TradingView HTML.

    Returns a dict with keys avg/high/low/rec_text/strongBuy/buy/hold/sell/
    strongSell/total/hasBreakdown, or None on failure.
    """
    exchange_mapping = {
        "US": ["NASDAQ", "NYSE", "AMEX", "OTC"],
        "UK": ["LSE"],
        "GB": ["LSE"],
        "DE": ["XETR"],
        "FR": ["EURONEXT"],
        "CA": ["TSX", "TSXV", "OTC", "NASDAQ", "NYSE"],
        "ES": ["LSE", "BME"],
        "NL": ["EURONEXT"],
        "IE": ["LSE", "EURONEXT", "MIL"],
    }

    clean_ticker = ticker
    if ticker.endswith("l") and len(ticker) > 1 and ticker[:-1].isupper():
        clean_ticker = ticker[:-1]

    exchanges = exchange_mapping.get(country.upper(), ["NASDAQ", "NYSE", "AMEX", "OTC"])
    headers   = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"}

    html = ""
    for ex in exchanges:
        url = f"https://www.tradingview.com/symbols/{ex}-{clean_ticker}/forecast/"
        for attempt in range(3):
            try:
                resp = requests.get(url, headers=headers, timeout=5)
                if resp.status_code == 200:
                    html = resp.text
                    break
                elif resp.status_code == 429:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                else:
                    break
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
        avg_target = float(m1.group(1).replace(',', ''))
        max_target = float(m1.group(2).replace(',', ''))
        min_target = float(m1.group(3).replace(',', ''))

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
        m2 = re.search(r'"initForecastQuotes":({.*?})', html)
        if m2:
            try:
                mark_match = re.search(r'"recommendation_mark"\s*:\s*([\d\.]+)', m2.group(1))
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


# ── TradingView trade signals ─────────────────────────────────────────────────

@ai_bp.route("/api/trade-signals")
def trade_signals():
    """Fetch actionable trade signals using TradingView analyst data for held stocks."""
    force_refresh = request.args.get("refresh", "0") == "1"
    cache_key     = "trade_signals:v2"

    if not force_refresh:
        cached = kv_get(cache_key, 43200)
        if cached is not None and len(cached) > 0:
            return jsonify({"status": "ok", "data": cached, "cached": True})

    excluded    = get_excluded_tickers()
    unique_rows = {}
    for pid in API_KEYS:
        rows, _ = rows_get(pid)
        if rows:
            for r in rows:
                ticker = r["ticker"]
                if ticker not in unique_rows and ticker not in excluded:
                    unique_rows[ticker] = {
                        "company_name": r["company_name"],
                        "country":      r.get("country", "US"),
                        "price":        r.get("native_price", r.get("current_price") or (
                            r.get("current_value", 0) / r.get("quantity", 1) if r.get("quantity") else 0
                        )),
                        "currency":     r.get("native_currency", r.get("currency_code", "USD")),
                    }

    results = []

    def process_ticker(ticker):
        info     = unique_rows[ticker]
        forecast = _get_tv_forecast(ticker, info["country"])
        if forecast and forecast.get("avg") is not None:
            rec        = forecast["rec_text"]
            conviction = "HIGH" if "STRONG" in rec else "MEDIUM" if rec in ("BUY", "SELL", "ADD", "REDUCE") else "LOW"
            entry      = info.get("price")
            target     = forecast["avg"]
            stop       = forecast["low"] if "BUY" in rec or "ADD" in rec else forecast["high"]
            exp_return = None
            if entry and target:
                val = ((target - entry) / entry) * 100
                if "SELL" in rec:
                    val = -val
                exp_return = round(val, 2)
            weight = 5.0 if "STRONG" in rec else 2.5 if "BUY" in rec or "SELL" in rec else 0.0
            return {
                "ticker":           ticker,
                "company_name":     info["company_name"],
                "currency":         info["currency"],
                "signal":           rec,
                "conviction":       conviction,
                "entry":            round(entry, 2) if entry else None,
                "target":           round(target, 2) if target else None,
                "max_target":       round(forecast["high"], 2) if forecast.get("high") else None,
                "min_target":       round(forecast["low"],  2) if forecast.get("low")  else None,
                "stop":             round(stop, 2) if stop else None,
                "exp_return":       exp_return,
                "suggested_weight": weight,
                "timeframe":        "12 months",
            }
        return None

    tickers = list(unique_rows.keys())
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, max(1, len(tickers)))) as ex:
        for res in ex.map(process_ticker, tickers):
            if res:
                results.append(res)

    results.sort(key=lambda x: -(x["exp_return"] or 0))
    kv_set(cache_key, results)
    return jsonify({"status": "ok", "data": results, "cached": False})


@ai_bp.route("/api/trade-signals/exclude", methods=["POST"])
def trade_signals_exclude():
    """Toggle exclusion of a ticker from trade signals."""
    data     = request.json or {}
    ticker   = data.get("ticker")
    excluded = data.get("excluded", True)
    if not ticker:
        return jsonify({"status": "error", "message": "Missing ticker"}), 400
    set_ticker_excluded(ticker, excluded)
    kv_set("trade_signals:v2", [])
    return jsonify({"status": "ok", "ticker": ticker, "excluded": excluded})


@ai_bp.route("/api/trade-signals/excluded")
def trade_signals_excluded_list():
    """Return a list of all current ticker exclusions."""
    return jsonify({"status": "ok", "data": get_excluded_tickers()})


# ── Trump posts ───────────────────────────────────────────────────────────────

@ai_bp.route("/api/trump-posts")
def trump_posts():
    """Fetch Trump's posts via trumpstruth.org RSS feed. Cached 5 min."""
    cache_key = "trump:posts:rss:v4"
    cached    = kv_get(cache_key, 300)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "cached": True})
    try:
        limit     = min(int(request.args.get("per_page", 25)), 40)
        feed_urls = [
            "https://trumpstruth.org/feed/",
            "https://trumpstruth.org/rss/",
            "https://trumpstruth.org/feed.xml",
            "https://trumpstruth.org/?feed=rss2",
        ]
        resp = None
        for url in feed_urls:
            try:
                r       = requests.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; RSS reader)",
                    "Accept":     "application/rss+xml, application/xml, text/xml, */*",
                }, timeout=12)
                snippet = r.content[:200].lstrip()
                if r.status_code == 200 and (b'<rss' in snippet or b'<?xml' in snippet or b'<feed' in snippet):
                    resp = r
                    break
                logger.info("trump_posts feed: %s → %s body[:60]=%r", url, r.status_code, r.text[:60])
            except Exception as e_inner:
                logger.warning("trump_posts feed %s: %s", url, e_inner)

        if resp is None:
            return jsonify({"status": "error", "message": "No RSS feed found at trumpstruth.org"}), 502

        root    = ET.fromstring(resp.content)
        ns      = {"media": "http://search.yahoo.com/mrss/", "content": "http://purl.org/rss/1.0/modules/content/"}
        channel = root.find("channel")
        items   = channel.findall("item") if channel is not None else root.findall(".//item")

        posts = []
        for item in items[:limit]:
            title        = (item.findtext("title")       or "").strip()
            desc         = (item.findtext("description") or "").strip()
            link         = (item.findtext("link")        or "").strip()
            pub_date     = (item.findtext("pubDate")     or "").strip()
            guid         = (item.findtext("guid")        or link).strip()
            full_content = item.findtext("content:encoded", namespaces=ns) or desc
            clean        = re.sub(r"<[^>]+>", " ", full_content or title)
            clean        = re.sub(r"\s+", " ", clean).strip()

            image = None
            mc    = item.find("media:content", ns)
            if mc is not None:
                image = mc.get("url")
            if not image:
                enc = item.find("enclosure")
                if enc is not None and (
                    enc.get("type", "").startswith("image") or
                    enc.get("url", "").endswith((".jpg", ".jpeg", ".png", ".webp"))
                ):
                    image = enc.get("url")
            if not image and full_content:
                m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', full_content)
                if m:
                    image = m.group(1)

            posts.append({
                "id":         guid,
                "content":    clean,
                "created_at": pub_date,
                "url":        link,
                "image":      image,
                "favourites": 0,
                "reblogs":    0,
                "replies":    0,
            })

        kv_set(cache_key, posts)
        return jsonify({"status": "ok", "data": posts, "cached": False})
    except Exception as e:
        logger.warning("trump_posts error: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


@ai_bp.route("/api/trump-posts/sentiment")
def trump_posts_sentiment():
    """Gemini sentiment analysis for Trump posts.  Only new posts hit the API."""
    try:
        posts = kv_get("trump:posts:rss:v4", 300)
        if not posts:
            return jsonify({"status": "error", "message": "No posts cached yet — fetch /api/trump-posts first"}), 400

        all_ids = [str(p.get("id", "")) for p in posts if p.get("id")]
        stored  = trump_sentiment_get(all_ids)

        new_posts      = [p for p in posts if str(p.get("id", "")) not in stored]
        newly_analysed = {}
        if new_posts:
            results        = _gemini.analyze_trump_post_sentiments(new_posts)
            newly_analysed = {str(r.get("id", "")): r for r in results if isinstance(r, dict)}
            trump_sentiment_set(newly_analysed)
            logger.info("trump_sentiment: analysed %d new post(s), %d already stored",
                        len(newly_analysed), len(stored))

        by_id = {**stored, **newly_analysed}
        return jsonify({"status": "ok", "data": by_id, "new": len(newly_analysed), "cached": len(stored)})
    except Exception as e:
        logger.warning("trump_posts_sentiment error: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


# ── Gemini AI endpoints ───────────────────────────────────────────────────────

@ai_bp.route("/api/ai/market-digest")
def ai_market_digest():
    """Daily automated market digest using Gemini."""
    try:
        news_data = kv_get("general_market_news", TTL_NEWS) or []
        digest    = _gemini.generate_market_summary(news_data)
        return jsonify({"status": "ok", "digest": digest})
    except Exception as e:
        logger.error("AI Market Digest failed: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


@ai_bp.route("/api/ai/trade-signals")
def ai_trade_signals():
    """AI-driven trade signals based on portfolio holdings using Gemini."""
    try:
        all_rows = []
        for pid in API_KEYS:
            rows, _ = rows_get(pid)
            if rows:
                all_rows.extend(rows)
        signals = _gemini.generate_trade_signals(all_rows)
        return jsonify({"status": "ok", "signals": signals})
    except Exception as e:
        logger.error("AI Trade Signals failed: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


@ai_bp.route("/api/ai/chat", methods=["POST"])
def ai_chat():
    """Interactive portfolio chat with Gemini."""
    try:
        body    = request.get_json()
        message = body.get("message")
        history = body.get("history", [])
        if not message:
            return jsonify({"status": "error", "message": "Message required"}), 400
        response = _gemini.chat_with_gemini(message, history)
        return jsonify({"status": "ok", "response": response})
    except Exception as e:
        logger.error("AI Chat failed: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500
