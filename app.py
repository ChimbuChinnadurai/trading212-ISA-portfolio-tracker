import concurrent.futures
import logging
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
import requests
import config  # noqa: F401 — must be imported before any local module reads os.environ

from collections import defaultdict
from datetime import date, timedelta

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory
import finviz_data as fvd
import ai_digest as _ai_digest
import gemini_utils as _gemini


from cache import (
    TTL_DIV, TTL_NEWS, init_db, kv_age, kv_get, kv_set, kv_delete,
    rows_get, rows_set, snapshot_add, snapshot_get,
    clear_all_cache, get_excluded_tickers, set_ticker_excluded,
    trump_sentiment_get, trump_sentiment_set,
    alerts_get_all, alert_add, alert_delete, alert_mark_triggered,
    notifications_get, notification_add, notifications_mark_all_read, notifications_unread_count,
)
from fx import get_gbpusd_rate
from portfolio import TICKER_MAPPING, build_rows
import snowball_dividends as _sdiv
from t212 import (
    get_account_summary, get_dividends, get_dividends_raw, get_instruments,
    get_orders, get_portfolio, get_recent_dividends,
)
app = Flask(__name__)
init_db()

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("app")

# Multi-portfolio config
API_KEYS = {
    "1": os.environ.get("TRADING212_API_KEY_1"),
    "2": os.environ.get("TRADING212_API_KEY_2")
}

PORTFOLIO_NAMES = {
    "1": os.environ.get("PORTFOLIO_NAME_1", "Portfolio 1"),
    "2": os.environ.get("PORTFOLIO_NAME_2", "Portfolio 2")
}


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(app.static_folder, "favicon.svg", mimetype="image/svg+xml")


@app.route("/")
def index():
    # SPA shell — all views (home, portfolio 1/2/combined) rendered client-side via hash routing
    show_ai = os.environ.get("SHOW_AI_FEATURES", "0") == "1"
    return render_template("spa.html", names=PORTFOLIO_NAMES, show_ai=show_ai)



@app.route("/portfolio/<pid>")
def details(pid):
    # Redirect old multi-page URLs to SPA hash routes (backward-compat for bookmarks)
    return redirect(f"/#portfolio/{pid}", code=302)


def fetch_and_cache_portfolio(pid, force=False):
    """Fetch data for a single portfolio and cache the result."""
    api_key = API_KEYS.get(pid)
    if not api_key:
        return None, 0.0

    # 1. Try cache if not forcing
    if not force:
        cached_rows, _ = rows_get(pid)
        if cached_rows is not None:
            total_div  = kv_get("total_dividends", TTL_DIV, pid=pid) or 0.0
            return cached_rows, total_div

    # 2. Fetch fresh data
    positions   = get_portfolio(api_key, pid)
    instruments = get_instruments(api_key)
    gbpusd      = get_gbpusd_rate()
    dividends   = get_dividends(api_key, pid)

    total_div = round(sum(dividends.values()), 2)
    rows = build_rows(positions, instruments, dividends, gbpusd)

    # Update cache
    rows_set(rows, pid=pid)
    kv_set("total_dividends", total_div, pid=pid)

    return rows, total_div


def _top_sector(rows):
    """Return the sector with the highest total current_value, or None."""
    buckets = {}
    for r in rows:
        s = r.get("sector") or "Other"
        buckets[s] = buckets.get(s, 0) + r.get("current_value", 0)
    return max(buckets, key=buckets.get) if buckets else None


@app.route("/api/overview")
def overview():
    """Return aggregated summary metrics for all configured portfolios."""
    res = {}
    total_value = 0.0
    total_returns = 0.0
    total_invested = 0.0

    force = request.args.get("refresh", "0") == "1"

    total_cash = 0.0
    total_realized = 0.0

    for pid, api_key in API_KEYS.items():
        rows, _ = fetch_and_cache_portfolio(pid, force=force)
        summary = {}
        if api_key:
            try:
                summary = get_account_summary(api_key, pid)
            except Exception:
                pass

        if rows:
            p_val = sum(r["current_value"] for r in rows)
            p_inv = sum(r["invested"] for r in rows)
            total_value += p_val
            total_invested += p_inv
            snapshot_add(pid, round(p_val, 2))

            cash        = summary.get("cash", 0)
            realized    = summary.get("realized_pnl", 0)
            # Prefer T212's own unrealized figure; fall back to computed if summary unavailable
            unrealized  = summary.get("unrealized_pnl") if summary else None
            if unrealized is None:
                unrealized = round(p_val - p_inv, 2)
            total_cash      += cash
            total_realized  += realized
            total_returns   += unrealized

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

    all_combined_rows = []
    for pid in API_KEYS:
        r, _ = rows_get(pid)
        if r:
            all_combined_rows.extend(r)

    res["combined"] = {
        "value":          round(total_value, 2),
        "returns":        round(total_returns, 2),
        "returns_pct":    round((total_returns / total_invested) * 100, 2) if total_invested > 0 else 0,
        "invested":       round(total_invested, 2),
        "positions":      sum(p["positions"] for p in res.values() if isinstance(p, dict) and "positions" in p),
        "top_sector":     _top_sector(all_combined_rows),
        "cash":           round(total_cash, 2),
        "realized_pnl":   round(total_realized, 2),
        "unrealized_pnl": round(total_returns, 2),
    }
    metadata = {
        "names": PORTFOLIO_NAMES,
        "freshness": {
            "prices": kv_age("1:rows") or 0,
            "dividends": kv_age("total_dividends", pid="1") or 0,
            "fx": kv_age("gbpusd") or 0
        }
    }
    return jsonify({"status": "ok", "data": res, "metadata": metadata})


@app.route("/api/pcombined/portfolio")
def portfolio_combined():
    """Aggregate holdings from all portfolios."""
    try:
        combined_rows_map = {}
        total_div = 0.0
        
        for pid, key in API_KEYS.items():
            if not key: continue
            # Attempt to get cached rows for each PID
            rows, _ = rows_get(pid)
            if rows is None:
                # If any portfolio is missing cache, we can't show combined accurately
                # In a real app we'd fetch them here, but for now we rely on them being indexed
                continue
            
            p_div = kv_get("total_dividends", TTL_DIV, pid=pid) or 0.0
            total_div += p_div

            for row in rows:
                ticker = row["ticker"]
                if ticker not in combined_rows_map:
                    # Clone row for combined and sanitize fields that might be None
                    new_row = row.copy()
                    for num_field in ["quantity", "invested", "current_value", "total_returns", "fx_impact", "dividends"]:
                        new_row[num_field] = new_row.get(num_field) or 0.0
                    combined_rows_map[ticker] = new_row
                    combined_rows_map[ticker]["portfolio_ids"] = [pid]
                else:
                    target = combined_rows_map[ticker]
                    target["portfolio_ids"].append(pid)
                    # Sum values with null-safety
                    target["quantity"]      = (target.get("quantity") or 0) + (row.get("quantity") or 0)
                    target["invested"]      = (target.get("invested") or 0) + (row.get("invested") or 0)
                    target["current_value"] = (target.get("current_value") or 0) + (row.get("current_value") or 0)
                    target["total_returns"] = (target.get("total_returns") or 0) + (row.get("total_returns") or 0)
                    target["fx_impact"]     = (target.get("fx_impact") or 0) + (row.get("fx_impact") or 0)
                    target["dividends"]     = (target.get("dividends") or 0) + (row.get("dividends") or 0)
                    # Recalculate avg price
                    if target["quantity"] > 0:
                        target["avg_price"] = target["invested"] / target["quantity"]

        combined_rows = list(combined_rows_map.values())
        total_p_value = sum(r["current_value"] for r in combined_rows)
        
        # Final pass: Recalculate weights, returns_pct, yoc, div_yield across combined
        for r in combined_rows:
            r["weight"] = (r["current_value"] / total_p_value * 100) if total_p_value > 0 else 0
            r["returns_pct"] = (r["total_returns"] / r["invested"] * 100) if r["invested"] > 0 else 0
            r["yoc"] = (r["dividends"] / r["invested"] * 100) if r["invested"] > 0 else 0
            r["div_yield"] = (r["dividends"] / r["current_value"] * 100) if r["current_value"] > 0 else 0

        # Note: combined is always "cached" from sub-portfolios for speed
        return jsonify({
            "status": "ok", "data": combined_rows, "cached": True,
            "cache_age": 0, "total_dividends": round(total_div, 2),
            "warning": None,
            "freshness": {"gbpusd": kv_age("gbpusd")}
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/pcombined/activity")
def activity_combined():
    """Aggregate activity from all portfolios."""
    try:
        all_orders = []
        for pid, key in API_KEYS.items():
            if not key: continue
            orders = get_orders(key, pid, limit=15)
            # Tag with portfolio ID
            for o in orders:
                o["_pid"] = pid
            all_orders.extend(orders)
        
        # Sort by date executed descending
        all_orders.sort(key=lambda x: x.get("dateExecuted", ""), reverse=True)
        return jsonify({"status": "ok", "data": all_orders[:20]})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@app.route("/api/pcombined/dividend-monthly")
def dividend_monthly_combined():
    """Aggregate monthly dividends from all portfolios."""
    try:
        combined_monthly = defaultdict(float)
        for pid, key in API_KEYS.items():
            if not key: continue
            items = get_dividends_raw(key, pid)
            for it in items:
                date_str = it.get("paidOn") or it.get("date") or ""
                if not date_str: continue
                month = str(date_str)[:7]
                combined_monthly[month] += float(it.get("amount") or 0)
        
        data = [{"month": m, "amount": round(a, 4)} for m, a in sorted(combined_monthly.items())]
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@app.route("/api/dividends/overview")
def dividends_overview():
    """Consolidated dividend analytics for the Dividends view.
    ?pid=combined|1|2  — filter to a specific portfolio (default: combined). Cached 15 min."""
    pid_param = request.args.get("pid", "combined").strip()
    # Resolve which API keys to use
    if pid_param in ("1", "2") and API_KEYS.get(pid_param):
        pids_to_use = {pid_param: API_KEYS[pid_param]}
    else:
        pids_to_use = {k: v for k, v in API_KEYS.items() if v}
        pid_param = "combined"

    try:
        cache_key = f"dividends:overview:v3:{pid_param}"
        cached = kv_get(cache_key, 900)
        if cached is not None:
            return jsonify({"status": "ok", "data": cached})

        today = date.today()
        this_year_str = str(today.year)
        last_year_str = str(today.year - 1)

        # ── Monthly data ─────────────────────────────────────────────────────
        combined_monthly = defaultdict(float)
        for pid, key in pids_to_use.items():
            items = get_dividends_raw(key, pid)
            for it in items:
                date_str = it.get("paidOn") or it.get("date") or ""
                if not date_str:
                    continue
                month = str(date_str)[:7]
                combined_monthly[month] += float(it.get("amount") or 0)

        monthly = [{"month": m, "amount": round(a, 2)} for m, a in sorted(combined_monthly.items())]

        # ── Annual totals ────────────────────────────────────────────────────
        annual_map = defaultdict(float)
        for item in monthly:
            annual_map[item["month"][:4]] += item["amount"]
        annual = [{"year": y, "amount": round(a, 2)} for y, a in sorted(annual_map.items())]

        # ── KPIs ─────────────────────────────────────────────────────────────
        total_received = round(sum(i["amount"] for i in monthly), 2)
        this_year      = round(sum(i["amount"] for i in monthly if i["month"].startswith(this_year_str)), 2)
        last_year_amt  = round(sum(i["amount"] for i in monthly if i["month"].startswith(last_year_str)), 2)

        # TTM: trailing 12 calendar months
        ttm_months = set()
        d = today.replace(day=1)
        for _ in range(12):
            ttm_months.add(str(d)[:7])
            d = (d - timedelta(days=1)).replace(day=1)
        ttm = round(sum(i["amount"] for i in monthly if i["month"] in ttm_months), 2)
        avg_monthly_ttm = round(ttm / 12, 2)

        # ── Per-ticker breakdown ─────────────────────────────────────────────
        ticker_map = {}
        for pid in pids_to_use:
            rows, _ = fetch_and_cache_portfolio(pid)
            if not rows:
                continue
            for r in rows:
                t   = r["ticker"]
                div = float(r.get("dividends") or 0)
                if t not in ticker_map:
                    ticker_map[t] = {
                        "ticker":        t,
                        "company_name":  r.get("company_name", ""),
                        "sector":        r.get("sector", ""),
                        "dividends":     div,
                        "quantity":      float(r.get("quantity") or 0),
                        "current_value": float(r.get("current_value") or 0),
                        "invested":      float(r.get("invested") or 0),
                        "country":       r.get("country", "US"),
                    }
                else:
                    ticker_map[t]["dividends"]     = round(ticker_map[t]["dividends"] + div, 4)
                    ticker_map[t]["quantity"]      += float(r.get("quantity") or 0)
                    ticker_map[t]["current_value"] += float(r.get("current_value") or 0)
                    ticker_map[t]["invested"]      += float(r.get("invested") or 0)

        # Recalculate div_yield and yoc from merged totals
        for v in ticker_map.values():
            cv = v["current_value"]
            inv = v["invested"]
            divs = v["dividends"]
            v["div_yield"] = round((divs / cv * 100), 4) if cv > 0 else 0
            v["yoc"]       = round((divs / inv * 100), 4) if inv > 0 else 0

        by_ticker = sorted(
            [v for v in ticker_map.values() if v["dividends"] > 0],
            key=lambda x: x["dividends"], reverse=True
        )

        data = {
            "monthly":         monthly,
            "annual":          annual,
            "by_ticker":       by_ticker[:50],
            "total_received":  total_received,
            "this_year":       this_year,
            "last_year":       last_year_amt,
            "ttm":             ttm,
            "avg_monthly_ttm": avg_monthly_ttm,
            "pid":             pid_param,
        }
        kv_set(cache_key, data)
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        logger.error("dividends_overview error: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/p<pid>/stock-activity/<ticker>")
def stock_activity(pid, ticker):
    """Fetch order and dividend history for a specific stock."""
    try:
        activities = []
        pids = [pid] if pid != "combined" else [k for k in API_KEYS if API_KEYS[k]]
        
        # Ticker aliases for search
        search_tickers = {ticker.upper()}
        for old, new in TICKER_MAPPING.items():
            if new.upper() == ticker.upper():
                search_tickers.add(old.upper())
            if old.upper() == ticker.upper():
                search_tickers.add(new.upper())

        for curr_pid in pids:
            key = API_KEYS.get(curr_pid)
            if not key:
                continue
                
            # 1. Get filtered orders
            orders = get_orders(key, curr_pid, limit=1000) 
            stock_orders = [o for o in orders if o.get("ticker", "").split("_")[0].upper() in search_tickers]
            for o in stock_orders:
                activities.append({
                    "type": "order",
                    "action": o.get("type", "Unknown"),
                    "date": o.get("dateExecuted") or o.get("dateCreated") or "",
                    "quantity": o.get("filledQuantity", 0),
                    "price": o.get("fillPrice", 0),
                    "total": o.get("filledQuantity", 0) * o.get("fillPrice", 0),
                    "_pid": curr_pid
                })
                
            # 2. Get filtered dividends
            divs = get_dividends_raw(key, curr_pid)
            stock_divs = [d for d in divs if d.get("ticker", "").split("_")[0].upper() in search_tickers]
            for d in stock_divs:
                activities.append({
                    "type": "dividend",
                    "action": "Dividend Paid",
                    "date": d.get("paidOn") or d.get("date") or "",
                    "amount": d.get("amount", 0),
                    "_pid": curr_pid
                })
                
        # Sort combined activity logically (newest first)
        activities.sort(key=lambda x: str(x.get("date") or ""), reverse=True)
        return jsonify({"status": "ok", "data": activities})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500



@app.route("/api/pcombined/daily-history")
def portfolio_daily_history():
    """Daily portfolio value history (end-of-day snapshots) for the last 365 days."""
    pid_daily = {}
    for pid in API_KEYS:
        snaps = snapshot_get(pid, hours=8760)  # 365 days = 8760 hours
        by_day = {}
        for s in snaps:
            day = date.fromtimestamp(s["ts"]).isoformat()
            if day not in by_day or s["ts"] > by_day[day][0]:
                by_day[day] = (s["ts"], s["value"])
        pid_daily[pid] = by_day

    all_days = sorted(set().union(*[set(d.keys()) for d in pid_daily.values()]))
    result = []
    for day in all_days:
        total = sum(pid_daily[pid][day][1] for pid in API_KEYS if day in pid_daily[pid])
        ts = next((pid_daily[pid][day][0] for pid in API_KEYS if day in pid_daily[pid]), 0)
        if total > 0:
            result.append({"date": day, "ts": int(ts), "value": round(total, 2)})
    return jsonify({"status": "ok", "data": result})


@app.route("/api/pcombined/top-performers")
def top_performers_combined():
    """Return Top 5 performers across all portfolios."""
    try:
        combined_rows_map = {}
        for pid, key in API_KEYS.items():
            if not key: continue
            rows, _ = rows_get(pid)
            if not rows: continue
            for r in rows:
                t = r["ticker"]
                if t not in combined_rows_map:
                    combined_rows_map[t] = r.copy()
                    combined_rows_map[t]["_pid"] = pid
                else:
                    curr = combined_rows_map[t]
                    curr["invested"] += r["invested"]
                    curr["current_value"] += r["current_value"]
                    curr["total_returns"] += r["total_returns"]
        
        consolidated = list(combined_rows_map.values())
        for r in consolidated:
            r["returns_pct"] = (r["total_returns"] / r["invested"] * 100) if r["invested"] > 0 else 0
        
        # Sort by total returns amount descending
        consolidated.sort(key=lambda x: x["total_returns"], reverse=True)
        return jsonify({"status": "ok", "data": consolidated[:5]})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})






