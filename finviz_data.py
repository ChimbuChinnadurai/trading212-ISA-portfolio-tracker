"""finviz_data.py — Finviz data layer using finvizfinance library.

All public functions return plain Python dicts/lists (JSON-serializable).
Callers (app.py) are responsible for caching via kv_get/kv_set.
All functions catch exceptions and return safe empty values on failure.
"""

import json
import logging
import re

logger = logging.getLogger("finviz_data")

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
