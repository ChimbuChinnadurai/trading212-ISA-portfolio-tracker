"""
routes/portfolio.py — Portfolio data, dividends, activity, and SPA shell endpoints.

Blueprint: portfolio_bp

Routes
------
  GET  /                                    SPA shell (Jinja template)
  GET  /favicon.ico
  GET  /portfolio/<pid>                     Legacy redirect → SPA hash route
  GET  /health
  GET  /api/fx-rate                         Current GBP/USD exchange rate
  GET  /api/overview                        Aggregated summary for all portfolios
  GET  /api/home-data                       Combined landing-page payload (overview +
                                            activity + top performers + market indicators)
  GET  /api/dividends/overview              Full dividend analytics  (?pid=combined|1|2)
  GET  /api/upcoming-dividends              Upcoming dividend calendar (pre-fetched by bg thread)
  GET  /api/pcombined/portfolio             Merged holdings across all portfolios
  GET  /api/pcombined/activity              Recent orders (all portfolios)
  GET  /api/pcombined/dividend-monthly      Monthly dividend totals (combined)
  GET  /api/pcombined/daily-history         Daily value history for the last 365 days
  GET  /api/pcombined/top-performers        Top 5 performers (combined)
  GET  /api/pcombined/recent-dividends      Recent dividend payments (combined)
  GET  /api/p<pid>/portfolio                Single-portfolio holdings
  GET  /api/p<pid>/diversification-details  Sector breakdown + concentration recommendations
  GET  /api/p<pid>/activity                 Recent orders with instrument name enrichment
  GET  /api/p<pid>/dividend-monthly         Monthly dividend totals (single portfolio)
  GET  /api/p<pid>/recent-dividends         Recent dividend payments (single portfolio)
  GET  /api/p<pid>/stock-activity/<ticker>  Per-stock order + dividend history
  GET  /api/p<pid>/history                  48-hour value snapshots for sparklines
"""

import logging
import os
from collections import defaultdict
from datetime import date, timedelta

import snowball_dividends as _sdiv
from cache import TTL_DIV, kv_age, kv_get, kv_set, rows_get, snapshot_get
from flask import Blueprint, jsonify, redirect, render_template, request, send_from_directory
from fx import get_gbpusd_rate
from helpers import (
    API_KEYS,
    PORTFOLIO_NAMES,
    _build_overview_data,
    _get_combined_rows_map,
    fetch_and_cache_portfolio,
)
from portfolio import TICKER_MAPPING
from t212 import get_dividends_raw, get_instruments, get_orders, get_recent_dividends

logger = logging.getLogger("portfolio")

portfolio_bp = Blueprint("portfolio", __name__)


# ── SPA shell & static ─────────────────────────────────────────────────────────

@portfolio_bp.route("/favicon.ico")
def favicon():
    from flask import current_app
    return send_from_directory(current_app.static_folder, "favicon.svg", mimetype="image/svg+xml")


@portfolio_bp.route("/")
def index():
    """SPA shell — all views are rendered client-side via hash routing."""
    show_ai = os.environ.get("SHOW_AI_FEATURES", "0") == "1"
    return render_template("spa.html", names=PORTFOLIO_NAMES, show_ai=show_ai)


@portfolio_bp.route("/portfolio/<pid>")
def details(pid):
    """Redirect legacy multi-page URLs to the SPA hash route (bookmark compat)."""
    return redirect(f"/#portfolio/{pid}", code=302)


@portfolio_bp.route("/health")
def health():
    return jsonify({"status": "healthy"})


# ── Overview & home ────────────────────────────────────────────────────────────

@portfolio_bp.route("/api/fx-rate")
def fx_rate():
    """Current GBP/USD exchange rate."""
    return jsonify({"rate": get_gbpusd_rate()})


@portfolio_bp.route("/api/overview")
def overview():
    """Aggregated summary metrics for all configured portfolios."""
    force = request.args.get("refresh", "0") == "1"
    res, metadata = _build_overview_data(force=force)
    return jsonify({"status": "ok", "data": res, "metadata": metadata})


@portfolio_bp.route("/api/home-data")
def home_data():
    """Single combined endpoint for the landing page.

    Returns overview, recent activity, top/under performers, market indicators,
    and the current FX rate in one response to minimise round-trips.
    """
    force = request.args.get("refresh", "0") == "1"
    try:
        return _home_data_inner(force)
    except Exception as exc:
        logger.exception("home_data failed: %s", exc)
        return jsonify({"status": "error", "message": str(exc)}), 500


