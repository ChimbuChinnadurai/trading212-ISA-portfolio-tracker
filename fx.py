"""Currency helpers: GBP/USD rate and country detection."""
import requests

from cache import TTL_FX, kv_get, kv_set

# ISIN prefix → display country code
_ISIN_COUNTRY: dict = {
    "GB": "UK", "US": "US", "DE": "DE", "FR": "FR", "NL": "NL",
    "IE": "IE", "LU": "LU", "CH": "CH", "CA": "CA", "AU": "AU",
    "JP": "JP", "ES": "ES", "IT": "IT", "SE": "SE", "DK": "DK",
    "NO": "NO", "FI": "FI", "BE": "BE", "HK": "HK", "CN": "CN",
}

# T212 ticker middle segment → country code (fallback when ISIN is absent)
_TICKER_SEGMENT_COUNTRY: dict = {
    "US": "US", "CA": "CA", "AU": "AU",
    "DE": "DE", "FR": "FR",
}

# Countries whose T212 prices are in pence and need ÷100
PENCE_COUNTRIES = {"UK", "ES"}

# Countries whose T212 prices are in USD and need ÷ GBPUSD
USD_COUNTRIES = {"US", "CA"}


def get_gbpusd_rate() -> float:
    """Fetch live GBP/USD rate from Yahoo Finance, cached for TTL_FX seconds."""
    cached = kv_get("gbpusd", TTL_FX)
    if cached is not None:
        return float(cached)
    try:
        resp = requests.get(
            "https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X",
            params={"interval": "1d", "range": "1d"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        resp.raise_for_status()
        rate = float(resp.json()["chart"]["result"][0]["meta"]["regularMarketPrice"])
        kv_set("gbpusd", rate)
        return rate
    except Exception:
        return 1.27


def get_country(instrument: dict, t212_ticker: str) -> str:
    """
    Derive a 2-letter country code for a stock.
    Priority: ISIN prefix → T212 ticker country segment → 'UK' for bare _EQ tickers.
    """
    isin = instrument.get("isin", "")
    if len(isin) >= 2:
        code = isin[:2].upper()
        if code in _ISIN_COUNTRY:
            return _ISIN_COUNTRY[code]

    parts = t212_ticker.upper().split("_")
    for seg in parts[1:-1]:           # skip symbol and trailing "EQ"
        if seg in _TICKER_SEGMENT_COUNTRY:
            return _TICKER_SEGMENT_COUNTRY[seg]

    if len(parts) == 2 and parts[-1] == "EQ":
        return "UK"

    return "?"


def convert_price(raw_price: float, country: str, gbpusd: float) -> float:
    """Convert a T212 raw price to GBP based on the stock's country."""
    if country in PENCE_COUNTRIES:
        return raw_price / 100
    if country in USD_COUNTRIES:
        return raw_price / gbpusd
    return raw_price
