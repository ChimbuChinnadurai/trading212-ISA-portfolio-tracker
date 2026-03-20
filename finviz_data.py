"""finviz_data.py — Finviz data layer using finvizfinance library.

All public functions return plain Python dicts/lists (JSON-serializable).
Callers (app.py) are responsible for caching via kv_get/kv_set.
All functions catch exceptions and return safe empty values on failure.
"""

import json
import logging
import re
from typing import Any

logger = logging.getLogger("finviz_data")

# ── Signal type → Finviz internal signal name ──────────────────────────────────
SIGNAL_MAP = {
    "gainers":    "ta_topgainers",
    "losers":     "ta_toplosers",
    "volume":     "ta_unusualvolume",
    "newhighs":   "ta_newhigh",
    "newlows":    "ta_newlow",
    "upgrades":   "upgrades",
    "downgrades": "downgrades",
    "overbought": "ta_overbought",
    "oversold":   "ta_oversold",
    "mostactive": "ta_mostactive",
}


# ── Internal helpers ────────────────────────────────────────────────────────────

def _safe_float(val) -> float | None:
    """Convert Finviz string values (e.g. '1.23B', '45.6M', '3.2%') to float."""
    if val is None:
        return None
    s = str(val).replace(",", "").replace("%", "").strip()
    if s in ("-", "", "N/A", "nan"):
        return None
    try:
        if s.endswith("T"):
            return float(s[:-1]) * 1_000_000_000_000
        if s.endswith("B"):
            return float(s[:-1]) * 1_000_000_000
        if s.endswith("M"):
            return float(s[:-1]) * 1_000_000
        if s.endswith("K"):
            return float(s[:-1]) * 1_000
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_change(val) -> float:
    """Parse a change string like '+4.23%' or '-1.5%' to a float."""
    if val is None:
        return 0.0
    s = str(val).replace("%", "").replace("+", "").strip()
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0


def _df_to_dicts(df) -> list[dict]:
    """Convert a pandas DataFrame to a list of plain dicts."""
    if df is None or df.empty:
        return []
    return df.where(df.notna(), None).to_dict(orient="records")


# ── Public API ──────────────────────────────────────────────────────────────────

def get_market_news() -> dict[str, list]:
    """Fetch market news and blog posts from Finviz.

    Returns:
        {
            "news":  [{"date": str, "time": str, "title": str, "link": str, "source": str}, ...],
            "blogs": [{"date": str, "time": str, "title": str, "link": str, "source": str}, ...],
        }
    """
    try:
        from finvizfinance.news import News
        raw = News().get_news()
        result = {}
        for key in ("news", "blogs"):
            df = raw.get(key)
            if df is None or df.empty:
                result[key] = []
                continue
            items = []
            for _, row in df.iterrows():
                items.append({
                    "date":   str(row.get("Date", row.get("date", ""))),
                    "time":   str(row.get("Time", row.get("time", ""))),
                    "title":  str(row.get("Title", row.get("Headline", row.get("title", "")))),
                    "link":   str(row.get("Link", row.get("News Link", row.get("link", "#")))),
                    "source": str(row.get("Source", row.get("source", row.get("ticker_id", "Finviz")))),
                })
            result[key] = items
        return result
    except Exception as exc:
        logger.warning("Finviz news fetch failed: %s", exc)
        return {"news": [], "blogs": []}


def get_insider_trading(period: str = "latest") -> list[dict]:
    """Fetch insider trading data from Finviz.

    Args:
        period: 'latest' | 'top week' | 'top owner trade'

    Returns list of dicts:
        ticker, insider, relationship, date, transaction, shares, cost, value, is_buy
    """
    _period_url = {
        "latest":          "https://finviz.com/insidertrading.ashx",
        "top week":        "https://finviz.com/insidertrading.ashx?or=topweek",
        "top owner trade": "https://finviz.com/insidertrading.ashx?or=topowner",
    }
    if period not in _period_url:
        period = "latest"
    try:
        from finvizfinance.util import web_scrap
        soup = web_scrap(_period_url[period])
        if soup is None:
            return []
        table = soup.find("table", class_="styled-table-new")
        if table is None:
            return []
        tr_list = table.findAll("tr")
        if len(tr_list) < 2:
            return []
        headers = [th.text.strip() for th in tr_list[0].findAll("th")]
        rows = []
        for tr in tr_list[1:]:
            cells = [td.text.strip() for td in tr.findAll("td")]
            if not cells or len(cells) < len(headers):
                continue
            row = {headers[i]: cells[i] for i in range(len(headers))}
            transaction = row.get("Transaction", "")
            is_buy = any(w in transaction.lower() for w in ("buy", "purchase", "acquisition"))
            rows.append({
                "ticker":       row.get("Ticker", "").strip(),
                "insider":      row.get("Owner", "").strip(),
                "relationship": row.get("Relationship", "").strip(),
                "date":         row.get("Date", "").strip(),
                "transaction":  transaction.strip(),
                "shares":       _safe_float(row.get("#Shares")),
                "cost":         _safe_float(row.get("Cost")),
                "value":        _safe_float(row.get("Value ($)")),
                "shares_total": _safe_float(row.get("#Shares Total")),
                "is_buy":       is_buy,
            })
        return rows[:40]
    except Exception as exc:
        logger.warning("Finviz insider fetch failed (period=%s): %s", period, exc)
        return []