@app.route("/api/pcombined/recent-dividends")
def recent_dividends_combined():
    api_key_1 = API_KEYS.get("1")
    try:
        all_divs = []
        for pid, key in API_KEYS.items():
            if not key: continue
            divs = get_recent_dividends(key, pid, n=10)
            for d in divs: 
                d["_pid"] = pid
                # Normalize ticker
                raw_ticker = d.get("ticker", "")
                base = raw_ticker.split("_")[0]
                if base in TICKER_MAPPING:
                    d["ticker"] = TICKER_MAPPING[base] + (raw_ticker[len(base):] if "_" in raw_ticker else "")
            all_divs.extend(divs)
        
        all_divs.sort(key=lambda x: str(x.get("paidOn") or x.get("date") or ""), reverse=True)
        return jsonify({"status": "ok", "data": all_divs[:15]})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@app.route("/api/p<pid>/portfolio")
def portfolio(pid):
    if pid not in API_KEYS or not API_KEYS[pid]:
        return jsonify({"status": "error", "message": "Invalid portfolio ID"}), 404
    
    api_key = API_KEYS[pid]
    try:
        force = request.args.get("force", "0") == "1"
        rows, total_div = fetch_and_cache_portfolio(pid, force=force)

        if rows is None:
            return jsonify({"status": "error", "message": "Portfolio not found"}), 404

        _, age = rows_get(pid)

        return jsonify({
            "status": "ok", "data": rows,
            "cached": True if not force else False,
            "cache_age": age or 0,
            "total_dividends": total_div,
            "warning": None,
            "freshness": {
                "instruments": kv_age("instruments"),
                "dividends":   kv_age("dividends", pid=pid),
                "gbpusd":      kv_age("gbpusd"),
            }
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500




@app.route("/api/p<pid>/diversification-details")
def diversification_details(pid):
    """Sector and concentration breakdown for a portfolio."""
    try:
        rows, _ = fetch_and_cache_portfolio(pid)
        if rows is None:
            return jsonify({"status": "error", "message": "Portfolio not found"}), 404

        total_value = sum(r.get("current_value", 0) for r in rows)

        # Sector breakdown
        sectors = defaultdict(float)
        for r in rows:
            sectors[r.get("sector", "Other")] += r.get("current_value", 0)

        sector_breakdown = []
        for s, val in sectors.items():
            sector_breakdown.append({
                "sector": s,
                "value": round(val, 2),
                "percentage": round((val / total_value * 100), 2) if total_value > 0 else 0
            })
        sector_breakdown.sort(key=lambda x: x["value"], reverse=True)

        # Top concentrations
        top_holdings = []
        sorted_rows = sorted(rows, key=lambda x: x.get("current_value", 0), reverse=True)
        for r in sorted_rows[:5]:
            top_holdings.append({
                "ticker": r["ticker"],
                "weight": round((r.get("current_value", 0) / total_value * 100), 2) if total_value > 0 else 0
            })

        # Recommendations based on concentration
        recommendations = []
        if sector_breakdown and sector_breakdown[0]["percentage"] > 40:
            recommendations.append(f"High concentration in {sector_breakdown[0]['sector']}. Consider diversifying into other sectors.")
        if top_holdings and top_holdings[0]["weight"] > 20:
            recommendations.append(f"Your position in {top_holdings[0]['ticker']} is over 20%. Consider trimming or balancing.")

        metadata = {
            "freshness": {
                "prices": kv_age(f"{pid}:rows") or 0,
                "dividends": kv_age("total_dividends", pid=pid) or 0,
                "fx": kv_age("gbpusd") or 0
            }
        }

        return jsonify({
            "status": "ok",
            "data": {
                "recommendations": recommendations,
                "sector_breakdown": sector_breakdown,
                "top_holdings": top_holdings
            },
            "metadata": metadata
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


def _fetch_market_symbol(config):
    """Fetch and process one Yahoo Finance index symbol. Returns (key, data_or_None)."""
    symbol, label, ma_period = config
    key = symbol.replace("^", "")
    try:
        resp = requests.get(
            f"{symbol}",
            params={"range": "2y", "interval": "1d"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        resp.raise_for_status()
        chart = resp.json()["chart"]["result"][0]
        timestamps = chart["timestamp"]
        closes = chart["indicators"]["quote"][0]["close"]

        pairs = [(t, c) for t, c in zip(timestamps, closes) if c is not None]
        if len(pairs) < ma_period + 10:
            return key, None

        ts_list = [p[0] for p in pairs]
        c_list  = [p[1] for p in pairs]

        ma_list = [
            sum(c_list[i - ma_period + 1 : i + 1]) / ma_period
            if i >= ma_period - 1 else None
            for i in range(len(c_list))
        ]

        n = 252  # display last 252 trading days (~1 year)
        c_out  = [round(v, 2) for v in c_list[-n:]]
        ma_out = [round(m, 2) if m is not None else None for m in ma_list[-n:]]
        current    = c_out[-1]
        current_ma = ma_out[-1]

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


def _fetch_and_cache_market_indicators():
    """Fetch GSPC, IXIC, VIX in parallel and cache the result. Returns the result dict."""
    configs = [
        ("^GSPC", "S&P 500", 125),
        ("^IXIC", "NASDAQ",   50),
        ("^VIX",  "VIX",      50),
    ]
    result = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        for key, data in ex.map(_fetch_market_symbol, configs):
            result[key] = data
    # Only write to cache when at least one symbol returned valid data.
    # Storing an all-None result would cause stale null data to be served
    # for the full TTL window, preventing a successful retry.
    if any(v is not None for v in result.values()):
        kv_set("market_indicators", result)
    return result


def _market_ind_valid(data) -> bool:
    """Return True only if data is a dict with at least one non-None symbol."""
    return isinstance(data, dict) and any(v is not None for v in data.values())


@app.route("/api/market-indicators")
def market_indicators():
    """S&P 500 (125-day MA) and VIX (50-day MA) from Yahoo Finance, cached 30 min."""
    cached = kv_get("market_indicators", 1800)
    if _market_ind_valid(cached):
        return jsonify({"status": "ok", "data": cached})
    # Stale all-null entry is in the cache — evict it so the background thread
    # can write a fresh result on its next cycle without waiting for TTL expiry.
    if cached is not None:
        kv_delete("market_indicators")
    result = _fetch_and_cache_market_indicators()
    return jsonify({"status": "ok", "data": result})


_COUNTRY_YF_SUFFIX = {
    "UK": ".L",  "DE": ".DE", "FR": ".PA", "NL": ".AS",
    "IE": ".L",  "CH": ".SW", "AU": ".AX", "JP": ".T",
    "ES": ".L", "IT": ".MI", "SE": ".ST", "DK": ".CO",
    "NO": ".OL", "FI": ".HE", "BE": ".BR", "HK": ".HK",
}


def _yf_fetch_points(symbol, range_, interval_):
    """Fetch close prices from Yahoo Finance chart API, return [{ts, price}] list."""
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


@app.route("/api/stock-tickers")
def stock_tickers_api():
    """Live price + today's change for all held stocks, per-ticker cache 60s."""
    all_rows = []
    for pid in API_KEYS:
        rows, _ = fetch_and_cache_portfolio(pid)
        if rows:
            all_rows.extend(rows)

    # Deduplicate by ticker, preserving order (highest-value first)
    seen, unique = set(), []
    for row in all_rows:
        t = row['ticker']
        if t not in seen:
            seen.add(t)
            unique.append(row)

    # Split into already-cached and needs-fetch
    result_map   = {}
    needs_fetch  = []
    for row in unique:
        ticker    = row['ticker']
        cache_key = f"tick:{ticker}"
        cached    = kv_get(cache_key, 5)
        if cached is not None:
            result_map[ticker] = cached
        else:
            needs_fetch.append(row)

    if needs_fetch:
        # Build yf_sym → row mapping for batch lookup
        sym_to_row = {}
        for row in needs_fetch:
            ticker  = row['ticker']
            country = row.get('country', 'US')
            suffix  = _COUNTRY_YF_SUFFIX.get(country.upper(), "")
            clean   = ticker[:-1] if suffix == ".L" and ticker.endswith("l") else ticker
            sym_to_row[f"{clean}{suffix}"] = (ticker, clean, row)

        quotes = []
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
                # All post-regular-session states: use postMarketPrice (last AH trade).
                # postMarketChangePercent is only vs today's regular close — re-compute
                # from regularMarketPreviousClose for a true full-day change.
                price = q.get("postMarketPrice")
                prev = q.get("regularMarketPreviousClose") or q.get("chartPreviousClose")
                if price is not None and prev and prev != 0:
                    change     = price - prev
                    change_pct = (change / prev) * 100

            if price is None:
                price      = q.get("regularMarketPrice")
                change     = q.get("regularMarketChange")
                change_pct = q.get("regularMarketChangePercent")

            # Compute change from previous close if API omitted it
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

    # Preserve original dedup order
    result = [result_map[row['ticker']] for row in unique if row['ticker'] in result_map]
    return jsonify({"status": "ok", "data": result})


@app.route("/api/stock-sparklines")
def stock_sparklines():
    """48-hour hourly price sparklines for multiple tickers via Yahoo Finance, cached 15 min."""
    tickers_raw   = request.args.get("tickers", "")
    countries_raw = request.args.get("countries", "")
    if not tickers_raw:
        return jsonify({"status": "ok", "data": {}})

    tickers   = [t.strip() for t in tickers_raw.split(",") if t.strip()]
    countries = [c.strip().upper() for c in countries_raw.split(",")]
    if len(countries) < len(tickers):
        countries += ["US"] * (len(tickers) - len(countries))

    result = {}
    for ticker, country in zip(tickers, countries):
        cache_key = f"stock_spark:{ticker}:{country}"
        cached = kv_get(cache_key, 900)
        if cached is not None:
            result[ticker] = cached
            continue

        suffix       = _COUNTRY_YF_SUFFIX.get(country, "")
        # T212 appends a lowercase 'l' to LSE-listed tickers (e.g. "LLOYl") — strip it
        clean_ticker = ticker[:-1] if suffix == ".L" and ticker.endswith("l") else ticker
        yf_symbol    = f"{clean_ticker}{suffix}"
        logger.info("stock_sparkline fetching %s (ticker=%s country=%s)", yf_symbol, ticker, country)
        try:
            points = _yf_fetch_points(yf_symbol, "2d", "1h")
            if len(points) < 2:
                # Fallback: some non-US stocks lack intraday data — use daily
                points = _yf_fetch_points(yf_symbol, "5d", "1d")
            if len(points) >= 2:
                kv_set(cache_key, points)  # Only cache valid results
            result[ticker] = points
        except Exception as exc:
            logger.warning("stock_sparkline failed for %s: %s", yf_symbol, exc)
            result[ticker] = []

    return jsonify({"status": "ok", "data": result})




@app.route("/api/p<pid>/activity")
def activity(pid):
    api_key = API_KEYS.get(pid)
    if not api_key: return jsonify({"status": "error"}), 404
    try:
        orders      = get_orders(api_key, pid, limit=15)
        instruments = get_instruments(api_key)
        for order in orders:
            ticker = order.get("ticker", "")
            # Normalize ticker
            base = ticker.split("_")[0]
            if base in TICKER_MAPPING:
                order["ticker"] = TICKER_MAPPING[base] + (ticker[len(base):] if "_" in ticker else "")
                ticker = order["ticker"]

            inst   = instruments.get(ticker, {})
            order["_company_name"] = (
                inst.get("name") or inst.get("shortname")
                or order.get("company_name") or ticker.split("_")[0]
            )
        return jsonify({"status": "ok", "data": orders})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@app.route("/api/p<pid>/dividend-monthly")
def dividend_monthly(pid):
    api_key = API_KEYS.get(pid)
    if not api_key: return jsonify({"status": "error"}), 404
    try:
        items   = get_dividends_raw(api_key, pid)
        monthly: dict = {}
        for it in items:
            date_str = it.get("paidOn") or it.get("date") or ""
            if not date_str: continue
            month = str(date_str)[:7]
            monthly[month] = round(monthly.get(month, 0) + float(it.get("amount") or 0), 4)
        data = [{"month": m, "amount": a} for m, a in sorted(monthly.items())]
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@app.route("/api/p<pid>/recent-dividends")
def recent_dividends(pid):
    api_key = API_KEYS.get(pid)
    if not api_key: return jsonify({"status": "error"}), 404
    try:
        items = get_recent_dividends(api_key, pid, n=10)
        for d in items:
            raw_ticker = d.get("ticker", "")
            base = raw_ticker.split("_")[0]
            if base in TICKER_MAPPING:
                d["ticker"] = TICKER_MAPPING[base] + (raw_ticker[len(base):] if "_" in raw_ticker else "")
        return jsonify({"status": "ok", "data": items})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


FINNHUB_TOKEN      = os.environ.get("FINNHUB_TOKEN")
TTL_EARNINGS       = 86400    # 1 day
TTL_NEWS           = 1800     # 30 minutes
TTL_DIVIDENDS_CAL  = 86400    # 24 hours


@app.route("/api/earnings")
def earnings():
    """Return upcoming earnings per US-held stock (next 6 months), per-symbol cache 1 day."""
    if not FINNHUB_TOKEN:
        return jsonify({"status": "error", "message": "Finnhub token not configured"}), 503

    try:
        # Collect US-based held tickers from all portfolio caches
        us_tickers = {}  # symbol -> company_name
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

        today = date.today()
        end = today + timedelta(days=183)
        today_str = str(today)
        all_earnings = []

        for symbol, company_name in us_tickers.items():
            cache_key = f"finnhub:earnings:{symbol}"
            data = kv_get(cache_key, TTL_EARNINGS)
            if data is None:
                try:
                    url = (
                        f"https://finnhub.io/api/v1/calendar/earnings"
                        f"?from={today}&to={end}&symbol={symbol}&token={FINNHUB_TOKEN}"
                    )
                    resp = requests.get(url, timeout=10)
                    data = resp.json().get("earningsCalendar", []) if resp.status_code == 200 else []
                except Exception:
                    data = []
                kv_set(cache_key, data)
                time.sleep(0.12)  # ~8 req/s — well within 60/min free tier limit

            for e in data:
                e["_company_name"] = company_name
            # Only keep upcoming dates
            all_earnings.extend(e for e in data if e.get("date", "") >= today_str)

        all_earnings.sort(key=lambda x: x.get("date", ""))
        return jsonify({"status": "ok", "data": all_earnings})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/stock-chart/<ticker>")
def stock_chart(ticker):
    """OHLCV candle data for a ticker. ?period=1d|1w|1m|1y|5y  ?country=US|UK|..."""
    ticker  = ticker.upper()
    period  = request.args.get("period", "1w").strip()
    country = request.args.get("country", "US").strip().upper()

    PERIOD_MAP = {
        "1d": ("1d",  "5m"),
        "1w": ("5d",  "1h"),
        "1m": ("1mo", "1d"),
        "1y": ("1y",  "1d"),
        "5y": ("5y",  "1wk"),
    }
    if period not in PERIOD_MAP:
        period = "1w"
    range_, interval_ = PERIOD_MAP[period]

    suffix = _COUNTRY_YF_SUFFIX.get(country, "")
    clean  = ticker[:-1] if suffix == ".L" and ticker.endswith("l") else ticker
    symbol = f"{clean}{suffix}"

    cache_key = f"stock:chart:v2:{symbol}:{period}"
    TTL = 60 if period == "1d" else 300 if period == "1w" else 3600
    # Include pre/post market candles for intraday periods (1d=5m, 1w=1h)
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
            result = resp.json()["chart"]["result"][0]
            meta    = result.get("meta", {})
            ts_list = result.get("timestamp", [])
            q       = result["indicators"]["quote"][0]
            opens   = q.get("open",   [])
            highs   = q.get("high",   [])
            lows    = q.get("low",    [])
            closes  = q.get("close",  [])
            volumes = q.get("volume", [])
            candles = []
            for i, t in enumerate(ts_list):
                o = opens[i] if i < len(opens) else None
                h = highs[i] if i < len(highs) else None
                l = lows[i]  if i < len(lows)  else None
                c = closes[i] if i < len(closes) else None
                v = volumes[i] if i < len(volumes) else None
                if None in (o, h, l, c):
                    continue
                candles.append({
                    "ts": int(t),
                    "o": round(float(o), 4),
                    "h": round(float(h), 4),
                    "l": round(float(l), 4),
                    "c": round(float(c), 4),
                    "v": int(v) if v else 0,
                })
            currency     = meta.get("currency", "")
            market_state = meta.get("marketState", "REGULAR")
            # Capture extended-hours live price so the chart can draw a current-price line
            ext_price = None
            if market_state == "PRE":
                ext_price = meta.get("preMarketPrice")
            elif market_state in ("POST", "POSTPOST", "PREPRE", "CLOSED"):
                ext_price = meta.get("postMarketPrice")
            data = {
                "candles":      candles,
                "currency":     currency,
                "market_state": market_state,
                "ext_price":    round(ext_price, 4) if ext_price is not None else None,
            }
            if candles:
                kv_set(cache_key, data)
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/stock-metrics/<ticker>")
def stock_metrics(ticker):
    """Return fundamental metrics for a US ticker, cached 24 hours."""
    if not FINNHUB_TOKEN:
        return jsonify({"status": "error", "message": "Finnhub token not configured"}), 503

    ticker = ticker.upper()
    cache_key = f"finnhub:metrics:{ticker}"

    try:
        data = kv_get(cache_key, TTL_EARNINGS)  # 24h TTL
        if data is None:
            url = (
                f"https://finnhub.io/api/v1/stock/metric"
                f"?symbol={ticker}&metric=all&token={FINNHUB_TOKEN}"
            )
            resp = requests.get(url, timeout=10)
            data = resp.json() if resp.status_code == 200 else {}
            if not isinstance(data, dict):
                data = {}
            kv_set(cache_key, data)

        # Return only the flat metric object — skip raw series data to keep payload small
        metric = data.get("metric", {})
        return jsonify({"status": "ok", "data": metric})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/stock-news/<ticker>")
def stock_news(ticker):
    """Return up to 1 year of company news for a ticker, cached 30 hours."""
    if not FINNHUB_TOKEN:
        return jsonify({"status": "error", "message": "Finnhub token not configured"}), 503

    ticker = ticker.upper()
    cache_key = f"finnhub:news:{ticker}"

    try:
        data = kv_get(cache_key, TTL_NEWS)
        if data is None:
            today = date.today()
            from_date = today - timedelta(days=365)
            url = (
                f"https://finnhub.io/api/v1/company-news"
                f"?symbol={ticker}&from={from_date}&to={today}&token={FINNHUB_TOKEN}"
            )
            resp = requests.get(url, timeout=10)
            data = resp.json() if resp.status_code == 200 else []
            if not isinstance(data, list):
                data = []
            kv_set(cache_key, data)

        # Sort newest first by datetime (Unix timestamp)
        data.sort(key=lambda x: x.get("datetime", 0), reverse=True)
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/analyst-ratings")
def analyst_ratings():
    """Return analyst recommendations for all held stocks using TradingView data, cached 24 hours."""
    try:
        # Collect all unique tickers across both portfolios (all countries)
        all_tickers = {}
        for pid in ["1", "2"]:
            rows, _ = fetch_and_cache_portfolio(pid)
            if rows:
                for r in rows:
                    ticker = r.get("ticker")
                    sector = (r.get("sector") or "").lower()
                    # Skip index funds / ETFs — they don't have analyst ratings
                    if ticker and ticker not in all_tickers and "index" not in sector:
                        all_tickers[ticker] = r.get("country", "US")

        if not all_tickers:
            return jsonify({"status": "ok", "data": {}})

        result = {}
        for ticker, country in sorted(all_tickers.items()):
            cache_key = f"tv:analyst:v4:{ticker}"
            data = kv_get(cache_key, TTL_EARNINGS)  # 24h TTL
            if data is None:
                forecast = _get_tv_forecast(ticker, country)
                data = forecast or {}
                kv_set(cache_key, data)

            rec_text = (data.get("rec_text") or "NEUTRAL").upper()
            total    = data.get("total", 0)

            # Skip if TradingView has no usable signal for this ticker
            if not data or (total == 0 and rec_text == "NEUTRAL"):
                continue

            strong_buy  = data.get("strongBuy", 0)
            buy         = data.get("buy", 0)
            hold        = data.get("hold", 0)
            sell        = data.get("sell", 0)
            strong_sell = data.get("strongSell", 0)
            has_breakdown = data.get("hasBreakdown", False)

            # Derive consensus: use weighted score when breakdown available,
            # otherwise map rec_text directly.
            if has_breakdown and total > 0:
                score = (strong_buy*1 + buy*2 + hold*3 + sell*4 + strong_sell*5) / total
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
                "strongBuy":    strong_buy,
                "buy":          buy,
                "hold":         hold,
                "sell":         sell,
                "strongSell":   strong_sell,
                "total":        total,
                "hasBreakdown": has_breakdown,
                "period":       "past 3 months",
                "consensus":    consensus,
                "avgTarget":    data.get("avg"),
                "highTarget":   data.get("high"),
                "lowTarget":    data.get("low"),
            }

        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/watchlist/signals")
def watchlist_signals():
    """TradingView analyst targets for any arbitrary ticker (for watchlist use)."""
    ticker  = request.args.get("ticker", "").strip().upper()
    country = request.args.get("country", "US").strip().upper()
    if not ticker:
        return jsonify({"status": "error", "message": "ticker required"}), 400
    try:
        cache_key = f"tv:analyst:v4:{ticker}"
        data = kv_get(cache_key, TTL_EARNINGS)
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
            }
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


_YF_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)


def _yf_crumb():
    """Return (crumb, cookie_str) for Yahoo Finance v10 requests, cached 1 h."""
    cached = kv_get("yf:crumb:v3", 3600)
    if cached:
        return cached["crumb"], cached["cookies"]

    sess = requests.Session()
    # Hit the consent endpoint so cookies are set
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


def _yf_summary(yf_sym, modules="financialData,defaultKeyStatistics,summaryDetail"):
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
            # Crumb expired — clear cache and retry
            try:
                kv_set("yf:crumb:v3", None)
            except Exception:
                pass
            continue
        resp.raise_for_status()
        result_list = resp.json().get("quoteSummary", {}).get("result") or []
        return result_list[0] if result_list else {}
    return {}


@app.route("/api/watchlist/fundamentals")
def watchlist_fundamentals():
    """Market cap, LTM revenue, P/S, trailing P/E, forward P/E, and 5-year avg P/E for a ticker. Cached 24h."""
    ticker  = request.args.get("ticker", "").strip().upper()
    country = request.args.get("country", "US").strip().upper()
    if not ticker:
        return jsonify({"status": "error", "message": "ticker required"}), 400
    try:
        cache_key = f"wl:fundamentals4:{ticker}:{country}"
        cached = kv_get(cache_key, TTL_EARNINGS)
        if cached is not None:
            return jsonify({"status": "ok", "data": cached})

        suffix       = _COUNTRY_YF_SUFFIX.get(country, "")
        clean_ticker = ticker[:-1] if suffix == ".L" and ticker.endswith("l") else ticker
        yf_sym       = f"{clean_ticker}{suffix}"

        summary = _yf_summary(yf_sym, modules="financialData,defaultKeyStatistics,summaryDetail,incomeStatementHistory")
        fin     = summary.get("financialData", {})
        stats   = summary.get("defaultKeyStatistics", {})
        detail  = summary.get("summaryDetail", {})

        def _raw(d, key):
            v = d.get(key)
            return v.get("raw") if isinstance(v, dict) else v

        market_cap    = _raw(stats, "marketCap") or _raw(detail, "marketCap")
        total_revenue = _raw(fin, "totalRevenue")
        trailing_pe   = _raw(detail, "trailingPE") or _raw(stats, "trailingPE")
        forward_pe_val = _raw(stats, "forwardPE") or _raw(detail, "forwardPE")

        rev_multiple = None
        if market_cap and total_revenue and total_revenue > 0:
            rev_multiple = round(market_cap / total_revenue, 1)

        pe_ratio    = round(trailing_pe, 1)    if trailing_pe    and trailing_pe    > 0 else None
        forward_pe  = round(forward_pe_val, 1) if forward_pe_val and forward_pe_val > 0 else None

        # 5-year average P/E — computed from annual EPS history + matching historical prices
        pe_5yr_avg = None
        try:
            statements = summary.get("incomeStatementHistory", {}).get("incomeStatementHistory", [])
            if statements:
                price_points = _yf_fetch_points(yf_sym, "5y", "1mo")
                if price_points:
                    pe_values = []
                    for stmt in statements[:5]:
                        end_date = stmt.get("endDate")
                        end_ts   = end_date.get("raw") if isinstance(end_date, dict) else None
                        basic_eps_raw = stmt.get("basicEps")
                        eps_val = basic_eps_raw.get("raw") if isinstance(basic_eps_raw, dict) else basic_eps_raw
                        if not end_ts or not eps_val or eps_val <= 0:
                            continue
                        closest = min(price_points, key=lambda p: abs(p["ts"] - end_ts))
                        if abs(closest["ts"] - end_ts) < 120 * 86400:  # within 120 days
                            pe = closest["price"] / eps_val
                            if 0 < pe < 2000:  # sanity check — exclude negative/absurd P/Es
                                pe_values.append(pe)
                    if pe_values:
                        pe_5yr_avg = round(sum(pe_values) / len(pe_values), 1)
        except Exception:
            pass

        # 6-month, 1-year and YTD price returns
        return_6m = return_1y = return_ytd = None
        try:
            pts = _yf_fetch_points(yf_sym, "1y", "1d")
            if pts:
                latest = pts[-1]["price"]
                def _ret_at(days):
                    target_ts = pts[-1]["ts"] - days * 86400
                    closest = min(pts, key=lambda p: abs(p["ts"] - target_ts))
                    if abs(closest["ts"] - target_ts) < 10 * 86400 and closest["price"] > 0:
                        return round((latest / closest["price"] - 1) * 100, 2)
                    return None
                return_6m = _ret_at(182)
                return_1y = _ret_at(365)
                # YTD: days elapsed since Jan 1 of current year
                days_ytd = (date.today() - date(date.today().year, 1, 1)).days
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


@app.route("/api/watchlist/price")
def watchlist_price():
    """Current price + company name for any arbitrary ticker (for watchlist use), cached 60s."""
    ticker  = request.args.get("ticker", "").strip()
    country = request.args.get("country", "US").strip().upper()
    if not ticker:
        return jsonify({"status": "error", "message": "ticker required"}), 400
    try:
        cache_key = f"wl:price:{ticker}:{country}"
        cached = kv_get(cache_key, 60)
        if cached is not None:
            return jsonify({"status": "ok", "data": cached})

        suffix       = _COUNTRY_YF_SUFFIX.get(country, "")
        clean_ticker = ticker[:-1] if suffix == ".L" and ticker.endswith("l") else ticker
        yf_sym       = f"{clean_ticker}{suffix}"

        quotes = []
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
            # Recompute vs previous close for true full-day change
            prev = q.get("regularMarketPreviousClose") or q.get("chartPreviousClose")
            if price is not None and prev and prev != 0:
                change_pct = ((price - prev) / prev) * 100

        if price is None:
            price      = q.get("regularMarketPrice")
            change_pct = q.get("regularMarketChangePercent")

        if price is not None and change_pct is None:
            prev = q.get("regularMarketPreviousClose") or q.get("chartPreviousClose")
            if prev and prev != 0:
                change_pct = ((price - prev) / prev) * 100

        company = q.get("longName") or q.get("shortName") or clean_ticker
        result = {
            "ticker":       clean_ticker,
            "company":      company,
            "price":        round(price, 4) if price is not None else None,
            "change_pct":   round(change_pct, 4) if change_pct is not None else None,
            "currency":     q.get("currency", ""),
            "market_state": market_state,
        }
        kv_set(cache_key, result)
        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


_WL_TTL = 10 * 365 * 24 * 3600  # ~10 years — effectively permanent


@app.route("/api/watchlist/tickers", methods=["GET"])
def get_watchlist_tickers():
    """Return the persisted watchlist ticker list."""
    data = kv_get("watchlist_tickers", _WL_TTL) or []
    return jsonify({"status": "ok", "data": data})


@app.route("/api/watchlist/tickers", methods=["POST"])
def save_watchlist_tickers():
    """Persist the full watchlist ticker list."""
    body = request.get_json(silent=True) or {}
    tickers = body.get("tickers", [])
    if not isinstance(tickers, list):
        return jsonify({"status": "error", "message": "tickers must be a list"}), 400
    kv_set("watchlist_tickers", tickers)
    return jsonify({"status": "ok"})


@app.route("/api/fx-rate")
def fx_rate():
    """Return the current GBP/USD exchange rate."""
    rate = get_gbpusd_rate()
    return jsonify({"rate": rate})


@app.route("/api/p<pid>/history")
def portfolio_history(pid):
    """Return up to 48 hours of portfolio value snapshots for sparkline charts."""
    if pid == "combined":
        bucket_size = 300  # 5-minute buckets
        buckets: dict[int, dict[str, float]] = {}
        for p in API_KEYS:
            for snap in snapshot_get(p, hours=48):
                bucket = int(snap["ts"] // bucket_size) * bucket_size
                if bucket not in buckets:
                    buckets[bucket] = {}
                # Take latest value per portfolio per bucket
                buckets[bucket][p] = snap["value"]
        
        data = []
        for ts in sorted(buckets.keys()):
            total_v = sum(buckets[ts].values())
            data.append({"ts": ts, "value": round(total_v, 2)})
    else:
        data = snapshot_get(pid, hours=48)
    return jsonify({"status": "ok", "data": data})


@app.route("/api/p<pid>/monthly-returns")
def monthly_returns_endpoint(pid):
    """Portfolio-level month-over-month % returns derived from value snapshots."""
    cache_key = f"monthly_returns:{pid}"
    cached = kv_get(cache_key, 1800)  # 30-min TTL
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})

    HOURS_5Y = 5 * 365 * 24  # fetch up to 5 years of snapshots

    if pid == "combined":
        pid_daily: dict = {}
        for p in API_KEYS:
            snaps = snapshot_get(p, hours=HOURS_5Y)
            by_day: dict = {}
            for s in snaps:
                day = date.fromtimestamp(s["ts"]).isoformat()
                if day not in by_day or s["ts"] > by_day[day][0]:
                    by_day[day] = (s["ts"], s["value"])
            pid_daily[p] = {d: v for d, (_, v) in by_day.items()}

        all_days: set = set()
        for d in pid_daily.values():
            all_days.update(d.keys())
        daily_vals: dict = {}
        for day in sorted(all_days):
            total = sum(pd.get(day, 0) for pd in pid_daily.values())
            if total > 0:
                daily_vals[day] = round(total, 2)
    else:
        snaps = snapshot_get(pid, hours=HOURS_5Y)
        by_day = {}
        for s in snaps:
            d = date.fromtimestamp(s["ts"]).isoformat()
            if d not in by_day or s["ts"] > by_day[d][0]:
                by_day[d] = (s["ts"], s["value"])
        daily_vals = {d: round(v, 2) for d, (_, v) in sorted(by_day.items())}

    # End-of-month value = last snapshot within each calendar month
    monthly_vals: dict = {}
    for day in sorted(daily_vals.keys()):
        monthly_vals[day[:7]] = daily_vals[day]

    # Month-over-month % returns
    months = sorted(monthly_vals.keys())
    result = []
    for i in range(1, len(months)):
        prev_v = monthly_vals[months[i - 1]]
        curr_v = monthly_vals[months[i]]
        if prev_v and prev_v > 0:
            pct = round((curr_v - prev_v) / prev_v * 100, 2)
            result.append({"month": months[i], "pct": pct, "value": curr_v})

    # ── Attach SPY benchmark monthly returns ──────────────────────────────────
    try:
        spy_cache_key = "spy_monthly_returns"
        spy_monthly = kv_get(spy_cache_key, 3600)
        if spy_monthly is None:
            spy_points = _yf_fetch_points("SPY", "5y", "1mo")
            spy_monthly_vals: dict = {}
            for i in range(1, len(spy_points)):
                from datetime import datetime as _dt2, timezone as _tz2
                mo = _dt2.fromtimestamp(spy_points[i]["ts"], _tz2.utc).strftime("%Y-%m")
                p0 = spy_points[i - 1]["price"]
                p1 = spy_points[i]["price"]
                if p0 and p0 > 0:
                    spy_monthly_vals[mo] = round((p1 - p0) / p0 * 100, 2)
            kv_set(spy_cache_key, spy_monthly_vals)
            spy_monthly = spy_monthly_vals
        for item in result:
            item["spy_pct"] = spy_monthly.get(item["month"])
    except Exception as _spy_exc:
        logger.warning("SPY benchmark fetch failed: %s", _spy_exc)

    kv_set(cache_key, result)
    return jsonify({"status": "ok", "data": result})


@app.route("/api/pcombined/risk-metrics")
def risk_metrics_endpoint():
    """Portfolio risk metrics: TWR, Beta, Annualised Volatility, Sharpe, Sortino, Weighted P/E."""
    cache_key = "risk_metrics:combined"
    cached = kv_get(cache_key, 3600)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})
    try:
        # ── 1. Build combined daily portfolio values (1 year of snapshots) ──
        HOURS_1Y = 8760
        pid_daily = {}
        for p in API_KEYS:
            snaps = snapshot_get(p, hours=HOURS_1Y)
            by_day = {}
            for s in snaps:
                day = date.fromtimestamp(s["ts"]).isoformat()
                if day not in by_day or s["ts"] > by_day[day][0]:
                    by_day[day] = (s["ts"], s["value"])
            pid_daily[p] = {d: v for d, (_, v) in by_day.items()}

        all_days = sorted(set().union(*[set(d.keys()) for d in pid_daily.values()]))
        pf_vals = {}
        for day in all_days:
            total = sum(pd.get(day, 0) for pd in pid_daily.values())
            if total > 0:
                pf_vals[day] = total

        if len(pf_vals) < 5:
            return jsonify({"status": "ok", "data": {"insufficient_data": True}})

        pf_days = sorted(pf_vals.keys())
        pf_prices = [pf_vals[d] for d in pf_days]

        # ── 2. Daily portfolio returns ──────────────────────────────────────
        pf_returns = [(pf_prices[i] / pf_prices[i - 1]) - 1 for i in range(1, len(pf_prices))]

        # ── 3. TWR ─────────────────────────────────────────────────────────
        twr = 1.0
        for r in pf_returns:
            twr *= (1 + r)
        twr = round((twr - 1) * 100, 2)

        # ── 4. Fetch SPY for Beta + SPY benchmarks ──────────────────────────
        spy_points = _yf_fetch_points("SPY", "1y", "1d")
        spy_by_day = {date.fromtimestamp(p["ts"]).isoformat(): p["price"] for p in spy_points}
        common_days = sorted(d for d in pf_days if d in spy_by_day)

        spy_twr = None
        beta = None
        spy_sharpe = None
        if len(common_days) >= 10:
            spy_prices_c = [spy_by_day[d] for d in common_days]
            pf_prices_c  = [pf_vals[d]     for d in common_days]
            spy_rets = [(spy_prices_c[i] / spy_prices_c[i - 1]) - 1 for i in range(1, len(spy_prices_c))]
            pf_rets_c = [(pf_prices_c[i]  / pf_prices_c[i - 1])  - 1 for i in range(1, len(pf_prices_c))]
            # SPY TWR
            v = 1.0
            for r in spy_rets:
                v *= (1 + r)
            spy_twr = round((v - 1) * 100, 2)
            # Beta
            n = len(pf_rets_c)
            if n >= 2:
                mp = sum(pf_rets_c) / n
                ms = sum(spy_rets) / n
                cov    = sum((pf_rets_c[i] - mp) * (spy_rets[i] - ms) for i in range(n)) / (n - 1)
                var_s  = sum((r - ms) ** 2 for r in spy_rets) / (n - 1)
                beta = round(cov / var_s, 3) if var_s > 0 else None
            # SPY Sharpe
            rf_d = (1.045 ** (1 / 252)) - 1
            spy_exc = [r - rf_d for r in spy_rets]
            sm = sum(spy_exc) / len(spy_exc)
            ss = (sum((r - sm) ** 2 for r in spy_exc) / (len(spy_exc) - 1)) ** 0.5
            spy_sharpe = round(sm / ss * (252 ** 0.5), 3) if ss > 0 else None

        # ── 5. Sharpe, Sortino, Volatility ──────────────────────────────────
        rf_d = (1.045 ** (1 / 252)) - 1
        exc  = [r - rf_d for r in pf_returns]
        n    = len(exc)
        mean_e = sum(exc) / n if n > 0 else 0
        var_e  = sum((r - mean_e) ** 2 for r in exc) / (n - 1) if n > 1 else 0
        std_e  = var_e ** 0.5
        sharpe = round(mean_e / std_e * (252 ** 0.5), 3) if std_e > 0 else None
        vol    = round(std_e * (252 ** 0.5) * 100, 2) if std_e > 0 else None
        down   = [r for r in exc if r < 0]
        sortino = None
        if len(down) > 1:
            dv  = sum(r ** 2 for r in down) / len(down)
            sortino = round(mean_e / (dv ** 0.5) * (252 ** 0.5), 3) if dv > 0 else None

        # ── 6. Weighted P/E ─────────────────────────────────────────────────
        pe_weighted = None
        try:
            combined_rows = []
            total_val = 0.0
            for p in API_KEYS:
                rows, _ = rows_get(p)
                if rows:
                    combined_rows.extend(rows)
                    total_val += sum(r["current_value"] for r in rows)
            if total_val > 0:
                # Build per-row metadata and separate cached from uncached
                row_meta = []
                for row in combined_rows:
                    tk      = row["ticker"]
                    country = row.get("country", "US")
                    suffix  = _COUNTRY_YF_SUFFIX.get(country, "")
                    clean   = tk[:-1] if suffix == ".L" and tk.lower().endswith("l") else tk
                    yf_sym  = f"{clean}{suffix}"
                    row_meta.append((row, yf_sym, f"pe:{yf_sym}"))

                # Check cache first; collect symbols that need fetching
                pe_map = {}
                to_fetch = []
                for row, yf_sym, ck in row_meta:
                    cached_pe = kv_get(ck, 86400)
                    if cached_pe is not None:
                        pe_map[yf_sym] = cached_pe
                    elif yf_sym not in pe_map:
                        to_fetch.append((yf_sym, ck))

                # Fetch uncached P/E values in parallel
                def _fetch_pe(args):
                    sym, ck = args
                    try:
                        summ   = _yf_summary(sym, modules="summaryDetail,defaultKeyStatistics")
                        detail = summ.get("summaryDetail", {})
                        stats  = summ.get("defaultKeyStatistics", {})
                        def _r(d, k):
                            v = d.get(k); return v.get("raw") if isinstance(v, dict) else v
                        raw_pe = _r(detail, "trailingPE") or _r(stats, "trailingPE")
                        val = round(raw_pe, 1) if raw_pe and 0 < raw_pe < 500 else None
                    except Exception:
                        val = None
                    kv_set(ck, val)
                    return sym, val

                if to_fetch:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(to_fetch))) as ex:
                        for sym, val in ex.map(_fetch_pe, to_fetch):
                            pe_map[sym] = val

                pe_sum = pe_wt = 0.0
                for row, yf_sym, _ in row_meta:
                    pe_val = pe_map.get(yf_sym)
                    if pe_val:
                        w = row["current_value"] / total_val
                        pe_sum += pe_val * w
                        pe_wt  += w
                if pe_wt >= 0.5:
                    pe_weighted = round(pe_sum / pe_wt, 1)
        except Exception as pe_err:
            logger.warning("P/E computation error: %s", pe_err)

        result = {
            "twr": twr,
            "spy_twr": spy_twr,
            "twr_vs_spy": round(twr - spy_twr, 2) if spy_twr is not None else None,
            "beta": beta,
            "volatility": vol,
            "sharpe": sharpe,
            "sortino": sortino,
            "spy_sharpe": spy_sharpe,
            "pe": pe_weighted,
            "data_days": len(pf_days),
        }
        kv_set(cache_key, result)
        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        logger.error("risk_metrics error: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/p<pid>/monthly-performance")