def _home_data_inner(force: bool):
    from cache import TTL_NEWS

    overview_res, overview_metadata = _build_overview_data(force=force)

    activity_data: list = []
    try:
        all_orders: list = []
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

    performers_data: list = []
    under_performers_data: list = []
    try:
        consolidated = list(_get_combined_rows_map().values())
        for r in consolidated:
            r["returns_pct"] = (r["total_returns"] / r["invested"] * 100) if r["invested"] > 0 else 0
        consolidated.sort(key=lambda x: x["total_returns"], reverse=True)
        performers_data       = consolidated[:5]
        under_performers_data = list(reversed(consolidated[-5:])) if consolidated else []
    except Exception:
        pass

    market_ind_data = kv_get("market_indicators", 1800)
    if not (isinstance(market_ind_data, dict) and any(v is not None for v in market_ind_data.values())):
        market_ind_data = None

    return jsonify({
        "status":            "ok",
        "overview":          overview_res,
        "overview_metadata": overview_metadata,
        "activity":          activity_data,
        "top_performers":    performers_data,
        "under_performers":  under_performers_data,
        "market_indicators": market_ind_data,
        "fx_rate":           get_gbpusd_rate(),
    })


# ── Dividend analytics ─────────────────────────────────────────────────────────

@portfolio_bp.route("/api/dividends/overview")
def dividends_overview():
    """Consolidated dividend analytics. ?pid=combined|1|2 — default combined. Cached 15 min."""
    pid_param = request.args.get("pid", "combined").strip()
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

        today         = date.today()
        this_year_str = str(today.year)
        last_year_str = str(today.year - 1)

        combined_monthly: dict = defaultdict(float)
        for pid, key in pids_to_use.items():
            for it in get_dividends_raw(key, pid):
                date_str = it.get("paidOn") or it.get("date") or ""
                if not date_str:
                    continue
                combined_monthly[str(date_str)[:7]] += float(it.get("amount") or 0)

        monthly = [{"month": m, "amount": round(a, 2)} for m, a in sorted(combined_monthly.items())]

        annual_map: dict = defaultdict(float)
        for item in monthly:
            annual_map[item["month"][:4]] += item["amount"]
        annual = [{"year": y, "amount": round(a, 2)} for y, a in sorted(annual_map.items())]

        total_received = round(sum(i["amount"] for i in monthly), 2)
        this_year      = round(sum(i["amount"] for i in monthly if i["month"].startswith(this_year_str)), 2)
        last_year_amt  = round(sum(i["amount"] for i in monthly if i["month"].startswith(last_year_str)), 2)

        ttm_months: set = set()
        d = today.replace(day=1)
        for _ in range(12):
            ttm_months.add(str(d)[:7])
            d = (d - timedelta(days=1)).replace(day=1)
        ttm             = round(sum(i["amount"] for i in monthly if i["month"] in ttm_months), 2)
        avg_monthly_ttm = round(ttm / 12, 2)

        ticker_map: dict = {}
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

        for v in ticker_map.values():
            cv, inv, divs = v["current_value"], v["invested"], v["dividends"]
            v["div_yield"] = round((divs / cv * 100), 4)  if cv  > 0 else 0
            v["yoc"]       = round((divs / inv * 100), 4) if inv > 0 else 0

        by_ticker = sorted(
            [v for v in ticker_map.values() if v["dividends"] > 0],
            key=lambda x: x["dividends"], reverse=True,
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


@portfolio_bp.route("/api/upcoming-dividends")
def upcoming_dividends():
    """Upcoming dividends for all held tickers. Data pre-fetched by background thread every 6h."""
    _log      = logging.getLogger("upcoming-dividends")
    today_str = str(date.today())
    all_entries: list = []
    missing:     list = []

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


# ── Combined portfolio routes ──────────────────────────────────────────────────

@portfolio_bp.route("/api/pcombined/portfolio")
def portfolio_combined():
    """Aggregate holdings from all portfolios, summing financial fields per ticker."""
    try:
        combined_rows_map: dict = {}
        total_div = 0.0

        for pid, key in API_KEYS.items():
            if not key:
                continue
            rows, _ = rows_get(pid)
            if rows is None:
                continue

            total_div += kv_get("total_dividends", TTL_DIV, pid=pid) or 0.0

            for row in rows:
                ticker = row["ticker"]
                if ticker not in combined_rows_map:
                    new_row = row.copy()
                    for f in ["quantity", "invested", "current_value", "total_returns", "fx_impact", "dividends"]:
                        new_row[f] = new_row.get(f) or 0.0
                    combined_rows_map[ticker] = new_row
                    combined_rows_map[ticker]["portfolio_ids"] = [pid]
                else:
                    t = combined_rows_map[ticker]
                    t["portfolio_ids"].append(pid)
                    for f in ["quantity", "invested", "current_value", "total_returns", "fx_impact", "dividends"]:
                        t[f] = (t.get(f) or 0) + (row.get(f) or 0)
                    for k in ["ret1d", "ret1w", "ret1m", "ret3m", "ret6m", "ret1y", "ret3y", "ret5y"]:
                        if k not in t or t[k] is None:
                            t[k] = row.get(k)
                    if t["quantity"] > 0:
                        t["avg_price"] = t["invested"] / t["quantity"]

        combined_rows = list(combined_rows_map.values())
        total_p_value = sum(r["current_value"] for r in combined_rows)

        for r in combined_rows:
            r["weight"]      = (r["current_value"] / total_p_value * 100) if total_p_value > 0 else 0
            r["returns_pct"] = (r["total_returns"] / r["invested"] * 100)  if r["invested"] > 0 else 0
            r["yoc"]         = (r["dividends"] / r["invested"] * 100)       if r["invested"] > 0 else 0
            r["div_yield"]   = (r["dividends"] / r["current_value"] * 100)  if r["current_value"] > 0 else 0

        return jsonify({
            "status": "ok", "data": combined_rows, "cached": True,
            "cache_age": 0, "total_dividends": round(total_div, 2),
            "warning": None,
            "freshness": {"gbpusd": kv_age("gbpusd")},
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@portfolio_bp.route("/api/pcombined/activity")
def activity_combined():
    """Recent orders from all portfolios, newest first."""
    try:
        all_orders: list = []
        for pid, key in API_KEYS.items():
            if not key:
                continue
            for o in get_orders(key, pid, limit=15):
                o["_pid"] = pid
                all_orders.append(o)
        all_orders.sort(key=lambda x: x.get("dateExecuted", ""), reverse=True)
        return jsonify({"status": "ok", "data": all_orders[:20]})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@portfolio_bp.route("/api/pcombined/dividend-monthly")
def dividend_monthly_combined():
    """Monthly dividend totals aggregated across all portfolios."""
    try:
        combined_monthly: dict = defaultdict(float)
        for pid, key in API_KEYS.items():
            if not key:
                continue
            for it in get_dividends_raw(key, pid):
                date_str = it.get("paidOn") or it.get("date") or ""
                if date_str:
                    combined_monthly[str(date_str)[:7]] += float(it.get("amount") or 0)
        data = [{"month": m, "amount": round(a, 4)} for m, a in sorted(combined_monthly.items())]
        return jsonify({"status": "ok", "data": data})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@portfolio_bp.route("/api/pcombined/daily-history")
def portfolio_daily_history():
    """Daily portfolio value history (end-of-day snapshots) for the last 365 days."""
    pid_daily: dict = {}
    for pid in API_KEYS:
        snaps  = snapshot_get(pid, hours=8760)
        by_day: dict = {}
        for s in snaps:
            day = date.fromtimestamp(s["ts"]).isoformat()
            if day not in by_day or s["ts"] > by_day[day][0]:
                by_day[day] = (s["ts"], s["value"])
        pid_daily[pid] = by_day

    all_days    = sorted(set().union(*[set(d.keys()) for d in pid_daily.values()]))
    pids_active = [p for p in API_KEYS if API_KEYS[p]]
    last_known: dict = {}
    result: list = []

    for day in all_days:
        for pid in pids_active:
            if day in pid_daily[pid]:
                last_known[pid] = pid_daily[pid][day]
        if all(p in last_known for p in pids_active):
            total = sum(last_known[p][1] for p in pids_active)
            ts    = next((last_known[p][0] for p in pids_active), 0)
            if total > 0:
                result.append({"date": day, "ts": int(ts), "value": round(total, 2)})
    return jsonify({"status": "ok", "data": result})


@portfolio_bp.route("/api/pcombined/top-performers")
def top_performers_combined():
    """Top 5 performers by total returns across all portfolios."""
    try:
        consolidated = list(_get_combined_rows_map().values())
        for r in consolidated:
            r["returns_pct"] = (r["total_returns"] / r["invested"] * 100) if r["invested"] > 0 else 0
        consolidated.sort(key=lambda x: x["total_returns"], reverse=True)
        return jsonify({"status": "ok", "data": consolidated[:5]})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@portfolio_bp.route("/api/pcombined/recent-dividends")
def recent_dividends_combined():
    """Recent dividend payments from all portfolios, newest first."""
    try:
        all_divs: list = []
        for pid, key in API_KEYS.items():
            if not key:
                continue
            divs = get_recent_dividends(key, pid, n=10)
            for d in divs:
                d["_pid"] = pid
                raw_ticker = d.get("ticker", "")
                base = raw_ticker.split("_")[0]
                if base in TICKER_MAPPING:
                    d["ticker"] = TICKER_MAPPING[base] + (raw_ticker[len(base):] if "_" in raw_ticker else "")
            all_divs.extend(divs)
        all_divs.sort(key=lambda x: str(x.get("paidOn") or x.get("date") or ""), reverse=True)
        return jsonify({"status": "ok", "data": all_divs[:15]})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


# ── Single-portfolio routes ────────────────────────────────────────────────────

@portfolio_bp.route("/api/p<pid>/portfolio")
def portfolio(pid):
    """Holdings for a single portfolio with freshness metadata."""
    if pid not in API_KEYS or not API_KEYS[pid]:
        return jsonify({"status": "error", "message": "Invalid portfolio ID"}), 404
    try:
        force = request.args.get("force", "0") == "1"
        rows, total_div = fetch_and_cache_portfolio(pid, force=force)
        if rows is None:
            return jsonify({"status": "error", "message": "Portfolio not found"}), 404
        _, age = rows_get(pid)
        return jsonify({
            "status": "ok", "data": rows,
            "cached": not force, "cache_age": age or 0,
            "total_dividends": total_div, "warning": None,
            "freshness": {
                "instruments": kv_age("instruments"),
                "dividends":   kv_age("dividends", pid=pid),
                "gbpusd":      kv_age("gbpusd"),
            },
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@portfolio_bp.route("/api/p<pid>/diversification-details")
def diversification_details(pid):
    """Sector breakdown and top-concentration recommendations for a portfolio."""
    try:
        rows, _ = fetch_and_cache_portfolio(pid)
        if rows is None:
            return jsonify({"status": "error", "message": "Portfolio not found"}), 404

        total_value = sum(r.get("current_value", 0) for r in rows)

        sectors: dict = defaultdict(float)
        for r in rows:
            sectors[r.get("sector", "Other")] += r.get("current_value", 0)

        sector_breakdown = sorted(
            [{"sector": s, "value": round(v, 2),
              "percentage": round(v / total_value * 100, 2) if total_value > 0 else 0}
             for s, v in sectors.items()],
            key=lambda x: x["value"], reverse=True,
        )

        top_holdings = [
            {"ticker": r["ticker"],
             "weight": round(r.get("current_value", 0) / total_value * 100, 2) if total_value > 0 else 0}
            for r in sorted(rows, key=lambda x: x.get("current_value", 0), reverse=True)[:5]
        ]

        recommendations: list = []
        if sector_breakdown and sector_breakdown[0]["percentage"] > 40:
            recommendations.append(
                f"High concentration in {sector_breakdown[0]['sector']}. Consider diversifying."
            )
        if top_holdings and top_holdings[0]["weight"] > 20:
            recommendations.append(
                f"Position in {top_holdings[0]['ticker']} exceeds 20%. Consider rebalancing."
            )

        return jsonify({
            "status": "ok",
            "data": {
                "recommendations": recommendations,
                "sector_breakdown": sector_breakdown,
                "top_holdings": top_holdings,
            },
            "metadata": {
                "freshness": {
                    "prices":    kv_age(f"{pid}:rows") or 0,
                    "dividends": kv_age("total_dividends", pid=pid) or 0,
                    "fx":        kv_age("gbpusd") or 0,
                }
            },
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@portfolio_bp.route("/api/p<pid>/activity")
def activity(pid):
    """Recent orders with instrument company-name enrichment."""
    api_key = API_KEYS.get(pid)
    if not api_key:
        return jsonify({"status": "error"}), 404
    try:
        orders      = get_orders(api_key, pid, limit=15)
        instruments = get_instruments(api_key)
        for order in orders:
            ticker = order.get("ticker", "")
            base   = ticker.split("_")[0]
            if base in TICKER_MAPPING:
                order["ticker"] = TICKER_MAPPING[base] + (ticker[len(base):] if "_" in ticker else "")
                ticker = order["ticker"]
            inst = instruments.get(ticker, {})
            order["_company_name"] = (
                inst.get("name") or inst.get("shortname")
                or order.get("company_name") or ticker.split("_")[0]
            )
        return jsonify({"status": "ok", "data": orders})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@portfolio_bp.route("/api/p<pid>/dividend-monthly")
def dividend_monthly(pid):
    """Monthly dividend totals for a single portfolio."""
    api_key = API_KEYS.get(pid)
    if not api_key:
        return jsonify({"status": "error"}), 404
    try:
        monthly: dict = {}
        for it in get_dividends_raw(api_key, pid):
            date_str = it.get("paidOn") or it.get("date") or ""
            if not date_str:
                continue
            month = str(date_str)[:7]
            monthly[month] = round(monthly.get(month, 0) + float(it.get("amount") or 0), 4)
        return jsonify({"status": "ok", "data": [{"month": m, "amount": a} for m, a in sorted(monthly.items())]})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@portfolio_bp.route("/api/p<pid>/recent-dividends")
def recent_dividends(pid):
    """Recent dividend payments for a single portfolio."""
    api_key = API_KEYS.get(pid)
    if not api_key:
        return jsonify({"status": "error"}), 404
    try:
        items = get_recent_dividends(api_key, pid, n=10)
        for d in items:
            raw_ticker = d.get("ticker", "")
            base       = raw_ticker.split("_")[0]
            if base in TICKER_MAPPING:
                d["ticker"] = TICKER_MAPPING[base] + (raw_ticker[len(base):] if "_" in raw_ticker else "")
        return jsonify({"status": "ok", "data": items})
    except Exception as e:
        return jsonify({"status": "ok", "data": [], "warning": str(e)})


@portfolio_bp.route("/api/p<pid>/stock-activity/<ticker>")
def stock_activity(pid, ticker):
    """Order and dividend history for a specific stock. pid=combined spans all portfolios."""
    try:
        activities: list = []
        pids = [pid] if pid != "combined" else [k for k in API_KEYS if API_KEYS[k]]

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
            for o in get_orders(key, curr_pid, limit=1000):
                if o.get("ticker", "").split("_")[0].upper() in search_tickers:
                    activities.append({
                        "type": "order", "action": o.get("type", "Unknown"),
                        "date": o.get("dateExecuted") or o.get("dateCreated") or "",
                        "quantity": o.get("filledQuantity", 0),
                        "price": o.get("fillPrice", 0),
                        "total": o.get("filledQuantity", 0) * o.get("fillPrice", 0),
                        "_pid": curr_pid,
                    })
            for d in get_dividends_raw(key, curr_pid):
                if d.get("ticker", "").split("_")[0].upper() in search_tickers:
                    activities.append({
                        "type": "dividend", "action": "Dividend Paid",
                        "date": d.get("paidOn") or d.get("date") or "",
                        "amount": d.get("amount", 0),
                        "_pid": curr_pid,
                    })

        activities.sort(key=lambda x: str(x.get("date") or ""), reverse=True)
        return jsonify({"status": "ok", "data": activities})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@portfolio_bp.route("/api/p<pid>/history")
def portfolio_history(pid):
    """Up to 48-hour value snapshots for sparkline charts."""
    if pid == "combined":
        bucket_size = 300
        all_snaps: list = []
        for p in API_KEYS:
            if not API_KEYS[p]:
                continue
            for snap in snapshot_get(p, hours=48):
                all_snaps.append((snap["ts"], p, snap["value"]))
        all_snaps.sort()

        raw_buckets: dict = {}
        for ts_snap, p, val in all_snaps:
            bucket = int(ts_snap // bucket_size) * bucket_size
            raw_buckets.setdefault(bucket, {})[p] = val

        pids_active = [p for p in API_KEYS if API_KEYS[p]]
        last_known: dict = {}
        data: list = []
        for ts in sorted(raw_buckets):
            last_known.update(raw_buckets[ts])
            if all(p in last_known for p in pids_active):
                data.append({"ts": ts, "value": round(sum(last_known[p] for p in pids_active), 2)})
    else:
        data = snapshot_get(pid, hours=48)
    return jsonify({"status": "ok", "data": data})