def _scrape_screener(url: str, limit: int = -1) -> list[dict]:
    """Scrape finviz screener table directly (library HTML parser is outdated).

    Handles pagination automatically. Returns list of raw row dicts with keys
    matching the table headers (Ticker, Company, Sector, Price, Change, Volume,
    Market Cap, P/E).
    """
    from finvizfinance.util import web_scrap
    import re
    import time

    rows: list[dict] = []
    page_start = 1

    while True:
        if page_start > 1:
            time.sleep(1.0)  # avoid 429 rate-limiting between pages
        page_url = url if page_start == 1 else f"{url}&r={page_start}"
        soup = web_scrap(page_url)
        if soup is None:
            break

        table = soup.find("table", class_="screener_table")
        if table is None:
            break

        tr_list = table.findAll("tr")
        if len(tr_list) < 2:
            break

        # Headers from <th> elements (first row)
        headers = [th.text.strip() for th in tr_list[0].findAll("th")]

        for tr in tr_list[1:]:
            cells = tr.findAll("td")
            if not cells:
                continue
            # cells[0] is row number, data starts at cells[1]
            cell_texts = [c.text.strip() for c in cells]
            if len(cell_texts) < 2:
                continue
            # Map starting from index 1 (skip No. column)
            row = {headers[i]: cell_texts[i] for i in range(1, min(len(headers), len(cell_texts)))}
            rows.append(row)
            if limit != -1 and len(rows) >= limit:
                return rows

        # Check if there are more pages — look for total count
        total_text = ""
        for el in soup.find_all(string=re.compile(r"#\d+ / \d+ Total")):
            total_text = str(el)
            break

        if total_text:
            m = re.search(r"#\d+ / (\d+) Total", total_text)
            if m:
                total_rows = int(m.group(1))
                if len(rows) >= total_rows:
                    break
                page_start += 20
                continue
        break

    return rows


def get_market_signals(signal_type: str, limit: int = 15) -> list[dict]:
    """Fetch screener results for a given market signal.

    Args:
        signal_type: key from SIGNAL_MAP ('gainers', 'losers', 'volume', 'newhighs', etc.)
        limit: max number of stocks to return

    Returns list of dicts:
        ticker, company, sector, price, change_pct, volume, market_cap
    """
    signal = SIGNAL_MAP.get(signal_type)
    if not signal:
        logger.warning("Unknown signal type: %s", signal_type)
        return []
    try:
        url = f"https://finviz.com/screener.ashx?v=111&s={signal}&ft=4"
        raw_rows = _scrape_screener(url, limit=limit)
        result = []
        for row in raw_rows:
            result.append({
                "ticker":     row.get("Ticker", ""),
                "company":    row.get("Company", ""),
                "sector":     row.get("Sector", ""),
                "price":      _safe_float(row.get("Price")),
                "change_pct": _parse_change(row.get("Change")),
                "volume":     _safe_float(row.get("Volume")),
                "market_cap": _safe_float(row.get("Market Cap")),
                "pe":         _safe_float(row.get("P/E")),
            })
        return result
    except Exception as exc:
        logger.warning("Finviz signals fetch failed (signal=%s): %s", signal_type, exc)
        return []


def get_sp500_heatmap() -> list[dict]:
    """Fetch all S&P 500 stocks for the market heatmap.

    Returns list of dicts:
        ticker, company, sector, price, change_pct, market_cap

    Note: This fetches all pages from Finviz (~500 stocks) and may take
    10–30 seconds on first call. Results should be cached for >= 5 minutes.
    """
    try:
        url = "https://finviz.com/screener.ashx?v=111&f=idx_sp500&ft=4"
        raw_rows = _scrape_screener(url)
        result = []
        for row in raw_rows:
            market_cap = _safe_float(row.get("Market Cap"))
            result.append({
                "ticker":     row.get("Ticker", ""),
                "company":    row.get("Company", ""),
                "sector":     row.get("Sector", "Other"),
                "price":      _safe_float(row.get("Price")),
                "change_pct": _parse_change(row.get("Change")),
                "market_cap": market_cap if market_cap else 0,
            })
        return result
    except Exception as exc:
        logger.warning("Finviz S&P 500 heatmap fetch failed: %s", exc)
        return []