def monthly_performance(pid):
    """Monthly % returns for all tickers in the portfolio for the last 12 months."""
    from datetime import datetime as _dt, timezone as _tz

    cache_key = f"monthly_perf:{pid}"
    cached = kv_get(cache_key, 900)  # 15-min TTL — current month needs fresh price
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})

    if pid == "combined":
        all_rows = []
        for p in API_KEYS:
            rows, _ = fetch_and_cache_portfolio(p)
            if rows:
                all_rows.extend(rows)
        seen, unique = set(), []
        for row in all_rows:
            t = row["ticker"]
            if t not in seen:
                seen.add(t)
                unique.append(row)
    else:
        rows, _ = fetch_and_cache_portfolio(pid)
        unique = rows or []

    def _fetch_monthly(row):
        ticker = row["ticker"]
        country = row.get("country", "US")
        suffix = _COUNTRY_YF_SUFFIX.get(country.upper(), "")
        clean_ticker = ticker[:-1] if suffix == ".L" and ticker.endswith("l") else ticker
        yf_sym = f"{clean_ticker}{suffix}"
        try:
            resp = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}",
                params={"range": "1y", "interval": "1mo"},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10,
            )
            resp.raise_for_status()
            result = resp.json()["chart"]["result"][0]
            timestamps = result.get("timestamp", [])
            closes = list(result["indicators"]["quote"][0].get("close", []))

            # Yahoo Finance opens a new monthly bar with close = prev month's close
            # (the bar hasn't "settled" yet), so the current incomplete month always
            # shows 0%.  Override the last bar with regularMarketPrice to get the
            # real month-to-date return.
            current_price = result.get("meta", {}).get("regularMarketPrice")
            if current_price and closes:
                closes[-1] = current_price

            monthly = {}
            for i in range(1, len(timestamps)):
                if closes[i] is None or closes[i - 1] is None or closes[i - 1] == 0:
                    continue
                dt = _dt.fromtimestamp(timestamps[i], _tz.utc)
                month_key = dt.strftime("%Y-%m")
                pct = (closes[i] - closes[i - 1]) / closes[i - 1] * 100
                monthly[month_key] = round(pct, 2)
            return clean_ticker, monthly
        except Exception as exc:
            logger.warning("monthly_perf failed for %s: %s", yf_sym, exc)
            return ticker, {}

    result = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(12, max(1, len(unique)))) as ex:
        for ticker, monthly in ex.map(_fetch_monthly, unique):
            result[ticker] = monthly

    kv_set(cache_key, result)
    return jsonify({"status": "ok", "data": result})


