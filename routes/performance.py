"""
routes/performance.py — Performance analytics endpoints.

Provides per-portfolio and combined performance metrics:
  - Monthly portfolio returns vs SPY benchmark
  - Risk metrics: TWR, Beta, Sharpe, Sortino, Volatility, Weighted P/E
  - Monthly / daily / yearly per-ticker performance heatmaps
  - Per-sector return attribution (last 12 months)
  - Daily/weekly portfolio value change series

All heavy data is fetched from Yahoo Finance and cached in the shared KV
store so repeated calls are fast.  Cache TTLs range from 5 min (daily perf)
to 1 hour (yearly perf / risk metrics).
"""

import concurrent.futures
import logging
from datetime import date, datetime as _dt, timezone as _tz

import requests
from flask import Blueprint, jsonify, request

from cache import kv_get, kv_set, rows_get, snapshot_get
from helpers import API_KEYS, fetch_and_cache_portfolio
from yf import _build_yf_symbol, _yf_fetch_points, _yf_summary

logger = logging.getLogger("performance")

performance_bp = Blueprint("performance", __name__)


# ── Monthly portfolio returns ─────────────────────────────────────────────────

@performance_bp.route("/api/p<pid>/monthly-returns")
def monthly_returns_endpoint(pid):
    """Portfolio-level month-over-month % returns derived from value snapshots."""
    cache_key = f"monthly_returns:{pid}"
    cached = kv_get(cache_key, 1800)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})

    HOURS_5Y = 5 * 365 * 24

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

    monthly_vals: dict = {}
    for day in sorted(daily_vals.keys()):
        monthly_vals[day[:7]] = daily_vals[day]

    months = sorted(monthly_vals.keys())
    result = []
    for i in range(1, len(months)):
        prev_v = monthly_vals[months[i - 1]]
        curr_v = monthly_vals[months[i]]
        if prev_v and prev_v > 0:
            pct = round((curr_v - prev_v) / prev_v * 100, 2)
            result.append({"month": months[i], "pct": pct, "value": curr_v})

    try:
        spy_cache_key = "spy_monthly_returns"
        spy_monthly = kv_get(spy_cache_key, 3600)
        if spy_monthly is None:
            spy_points = _yf_fetch_points("SPY", "5y", "1mo")
            spy_monthly_vals: dict = {}
            for i in range(1, len(spy_points)):
                mo = _dt.fromtimestamp(spy_points[i]["ts"], _tz.utc).strftime("%Y-%m")
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


# ── Risk metrics ──────────────────────────────────────────────────────────────

