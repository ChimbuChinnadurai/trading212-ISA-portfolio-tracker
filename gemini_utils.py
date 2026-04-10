"""
gemini_utils.py — Logic for Gemini AI interaction.
Uses the google-genai SDK (replaces deprecated google.generativeai).
"""

import json as _json
import logging
import os

from google import genai
from google.genai import types

logger = logging.getLogger("gemini")

api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

if not api_key:
    logger.warning("Neither GEMINI_API_KEY nor GOOGLE_API_KEY found in environment")

_DEFAULT_MODEL = "gemini-2.5-flash"


def _client() -> genai.Client:
    return genai.Client(api_key=api_key)


def _generate(prompt: str, model: str = _DEFAULT_MODEL) -> str:
    """Single-turn text generation. Returns the response text."""
    client = _client()
    response = client.models.generate_content(
        model=model,
        contents=prompt,
    )
    return response.text


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

    prompt = f"""
    You are a professional financial analyst. Based on the following recent market news headlines,
    provide a concise Daily Market Digest.
    Focus on the most impactful events for a retail investor.
    Use bullet points and bold text for emphasis.
    Keep it professional, insightful, and brief (max 250 words).

    HEADLINES:
    {chr(10).join(headlines)}

    DAILY MARKET DIGEST:
    """

    try:
        return _generate(prompt)
    except Exception as e:
        logger.error("Error generating market summary: %s", e)
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

    prompt = f"""
    You are an AI investment assistant. Analyze the following stock portfolio and provide 3-5 'AI-Driven Trade Signals' or insights.
    Consider diversification, performance, and potential rebalancing needs.
    Use a professional tone. For each signal, provide:
    1. **Ticker/Sector**: The focus of the signal.
    2. **Insight**: What the AI sees.
    3. **Actionable Tip**: A suggestion for the investor (e.g., 'Consider taking profits', 'Research further', 'Hold').

    PORTFOLIO HOLDINGS:
    {chr(10).join(holdings)}

    AI-DRIVEN TRADE SIGNALS:
    """

    try:
        return _generate(prompt)
    except Exception as e:
        logger.error("Error generating trade signals: %s", e)
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

    prompt = f"""You are a quantitative financial analyst specializing in political risk and market impact.
Analyze the following {len(lines)} Trump posts and assess how each one is likely to affect financial markets.

For each post return a JSON object with exactly these fields:
- "id": the post id string (copy exactly from the input)
- "impact": one of "bullish", "bearish", or "neutral"
- "confidence": one of "high", "medium", or "low"
- "sectors": array of up to 3 sector names most affected (e.g. "Defense", "Energy", "Tech", "Financials", "Healthcare", "Crypto", "Tariffs/Trade", "Agriculture", "Infrastructure")
- "summary": ONE sentence describing the likely market reaction (max 15 words)

Respond ONLY with a valid JSON array. No markdown, no explanation, no code fences.

POSTS:
{chr(10).join(lines)}

JSON ARRAY:"""

    try:
        text = _generate(prompt).strip()
        # Strip any accidental markdown fences
        if text.startswith("```"):
            text = text.split("\n", 1)[-1]
        text = text.rstrip("`").strip()
        return _json.loads(text)
    except Exception as e:
        logger.error("Error in analyze_trump_post_sentiments: %s", e)
        return []


def chat_with_gemini(message, history=None):
    """Simple multi-turn chat interface with Gemini."""
    if not api_key:
        return "Gemini API key not configured."

    try:
        client = _client()
        # Build contents list from history + new message
        contents = []
        for turn in (history or []):
            role = turn.get("role", "user")
            parts = turn.get("parts", [])
            text = parts[0] if parts and isinstance(parts[0], str) else str(parts)
            contents.append(types.Content(role=role, parts=[types.Part(text=text)]))
        contents.append(types.Content(role="user", parts=[types.Part(text=message)]))

        response = client.models.generate_content(
            model=_DEFAULT_MODEL,
            contents=contents,
        )
        return response.text
    except Exception as e:
        logger.error("Error in Gemini chat: %s", e)
        return f"Error: {str(e)}"
