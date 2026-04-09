"""
gemini_utils.py — Logic for Gemini AI interaction.
"""

import os
import logging
import google.generativeai as genai

logger = logging.getLogger("gemini")

# Initialize Gemini API
api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
if api_key:
    genai.configure(api_key=api_key)
else:
    logger.warning("Neither GEMINI_API_KEY nor GOOGLE_API_KEY found in environment")

def _get_model(model_name="gemini-2.5-flash"):
    return genai.GenerativeModel(model_name)

def generate_market_summary(news_data):
    """
    Summarize a list of news headlines into a daily market digest.
    """
    if not api_key:
        return "Gemini API key not configured."

    if not news_data:
        return "No news data available to summarize."

    # Prepare headlines for the prompt
    headlines = []
    for item in news_data[:15]: # Take top 15 news items
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
        model = _get_model()
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        logger.error("Error generating market summary: %s", e)
        return f"Error generating digest: {str(e)}"

def generate_trade_signals(portfolio_data):
    """
    Generate AI-driven trade signals based on portfolio holdings.
    """
    if not api_key:
        return "Gemini API key not configured."

    if not portfolio_data:
        return "No portfolio data available to analyze."

    # Prepare portfolio info for the prompt
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
        model = _get_model()
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        logger.error("Error generating trade signals: %s", e)
        return f"Error generating signals: {str(e)}"

def analyze_trump_post_sentiments(posts):
    """
    Batch-analyze a list of Trump posts for market sentiment in one API call.
    Returns a list of dicts, one per post, keyed by post id:
      {
        "id": str,
        "impact": "bullish" | "bearish" | "neutral",
        "confidence": "high" | "medium" | "low",
        "sectors": ["Defense", "Energy", ...],   # up to 3 most relevant
        "summary": str                            # 1-sentence market implication
      }
    """
    import json as _json

    if not api_key:
        return []
    if not posts:
        return []

    # Build a numbered list for the prompt (keep content short to save tokens)
    lines = []
    for i, p in enumerate(posts[:25]):
        text = (p.get("content") or "")[:300].replace("\n", " ")
        lines.append(f'[{i}] id={p.get("id","")} | {text}')

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
        model = _get_model("gemini-2.5-flash")
        response = model.generate_content(prompt)
        text = response.text.strip()
        # Strip any accidental markdown fences
        text = text.lstrip("```json").lstrip("```").rstrip("```").strip()
        return _json.loads(text)
    except Exception as e:
        logger.error("Error in analyze_trump_post_sentiments: %s", e)
        return []


def chat_with_gemini(message, history=None):
    """
    Simple chat interface with Gemini.
    """
    if not api_key:
        return "Gemini API key not configured."

    try:
        model = _get_model()
        # history should be a list of {'role': 'user'|'model', 'parts': [text]}
        chat = model.start_chat(history=history or [])
        response = chat.send_message(message)
        return response.text
    except Exception as e:
        logger.error("Error in Gemini chat: %s", e)
        return f"Error: {str(e)}"
