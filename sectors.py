"""Robust sector mapping for global stocks and ETFs."""

# GICS Sectors + Special Categories
SECTORS = {
    # Portfolio holdings (User's specific tickers)
    "GOOGL": "Communication Services",
    "NVDA":  "Information Technology",
    "VUAGl": "Index Funds",
    "AMZN":  "Consumer Discretionary",
    "KRKNF": "Industrials",
    "AVGO":  "Information Technology",
    "BMNR":  "Information Technology",
    "IAGl":  "Industrials",
    "BARCl": "Financials",
    "NFLX":  "Communication Services",
    "LLOYl": "Financials",
    "CRWV":  "Information Technology",
    "PLTR":  "Information Technology",
    "ATOp":  "Information Technology",
    "KULR":  "Industrials",

    # Major Tech
    "AAPL":  "Information Technology",
    "MSFT":  "Information Technology",
    "TSLA":  "Consumer Discretionary",
    "META":  "Communication Services",
    "AMD":   "Information Technology",

    # Common ETFs
    "VUSA":  "Index Funds",
    "VWRL":  "Index Funds",
    "EQQQ":  "Index Funds",
    "CSPX":  "Index Funds",
}

# Substring matches for fallback
COMPANY_KEYWORDS = {
    "bank": "Financials",
    "finance": "Financials",
    "insurance": "Financials",
    "technology": "Information Technology",
    "tech": "Information Technology",
    "software": "Information Technology",
    "cloud": "Information Technology",
    "index": "Index Funds",
    "etf": "Index Funds",
    "vanguard": "Index Funds",
    "ishares": "Index Funds",
    "mining": "Materials",
    "energy": "Energy",
    "health": "Health Care",
    "pharma": "Health Care",
    "retail": "Consumer Discretionary",
    "airline": "Industrials",
}

def get_sector(ticker: str, company_name: str) -> str:
    """Identify sector based on ticker mapping or company name keywords."""
    # 1. Exact ticker match
    if ticker in SECTORS:
        return SECTORS[ticker]

    # 2. Base symbol match (remove single exchange suffix char like 'l' (LSE) or 'p' (preference))
    base_ticker = (ticker[:-1] if ticker and ticker[-1].lower() in ('l', 'p') else ticker).upper()
    if base_ticker in SECTORS:
        return SECTORS[base_ticker]

    # 3. Company name keyword match
    name_lower = company_name.lower()
    for kw, sector in COMPANY_KEYWORDS.items():
        if kw in name_lower:
            return sector

    return "Other"