@app.route("/api/home-data")
def home_data():
    """Single combined endpoint for the landing page: overview + activity + top performers + market indicators + fx rate."""
    force = request.args.get("refresh", "0") == "1"
    try:
        return _home_data_inner(force)
    except Exception as exc:
        logger.exception("home_data failed (force=%s): %s", force, exc)
        return jsonify({"status": "error", "message": str(exc)}), 500


def _home_data_inner(force):
    # ── 1. Overview ────────────────────────────────────────────────────────────
    overview_res = {}
    total_value = total_returns = total_invested = 0.0
    total_cash = total_realized = 0.0
    for pid, api_key in API_KEYS.items():
        rows, _ = fetch_and_cache_portfolio(pid, force=force)
        summary = {}
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
            cash        = summary.get("cash", 0)
            realized    = summary.get("realized_pnl", 0)
            unrealized  = summary.get("unrealized_pnl") if summary else None
            if unrealized is None:
                unrealized = round(p_val - p_inv, 2)
            total_cash      += cash
            total_realized  += realized
            total_returns   += unrealized
            overview_res[pid] = {
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
    all_combined_rows = []
    for pid in API_KEYS:
        r, _ = rows_get(pid)
        if r:
            all_combined_rows.extend(r)
    overview_res["combined"] = {
        "value":          round(total_value, 2),
        "returns":        round(total_returns, 2),
        "returns_pct":    round((total_returns / total_invested) * 100, 2) if total_invested > 0 else 0,
        "invested":       round(total_invested, 2),
        "positions":      sum(p["positions"] for p in overview_res.values() if isinstance(p, dict) and "positions" in p),
        "top_sector":     _top_sector(all_combined_rows),
        "cash":           round(total_cash, 2),
        "realized_pnl":   round(total_realized, 2),
        "unrealized_pnl": round(total_returns, 2),
    }
    overview_metadata = {
        "names": PORTFOLIO_NAMES,
        "freshness": {
            "prices":    kv_age("1:rows") or 0,
            "dividends": kv_age("total_dividends", pid="1") or 0,
            "fx":        kv_age("gbpusd") or 0,
        }
    }

    # ── 2. Activity ────────────────────────────────────────────────────────────
    activity_data = []
    try:
        all_orders = []
        for pid, key in API_KEYS.items():
            if not key:
                continue
            orders = get_orders(key, pid, limit=15)
            for o in orders:
                o["_pid"] = pid
            all_orders.extend(orders)
        all_orders.sort(key=lambda x: x.get("dateExecuted", ""), reverse=True)
        activity_data = all_orders[:20]
    except Exception:
        pass

    # ── 3. Top performers ──────────────────────────────────────────────────────
    performers_data = []
    under_performers_data = []
    try:
        combined_rows_map = {}
        for pid, key in API_KEYS.items():
            if not key:
                continue
            rows, _ = rows_get(pid)
            if not rows:
                continue
            for r in rows:
                t = r["ticker"]
                if t not in combined_rows_map:
                    combined_rows_map[t] = r.copy()
                    combined_rows_map[t]["_pid"] = pid
                else:
                    curr = combined_rows_map[t]
                    curr["invested"]      += r["invested"]
                    curr["current_value"] += r["current_value"]
                    curr["total_returns"] += r["total_returns"]
        consolidated = list(combined_rows_map.values())
        for r in consolidated:
            r["returns_pct"] = (r["total_returns"] / r["invested"] * 100) if r["invested"] > 0 else 0
        consolidated.sort(key=lambda x: x["total_returns"], reverse=True)
        performers_data = consolidated[:5]
        under_performers_data = list(reversed(consolidated[-5:])) if consolidated else []
    except Exception:
        pass

    # ── 4. Market indicators (cache only — background thread keeps this warm) ──
    market_ind_data = kv_get("market_indicators", 1800)
    if not _market_ind_valid(market_ind_data):
        market_ind_data = None

    # ── 5. FX rate ─────────────────────────────────────────────────────────────
    fx_rate = get_gbpusd_rate()

    return jsonify({
        "status":            "ok",
        "overview":          overview_res,
        "overview_metadata": overview_metadata,
        "activity":          activity_data,
        "top_performers":    performers_data,
        "under_performers":  under_performers_data,
        "market_indicators": market_ind_data,
        "fx_rate":           fx_rate,
    })


def _pick_exchange_schedule(exchange_data):
    """Pick the main working schedule — skip 1-second OPEN/CLOSE heartbeat schedules."""
    best, best_count = None, 0
    for schedule in exchange_data.get('workingSchedules', []):
        events = schedule.get('timeEvents', [])
        opens  = [e for e in events if e['type'] == 'OPEN']
        closes = [e for e in events if e['type'] == 'CLOSE']
        if opens and closes:
            from datetime import datetime, timezone
            o_ts = datetime.fromisoformat(opens[0]['date'].replace('Z', '+00:00')).timestamp()
            c_ts = datetime.fromisoformat(closes[0]['date'].replace('Z', '+00:00')).timestamp()
            if abs(c_ts - o_ts) < 60:
                continue  # skip heartbeat schedules
        if len(events) > best_count:
            best, best_count = schedule, len(events)
    return best


def _session_from_schedule(schedule, now_ts):
    """Return current session label by finding the most recent timeEvent <= now."""
    SESSION_MAP = {
        'OPEN': 'open',
        'PRE_MARKET_OPEN': 'pre-market',
        'AFTER_HOURS_OPEN': 'after-hours',
        'OVERNIGHT_OPEN': 'after-hours',
        'AFTER_HOURS_CLOSE': 'closed',
        'CLOSE': 'closed',
    }
    from datetime import datetime, timezone
    events = sorted(schedule.get('timeEvents', []), key=lambda e: e['date'])
    current = None
    for ev in events:
        ev_ts = datetime.fromisoformat(ev['date'].replace('Z', '+00:00')).timestamp()
        if ev_ts <= now_ts:
            current = ev
        else:
            break
    return SESSION_MAP.get(current['type'], 'closed') if current else 'closed'


def _schedule_details(schedule, now_dt):
    """Extract today's open/close and upcoming day-pairs for the tooltip."""
    from datetime import datetime, timezone
    from collections import defaultdict

    events = sorted(schedule.get('timeEvents', []), key=lambda e: e['date'])
    today  = now_dt.date()

    def parse_dt(e):
        return datetime.fromisoformat(e['date'].replace('Z', '+00:00'))

    # AFTER_HOURS_OPEN signals end of regular session when CLOSE is absent (e.g. NASDAQ)
    CLOSE_TYPES = ('CLOSE', 'AFTER_HOURS_OPEN')

    today_open  = next((e for e in events if e['type'] == 'OPEN'      and parse_dt(e).date() == today), None)
    today_close = next((e for e in events if e['type'] in CLOSE_TYPES and parse_dt(e).date() == today), None)

    # Group future events into per-day {open, close} pairs
    by_day: dict = defaultdict(dict)
    for e in events:
        if e['type'] not in ('OPEN',) + CLOSE_TYPES:
            continue
        day = parse_dt(e).date()
        if day <= today:
            continue
        if e['type'] == 'OPEN' and 'open' not in by_day[day]:
            by_day[day]['open'] = e['date']
        elif e['type'] in CLOSE_TYPES and 'close' not in by_day[day]:
            by_day[day]['close'] = e['date']

    upcoming = [
        {'open': v.get('open'), 'close': v.get('close')}
        for _, v in sorted(by_day.items())
    ][:5]

    return {
        'today_open':  today_open['date']  if today_open  else None,
        'today_close': today_close['date'] if today_close else None,
        'upcoming':    upcoming,
    }


@app.route("/api/market-status")
def market_status_api():
    """Market session from T212 exchange metadata — metadata cached 6h, session 60s."""
    cached = kv_get("market_status", 60)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})

    TARGET = {53: 'NASDAQ', 42: 'LSE'}
    result = {}
    try:
        exchanges_raw = kv_get("t212_exchange_meta", 21600)
        if exchanges_raw is None:
            api_key = next(iter(API_KEYS.values()), None)
            base = os.environ.get("TRADING212_BASE_URL", "https://live.trading212.com")
            resp = requests.get(
                f"{base}/api/v0/equity/metadata/exchanges",
                headers={"Authorization": "Basic " +api_key},
                timeout=10,
            )
            resp.raise_for_status()
            exchanges_raw = resp.json()
            kv_set("t212_exchange_meta", exchanges_raw)

        from datetime import datetime, timezone
        now_dt = datetime.now(timezone.utc)
        now_ts = now_dt.timestamp()
        for exch in exchanges_raw:
            if exch.get('id') in TARGET:
                name     = TARGET[exch['id']]
                schedule = _pick_exchange_schedule(exch)
                session  = _session_from_schedule(schedule, now_ts) if schedule else 'closed'
                details  = _schedule_details(schedule, now_dt)      if schedule else {}
                result[name] = {"session": session, "schedule": details}
    except Exception as exc:
        logger.warning("market_status: %s", exc)
        return jsonify({"status": "error"}), 500

    kv_set("market_status", result)
    return jsonify({"status": "ok", "data": result})


