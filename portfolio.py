"""Build the enriched portfolio rows from raw T212 data."""
from collections import defaultdict

from fx import PENCE_COUNTRIES, USD_COUNTRIES, convert_price, get_country
from sectors import get_sector


# Ticker normalization mapping
TICKER_MAPPING = {
    "FB": "META",
    "ATOp": "ATO"
}


def build_rows(positions: list, instruments: dict, dividends: defaultdict, gbpusd: float) -> list:
    """
    Combine T212 positions with instrument metadata, dividends, and FX rate
    into a list of display-ready dicts, sorted by current value descending.
    """
    # Create a consolidated dividends map to handle ticker changes (e.g., FB -> META)
    consolidated_divs = defaultdict(float)
    for raw_ticker, amount in dividends.items():
        # Get base symbol (e.g., FB_US_EQ -> FB)
        base = raw_ticker.split("_")[0]
        mapped_base = TICKER_MAPPING.get(base, base)
        # We store by mapped base to group FB and META dividends
        consolidated_divs[mapped_base] += amount

    rows = []
    for pos in positions:
        raw_ticker        = pos.get("ticker", "")
        base_ticker       = raw_ticker.split("_")[0]
        mapped_base       = TICKER_MAPPING.get(base_ticker, base_ticker)
        
        quantity          = float(pos.get("quantity",      0))
        avg_price_raw     = float(pos.get("averagePrice",  0))
        current_price_raw = float(pos.get("currentPrice",  0))
        ppl               = float(pos.get("ppl",           0))
        raw_fx_ppl        = pos.get("fxPpl")
 
        instrument    = instruments.get(raw_ticker, {})
        company_name  = instrument.get("name") or instrument.get("shortname") or raw_ticker
        short_symbol  = mapped_base
        
        country       = get_country(instrument, raw_ticker)
        sector_raw    = instrument.get("sector") or instrument.get("industry")
        sector        = get_sector(short_symbol, company_name) if not sector_raw else sector_raw
        raw_currency  = instrument.get("currencyCode", "")
        currency_code = (raw_currency.upper().replace("GBX", "GBP").replace("GBP", "GBP")
                         if raw_currency else
                         ("GBP" if country in PENCE_COUNTRIES else
                          "USD" if country in USD_COUNTRIES else "GBP"))
 
        avg_price     = convert_price(avg_price_raw,     country, gbpusd)
        current_price = convert_price(current_price_raw, country, gbpusd)
 
        current_value = quantity * current_price
        invested      = quantity * avg_price
        returns_pct   = (ppl / invested * 100) if invested else 0
        
        native_currency = (raw_currency.upper() if raw_currency else
                           ("GBX" if country in PENCE_COUNTRIES else
                            "USD" if country in USD_COUNTRIES else "GBP"))
 
        # FX impact is only meaningful for non-UK holdings
        fx_impact = None if country == "UK" else (
            round(float(raw_fx_ppl), 2) if raw_fx_ppl is not None else None
        )
        rows.append({
            "company_name":  company_name,
            "ticker":        short_symbol, # This is now the mapped base
            "country":       country,
            "quantity":      round(quantity, 6), 
            "avg_price":     round(avg_price, 4),
            "current_price": round(current_price, 4),
            "native_price":  round(current_price_raw, 4),
            "invested":      round(invested, 2),
            "current_value": round(current_value, 2),
            "total_returns": round(ppl, 2),
            "fx_impact":     fx_impact,
            "returns_pct":   round(returns_pct, 2),
            "dividends":     round(consolidated_divs.get(short_symbol, 0), 2),
            "sector":        sector,
            "currency_code": currency_code,
            "native_currency": native_currency,
        })

    rows.sort(key=lambda r: r["current_value"], reverse=True)
    return rows
