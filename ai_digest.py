"""
ai_digest.py — Daily market digest from Finviz
"""

import logging
import os

logger = logging.getLogger("ai_digest")



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
}


def generate_digest(provider: str, context: dict) -> str:
    """Generate a market digest string using the requested provider."""
    # Only Finviz is supported now
    provider = "finviz"
    fn = _GENERATORS.get(provider)
    logger.info("Generating market digest via %s", provider)
    return fn("")