@performance_bp.route("/api/pcombined/risk-metrics")
def risk_metrics_endpoint():
    """Portfolio risk metrics: TWR, Beta, Annualised Volatility, Sharpe, Sortino, Weighted P/E."""
    cache_key = "risk_metrics:combined"
    cached = kv_get(cache_key, 3600)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})
    try:
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

        pf_days   = sorted(pf_vals.keys())
        pf_prices = [pf_vals[d] for d in pf_days]
        pf_returns = [(pf_prices[i] / pf_prices[i - 1]) - 1 for i in range(1, len(pf_prices))]

        twr = 1.0
        for r in pf_returns:
            twr *= (1 + r)
        twr = round((twr - 1) * 100, 2)

        spy_points = _yf_fetch_points("SPY", "1y", "1d")
        spy_by_day = {date.fromtimestamp(p["ts"]).isoformat(): p["price"] for p in spy_points}
        common_days = sorted(d for d in pf_days if d in spy_by_day)

        spy_twr = beta = spy_sharpe = None
        if len(common_days) >= 10:
            spy_prices_c = [spy_by_day[d] for d in common_days]
            pf_prices_c  = [pf_vals[d]    for d in common_days]
            spy_rets  = [(spy_prices_c[i] / spy_prices_c[i - 1]) - 1 for i in range(1, len(spy_prices_c))]
            pf_rets_c = [(pf_prices_c[i]  / pf_prices_c[i - 1])  - 1 for i in range(1, len(pf_prices_c))]
            v = 1.0
            for r in spy_rets:
                v *= (1 + r)
            spy_twr = round((v - 1) * 100, 2)
            n = len(pf_rets_c)
            if n >= 2:
                mp    = sum(pf_rets_c) / n
                ms    = sum(spy_rets) / n
                cov   = sum((pf_rets_c[i] - mp) * (spy_rets[i] - ms) for i in range(n)) / (n - 1)
                var_s = sum((r - ms) ** 2 for r in spy_rets) / (n - 1)
                beta  = round(cov / var_s, 3) if var_s > 0 else None
            rf_d    = (1.045 ** (1 / 252)) - 1
            spy_exc = [r - rf_d for r in spy_rets]
            sm = sum(spy_exc) / len(spy_exc)
            ss = (sum((r - sm) ** 2 for r in spy_exc) / (len(spy_exc) - 1)) ** 0.5
            spy_sharpe = round(sm / ss * (252 ** 0.5), 3) if ss > 0 else None

        rf_d   = (1.045 ** (1 / 252)) - 1
        exc    = [r - rf_d for r in pf_returns]
        n      = len(exc)
        mean_e = sum(exc) / n if n > 0 else 0
        var_e  = sum((r - mean_e) ** 2 for r in exc) / (n - 1) if n > 1 else 0
        std_e  = var_e ** 0.5
        sharpe  = round(mean_e / std_e * (252 ** 0.5), 3) if std_e > 0 else None
        vol     = round(std_e * (252 ** 0.5) * 100, 2)    if std_e > 0 else None
        down    = [r for r in exc if r < 0]
        sortino = None
        if len(down) > 1:
            dv = sum(r ** 2 for r in down) / len(down)
            sortino = round(mean_e / (dv ** 0.5) * (252 ** 0.5), 3) if dv > 0 else None

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
                row_meta = []
                for row in combined_rows:
                    _, yf_sym = _build_yf_symbol(row["ticker"], row.get("country", "US"))
                    row_meta.append((row, yf_sym, f"pe:{yf_sym}"))

                pe_map, to_fetch = {}, []
                for row, yf_sym, ck in row_meta:
                    cached_pe = kv_get(ck, 86400)
                    if cached_pe is not None:
                        pe_map[yf_sym] = cached_pe
                    elif yf_sym not in pe_map:
                        to_fetch.append((yf_sym, ck))

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
            "twr":        twr,
            "spy_twr":    spy_twr,
            "twr_vs_spy": round(twr - spy_twr, 2) if spy_twr is not None else None,
            "beta":       beta,
            "volatility": vol,
            "sharpe":     sharpe,
            "sortino":    sortino,
            "spy_sharpe": spy_sharpe,
            "pe":         pe_weighted,
            "data_days":  len(pf_days),
        }
        kv_set(cache_key, result)
        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        logger.error("risk_metrics error: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


# ── Monthly per-ticker performance heatmap ────────────────────────────────────

@performance_bp.route("/api/p<pid>/monthly-performance")
def monthly_performance(pid):
    """Monthly % returns for all tickers in the portfolio for the last 12 months."""
    cache_key = f"monthly_perf_v2:{pid}"
    cached = kv_get(cache_key, 900)
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
        clean_ticker, yf_sym = _build_yf_symbol(ticker, country)

        per_ticker_key = f"monthly_perf_ticker:{yf_sym}"
        cached_monthly = kv_get(per_ticker_key, 900)
        if cached_monthly is not None:
            return clean_ticker, cached_monthly

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

            # Yahoo opens a new bar with prev month's close; override with live price for current month.
            current_price = result.get("meta", {}).get("regularMarketPrice")
            if current_price and closes:
                closes[-1] = current_price

            monthly = {}
            for i in range(1, len(timestamps)):
                if closes[i] is None or closes[i - 1] is None or closes[i - 1] == 0:
                    continue
                dt_obj    = _dt.fromtimestamp(timestamps[i], _tz.utc)
                month_key = dt_obj.strftime("%Y-%m")
                pct       = (closes[i] - closes[i - 1]) / closes[i - 1] * 100
                monthly[month_key] = round(pct, 2)
            kv_set(per_ticker_key, monthly)
            return clean_ticker, monthly
        except Exception as exc:
            logger.warning("monthly_perf failed for %s: %s", yf_sym, exc)
            return ticker, {}

    result = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(12, max(1, len(unique)))) as ex:
        for ticker, monthly in ex.map(_fetch_monthly, unique):
            result[ticker] = monthly

    _, sp500_monthly = _fetch_monthly({"ticker": "^GSPC", "country": "US"})
    result["S&P 500"] = sp500_monthly

    kv_set(cache_key, result)
    return jsonify({"status": "ok", "data": result})