@app.route("/api/admin/clear-cache")
def api_clear_cache():
    """Force clear all cached data."""
    try:
        clear_all_cache()
        return jsonify({"status": "ok", "message": "Cache cleared successfully"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


def _fetch_and_cache_news():
    """Fetch general market news from Finnhub and store in cache. Returns news list or None."""
    token = os.environ.get("FINNHUB_TOKEN")
    if not token:
        return None
    url = f"https://finnhub.io/api/v1/news?category=general&token={token}"
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    news = resp.json()
    kv_set("general_market_news", news)
    return news


@app.route("/api/news")
def api_news():
    """Fetch general market news from Finnhub with caching. ?force=1 bypasses cache."""
    force = request.args.get("force") == "1"
    if not force:
        cached = kv_get("general_market_news", TTL_NEWS)
        if cached:
            return jsonify({"status": "ok", "data": cached})
    try:
        news = _fetch_and_cache_news()
        if news is None:
            return jsonify({"status": "error", "message": "Finnhub token not configured"}), 500
        return jsonify({"status": "ok", "data": news})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500




@app.route("/api/upcoming-dividends")
def upcoming_dividends():
    """Return upcoming dividends for all held tickers (US via Massive, UK via Snowball).
    Data is pre-fetched by the background dividend refresh thread every 12 hours."""
    _log = logging.getLogger("upcoming-dividends")
    today_str    = str(date.today())
    all_entries  = []
    missing      = []

    all_ticker_info = {
        **_sdiv.build_ticker_info(API_KEYS),
        **_sdiv.build_uk_ticker_info(API_KEYS),
    }

    if not all_ticker_info:
        _log.warning("No tickers found in portfolio cache — dividend calendar empty")
        return jsonify({"status": "ok", "data": [], "last_refresh": None})

    for ticker, info in all_ticker_info.items():
        raw = kv_get(f"{_sdiv.DIV_CACHE_KEY_PREFIX}:{ticker}", _sdiv.TTL_DIVIDENDS_CAL)
        if raw is None:
            missing.append(ticker)
            continue
        all_entries.extend(_sdiv.format_snowball_entries(ticker, info, raw, today_str))

    if missing:
        _log.info("Dividend cache missing for %d tickers: %s", len(missing), ", ".join(missing[:10]))

    all_entries.sort(key=lambda d: d.get("payment_date", ""))

    last_refresh = kv_get(_sdiv.LAST_REFRESH_KEY, _sdiv.TTL_DIVIDENDS_CAL)
    return jsonify({
        "status":       "ok",
        "data":         all_entries,
        "last_refresh": last_refresh,
        "cached":       len(all_ticker_info) - len(missing),
        "total":        len(all_ticker_info),
    })


@app.route("/health")
def health():
    return jsonify({"status": "healthy"})


def _get_tv_forecast(ticker, country="US"):
    import requests, re, time
    exchange_mapping = {
        "US": ["NASDAQ", "NYSE", "AMEX", "OTC"],
        "UK": ["LSE"],
        "GB": ["LSE"],
        "DE": ["XETR"],
        "FR": ["EURONEXT"],
        "CA": ["TSX", "TSXV", "OTC", "NASDAQ", "NYSE"],
        "ES": ["LSE", "BME"],
        "NL": ["EURONEXT"],
        "IE": ["LSE", "EURONEXT", "MIL"]
    }
    
    clean_ticker = ticker
    if ticker.endswith("l") and len(ticker) > 1 and ticker[:-1].isupper():
        clean_ticker = ticker[:-1]
        
    exchanges = exchange_mapping.get(country.upper(), ["NASDAQ", "NYSE", "AMEX", "OTC"])
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
    }

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
        
    avg_target = None
    max_target = None
    min_target = None

    # Pattern 1: prose text "price target is X with a max estimate of Y and a min estimate of Z"
    m1 = re.search(r'price target is.*?([\d,\.]+).*?with a max estimate of.*?([\d,\.]+).*?and a min estimate of.*?([\d,\.]+)', html, re.IGNORECASE)
    if m1:
        avg_target = float(m1.group(1).replace(',', ''))
        max_target = float(m1.group(2).replace(',', ''))
        min_target = float(m1.group(3).replace(',', ''))

    # Pattern 2: JSON fields priceTarget / targetPrice in embedded data
    if avg_target is None:
        m2 = re.search(r'"priceTarget"\s*:\s*\{[^}]*"mean"\s*:\s*([\d\.]+)[^}]*"high"\s*:\s*([\d\.]+)[^}]*"low"\s*:\s*([\d\.]+)', html, re.DOTALL)
        if not m2:
            m2 = re.search(r'"priceTarget"\s*:\s*\{[^}]*"low"\s*:\s*([\d\.]+)[^}]*"mean"\s*:\s*([\d\.]+)[^}]*"high"\s*:\s*([\d\.]+)', html, re.DOTALL)
        if m2:
            try:
                avg_target = float(m2.group(2)) if m2.lastindex == 3 else float(m2.group(1))
                max_target = float(m2.group(3)) if m2.lastindex == 3 else float(m2.group(2))
                min_target = float(m2.group(1)) if m2.lastindex == 3 else float(m2.group(3))
            except Exception:
                pass

    # Pattern 3: initForecastQuotes fields targetPrice / targetHigh / targetLow / targetMean
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
                    if rec_mark < 1.5: rec_text = "STRONG BUY"
                    elif rec_mark < 2.5: rec_text = "BUY"
                    elif rec_mark < 3.5: rec_text = "HOLD"
                    elif rec_mark < 4.5: rec_text = "SELL"
                    else: rec_text = "STRONG SELL"
            except Exception:
                pass
            
    # Extract analyst counts from initForecastQuotes section
    strong_buy = buy_count = hold_count = sell_count = strong_sell = 0
    # Extract analyst count and individual breakdown from initForecastQuotes
    # TradingView embeds recommendation_mark (1-5) and recommendation_total in the page HTML.
    # Individual counts (strongBuy/buy/hold/sell/strongSell) are NOT in the HTML — they're
    # loaded dynamically, so we only have the aggregate mark + total.
    analyst_total = 0
    strong_buy = buy_count = hold_count = sell_count = strong_sell = 0
    fq_match = re.search(r'"initForecastQuotes"\s*:\s*\{(.{10,2000})', html, re.DOTALL)
    if fq_match:
        fq = fq_match.group(1)
        def _gi(pat, t):
            mm = re.search(pat, t)
            return int(mm.group(1)) if mm else 0
        analyst_total = _gi(r'"recommendation_total"\s*:\s*(\d+)', fq)
        # Individual counts — may be 0 if TradingView doesn't include them in HTML
        strong_buy  = _gi(r'"strongBuy"\s*:\s*(\d+)', fq)
        buy_count   = _gi(r'"buy"\s*:\s*(\d+)', fq)
        hold_count  = _gi(r'"hold"\s*:\s*(\d+)', fq)
        sell_count  = _gi(r'"sell"\s*:\s*(\d+)', fq)
        strong_sell = _gi(r'"strongSell"\s*:\s*(\d+)', fq)

    counts_total = strong_buy + buy_count + hold_count + sell_count + strong_sell
    return {
        "ticker":      ticker,
        "avg":         avg_target,
        "high":        max_target,
        "low":         min_target,
        "rec_text":    rec_text,
        "strongBuy":   strong_buy,
        "buy":         buy_count,
        "hold":        hold_count,
        "sell":        sell_count,
        "strongSell":  strong_sell,
        # counts_total > 0 when individual breakdown is available; fall back to analyst_total
        "total":       counts_total if counts_total > 0 else analyst_total,
        "hasBreakdown": counts_total > 0,
    }

@app.route("/api/trade-signals")
def trade_signals():
    """Fetch actionable AI trade signals using TradingView technical analysis for held stocks."""
    force_refresh = request.args.get("refresh", "0") == "1"
    cache_key = "trade_signals:v2"
    
    if not force_refresh:
        cached = kv_get(cache_key, 43200)  # 12 hour cache
        if cached is not None and len(cached) > 0:
            return jsonify({"status": "ok", "data": cached, "cached": True})

    # Gather unique tickers from cached portfolios
    excluded = get_excluded_tickers()
    unique_rows = {}
    for pid in API_KEYS:
        rows, _ = rows_get(pid)
        if rows:
            for r in rows:
                ticker = r["ticker"]
                if ticker not in unique_rows and ticker not in excluded:
                    unique_rows[ticker] = {
                        "company_name": r["company_name"],
                        "country": r.get("country", "US"),
                        "price": r.get("native_price", r.get("current_price") or (r.get("current_value", 0) / r.get("quantity", 1) if r.get("quantity") else 0)),
                        "currency": r.get("native_currency", r.get("currency_code", "USD"))
                    }
                    
    results = []
    
    def process_ticker(ticker):
        info = unique_rows[ticker]
        forecast = _get_tv_forecast(ticker, info["country"])
        if forecast and forecast.get("avg") is not None:
            rec = forecast["rec_text"]
            
            # Map recommendation
            signal_text = rec
            # if rec == "BUY":
            #     signal_text = "ADD"
            # elif rec == "SELL":
            #     signal_text = "REDUCE"
                
            conviction = "HIGH" if "STRONG" in rec else "MEDIUM" if rec in ("BUY", "SELL", "ADD", "REDUCE") else "LOW"
            
            entry = info.get("price")
            target = forecast["avg"]
            stop = forecast["low"] if "BUY" in rec or "ADD" in rec else forecast["high"]
            
            exp_return = None
            if entry and target:
                val = ((target - entry) / entry) * 100
                if "SELL" in rec: val = -val  # shorting logic or downside
                exp_return = round(val, 2)
            
            weight = 5.0 if "STRONG" in rec else 2.5 if "BUY" in rec or "SELL" in rec else 0.0
            
            return {
                "ticker": ticker,
                "company_name": info["company_name"],
                "currency": info["currency"],
                "signal": signal_text,
                "conviction": conviction,
                "entry": round(entry, 2) if entry else None,
                "target": round(target, 2) if target else None,
                "max_target": round(forecast["high"], 2) if forecast.get("high") else None,
                "min_target": round(forecast["low"], 2) if forecast.get("low") else None,
                "stop": round(stop, 2) if stop else None,
                "exp_return": exp_return,
                "suggested_weight": weight,
                "timeframe": "12 months",
            }
        return None

    # Fetch top signals in parallel
    tickers = list(unique_rows.keys())
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        for res in ex.map(process_ticker, tickers):
            if res:
                results.append(res)
                
    # Sort by expected return (positive logic)
    results.sort(key=lambda x: -(x["exp_return"] or 0))
    
    kv_set(cache_key, results)
    return jsonify({"status": "ok", "data": results, "cached": False})


@app.route("/api/trade-signals/exclude", methods=["POST"])
def trade_signals_exclude():
    """Toggle exclusion of a ticker from trade signals."""
    data = request.json or {}
    ticker = data.get("ticker")
    excluded = data.get("excluded", True)
    if not ticker:
        return jsonify({"status": "error", "message": "Missing ticker"}), 400
    
    set_ticker_excluded(ticker, excluded)
    # Wipe the trade signals cache to reflect the change immediately
    kv_set("trade_signals:v2", [])
    return jsonify({"status": "ok", "ticker": ticker, "excluded": excluded})


@app.route("/api/trade-signals/excluded")
def trade_signals_excluded_list():
    """Return a list of all current ticker exclusions."""
    return jsonify({"status": "ok", "data": get_excluded_tickers()})



@app.route("/api/trump-posts")
def trump_posts():
    """Fetch Trump's posts via trumpstruth.org RSS feed. Cached 5 min."""
    cache_key = "trump:posts:rss:v4"
    cached = kv_get(cache_key, 300)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "cached": True})
    try:
        limit = min(int(request.args.get("per_page", 25)), 40)
        # Try standard RSS/feed paths
        feed_urls = [
            "https://trumpstruth.org/feed/",
            "https://trumpstruth.org/rss/",
            "https://trumpstruth.org/feed.xml",
            "https://trumpstruth.org/?feed=rss2",
        ]
        resp = None
        for url in feed_urls:
            try:
                r = requests.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; RSS reader)",
                    "Accept": "application/rss+xml, application/xml, text/xml, */*",
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

        root = ET.fromstring(resp.content)
        ns = {"media": "http://search.yahoo.com/mrss/", "content": "http://purl.org/rss/1.0/modules/content/"}
        channel = root.find("channel")
        items = channel.findall("item") if channel is not None else root.findall(".//item")

        posts = []
        for item in items[:limit]:
            title    = (item.findtext("title") or "").strip()
            desc     = (item.findtext("description") or "").strip()
            link     = (item.findtext("link") or "").strip()
            pub_date = (item.findtext("pubDate") or "").strip()
            guid     = (item.findtext("guid") or link).strip()

            # Full content (WP content:encoded module), fall back to description
            full_content = item.findtext("content:encoded", namespaces=ns) or desc
            clean = re.sub(r"<[^>]+>", " ", full_content or title)
            clean = re.sub(r"\s+", " ", clean).strip()

            # Image: media:content → enclosure → first <img> in content
            image = None
            mc = item.find("media:content", ns)
            if mc is not None:
                image = mc.get("url")
            if not image:
                enc = item.find("enclosure")
                if enc is not None and (enc.get("type", "").startswith("image") or enc.get("url", "").endswith((".jpg", ".jpeg", ".png", ".webp"))):
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