def get_stock_details(ticker: str) -> dict[str, Any]:
    """Fetch detailed data for a single stock (fundamentals, signals, ratings, insider).

    Returns:
        {
            "fundament": dict,           # P/E, EPS, Market Cap, 52W range, volatility, etc.
            "signals":   list[str],      # active TA signal names
            "ratings":   list[dict],     # analyst upgrades/downgrades with price targets
            "insider":   list[dict],     # recent insider trades for this ticker
            "description": str,
        }
    """
    result = {
        "fundament":   {},
        "signals":     [],
        "ratings":     [],
        "insider":     [],
        "description": "",
    }
    if not ticker:
        return result
    try:
        from finvizfinance.quote import finvizfinance as fvstock
        stock = fvstock(ticker)

        # Fundamentals
        try:
            fund = stock.ticker_fundament()
            if isinstance(fund, dict):
                result["fundament"] = {
                    k: str(v) for k, v in fund.items()
                    if v is not None and str(v) not in ("-", "", "nan")
                }
        except Exception as e:
            logger.debug("Fundament failed for %s: %s", ticker, e)

        # Signals
        try:
            sigs = stock.ticker_signal()
            result["signals"] = [str(s) for s in (sigs or [])]
        except Exception as e:
            logger.debug("Signals failed for %s: %s", ticker, e)

        # Analyst ratings/price targets
        try:
            ratings_df = stock.ticker_outer_ratings()
            if ratings_df is not None and not ratings_df.empty:
                for _, row in ratings_df.iterrows():
                    result["ratings"].append({
                        "date":   str(row.get("Date", "")),
                        "firm":   str(row.get("Outer", row.get("outer", ""))),
                        "status": str(row.get("Status", "")),
                        "rating": str(row.get("Rating", "")),
                        "target": _safe_float(row.get("Price", row.get("Target", row.get("price")))),
                    })
        except Exception as e:
            logger.debug("Ratings failed for %s: %s", ticker, e)

        # Insider activity for this specific stock
        try:
            insider_df = stock.ticker_inside_trader()
            if insider_df is not None and not insider_df.empty:
                for _, row in insider_df.iterrows():
                    transaction = str(row.get("Transaction", row.get("Relationship", "")))
                    is_buy = any(w in transaction.lower() for w in ("buy", "purchase", "acquisition"))
                    result["insider"].append({
                        "insider":      str(row.get("Insider Trading", row.get("insider", ""))).strip(),
                        "relationship": str(row.get("Relationship", "")).strip(),
                        "date":         str(row.get("Date", "")).strip(),
                        "transaction":  transaction.strip(),
                        "shares":       _safe_float(row.get("#Shares", row.get("shares"))),
                        "value":        _safe_float(row.get("Value ($)", row.get("value"))),
                        "is_buy":       is_buy,
                    })
        except Exception as e:
            logger.debug("Insider failed for %s: %s", ticker, e)

        # Description
        try:
            result["description"] = str(stock.ticker_description() or "")
        except Exception as e:
            logger.debug("Description failed for %s: %s", ticker, e)

    except Exception as exc:
        logger.warning("Finviz stock details failed for %s: %s", ticker, exc)

    return result


def get_market_digest() -> dict:
    """Scrape the Finviz AI-generated daily market digest from the homepage.

    Returns:
        {
            "headline":  str,         # main headline
            "bullets":   list[str],   # bullet points (markdown links stripped to plain text)
            "datetime":  str,         # ISO datetime string from Finviz
            "sentiment": str,         # "good" or "bad"
        }
    """
    result: dict = {}
    try:
        from finvizfinance.util import web_scrap

        soup = web_scrap("https://finviz.com/")
        if soup is None:
            raise RuntimeError("Failed to fetch finviz homepage")

        # The digest is embedded as JSON in a <script> tag
        for script in soup.find_all("script"):
            text = script.string or ""
            if "whyMoving" not in text:
                continue
            m = re.search(r'\{"whyMoving":.+\}', text)
            if not m:
                continue
            data = json.loads(m.group(0))
            wm = data.get("whyMoving", {})

            # Strip markdown links [TEXT](url) → TEXT, keep ticker chips
            def _clean(s: str) -> str:
                # [LABEL](url) → LABEL
                return re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', s)

            bullets = [_clean(b) for b in wm.get("bulletPointsList", []) if b]
            result = {
                "headline":  wm.get("headline", ""),
                "bullets":   bullets,
                "datetime":  wm.get("dateTime", ""),
                "sentiment": wm.get("sentiment", ""),
            }
            break

    except Exception as exc:
        logger.warning("Finviz market digest failed: %s", exc)

    return result