# ── Daily per-ticker performance heatmap ──────────────────────────────────────

@performance_bp.route("/api/p<pid>/daily-performance")
def daily_performance(pid):
    """Month-to-date daily % returns for all tickers + S&P 500."""
    cache_key = f"daily_perf:{pid}"
    cached = kv_get(cache_key, 300)
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

    def _fetch_daily(row):
        ticker   = row["ticker"]
        country  = row.get("country", "US")
        is_sp500 = ticker == "^GSPC"
        clean_ticker, yf_sym = _build_yf_symbol(ticker, country)

        per_ticker_key = f"daily_perf_ticker:{yf_sym}"
        cached_daily = kv_get(per_ticker_key, 300)
        if cached_daily is not None:
            return ("S&P 500" if is_sp500 else clean_ticker), cached_daily

        try:
            resp = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}",
                params={"range": "1mo", "interval": "1d"},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10,
            )
            resp.raise_for_status()
            chart_result = resp.json()["chart"]["result"][0]
            timestamps   = chart_result.get("timestamp", [])
            closes       = list(chart_result["indicators"]["quote"][0].get("close", []))

            current_price = chart_result.get("meta", {}).get("regularMarketPrice")
            if current_price and closes:
                closes[-1] = current_price

            now        = _dt.now(_tz.utc)
            current_ym = now.strftime("%Y-%m")

            daily = {}
            for i in range(1, len(timestamps)):
                if closes[i] is None or closes[i - 1] is None or closes[i - 1] == 0:
                    continue
                dt_obj  = _dt.fromtimestamp(timestamps[i], _tz.utc)
                day_key = dt_obj.strftime("%Y-%m-%d")
                if not day_key.startswith(current_ym):
                    continue
                pct = (closes[i] - closes[i - 1]) / closes[i - 1] * 100
                daily[day_key] = round(pct, 2)

            kv_set(per_ticker_key, daily)
            return ("S&P 500" if is_sp500 else clean_ticker), daily
        except Exception as exc:
            logger.warning("daily_perf failed for %s: %s", yf_sym, exc)
            return ("S&P 500" if is_sp500 else ticker), {}

    tasks = list(unique) + [{"ticker": "^GSPC", "country": "US"}]
    result = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(12, max(1, len(tasks)))) as ex:
        for display_key, daily in ex.map(_fetch_daily, tasks):
            result[display_key] = daily

    kv_set(cache_key, result)
    return jsonify({"status": "ok", "data": result})


# ── Yearly per-ticker performance ─────────────────────────────────────────────

@performance_bp.route("/api/p<pid>/yearly-performance")
def yearly_performance(pid):
    """Annual % returns for all tickers + S&P 500 for the last 15 years."""
    cache_key = f"yearly_perf_15y:{pid}"
    cached = kv_get(cache_key, 3600)
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

    def _fetch_yearly(row):
        ticker   = row["ticker"]
        country  = row.get("country", "US")
        is_sp500 = ticker == "^GSPC"
        clean_ticker, yf_sym = _build_yf_symbol(ticker, country)
        try:
            resp = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}",
                params={"range": "15y", "interval": "1mo"},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=10,
            )
            resp.raise_for_status()
            chart_result = resp.json()["chart"]["result"][0]
            timestamps   = chart_result.get("timestamp", [])
            closes       = list(chart_result["indicators"]["quote"][0].get("close", []))

            current_price = chart_result.get("meta", {}).get("regularMarketPrice")
            if current_price and closes:
                closes[-1] = current_price

            year_closes = {}
            for i, ts in enumerate(timestamps):
                if closes[i] is None:
                    continue
                dt_obj = _dt.fromtimestamp(ts, _tz.utc)
                yr = dt_obj.year
                if yr not in year_closes:
                    year_closes[yr] = {}
                year_closes[yr][dt_obj.month] = closes[i]

            yearly = {}
            sorted_years = sorted(year_closes.keys())
            for j in range(1, len(sorted_years)):
                yr      = sorted_years[j]
                prev_yr = sorted_years[j - 1]
                prev_months = year_closes.get(prev_yr, {})
                this_months = year_closes.get(yr, {})
                if not prev_months or not this_months:
                    continue
                prev_last = prev_months[max(prev_months)]
                this_last = this_months[max(this_months)]
                if prev_last and prev_last != 0:
                    yearly[str(yr)] = round((this_last - prev_last) / prev_last * 100, 2)

            return ("S&P 500" if is_sp500 else clean_ticker), yearly
        except Exception as exc:
            logger.warning("yearly_perf failed for %s: %s", yf_sym, exc)
            return ("S&P 500" if is_sp500 else ticker), {}

    tasks = list(unique) + [{"ticker": "^GSPC", "country": "US"}]
    result = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(12, max(1, len(tasks)))) as ex:
        for display_key, yearly in ex.map(_fetch_yearly, tasks):
            result[display_key] = yearly

    kv_set(cache_key, result)
    return jsonify({"status": "ok", "data": result})


