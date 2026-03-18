# CLAUDE.md — Trading212 Portfolio Tracker

## Project Overview
Flask + Vanilla JS web app that fetches Trading212 ISA positions and displays them in an interactive dashboard. Supports 2+ portfolios simultaneously with aggregated views.

**No Gemini AI integration exists yet** — this is a planned addition (the repo name is aspirational).

---

## Architecture at a Glance

```
Trading212 API + Yahoo Finance
    ↓
t212.py (API client + per-endpoint TTL caching)
    ↓
cache.py (SQLite kv-store, TTL=10m rows / 1h instruments / 30m dividends)
    ↓
portfolio.py (enrichment: FX conversion, sector, weight, YOC, div yield)
    ↓
app.py (14 Flask REST endpoints, /api/p<pid>/* and /api/pcombined/*)
    ↓
home.js / app.js → index.html / details.html
```

---

## File Map (read these before editing)

| File | What it does |
|------|-------------|
| `app.py` | Flask app, 14 endpoints, multi-portfolio aggregation, 487 lines |
| `t212.py` | Trading212 REST client, pagination, order normalization, 220 lines |
| `portfolio.py` | Builds enriched row dicts from raw T212 data, 64 lines |
| `cache.py` | SQLite wrapper with TTL, `kv_get/set`, `rows_get/set`, 107 lines |
| `fx.py` | GBP/USD rate (Yahoo), price conversion (GBX pence→GBP), country from ISIN, 76 lines |
| `sectors.py` | Hardcoded ticker→sector map + keyword fallback, 76 lines |
| `static/app.js` | Detail page: table, allocation bars, price charts, side panel, ~800 lines |
| `static/home.js` | Landing page: overview cards, activity, top performers, news, 288 lines |
| `static/style.css` | Dark/light theme, CSS variables, ~1000 lines |
| `templates/index.html` | Landing page shell, 166 lines |
| `templates/details.html` | Detail page shell with Jinja `pid` variable, 412 lines |

---

## Data Model — Portfolio Row

```python
{
    "ticker": str,          # "GOOGL", "VUSA"
    "company_name": str,
    "country": str,         # "UK", "US", "DE"
    "quantity": float,
    "avg_price": float,     # GBP
    "invested": float,      # GBP total cost
    "current_value": float, # GBP current
    "total_returns": float, # GBP P&L
    "returns_pct": float,
    "fx_impact": float | None,
    "dividends": float,     # GBP total received
    "sector": str,          # GICS or "Index Funds"
    "currency_code": str,   # "GBP", "USD", "EUR"
    "weight": float,        # % of portfolio
    "div_yield": float,     # dividends / current_value %
    "yoc": float,           # dividends / invested %
}
```

---

## Key Patterns to Follow

### Adding a new backend endpoint
1. Add route in `app.py` following `/api/p<pid>/` naming
2. Use `fetch_and_cache_portfolio(pid)` to get rows
3. For combined view, also add `/api/pcombined/` variant if applicable
4. Return `jsonify({...})`

### Adding a new frontend widget (detail page)
1. Add HTML section in `templates/details.html`
2. Add fetch + render functions in `static/app.js`
3. Call from `loadPortfolio()` or on-demand
4. Style using existing CSS variables (avoid inline styles)

### Adding sector/ticker mappings
- Edit `sectors.py` — add to `SECTOR_MAP` dict at top

### Caching new API data
- Use `cache.kv_get(key, ttl)` / `cache.kv_set(key, value)` in `t212.py`
- Namespace per-portfolio keys as `{pid}:{key}`

---

## Environment Variables

```
TRADING212_API_KEY          # Portfolio 1
TRADING212_API_KEY_2        # Portfolio 2 (optional)
TRADING212_BASE_URL         # https://live.trading212.com/api/v0
PORT                        # default 8080
DB_PATH                     # SQLite path, default portfolio_cache.db (ignored when DATABASE_URL is set)
DATABASE_URL                # PostgreSQL DSN e.g. postgresql://user:pass@host:5432/db (optional; unset = SQLite)
CACHE_TTL_SECONDS           # portfolio rows, default 600
CACHE_TTL_INSTRUMENTS       # default 3600
CACHE_TTL_DIVIDENDS         # default 1800
CACHE_TTL_FX                # default 300
CACHE_TTL_ORDERS            # default 300
```

---

## Known Gaps / Planned Features

- **Gemini AI integration** — natural language portfolio Q&A, AI-generated insights
- **Sector map is manual** — needs auto-classification (could use Gemini)
- **No unit tests** — no test files exist
- **SQLite ephemeral on Cloud Run** — resets on redeploy; set `DATABASE_URL` to use persistent PostgreSQL instead
- **No auth layer** — assumes private deployment
- **No price charts** — yfinance removed; stock side panel shows only activity & dividends
- **Cache doesn't auto-purge** — stale rows accumulate in SQLite

---

## Development Notes

- Run locally: `python app.py` on port 8080, requires `.env`
- Docker: `docker build -t tracker . && docker run -p 8080:8080 --env-file .env tracker`
- No build step — vanilla JS, no bundler
- Theme toggle stored in `localStorage` key `theme`
- Combined portfolio ID is the string `"combined"` — handled specially in most endpoints

---

## Constraints

- Keep frontend in vanilla JS — no React/Vue/etc.
- Flask only — no FastAPI migration
- SQLite by default; PostgreSQL when `DATABASE_URL` is set — no Redis
- All monetary values in GBP (frontend assumes £)
- GBX (pence) prices are divided by 100 in `fx.py`
