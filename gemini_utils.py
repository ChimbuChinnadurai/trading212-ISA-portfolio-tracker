"""
gemini_utils.py — Logic for Gemini AI interaction.
Uses the google-genai SDK (replaces deprecated google.generativeai).
"""

import json as _json
import logging
import os
import time
import uuid

from google import genai
from google.genai import types

logger = logging.getLogger("gemini")

api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

if not api_key:
    logger.warning("Neither GEMINI_API_KEY nor GOOGLE_API_KEY found in environment")

_DEFAULT_MODEL = "gemini-2.5-flash"
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 2.0  # seconds; doubles each attempt

_singleton_client: genai.Client | None = None


def _client() -> genai.Client:
    global _singleton_client
    if _singleton_client is None:
        _singleton_client = genai.Client(api_key=api_key)
    return _singleton_client


def _generate(prompt: str, model: str = _DEFAULT_MODEL) -> str:
    """Single-turn text generation with exponential-backoff retry."""
    run_id = uuid.uuid4().hex[:8]
    client = _client()
    for attempt in range(_MAX_RETRIES):
        try:
            logger.debug("gemini._generate run=%s attempt=%d model=%s", run_id, attempt, model)
            t0 = time.monotonic()
            response = client.models.generate_content(model=model, contents=prompt)
            elapsed = time.monotonic() - t0
            tokens_out = getattr(response.usage_metadata, "candidates_token_count", "?")
            logger.info("gemini._generate run=%s ok elapsed=%.2fs tokens_out=%s",
                        run_id, elapsed, tokens_out)
            return response.text
        except Exception as e:
            if attempt < _MAX_RETRIES - 1:
                delay = _RETRY_BASE_DELAY ** (attempt + 1)
                logger.warning("gemini._generate run=%s attempt=%d failed (%s), retrying in %.1fs",
                               run_id, attempt, e, delay)
                time.sleep(delay)
            else:
                logger.error("gemini._generate run=%s all %d attempts failed: %s",
                             run_id, _MAX_RETRIES, e)
                raise