@app.route("/api/trump-posts/sentiment")
def trump_posts_sentiment():
    """Gemini sentiment analysis for Trump posts. Results are persisted per post ID — only new posts hit the API."""
    try:
        posts = kv_get("trump:posts:rss:v4", 300)
        if not posts:
            return jsonify({"status": "error", "message": "No posts cached yet — fetch /api/trump-posts first"}), 400

        all_ids = [str(p.get("id", "")) for p in posts if p.get("id")]

        # Load whatever is already stored
        stored = trump_sentiment_get(all_ids)

        # Only analyse posts not yet in the DB
        new_posts = [p for p in posts if str(p.get("id", "")) not in stored]
        newly_analysed = {}
        if new_posts:
            results = _gemini.analyze_trump_post_sentiments(new_posts)
            newly_analysed = {str(r.get("id", "")): r for r in results if isinstance(r, dict)}
            trump_sentiment_set(newly_analysed)
            logger.info("trump_sentiment: analysed %d new post(s), %d already stored", len(newly_analysed), len(stored))

        by_id = {**stored, **newly_analysed}
        return jsonify({"status": "ok", "data": by_id, "new": len(newly_analysed), "cached": len(stored)})
    except Exception as e:
        logger.warning("trump_posts_sentiment error: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/finviz/news")