# ── Per-sector return attribution ─────────────────────────────────────────────

@performance_bp.route("/api/p<pid>/return-attribution")
def return_attribution(pid):
    """Per-sector monthly return contribution for the last 12 months."""
    cache_key = f"return_attr:{pid}"
    cached = kv_get(cache_key, 900)
    if cached is not None:
        return jsonify({"status": "ok", "data": cached})

    try:
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

        weights = {r["ticker"]: r["current_value"] / total_val for r in unique}
        sectors = {r["ticker"]: (r.get("sector") or "Other") for r in unique}

        monthly_perf_key = f"monthly_perf:{pid}"
        monthly_perf = kv_get(monthly_perf_key, 900)
        if monthly_perf is None:
            def _fetch_monthly_attr(row):
                ticker = row["ticker"]
                country = row.get("country", "US")
                clean_ticker, yf_sym = _build_yf_symbol(ticker, country)
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
                    closes     = list(result["indicators"]["quote"][0].get("close", []))
                    cur_px = result.get("meta", {}).get("regularMarketPrice")
                    if cur_px and closes:
                        closes[-1] = cur_px
                    monthly = {}
                    for i in range(1, len(timestamps)):
                        if closes[i] is None or closes[i - 1] is None or closes[i - 1] == 0:
                            continue
                        dt_obj = _dt.fromtimestamp(timestamps[i], _tz.utc)
                        mk = dt_obj.strftime("%Y-%m")
                        monthly[mk] = round((closes[i] - closes[i - 1]) / closes[i - 1] * 100, 2)
                    return ticker, monthly
                except Exception:
                    return ticker, {}

            monthly_perf = {}
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(12, max(1, len(unique)))) as ex:
                for ticker, monthly in ex.map(_fetch_monthly_attr, unique):
                    monthly_perf[ticker] = monthly

        all_months = set()
        for monthly in monthly_perf.values():
            all_months.update(monthly.keys())
        sorted_months = sorted(all_months)[-12:]

        attribution = {}
        for month in sorted_months:
            attribution[month] = {}
            for row in unique:
                t   = row["ticker"]
                w   = weights.get(t, 0)
                sec = sectors.get(t, "Other")
                pct = monthly_perf.get(t, {}).get(month, 0) or 0
                attribution[month][sec] = round(attribution[month].get(sec, 0) + w * pct, 4)

        all_sectors = sorted(set(s for month_data in attribution.values() for s in month_data))

        result = {
            "months":      sorted_months,
            "sectors":     all_sectors,
            "attribution": attribution,
        }
        kv_set(cache_key, result)
        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        logger.error("return_attribution error: %s", e)
        return jsonify({"status": "error", "message": str(e)}), 500


# ── Daily/weekly portfolio value changes ──────────────────────────────────────

@performance_bp.route("/api/p<pid>/daily-returns")
def daily_returns_endpoint(pid):
    """Daily portfolio value changes for the last 30 days (or 7 days for ?range=1W)."""
    range_    = request.args.get("range", "1M")
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

    days   = sorted(daily_vals.keys())
    result = []
    for i in range(1, len(days)):
        prev_v = daily_vals[days[i - 1]]
        curr_v = daily_vals[days[i]]
        if prev_v and prev_v > 0:
            pct = round((curr_v - prev_v) / prev_v * 100, 3)
            result.append({"date": days[i], "pct": pct, "value": curr_v})

    kv_set(cache_key, result)
    return jsonify({"status": "ok", "data": result})