def _parse_json_response(text: str) -> list | dict:
    """Strip markdown fences and parse JSON from a Gemini response."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].strip()
    if text.endswith("```"):
        text = text[: text.rfind("```")].rstrip()
    return _json.loads(text)


# ── Prompt builders ───────────────────────────────────────────────────────────

def _build_market_summary_prompt(headlines: list[str]) -> str:
    return (
        "You are a professional financial analyst. Based on the following recent market news headlines,\n"
        "provide a concise Daily Market Digest.\n"
        "Focus on the most impactful events for a retail investor.\n"
        "Use bullet points and bold text for emphasis.\n"
        "Keep it professional, insightful, and brief (max 250 words).\n\n"
        "HEADLINES:\n"
        + "\n".join(headlines)
        + "\n\nDAILY MARKET DIGEST:"
    )


def _build_trade_signals_prompt(holdings: list[str]) -> str:
    return (
        "You are an AI investment assistant. Analyze the following stock portfolio and provide 3-5 "
        "'AI-Driven Trade Signals' or insights.\n"
        "Consider diversification, performance, and potential rebalancing needs.\n"
        "Use a professional tone. For each signal, provide:\n"
        "1. **Ticker/Sector**: The focus of the signal.\n"
        "2. **Insight**: What the AI sees.\n"
        "3. **Actionable Tip**: A suggestion (e.g., 'Consider taking profits', 'Research further', 'Hold').\n\n"
        "PORTFOLIO HOLDINGS:\n"
        + "\n".join(holdings)
        + "\n\nAI-DRIVEN TRADE SIGNALS:"
    )


def _build_trump_sentiment_prompt(lines: list[str]) -> str:
    return (
        f"You are a quantitative financial analyst specializing in political risk and market impact.\n"
        f"Analyze the following {len(lines)} Trump posts and assess how each one is likely to affect financial markets.\n\n"
        "For each post return a JSON object with exactly these fields:\n"
        '- "id": the post id string (copy exactly from the input)\n'
        '- "impact": one of "bullish", "bearish", or "neutral"\n'
        '- "confidence": one of "high", "medium", or "low"\n'
        '- "sectors": array of up to 3 sector names most affected (e.g. "Defense", "Energy", "Tech", '
        '"Financials", "Healthcare", "Crypto", "Tariffs/Trade", "Agriculture", "Infrastructure")\n'
        '- "summary": ONE sentence describing the likely market reaction (max 15 words)\n\n'
        "Respond ONLY with a valid JSON array. No markdown, no explanation, no code fences.\n\n"
        "POSTS:\n"
        + "\n".join(lines)
        + "\n\nJSON ARRAY:"
    )


# ── Public API ────────────────────────────────────────────────────────────────

def generate_market_summary(news_data):
    """Summarize a list of news headlines into a daily market digest."""
    if not api_key:
        return "Gemini API key not configured."
    if not news_data:
        return "No news data available to summarize."

    headlines = []
    for item in news_data[:15]:
        title = item.get("headline") or item.get("title")
        summary = item.get("summary") or ""
        if title:
            headlines.append(f"- {title}: {summary[:100]}...")

    try:
        return _generate(_build_market_summary_prompt(headlines))
    except Exception as e:
        logger.error("generate_market_summary failed: %s", e)
        return f"Error generating digest: {str(e)}"


def generate_trade_signals(portfolio_data):
    """Generate AI-driven trade signals based on portfolio holdings."""
    if not api_key:
        return "Gemini API key not configured."
    if not portfolio_data:
        return "No portfolio data available to analyze."

    holdings = []
    for r in portfolio_data:
        ticker = r.get("ticker")
        name = r.get("company_name")
        ret_pct = r.get("returns_pct", 0)
        weight = r.get("weight", 0)
        holdings.append(f"- {name} ({ticker}): {weight:.1f}% of portfolio, {ret_pct:+.1f}% return")

    try:
        return _generate(_build_trade_signals_prompt(holdings))
    except Exception as e:
        logger.error("generate_trade_signals failed: %s", e)
        return f"Error generating signals: {str(e)}"


def analyze_trump_post_sentiments(posts):
    """
    Batch-analyze a list of Trump posts for market sentiment in one API call.
    Returns a list of dicts, one per post:
      {
        "id": str,
        "impact": "bullish" | "bearish" | "neutral",
        "confidence": "high" | "medium" | "low",
        "sectors": ["Defense", "Energy", ...],
        "summary": str
      }
    """
    if not api_key:
        return []
    if not posts:
        return []

    lines = []
    for i, p in enumerate(posts[:25]):
        text = (p.get("content") or "")[:300].replace("\n", " ")
        lines.append(f'[{i}] id={p.get("id", "")} | {text}')

    try:
        raw = _generate(_build_trump_sentiment_prompt(lines))
        return _parse_json_response(raw)
    except Exception as e:
        logger.error("analyze_trump_post_sentiments failed: %s", e)
        return []


_MAX_CHAT_MESSAGE_CHARS = 4000
_MAX_CHAT_HISTORY_TURNS = 20


def chat_with_gemini(message, history=None):
    """Multi-turn chat interface with Gemini."""
    if not api_key:
        return "Gemini API key not configured."

    if not isinstance(message, str) or not message.strip():
        return "Please enter a message."

    message = message[:_MAX_CHAT_MESSAGE_CHARS]

    try:
        client = _client()
        contents = []
        for turn in (history or [])[-_MAX_CHAT_HISTORY_TURNS:]:
            if not isinstance(turn, dict):
                continue
            role = turn.get("role", "user")
            if role not in ("user", "model"):
                continue
            parts = turn.get("parts", [])
            text = parts[0] if parts and isinstance(parts[0], str) else str(parts)
            contents.append(types.Content(role=role, parts=[types.Part(text=text[:_MAX_CHAT_MESSAGE_CHARS])]))
        contents.append(types.Content(role="user", parts=[types.Part(text=message)]))

        run_id = uuid.uuid4().hex[:8]
        logger.info("gemini.chat run=%s history_turns=%d", run_id, len(contents) - 1)
        t0 = time.monotonic()
        response = client.models.generate_content(model=_DEFAULT_MODEL, contents=contents)
        logger.info("gemini.chat run=%s elapsed=%.2fs", run_id, time.monotonic() - t0)
        return response.text
    except Exception as e:
        logger.error("chat_with_gemini failed: %s", e)
        return f"Error: {str(e)}"
