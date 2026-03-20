"""
ai_digest.py — AI-generated daily market digest

Supports three providers:
  claude     — Anthropic Claude API (anthropic SDK, ANTHROPIC_API_KEY)
  gemini     — Google Gemini API (google-generativeai, GEMINI_API_KEY)
  perplexity — Perplexity AI (REST, PERPLEXITY_API_KEY)
"""

import logging
import os

logger = logging.getLogger("ai_digest")

SYSTEM_PROMPT = """You are a concise financial market analyst. You produce a daily market digest
for a retail investor with a UK ISA portfolio of US and UK stocks.

Format your response as:
1. A single bold headline (e.g. **Markets cautious ahead of Fed decision**)
2. 4–6 bullet points covering key themes, sector moves, and notable stocks
   — include ticker symbols in parentheses like (SPY), (TSLA), (NVDA)
3. A brief 1-sentence outlook for the rest of the session or next day

Keep it factual, brief, and actionable. No disclaimers or preamble."""


def _build_user_message(context: dict) -> str:
    parts = ["Produce a market digest based on the following data:\n"]

    # S&P 500 / VIX
    indicators = context.get("indicators", {})
    gspc = indicators.get("GSPC", {})
    vix  = indicators.get("VIX", {})
    if gspc.get("current"):
        parts.append(f"S&P 500: {gspc['current']:.2f} ({gspc.get('pct_vs_ma', 0):+.2f}% vs 20-day MA)")
    if vix.get("current"):
        parts.append(f"VIX (volatility): {vix['current']:.2f}")

    # Gainers
    gainers = context.get("gainers", [])[:8]
    if gainers:
        g_text = ", ".join(
            f"{r.get('Ticker','?')} {r.get('Change','?')}" for r in gainers
        )
        parts.append(f"Top gainers: {g_text}")

    # Losers
    losers = context.get("losers", [])[:8]
    if losers:
        l_text = ", ".join(
            f"{r.get('Ticker','?')} {r.get('Change','?')}" for r in losers
        )
        parts.append(f"Top losers: {l_text}")

    # News headlines
    news = context.get("news", [])[:6]
    if news:
        parts.append("Recent headlines:")
        for item in news:
            headline = item.get("headline") or item.get("title") or ""
            if headline:
                parts.append(f"  • {headline}")

    return "\n".join(parts)


# ── Claude ────────────────────────────────────────────────────────────────────

def _generate_claude(user_msg: str) -> str:
    try:
        import anthropic
    except ImportError:
        raise RuntimeError("anthropic package not installed — run: pip install anthropic")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    client = anthropic.Anthropic(api_key=api_key)
    with client.messages.stream(
        model="claude-opus-4-6",
        max_tokens=600,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        return stream.get_final_message().content[0].text


# ── Gemini ────────────────────────────────────────────────────────────────────

def _generate_gemini(user_msg: str) -> str:
    try:
        from google import genai
        from google.genai import types as genai_types
    except ImportError:
        raise RuntimeError("google-genai not installed — run: pip install google-genai")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=api_key)
    resp = client.models.generate_content(
        model="gemini-2.0-flash-lite",
        contents=user_msg,
        config=genai_types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            max_output_tokens=600,
        ),
    )
    return resp.text


# ── Perplexity ────────────────────────────────────────────────────────────────

def _generate_perplexity(user_msg: str) -> str:
    import requests as _req

    api_key = os.environ.get("PERPLEXITY_API_KEY")
    if not api_key:
        raise RuntimeError("PERPLEXITY_API_KEY not set")

    payload = {
        "model": "sonar",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_msg},
        ],
        "max_tokens": 600,
    }
    resp = _req.post(
        "https://api.perplexity.ai/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


# ── Finviz ────────────────────────────────────────────────────────────────────

def _generate_finviz(_user_msg: str) -> str:
    """Fetch the Finviz AI daily digest directly — no API key required."""
    import finviz_data as fvd

    data = fvd.get_market_digest()
    if not data or not data.get("headline"):
        raise RuntimeError("Finviz digest unavailable — homepage may have changed")

    headline = data["headline"]
    bullets  = data.get("bullets", [])
    lines    = [f"**{headline}**", ""]
    lines   += [f"• {b}" for b in bullets]
    return "\n".join(lines)


# ── Public API ────────────────────────────────────────────────────────────────

_GENERATORS = {
    "finviz": _generate_finviz,
    "claude": _generate_claude,
}


def generate_digest(provider: str, context: dict) -> str:
    """Generate a market digest string using the requested provider."""
    fn = _GENERATORS.get(provider)
    if fn is None:
        raise ValueError(f"Unknown provider '{provider}'. Choose: {list(_GENERATORS)}")
    user_msg = _build_user_message(context)
    logger.info("Generating market digest via %s", provider)
    return fn(user_msg)
