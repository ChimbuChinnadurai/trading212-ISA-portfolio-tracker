import concurrent.futures
import logging
import os
import re
import threading
import time
import requests
from dotenv import load_dotenv
load_dotenv()

import collections
from collections import defaultdict
from datetime import date, timedelta

from flask import Flask, jsonify, redirect, render_template, request
import finviz_data as fvd
import ai_digest as _ai_digest

from cache import (
    TTL_DIV, TTL_NEWS, init_db, kv_age, kv_get, kv_set,
    rows_get, rows_set, snapshot_add, snapshot_get,
    clear_all_cache, get_excluded_tickers, set_ticker_excluded
)
from fx import get_gbpusd_rate
from portfolio import TICKER_MAPPING, build_rows
from t212 import (
    get_dividends, get_dividends_raw, get_instruments,
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


@app.route("/")
def index():
    # SPA shell — all views (home, portfolio 1/2/combined) rendered client-side via hash routing
    return render_template("spa.html", names=PORTFOLIO_NAMES)



@app.route("/portfolio/<pid>")
def details(pid):
    # Redirect old multi-page URLs to SPA hash routes (backward-compat for bookmarks)
    return redirect(f"/#portfolio/{pid}", code=302)


def fetch_and_cache_portfolio(pid, force=False):
    """Fetch data for a single portfolio and cache the result."""
    api_key = API_KEYS.get(pid)
    if not api_key:
        return None, 0.0, 0.0, 0

    # 1. Try cache if not forcing
    if not force:
        cached_rows, _ = rows_get(pid)
        if cached_rows is not None:
            total_div  = kv_get("total_dividends", TTL_DIV, pid=pid) or 0.0
            pai        = kv_get("pai", TTL_DIV, pid=pid) or 0.0
            div_score  = kv_get("div_score", TTL_DIV, pid=pid) or 0
            return cached_rows, total_div, pai, div_score

    # 2. Fetch fresh data
    positions   = get_portfolio(api_key, pid)
    instruments = get_instruments(api_key)
    gbpusd      = get_gbpusd_rate()
    dividends   = get_dividends(api_key, pid)

    total_div = round(sum(dividends.values()), 2)
    rows = build_rows(positions, instruments, dividends, gbpusd)
    
    # 3. Calculate Projected Annual Income (PAI)
    # This is an estimate based on trailing dividends
    pai = sum(r.get("dividends", 0) for r in rows)
    
    # 4. Calculate Diversification Score (0-100)
    # Simple logic: higher score for more holdings and more even weight distribution
    total_value = sum(r.get("current_value", 0) for r in rows)
    if total_value > 0 and len(rows) > 0:
        # Calculate Herfindahl-Hirschman Index (HHI) for concentration
        # Lower HHI = better diversification
        hhi = sum(((r.get("current_value", 0) / total_value) * 100)**2 for r in rows)
        # Map 10000 (1 holding) to 0, and ~500 (20 equal holdings) to ~95
        div_score = max(0, min(100, round(100 - (hhi / 100))))
    else:
        div_score = 0

    # Update cache
    rows_set(rows, pid=pid)
    kv_set("total_dividends", total_div, pid=pid)
    kv_set("pai", pai, pid=pid)
    kv_set("div_score", div_score, pid=pid)
    
    return rows, total_div, pai, div_score


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

    for pid in API_KEYS:
        rows, _, p_pai, p_div_score = fetch_and_cache_portfolio(pid, force=force)

        if rows:
            p_val = sum(r["current_value"] for r in rows)
            p_inv = sum(r["invested"] for r in rows)
            total_value += p_val
            total_invested += p_inv
            total_returns += (p_val - p_inv)
            # Seed sparkline history on every overview fetch (first load + manual refresh)
            snapshot_add(pid, round(p_val, 2))

            res[pid] = {
                "value":       round(p_val, 2),
                "returns":     round(p_val - p_inv, 2),
                "returns_pct": round(((p_val / p_inv) - 1) * 100, 2) if p_inv > 0 else 0,
                "pai":         round(p_pai, 2),
                "div_score":   p_div_score,
                "invested":    round(p_inv, 2),
                "positions":   len(rows),
                "top_sector":  _top_sector(rows),
            }

    # Collect all rows for combined metrics
    all_combined_rows = []
    for pid in API_KEYS:
        r, _ = rows_get(pid)
        if r:
            all_combined_rows.extend(r)

    # Calculate combined Diversification Score
    combined_div_score = 0
    if total_value > 0 and all_combined_rows:
        hhi = sum(((r.get("current_value", 0) / total_value) * 100)**2 for r in all_combined_rows)
        combined_div_score = max(0, min(100, round(100 - (hhi / 100))))

    res["combined"] = {
        "value":       round(total_value, 2),
        "returns":     round(total_returns, 2),
        "returns_pct": round(((total_value / total_invested) - 1) * 100, 2) if total_invested > 0 else 0,
        "pai":         round(sum(p["pai"] for p in res.values() if isinstance(p, dict) and "pai" in p), 2),
        "div_score":   combined_div_score,
        "invested":    round(total_invested, 2),
        "positions":   sum(p["positions"] for p in res.values() if isinstance(p, dict) and "positions" in p),
        "top_sector":  _top_sector(all_combined_rows),
    }
    # Collect freshness metadata
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
        
        # Calculate combined PAI and Div Score
        combined_pai = 0.0
        for pid in API_KEYS:
            if API_KEYS[pid]:
                combined_pai += kv_get("pai", TTL_DIV, pid=pid) or 0.0
        
        combined_div_score = 0
        if total_p_value > 0 and combined_rows:
            hhi = sum(((r.get("current_value", 0) / total_p_value) * 100)**2 for r in combined_rows)
            combined_div_score = max(0, min(100, round(100 - (hhi / 100))))

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
            "pai": round(combined_pai, 2),
            "div_score": combined_div_score,
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
        rows, total_div, p_pai, p_div_score = fetch_and_cache_portfolio(pid, force=force)
        
        if rows is None:
            return jsonify({"status": "error", "message": "Portfolio not found"}), 404

        _, age = rows_get(pid)
        
        return jsonify({
            "status": "ok", "data": rows,
            "cached": True if not force else False, 
            "cache_age": age or 0,
            "total_dividends": total_div, 
            "pai": round(p_pai, 2),
            "div_score": p_div_score,
            "warning": None,
            "freshness": {
                "instruments": kv_age("instruments"),
                "dividends":   kv_age("dividends", pid=pid),
                "gbpusd":      kv_age("gbpusd"),
            }
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/p<pid>/pai-details")
def pai_details(pid):
    """Detailed stock-level breakdown of Projected Annual Income."""
    try:
        rows, total_div, pai, _ = fetch_and_cache_portfolio(pid)
        if rows is None:
            return jsonify({"status": "error", "message": "Portfolio not found"}), 404

        # Calculate contribution for each stock
        contributors = []
        for r in rows:
            div_amount = r.get("dividends", 0)
            if div_amount > 0:
                contributors.append({
                    "ticker": r["ticker"],
                    "company_name": r["company_name"],
                    "income": round(div_amount, 2),
                    "percentage": round((div_amount / pai * 100), 2) if pai > 0 else 0
                })
        
        # Sort by income descending
        contributors.sort(key=lambda x: x["income"], reverse=True)
        
        return jsonify({
            "status": "ok",
            "data": {
                "total_pai": round(pai, 2),
                "contributors": contributors
            }
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/p<pid>/diversification-details")
def diversification_details(pid):
    """Detailed rationale and breakdown for Diversification Score."""
    try:
        rows, _, _, div_score = fetch_and_cache_portfolio(pid)
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

        # Generate Rationale & Recommendations
        rationale = f"Your diversification score of {div_score}/100 is based on the Herfindahl-Hirschman Index (HHI), which measures portfolio concentration."
        recommendations = []
        
        if div_score < 40:
            recommendations.append("Your portfolio is highly concentrated. Consider adding more positions to reduce risk.")
        elif div_score < 70:
            recommendations.append("Good diversification, but some positions may still have outsized influence.")
        else:
            recommendations.append("Excellent diversification! Your risk is well-spread across many holdings.")

        # Sector specific advice
        if sector_breakdown and sector_breakdown[0]["percentage"] > 40:
            recommendations.append(f"High concentration in {sector_breakdown[0]['sector']}. Consider diversifying into other sectors.")

        if top_holdings and top_holdings[0]["weight"] > 20:
            recommendations.append(f"Your position in {top_holdings[0]['ticker']} is over 20%. Consider trimming or balancing.")

        # Collect freshness metadata
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
                "score": div_score,
                "rationale": rationale,
                "recommendations": recommendations,
                "sector_breakdown": sector_breakdown,
                "top_holdings": top_holdings
            },
            "metadata": metadata
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/market-indicators")
def market_indicators():
    """S&P 500 (125-day MA) and VIX (50-day MA) from Yahoo Finance, cached 30 min."""
    cached = kv_get("market_indicators", 1800)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})

    result = {}
    configs = [
        ("^GSPC", "S&P 500", 125),
        ("^IXIC", "NASDAQ",   50),
        ("^VIX",  "VIX",      50),
    ]
    for symbol, label, ma_period in configs:
        key = symbol.replace("^", "")
        try:
            resp = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
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
                result[key] = None
                continue

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

            result[key] = {
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
            result[key] = None

    kv_set("market_indicators", result)
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
        params={"range": range_, "interval": interval_},
        headers={"User-Agent": "Mozilla/5.0"},
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
        rows, _, _, _ = fetch_and_cache_portfolio(pid)
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
        cached    = kv_get(cache_key, 60)
        if cached is not None:
            result_map[ticker] = cached
        else:
            needs_fetch.append(row)

    def _fetch_one(row):
        ticker       = row['ticker']
        country      = row.get('country', 'US')
        suffix       = _COUNTRY_YF_SUFFIX.get(country.upper(), "")
        clean_ticker = ticker[:-1] if suffix == ".L" and ticker.endswith("l") else ticker
        yf_sym       = f"{clean_ticker}{suffix}"
        try:
            resp = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}",
                params={"range": "1d", "interval": "1d"},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=8,
            )
            resp.raise_for_status()
            meta       = resp.json()["chart"]["result"][0]["meta"]
            price      = meta.get("regularMarketPrice")
            change     = meta.get("regularMarketChange")
            change_pct = meta.get("regularMarketChangePercent")
            currency   = meta.get("currency", "")
            # Fallback: compute change from previous close when API omits it
            if price is not None and (change is None or change_pct is None):
                prev = meta.get("chartPreviousClose") or meta.get("previousClose")
                if prev and prev != 0:
                    change     = price - prev
                    change_pct = (change / prev) * 100
            if clean_ticker == "ATO":
                clean_ticker == "ATO.PA"
            info = {
                "ticker":        clean_ticker,
                "company_name":  row.get("company_name", ticker),
                "price":         round(price,      4) if price      is not None else None,
                "change":        round(change,     4) if change     is not None else None,
                "change_pct":    round(change_pct, 4) if change_pct is not None else None,
                "currency":      currency,
                "current_value": row.get("current_value"),
                "sector":        row.get("sector", "Other"),
                # Full portfolio fields for stock side panel
                "quantity":      row.get("quantity"),
                "avg_price":     row.get("avg_price"),
                "invested":      row.get("invested"),
                "total_returns": row.get("total_returns"),
                "returns_pct":   row.get("returns_pct"),
                "country":       row.get("country"),
            }
            # Only cache when we have complete data; otherwise it retries next refresh
            if change is not None and change_pct is not None:
                kv_set(f"tick:{ticker}", info)
            return ticker, info
        except Exception as exc:
            logger.warning("stock_ticker failed for %s: %s", yf_sym, exc)
            return ticker, None

    if needs_fetch:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(10, len(needs_fetch))) as ex:
            for ticker, info in ex.map(_fetch_one, needs_fetch):
                if info is not None:
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
MASSIVE_API_KEY    = os.environ.get("MASSIVE_API_KEY")
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
            rows, _, _, _ = fetch_and_cache_portfolio(pid)
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
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
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
    """Market cap, LTM revenue, and P/S (revenue multiple) for a ticker. Cached 24h."""
    ticker  = request.args.get("ticker", "").strip().upper()
    country = request.args.get("country", "US").strip().upper()
    if not ticker:
        return jsonify({"status": "error", "message": "ticker required"}), 400
    try:
        cache_key = f"wl:fundamentals:{ticker}:{country}"
        cached = kv_get(cache_key, TTL_EARNINGS)
        if cached is not None:
            return jsonify({"status": "ok", "data": cached})

        suffix       = _COUNTRY_YF_SUFFIX.get(country, "")
        clean_ticker = ticker[:-1] if suffix == ".L" and ticker.endswith("l") else ticker
        yf_sym       = f"{clean_ticker}{suffix}"

        summary = _yf_summary(yf_sym)
        fin     = summary.get("financialData", {})
        stats   = summary.get("defaultKeyStatistics", {})
        detail  = summary.get("summaryDetail", {})

        def _raw(d, key):
            v = d.get(key)
            return v.get("raw") if isinstance(v, dict) else v

        market_cap    = _raw(stats, "marketCap") or _raw(detail, "marketCap")
        total_revenue = _raw(fin, "totalRevenue")
        trailing_pe   = _raw(detail, "trailingPE") or _raw(stats, "trailingPE")

        rev_multiple = None
        if market_cap and total_revenue and total_revenue > 0:
            rev_multiple = round(market_cap / total_revenue, 1)

        pe_ratio = round(trailing_pe, 1) if trailing_pe and trailing_pe > 0 else None

        data = {"market_cap": market_cap, "revenue": total_revenue, "rev_multiple": rev_multiple, "pe_ratio": pe_ratio}
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
        resp = requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}",
            params={"range": "1d", "interval": "1d"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=8,
        )
        resp.raise_for_status()
        meta       = resp.json()["chart"]["result"][0]["meta"]
        price      = meta.get("regularMarketPrice")
        change_pct = meta.get("regularMarketChangePercent")
        currency   = meta.get("currency", "")
        company    = meta.get("longName") or meta.get("shortName") or clean_ticker
        if price is not None and change_pct is None:
            prev = meta.get("chartPreviousClose") or meta.get("previousClose")
            if prev and prev != 0:
                change_pct = ((price - prev) / prev) * 100
        result = {
            "ticker":      clean_ticker,
            "company":     company,
            "price":       round(price, 4) if price is not None else None,
            "change_pct":  round(change_pct, 4) if change_pct is not None else None,
            "currency":    currency,
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
    for pid in API_KEYS:
        rows, _, p_pai, p_div_score = fetch_and_cache_portfolio(pid, force=force)
        if rows:
            p_val = sum(r["current_value"] for r in rows)
            p_inv = sum(r["invested"] for r in rows)
            total_value   += p_val
            total_invested += p_inv
            total_returns  += (p_val - p_inv)
            snapshot_add(pid, round(p_val, 2))
            overview_res[pid] = {
                "value":       round(p_val, 2),
                "returns":     round(p_val - p_inv, 2),
                "returns_pct": round(((p_val / p_inv) - 1) * 100, 2) if p_inv > 0 else 0,
                "pai":         round(p_pai, 2),
                "div_score":   p_div_score,
                "invested":    round(p_inv, 2),
                "positions":   len(rows),
                "top_sector":  _top_sector(rows),
            }
    all_combined_rows = []
    for pid in API_KEYS:
        r, _ = rows_get(pid)
        if r:
            all_combined_rows.extend(r)
    combined_div_score = 0
    if total_value > 0 and all_combined_rows:
        hhi = sum(((r.get("current_value", 0) / total_value) * 100) ** 2 for r in all_combined_rows)
        combined_div_score = max(0, min(100, round(100 - (hhi / 100))))
    overview_res["combined"] = {
        "value":       round(total_value, 2),
        "returns":     round(total_returns, 2),
        "returns_pct": round(((total_value / total_invested) - 1) * 100, 2) if total_invested > 0 else 0,
        "pai":         round(sum(p["pai"] for p in overview_res.values() if isinstance(p, dict) and "pai" in p), 2),
        "div_score":   combined_div_score,
        "invested":    round(total_invested, 2),
        "positions":   sum(p["positions"] for p in overview_res.values() if isinstance(p, dict) and "positions" in p),
        "top_sector":  _top_sector(all_combined_rows),
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


@app.route("/api/news")
def api_news():
    """Fetch general market news from Finnhub with caching."""
    cache_key = "general_market_news"
    cached = kv_get(cache_key, TTL_NEWS)
    if cached:
        return jsonify({"status": "ok", "data": cached})

    token = os.environ.get("FINNHUB_TOKEN")
    if not token:
        return jsonify({"status": "error", "message": "Finnhub token not configured"}), 500

    url = f"https://finnhub.io/api/v1/news?category=general&token={token}"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        news = resp.json()
        # Finnhub returns news already sorted by time (latest first usually)
        kv_set(cache_key, news)
        return jsonify({"status": "ok", "data": news})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# Sliding-window rate limiter: max 5 calls per 60 s for Massive API
_massive_call_times: collections.deque = collections.deque(maxlen=5)
_massive_lock = threading.Lock()


def _massive_rate_limited_get(url: str, timeout: int = 12):
    """Calls requests.get(url) while respecting a 5-req/min sliding window."""
    _log = logging.getLogger("massive-api")
    with _massive_lock:
        now = time.time()
        if len(_massive_call_times) == 5:
            oldest = _massive_call_times[0]
            wait = 61 - (now - oldest)
            if wait > 0:
                _log.debug("Rate limit window full — sleeping %.1fs", wait)
                time.sleep(wait)
        _massive_call_times.append(time.time())
    return requests.get(url, timeout=timeout)


def _build_ticker_info() -> dict:
    """Return {ticker: {quantity, company_name, pid}} for all held US stocks."""
    ticker_info: dict = {}
    for pid, key in API_KEYS.items():
        if not key:
            continue
        rows, _ = rows_get(pid)
        if not rows:
            continue
        for r in rows:
            if r.get("country") != "US":
                continue
            ticker = r["ticker"].upper()
            if ticker not in ticker_info:
                ticker_info[ticker] = {
                    "quantity": 0.0,
                    "company_name": r.get("company_name") or ticker,
                    "pid": pid,
                }
            ticker_info[ticker]["quantity"] += r.get("quantity", 0.0)
    return ticker_info


def _format_div_entries(ticker: str, info: dict, entries: list, today_str: str) -> list:
    """Convert raw Massive API entries into frontend-ready dicts.
    Keeps entries where pay_date >= today so dividends due today are visible."""
    qty = info["quantity"]
    out = []
    for d in entries:
        pay_date = d.get("pay_date", "")
        if not pay_date or pay_date < today_str:
            continue
        amount = float(d.get("cash_amount") or 0)
        out.append({
            "ticker":           ticker,
            "company_name":     info["company_name"],
            "pid":              info["pid"],
            "ex_dividend_date": d.get("ex_dividend_date", ""),
            "declaration_date": d.get("declaration_date", ""),
            "record_date":      d.get("record_date", ""),
            "payment_date":     pay_date,
            "amount_per_share": amount,
            "frequency":        d.get("frequency"),
            "currency":         d.get("currency", "USD"),
            "quantity":         round(qty, 4),
            "expected_payout":  round(amount * qty, 4),
        })
    return out


@app.route("/api/upcoming-dividends")
def upcoming_dividends():
    """Return upcoming dividends for all held US stocks, served entirely from cache.
    Data is pre-fetched by the background dividend refresh thread every 12 hours."""
    _log = logging.getLogger("upcoming-dividends")
    if not MASSIVE_API_KEY:
        _log.warning("MASSIVE_API_KEY not configured — dividend calendar unavailable")
        return jsonify({"status": "error", "message": "Massive API key not configured"}), 503

    today_str = str(date.today())
    ticker_info = _build_ticker_info()

    if not ticker_info:
        _log.warning("No US tickers found in portfolio cache — dividend calendar empty")
        return jsonify({"status": "ok", "data": [], "last_refresh": None})

    all_entries = []
    missing = []
    for ticker, info in ticker_info.items():
        raw = kv_get(f"massive:div:{ticker}", TTL_DIVIDENDS_CAL)
        if raw is None:
            missing.append(ticker)
            continue
        all_entries.extend(_format_div_entries(ticker, info, raw, today_str))

    if missing:
        _log.info("Dividend cache missing for %d tickers: %s", len(missing), ", ".join(missing[:10]))

    all_entries.sort(key=lambda d: d.get("payment_date", ""))

    last_refresh = kv_get("massive:div:last_refresh", TTL_DIVIDENDS_CAL)
    return jsonify({
        "status":       "ok",
        "data":         all_entries,
        "last_refresh": last_refresh,
        "cached":       len(ticker_info) - len(missing),
        "total":        len(ticker_info),
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


@app.route("/api/finviz/sp500-heatmap")
def finviz_sp500_heatmap():
    """All S&P 500 stocks with sector, change %, price, market cap for the heatmap.
    Cached for 5 minutes — first call may be slow (scrapes ~500 stocks across pages).
    """
    cache_key = "finviz:sp500heatmap"
    cached = kv_get(cache_key, 300)  # 5-min TTL
    if cached is not None:
        return jsonify({"status": "ok", "data": cached, "cached": True})
    data = fvd.get_sp500_heatmap()
    if data:
        kv_set(cache_key, data)
    return jsonify({"status": "ok", "data": data, "cached": False})


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
    TTL_DIGEST = 1800  # 30 minutes

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


# ── Background portfolio refresh ──────────────────────────────────────────────
_REFRESH_INTERVAL = int(os.environ.get("AUTO_REFRESH_SECONDS", 300))  # default 5 min

def _background_refresh():
    """Daemon thread: keep portfolio cache warm by force-refreshing every 5 minutes."""
    _log = logging.getLogger("portfolio-refresh")
    time.sleep(5)
    while True:
        for pid, key in API_KEYS.items():
            if not key:
                continue
            try:
                rows, _, _, _ = fetch_and_cache_portfolio(pid, force=True)
                if rows:
                    total_value = sum(r.get("current_value", 0) for r in rows)
                    snapshot_add(pid, total_value)
                _log.info("Portfolio %s refreshed (%d holdings)", pid, len(rows or []))
            except Exception as exc:
                _log.error("Portfolio refresh failed for pid=%s: %s", pid, exc)
        time.sleep(_REFRESH_INTERVAL)

_refresh_thread = threading.Thread(target=_background_refresh, daemon=True, name="portfolio-refresh")
_refresh_thread.start()


# ── Background dividend refresh ────────────────────────────────────────────────
_DIV_REFRESH_INTERVAL   = int(os.environ.get("DIV_REFRESH_SECONDS", 43200))  # 12 hours
_MASSIVE_LAST_REFRESH_KEY = "massive:div:last_refresh"


def _fetch_all_dividends():
    """Fetch upcoming dividend data from Massive API for every held US ticker.
    Respects the 5 req/min rate limit. Stores results in kv_cache."""
    _log = logging.getLogger("div-refresh")
    if not MASSIVE_API_KEY:
        _log.warning("MASSIVE_API_KEY not set — skipping dividend refresh")
        return

    ticker_info = _build_ticker_info()
    if not ticker_info:
        _log.warning("No US tickers in portfolio cache yet — skipping dividend refresh")
        return

    _log.info("Starting dividend refresh for %d tickers", len(ticker_info))
    success, errors = 0, 0

    for ticker in ticker_info:
        cache_key = f"massive:div:{ticker}"
        try:
            url = (
                f"https://api.massive.com/stocks/v1/dividends"
                f"?ticker={ticker}&limit=100&sort=ex_dividend_date.desc"
                f"&apiKey={MASSIVE_API_KEY}"
            )
            resp = _massive_rate_limited_get(url)
            if resp.status_code == 429:
                _log.warning("Rate limit hit fetching dividends for %s — will retry next cycle", ticker)
                errors += 1
                continue
            if resp.status_code != 200:
                _log.warning("HTTP %d fetching dividends for %s", resp.status_code, ticker)
                errors += 1
                continue
            body = resp.json()
            entries = body.get("results", []) if body.get("status") == "OK" else []
            if not isinstance(entries, list):
                entries = []
            kv_set(cache_key, entries)
            _log.debug("Cached %d dividend entries for %s", len(entries), ticker)
            success += 1
        except Exception as exc:
            _log.error("Error fetching dividends for %s: %s", ticker, exc)
            errors += 1

    kv_set(_MASSIVE_LAST_REFRESH_KEY, int(time.time()))
    _log.info("Dividend refresh complete — %d ok, %d errors", success, errors)


def _background_dividend_refresh():
    """Daemon thread: pre-fetch dividend data every 12 hours."""
    _log = logging.getLogger("div-refresh")
    # Wait for the portfolio refresh to populate the cache first
    time.sleep(30)
    while True:
        try:
            _fetch_all_dividends()
        except Exception as exc:
            _log.error("Unhandled error in dividend refresh: %s", exc)
        time.sleep(_DIV_REFRESH_INTERVAL)


_div_refresh_thread = threading.Thread(target=_background_dividend_refresh, daemon=True, name="div-refresh")
_div_refresh_thread.start()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