def finviz_news():
    """Market news and blog posts from Finviz (finvizfinance library)."""
    cache_key = "finviz:news"
    cached = kv_get(cache_key, 300)  # 5-min TTL
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "cached": True})
    data = fvd.get_market_news()
    kv_set(cache_key, data)
    return jsonify({"status": "ok", "data": data, "cached": False})


@app.route("/api/finviz/insider")
def finviz_insider():
    """Insider trading data from Finviz.  ?period=latest|top+week|top+owner+trade"""
    period = request.args.get("period", "latest")
    if period not in ("latest", "top week", "top owner trade"):
        period = "latest"
    cache_key = f"finviz:insider:{period.replace(' ', '_')}"
    cached = kv_get(cache_key, 1800)  # 30-min TTL
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "period": period, "cached": True})
    data = fvd.get_insider_trading(period)
    kv_set(cache_key, data)
    return jsonify({"status": "ok", "data": data, "period": period, "cached": False})


@app.route("/api/finviz/signals")
def finviz_signals():
    """Market screener signals from Finviz.
    ?type=gainers|losers|volume|newhighs|newlows|upgrades|downgrades|oversold|overbought
    """
    signal_type = request.args.get("type", "gainers")
    cache_key = f"finviz:signals:{signal_type}"
    cached = kv_get(cache_key, 300)  # 5-min TTL
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "signal": signal_type, "cached": True})
    data = fvd.get_market_signals(signal_type, limit=15)
    kv_set(cache_key, data)
    return jsonify({"status": "ok", "data": data, "signal": signal_type, "cached": False})



# ── Sector Performance (SPDR ETFs — fast alternative to Finviz heatmap) ───────

_SECTOR_ETFS = {
    "XLK":  "Technology",
    "XLF":  "Financial Services",
    "XLE":  "Energy",
    "XLV":  "Healthcare",
    "XLI":  "Industrials",
    "XLP":  "Consumer Staples",
    "XLY":  "Consumer Cyclical",
    "XLB":  "Basic Materials",
    "XLRE": "Real Estate",
    "XLU":  "Utilities",
    "XLC":  "Communication Services",
}


@app.route("/api/market/sector-performance")
def market_sector_performance():
    """Sector performance using SPDR ETFs via Yahoo Finance.
    Returns [{sector, ticker, change_pct, price}] — one entry per sector.
    Much faster than /api/finviz/sp500-heatmap (11 tickers vs ~500 stocks).
    Cached 5 minutes.
    """
    cache_key = "market:sector_perf"
    cached = kv_get(cache_key, 300)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "cached": True})

    def _fetch_etf(ticker):
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
            
            price = None
            change_pct = None
            
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

    result = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=11) as ex:
        for entry in ex.map(_fetch_etf, list(_SECTOR_ETFS.keys())):
            if entry is not None:
                result.append(entry)

    if result:
        kv_set(cache_key, result)
    return jsonify({"status": "ok", "data": result, "cached": False})


@app.route("/api/finviz/stock/<ticker>")
def finviz_stock_details(ticker):
    """Fundamentals, signals, analyst ratings and insider activity for one stock."""
    ticker = ticker.upper().strip()
    cache_key = f"finviz:stock:{ticker}"
    cached = kv_get(cache_key, 600)  # 10-min TTL
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "cached": True})
    data = fvd.get_stock_details(ticker)
    kv_set(cache_key, data)
    return jsonify({"status": "ok", "data": data, "cached": False})


# ── Market Digest ─────────────────────────────────────────────────────────────

@app.route("/api/market-digest")
def market_digest():
    """Daily market digest from Finviz.
    ?provider=claude|gemini|perplexity  (default: claude)
    ?refresh=1  — bypass cache and regenerate
    """
    provider = request.args.get("provider", "finviz").lower()
    if provider not in ("finviz", "claude", "gemini"):
        return jsonify({"status": "error", "message": f"Unknown provider '{provider}'"}), 400

    force = request.args.get("refresh", "0") == "1"
    cache_key = f"ai_digest:{provider}"
    TTL_DIGEST = 300  # 5 minutes

    if not force:
        cached = kv_get(cache_key, TTL_DIGEST)
        if cached is not None:
            return jsonify({"status": "ok", "provider": provider, "digest": cached, "cached": True})

    # Build context from existing caches (non-blocking reads — all already warm)
    indicators = kv_get("market_indicators", TTL_DIGEST) or {}
    gainers    = kv_get("finviz:signals:gainers", 600) or []
    losers     = kv_get("finviz:signals:losers",  600) or []
    news_raw   = kv_get("news", TTL_NEWS) or []

    context = {
        "indicators": indicators,
        "gainers":    gainers[:10],
        "losers":     losers[:10],
        "news":       news_raw[:8],
    }

    try:
        text = _ai_digest.generate_digest(provider, context)
    except Exception as exc:
        logger.error("AI digest failed (provider=%s): %s", provider, exc)
        return jsonify({"status": "error", "message": str(exc)}), 500

    kv_set(cache_key, text)
    return jsonify({"status": "ok", "provider": provider, "digest": text, "cached": False})


# ── Price Alerts & Notifications ──────────────────────────────────────────────

@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    return jsonify({"status": "ok", "data": alerts_get_all()})


@app.route("/api/alerts", methods=["POST"])
def add_alert():
    body = request.get_json(silent=True) or {}
    ticker = body.get("ticker", "").strip().upper()
    condition = body.get("condition", "").lower()
    threshold = body.get("threshold")
    currency = body.get("currency", "GBP").upper()
    if not ticker or condition not in ("above", "below") or threshold is None:
        return jsonify({"status": "error", "message": "ticker, condition (above|below), threshold required"}), 400
    alert_id = alert_add(ticker, condition, float(threshold), currency)
    return jsonify({"status": "ok", "id": alert_id})


@app.route("/api/alerts/<int:alert_id>", methods=["DELETE"])
def delete_alert(alert_id):
    alert_delete(alert_id)
    return jsonify({"status": "ok"})


@app.route("/api/notifications", methods=["GET"])
def get_notifications():
    return jsonify({"status": "ok", "data": notifications_get(40), "unread": notifications_unread_count()})


@app.route("/api/notifications/read", methods=["POST"])
def mark_notifications_read():
    notifications_mark_all_read()
    return jsonify({"status": "ok"})


# ── Return Attribution ─────────────────────────────────────────────────────────

@app.route("/api/p<pid>/return-attribution")
def return_attribution(pid):
    """Per-sector monthly return contribution for the last 12 months."""
    cache_key = f"return_attr:{pid}"
    cached = kv_get(cache_key, 900)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})

    try:
        from datetime import datetime as _dt, timezone as _tz
        # 1. Get portfolio rows for weights + sectors
        if pid == "combined":
            all_r = []
            for p in API_KEYS:
                rows, _ = fetch_and_cache_portfolio(p)
                if rows:
                    all_r.extend(rows)
            seen, unique = set(), []
            for row in all_r:
                if row["ticker"] not in seen:
                    seen.add(row["ticker"])
                    unique.append(row)
        else:
            unique, _ = fetch_and_cache_portfolio(pid)
        if not unique:
            return jsonify({"status": "ok", "data": {}})

        total_val = sum(r["current_value"] for r in unique)
        if total_val == 0:
            return jsonify({"status": "ok", "data": {}})

        # Weight per ticker
        weights = {r["ticker"]: r["current_value"] / total_val for r in unique}
        sectors = {r["ticker"]: (r.get("sector") or "Other") for r in unique}

        # 2. Get monthly performance per ticker (already cached endpoint logic)
        monthly_perf_key = f"monthly_perf:{pid}"
        monthly_perf = kv_get(monthly_perf_key, 900)
        if monthly_perf is None:
            # Fetch inline (reuse same logic from /monthly-performance)
            def _fetch_monthly_attr(row):
                ticker = row["ticker"]
                country = row.get("country", "US")
                suffix = _COUNTRY_YF_SUFFIX.get(country.upper(), "")
                clean = ticker[:-1] if suffix == ".L" and ticker.endswith("l") else ticker
                yf_sym = f"{clean}{suffix}"
                try:
                    resp = requests.get(
                        f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}",
                        params={"range": "1y", "interval": "1mo"},
                        headers={"User-Agent": "Mozilla/5.0"},
                        timeout=10,
                    )
                    resp.raise_for_status()
                    result = resp.json()["chart"]["result"][0]
                    timestamps = result.get("timestamp", [])
                    closes = list(result["indicators"]["quote"][0].get("close", []))
                    cur_px = result.get("meta", {}).get("regularMarketPrice")
                    if cur_px and closes:
                        closes[-1] = cur_px
                    monthly = {}
                    for i in range(1, len(timestamps)):
                        if closes[i] is None or closes[i - 1] is None or closes[i - 1] == 0:
                            continue
                        dt = _dt.fromtimestamp(timestamps[i], _tz.utc)
                        mk = dt.strftime("%Y-%m")
                        monthly[mk] = round((closes[i] - closes[i - 1]) / closes[i - 1] * 100, 2)
                    return clean, monthly
                except Exception:
                    return ticker, {}

            monthly_perf = {}
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(12, max(1, len(unique)))) as ex:
                for ticker, monthly in ex.map(_fetch_monthly_attr, unique):
                    monthly_perf[ticker] = monthly

        # 3. Compute per-sector contribution per month
        all_months = set()
        for monthly in monthly_perf.values():
            all_months.update(monthly.keys())
        sorted_months = sorted(all_months)[-12:]

        # attribution[month][sector] = weighted contribution %
        attribution = {}
        for month in sorted_months:
            attribution[month] = {}
            for row in unique:
                t = row["ticker"]
                w = weights.get(t, 0)
                sec = sectors.get(t, "Other")
                pct = monthly_perf.get(t, {}).get(month, 0) or 0
                attribution[month][sec] = round(attribution[month].get(sec, 0) + w * pct, 4)

        # Gather all sectors
        all_sectors = sorted(set(s for month_data in attribution.values() for s in month_data))

        result = {
            "months": sorted_months,
            "sectors": all_sectors,
            "attribution": attribution,  # {month: {sector: pct}}
        }
        kv_set(cache_key, result)
        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        logger.error("return_attribution error: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


# ── Daily / Weekly Returns ─────────────────────────────────────────────────────

@app.route("/api/p<pid>/daily-returns")
def daily_returns_endpoint(pid):
    """Daily portfolio value changes for the last 30 days (or 7 days for ?range=1W).
    Returns [{date, pct, value}] for granular chart views."""
    range_ = request.args.get("range", "1M")  # 1W | 1M
    cache_key = f"daily_returns:{pid}:{range_}"
    cached = kv_get(cache_key, 300)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})

    hours = 7 * 24 if range_ == "1W" else 31 * 24

    if pid == "combined":
        pid_daily: dict = {}
        for p in API_KEYS:
            snaps = snapshot_get(p, hours=hours)
            by_day: dict = {}
            for s in snaps:
                day = date.fromtimestamp(s["ts"]).isoformat()
                if day not in by_day or s["ts"] > by_day[day][0]:
                    by_day[day] = (s["ts"], s["value"])
            pid_daily[p] = {d: v for d, (_, v) in by_day.items()}

        all_days: set = set()
        for d in pid_daily.values():
            all_days.update(d.keys())
        daily_vals: dict = {}
        for day in sorted(all_days):
            total = sum(pd.get(day, 0) for pd in pid_daily.values())
            if total > 0:
                daily_vals[day] = round(total, 2)
    else:
        snaps = snapshot_get(pid, hours=hours)
        by_day = {}
        for s in snaps:
            d = date.fromtimestamp(s["ts"]).isoformat()
            if d not in by_day or s["ts"] > by_day[d][0]:
                by_day[d] = (s["ts"], s["value"])
        daily_vals = {d: round(v, 2) for d, (_, v) in sorted(by_day.items())}

    days = sorted(daily_vals.keys())
    result = []
    for i in range(1, len(days)):
        prev_v = daily_vals[days[i - 1]]
        curr_v = daily_vals[days[i]]
        if prev_v and prev_v > 0:
            pct = round((curr_v - prev_v) / prev_v * 100, 3)
            result.append({"date": days[i], "pct": pct, "value": curr_v})

    kv_set(cache_key, result)
    return jsonify({"status": "ok", "data": result})


# ── Background portfolio refresh ──────────────────────────────────────────────
_REFRESH_INTERVAL = int(os.environ.get("AUTO_REFRESH_SECONDS", 300))  # default 5 min

def _check_price_alerts(rows):
    """Check active price alerts against current portfolio prices."""
    try:
        active = [a for a in alerts_get_all() if a["enabled"]]
        if not active:
            return
        
        # Build maps for current prices in GBP and native
        price_gbp = {r["ticker"]: r.get("current_price", 0) for r in rows}
        price_native = {r["ticker"]: r.get("native_price", 0) for r in rows}

        for alert in active:
            ticker = alert["ticker"]
            alert_currency = alert.get("currency", "GBP").upper()

            # Use native price if alert is in native currency, otherwise GBP
            if alert_currency == "GBP":
                price = price_gbp.get(ticker)
            else:
                price = price_native.get(ticker)

            if price is None:
                # Fallback: try matching ticker without suffix (e.g. CRWV_US_EQ -> CRWV)
                # find first key that starts with ticker
                for t in price_native.keys():
                    if t.startswith(ticker):
                        price = price_gbp.get(t) if alert_currency == "GBP" else price_native.get(t)
                        break
                
            if price is None:
                continue

            triggered = (alert["condition"] == "above" and price >= alert["threshold"]) or \
                        (alert["condition"] == "below" and price <= alert["threshold"])
            
            logging.getLogger("alerts").debug(f"Checking {ticker}: {price} {alert_currency} vs {alert['threshold']} {alert['condition']} -> {triggered}")

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

def _background_refresh():
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

_refresh_thread = threading.Thread(target=_background_refresh, daemon=True, name="portfolio-refresh")
_refresh_thread.start()


# ── Background dividend refresh ────────────────────────────────────────────────

def _background_dividend_refresh():
    """Daemon thread: pre-fetch dividend data every 6 hours via Snowball Analytics."""
    _log = logging.getLogger("div-refresh")
    time.sleep(30)  # let portfolio cache warm up first
    while True:
        try:
            _sdiv.fetch_all_dividends(API_KEYS)
        except Exception as exc:
            _log.error("Unhandled error in dividend refresh: %s", exc)
        time.sleep(_sdiv.DIV_REFRESH_INTERVAL)


_div_refresh_thread = threading.Thread(target=_background_dividend_refresh, daemon=True, name="div-refresh")
_div_refresh_thread.start()


# ── Background market-indicators refresh ───────────────────────────────────────

def _background_market_refresh():
    """Daemon thread: keep market-indicators cache warm every 25 min (TTL is 30 min)."""
    _log = logging.getLogger("market-refresh")
    time.sleep(10)  # short startup delay; portfolio refresh runs at t=5s
    while True:
        try:
            _fetch_and_cache_market_indicators()
            _log.info("Market indicators cache refreshed")
        except Exception as exc:
            _log.error("Market indicators refresh failed: %s", exc)
        time.sleep(1500)  # 25 min

_market_refresh_thread = threading.Thread(target=_background_market_refresh, daemon=True, name="market-refresh")
_market_refresh_thread.start()


def _background_news_refresh():
    """Daemon thread: keep news cache warm every 5 min."""
    _log = logging.getLogger("news-refresh")
    time.sleep(15)  # short startup delay
    while True:
        try:
            _fetch_and_cache_news()
            _log.info("News cache refreshed")
        except Exception as exc:
            _log.error("News refresh failed: %s", exc)
        time.sleep(300)  # 5 min

_news_refresh_thread = threading.Thread(target=_background_news_refresh, daemon=True, name="news-refresh")
_news_refresh_thread.start()



# ── Gemini AI Endpoints ───────────────────────────────────────────────────────



@app.route("/api/ai/market-digest")
def ai_market_digest():
    """Daily automated market digest using Gemini."""
    try:
        # Fetch current news to provide context to Gemini
        news_resp = api_news()
        news_data = news_resp.get_json().get("data", []) if hasattr(news_resp, "get_json") else []
        
        digest = _gemini.generate_market_summary(news_data)
        return jsonify({"status": "ok", "digest": digest})
    except Exception as e:
        logger.error("AI Market Digest failed: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/ai/trade-signals")
def ai_trade_signals():
    """AI-driven trade signals based on portfolio using Gemini."""
    try:
        # Gather portfolio data across all pids
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


@app.route("/api/ai/chat", methods=["POST"])
def ai_chat():
    """Interactive chat with Gemini."""
    try:
        body = request.get_json()
        message = body.get("message")
        history = body.get("history", []) # List of {role, parts}
        
        if not message:
            return jsonify({"status": "error", "message": "Message required"}), 400
            
        response = _gemini.chat_with_gemini(message, history)
        return jsonify({"status": "ok", "response": response})
    except Exception as e:
        logger.error("AI Chat failed: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


def _migrate_price_alerts():
    """One-time migration: Convert GBP alerts for non-UK stocks to their native currency."""
    try:
        from fx import get_gbpusd_rate
        
        # Check if migration already run
        if kv_get("migration_alerts_native_v1", 9999999):
            return

        alerts = alerts_get_all()
        if not alerts:
            return

        # Get portfolio data to know the native currency of stocks
        all_rows = []
        for pid in API_KEYS:
            rows, _ = rows_get(pid)
            if rows:
                all_rows.extend(rows)
        
        if not all_rows:
            return

        # Map ticker -> native_currency
        ticker_map = {r["ticker"]: r for r in all_rows}
        gbpusd = get_gbpusd_rate()

        from cache import _db
        with _db() as conn:
            for alert in alerts:
                ticker = alert["ticker"]
                current_currency = alert.get("currency", "GBP")
                if current_currency != "GBP":
                    continue # Already migrated or set manually
                
                stock = ticker_map.get(ticker)
                if not stock:
                    continue # Can't migrate if not in portfolio
                
                native_currency = stock.get("native_currency", "GBP")
                if native_currency == "GBP" or native_currency == "GBX":
                    # For UK stocks, native is GBP/GBX, already handled correctly by current_price
                    continue
                
                # For non-UK stocks (e.g. US), convert threshold from GBP to native
                threshold_gbp = alert["threshold"]
                if native_currency == "USD":
                    new_threshold = round(threshold_gbp * gbpusd, 2)
                    new_currency = "USD"
                else:
                    # For other currencies (EUR, etc.), we don't have rates in fx.py easily accessible
                    # but we can try to find them if needed. For now US is the main one.
                    continue
                
                conn.execute(
                    "UPDATE price_alerts SET threshold = ?, currency = ? WHERE id = ?",
                    (new_threshold, new_currency, alert["id"])
                )
                logger.info("Migrated alert %d for %s: %.2f GBP -> %.2f %s", 
                            alert["id"], ticker, threshold_gbp, new_threshold, new_currency)

        kv_set("migration_alerts_native_v1", True)
    except Exception as e:
        logger.error("Alert migration failed: %s", e)

# Run migration on startup
_migrate_price_alerts()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
