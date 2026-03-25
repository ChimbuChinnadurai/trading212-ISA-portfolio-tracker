# CLAUDE.md — Trading212 Portfolio Tracker

## Project Overview

Flask + Vanilla JS web app that fetches Trading212 ISA positions and displays them in an
interactive dashboard. Supports **2 named portfolios** simultaneously, plus an aggregated
**Combined** view. Data is enriched with FX conversion, sector classification, dividend history,
Yahoo Finance stock data, and market indicators.

> **No Gemini AI integration exists yet** — the repo name is aspirational/planned.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3, Flask |
| Data sources | Trading212 REST API v0, Yahoo Finance (yfinance), CNBC/CNN Fear & Greed |
| Cache | SQLite (default) or PostgreSQL (via `DATABASE_URL`) with per-key TTLs |
| Frontend | Vanilla JS (ES2020+), no bundler, no frameworks |
| Styling | Plain CSS with CSS variables (dark/light themes) |
| Deployment | Docker / Google Cloud Run |

---

## Architecture

```
Trading212 API (per portfolio API key)
    ↓
t212.py          — REST client, pagination, order normalisation
    ↓
cache.py         — SQLite/PostgreSQL KV store with TTL
    ↓
portfolio.py     — enrichment: FX conversion, sector, weight, YOC, div yield
    ↓
app.py           — 30 Flask REST endpoints + Jinja page routes
    ↓
home.js          — Home/overview view JS
app.js           — Portfolio detail view JS
router.js        — Hash-based SPA router
currency.js      — Currency formatting helpers (shared)
    ↓
spa.html         — SPA shell (all views rendered client-side via hash routing)
style.css        — All styles, dark/light theme, responsive
```

---

## File Map

| File | Purpose | Lines |
|------|---------|-------|
| `app.py` | Flask app, all API endpoints, background refresh threads | 1565 |
| `t212.py` | Trading212 API client, pagination, instrument cache | ~220 |
| `portfolio.py` | Builds enriched row dicts from raw T212 data | ~64 |
| `cache.py` | SQLite/Postgres KV store: `kv_get/set`, `rows_get/set`, `snapshot_get/add` | ~107 |
| `fx.py` | GBP/USD rate (Yahoo), GBX pence→GBP, ISIN→country | ~76 |
| `sectors.py` | Hardcoded ticker→sector map + keyword fallback | ~76 |
| `static/app.js` | Detail view: portfolio table, allocation bars, price charts, side panel, CSV export | ~1600 |
| `static/home.js` | Home view: overview cards, heatmap, sparklines, fear & greed, news, earnings, dividends | ~1550 |
| `static/router.js` | Hash-based SPA router: view lifecycle, timers, back button, header updates | ~225 |
| `static/currency.js` | `setCurrency()`, `formatValue()`, GBP↔USD display conversion | small |
| `static/style.css` | Dark/light CSS vars, all component styles, responsive breakpoints | ~4750 |
| `templates/spa.html` | SPA shell — all views rendered client-side via hash routing (Jinja: `names`) | ~870 |

---

## Pages & Routes

### Page Routes (Jinja templates)

| Route | Template | Jinja vars |
|-------|----------|-----------|
| `GET /` | `spa.html` | `names` dict `{"1": "Chimbu", "2": "Poornima"}` |
| `GET /portfolio/<pid>` | — | Redirects to `/#portfolio/<pid>` (backward compat) |

### API Endpoints (all return JSON)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/overview` | Combined overview: portfolio values, 24h change, total returns, PAI |
| `GET /api/home-data` | All landing-page data in one call: overview + activity + performers + dividends |
| `GET /api/p<pid>/portfolio` | Full enriched position rows for one portfolio |
| `GET /api/pcombined/portfolio` | Merged rows across both portfolios |
| `GET /api/p<pid>/activity` | Trade/order history for one portfolio |
| `GET /api/pcombined/activity` | Combined activity across both portfolios |
| `GET /api/pcombined/top-performers` | Top 5 gainers by total return % |
| `GET /api/p<pid>/recent-dividends` | Last N dividends for one portfolio |
| `GET /api/pcombined/recent-dividends` | Combined recent dividends |
| `GET /api/p<pid>/dividend-monthly` | Monthly dividend totals (bar chart data) |
| `GET /api/pcombined/dividend-monthly` | Combined monthly dividend totals |
| `GET /api/p<pid>/pai-details` | Projected Annual Income breakdown per stock |
| `GET /api/p<pid>/diversification-details` | Sector/country/currency allocation detail |
| `GET /api/p<pid>/history` | Portfolio value snapshots over time (sparkline data) |
| `GET /api/p<pid>/stock-activity/<ticker>` | Buy/sell history for a specific ticker |
| `GET /api/stock-tickers` | Real-time prices + % change for all held tickers (Yahoo Finance) |
| `GET /api/stock-sparklines` | 5-day OHLC sparkline data per ticker (Yahoo Finance) |
| `GET /api/stock-metrics/<ticker>` | P/E, market cap, 52-week range, beta (Yahoo Finance) |
| `GET /api/stock-news/<ticker>` | Company-specific news (Yahoo Finance) |
| `GET /api/market-indicators` | Fear & Greed index history, S&P 500 + VIX sparklines |
| `GET /api/market-status` | NASDAQ + LSE open/close status with schedule |
| `GET /api/earnings` | Upcoming earnings dates for held tickers |
| `GET /api/upcoming-dividends` | Upcoming ex-div + pay dates for held tickers |
| `GET /api/analyst-ratings` | Analyst buy/hold/sell consensus per held ticker |
| `GET /api/fx-rate` | Current GBP/USD rate |
| `GET /api/news` | General market news (CNBC RSS) |
| `GET /health` | Health check `{"status": "ok"}` |
| `POST /api/admin/clear-cache` | Wipes all cache entries |

---

## Data Model — Enriched Portfolio Row

```python
{
    "ticker": str,          # "GOOGL", "LLOY"
    "company_name": str,
    "country": str,         # "UK", "US", "DE" — from ISIN prefix in fx.py
    "quantity": float,
    "avg_price": float,     # GBP (GBX already converted ÷100)
    "invested": float,      # GBP total cost basis
    "current_value": float, # GBP current market value
    "total_returns": float, # GBP absolute P&L
    "returns_pct": float,   # % P&L
    "fx_impact": float | None,
    "dividends": float,     # GBP total received lifetime
    "sector": str,          # GICS label or "Index Funds" — from sectors.py
    "currency_code": str,   # Original trade currency "GBP"/"USD"/"GBX"
    "weight": float,        # % of total portfolio value
    "div_yield": float,     # dividends / current_value %
    "yoc": float,           # dividends / invested % (yield-on-cost)
    "pid": str,             # "1" or "2" — added in combined views
    # Added by /api/stock-tickers (Yahoo Finance):
    "price": float,         # current live price
    "change_pct": float,    # today's % change
    "currency": str,        # Yahoo currency code e.g. "GBp", "USD"
}
```

---

## Frontend Architecture

### Home View (`spa.html` + `home.js`)

**Layout:**
- `fixed-layout` class on `.app` → full-viewport, no scroll on **desktop only**
- On **mobile (≤768px)**: `fixed-layout` constraints are overridden via media query, page scrolls
- `.landing-page` is a CSS grid: `1fr 300px` (main content + Market News sidebar)
- `.dashboard-body` wraps overview + widgets (left column)
- `.dashboard-news` is the right sidebar (Market News, full height)

**Overview grid (`.overview-grid`, `repeat(3, 1fr)`):**
- Card: Chimbu portfolio (`#ov1`)
- Card: Poornima portfolio (`#ov2`)
- Card: Combined (`#ov3`)
- Card: Portfolio Heatmap (`ov-card-heatmap`, `grid-column: span 2`)
- Card: Fear & Greed Index (`ov-card-fg`)

**Bottom widgets (`.home-widgets`, `repeat(4, 1fr)`):**
1. Unified Recent Activity
2. Top Performers
3. Dividend Calendar (cached 12h, localStorage)
4. Upcoming Earnings

**Right sidebar:**
- Market News (CNBC RSS, 5m auto-refresh)

**Refresh Countdown Clocks:**
- SVG ring indicators (20×20 viewBox, r=8) on heatmap (60s/cyan), Fear & Greed (60s/purple), news (5m/amber)
- `_initClock(el)` → `setInterval` tick; `resetClock(id)` called after each successful fetch
- Numbers shown inside SVG using `dy="0.35em"` (cross-browser vertical centering)

**Key functions in `home.js`:**

| Function | Purpose |
|----------|---------|
| `loadHomeData(refresh)` | Fetches `/api/home-data`, updates overview cards + activity + performers |
| `loadHomeWidgets()` | Kicks off dividend calendar, earnings, news, market status in parallel |
| `renderOverview(data)` | Updates all 3 portfolio cards with values/sparklines |
| `loadStockTicker()` | Fetches `/api/stock-tickers`, renders heatmap, resets clock |
| `_renderHeatmap(items)` | CSS grid of equal 88×72px cells, sorted by **absolute % change** (biggest movers first) |
| `_heatColor(pct)` | Returns bg colour: green gradient (gains) or red gradient (losses) |
| `loadSparklines()` | 90-day portfolio value sparklines on overview cards with hover tooltip |
| `loadFearGreed()` | Fetches `/api/market-indicators`, draws gauge canvas + history rows |
| `loadMarketNews()` | Fetches `/api/news`, renders news items, resets 5m clock |
| `loadDividendCalendar()` | Fetches upcoming dividends, caches to localStorage (12h TTL) |
| `loadEarnings()` | Fetches `/api/earnings`, renders upcoming earnings cards |
| `loadActivity()` | Fetches `/api/pcombined/activity`, renders recent trades |
| `_initClock(el)` | Builds SVG countdown ring and starts setInterval |
| `initRefreshClocks()` | Initialises all `.refresh-clock` elements on DOMContentLoaded |
| `resetClock(id)` | Resets a specific clock to full after data refresh |
| `loadMarketStatus()` | Fetches `/api/market-status`, renders NASDAQ/LSE pills with tooltips |

### Detail View (`spa.html` + `app.js`)

**Active pid:** Set dynamically by `router.js` via `window.PORTFOLIO_ID` — "1", "2", or "combined"

**Key functions in `app.js`:**

| Function | Purpose |
|----------|---------|
| `loadPortfolio(force)` | Main entry: fetches `/api/p<pid>/portfolio`, drives entire page |
| `renderSummary(rows, ...)` | Updates 3 summary cards (value, P&L, PAI) |
| `renderTable(rows)` | Renders sortable/filterable positions table with allocation bars |
| `renderAllocBar(rows, total)` | Sector allocation progress bars |
| `renderCurrencyBar(rows, total)` | Currency exposure bars |
| `renderSectorBar(rows, total)` | Sector breakdown bars |
| `renderCountryFilters(rows)` | Country filter buttons (UK/US/DE/etc.) |
| `loadMonthlyDividends()` | Monthly dividend bar chart |
| `loadAnalystRatings()` | Analyst consensus per held ticker |
| `loadActivity()` | Trade history list |
| `loadUpcomingDividends()` | Upcoming dividend table |
| `_loadStockSparklines(rows)` | 48h sparklines per position in table |
| `sortTable(th)` | Column sort (clicked header) |
| `filterTable()` / `filterRows()` | Search + country filter |
| `exportCSV()` | Downloads current rows as CSV |
| `openPaiDetails()` | Opens PAI detail side panel |
| `openDiversificationDetails()` | Opens diversification detail side panel |

**Stock Side Panel** (slides in from right):
- Opens on table row click → `openStockPanel(ticker, pid)`
- Shows: key metrics, price chart (48h), activity history, company news, analyst ratings

---

## CSS Architecture (`style.css`, 4770 lines)

### CSS Variables (defined on `:root`, overridden in `html[data-theme="light"]`)

```css
--bg, --bg-card, --bg-row-alt, --bg-hover
--border, --border-bright
--accent (#3b82f6)
--text-primary, --text-secondary, --text-muted
--green (#10b981), --red (#ef4444)
--radius (12px)
```

### Theme
- Default: **dark** (`data-theme="dark"` on `<html>`)
- Toggle via `toggleTheme()` — persisted in `localStorage` key `theme`
- Glass mode: `data-glass="true"` on `<html>` (togglable, persisted)

### Responsive Breakpoints

| Breakpoint | Layout change |
|-----------|--------------|
| ≤1300px | Landing page sidebar narrows: `1fr 260px` |
| ≤1100px | Sidebar hidden, landing page single column, overview 2-col, widgets 2-col |
| ≤900px | Heatmap card: `span 2` → `span 1` |
| ≤768px | **Mobile**: viewport-lock removed, all columns → 1, news restored below widgets, page scrollable |
| ≤640px | Header wraps, market pills hidden, brand title shrinks |
| ≤400px | Brand subtitle hidden, buttons/padding reduced |

### Key CSS Classes

```
.app.fixed-layout     — Desktop-only: height:100vh, overflow:hidden (undone at ≤768px)
.landing-page         — CSS grid: 1fr 300px (main + sidebar)
.dashboard-body       — Left column: summary-row + home-widgets
.dashboard-news       — Right column: Market News panel
.overview-grid        — repeat(3, 1fr), gap 14px
.home-widgets         — repeat(4, 1fr), gap 14px
.ov-card              — Portfolio overview card (padding 8px 12px)
.ov-card-heatmap      — Spans 2 columns, min-height 190px
.ov-card-fg           — Fear & Greed card
.widget-panel         — Bottom widget container (height: 340px desktop, 300px mobile)
.heatmap-container    — CSS grid: repeat(auto-fill, minmax(88px, 1fr))
.hm-cell              — 72px tall heatmap tile
.refresh-clock        — SVG countdown ring wrapper
.rc-svg / .rc-arc / .rc-track / .rc-text — SVG clock parts
.side-panel           — Slides in from right (stock detail, PAI, diversification, F&G)
```

---

## Portfolio Heatmap

- **Location:** `overview-grid`, after Combined card, spans 2 columns
- **Data source:** `/api/stock-tickers` (Yahoo Finance real-time prices)
- **Sort order:** Absolute `|change_pct|` descending — biggest movers first, up or down mixed
- **Cell layout:** Equal 88×72px tiles via CSS `auto-fill` grid (no treemap weighting)
- **Content per cell:** Ticker, price with currency symbol, ▲/▼ with % change
- **Colour:** Dynamic background from `_heatColor(pct)` — green gradient (gains), red gradient (losses)
- **Currency symbols:** `{ USD:'$', GBP:'£', GBp:'p', GBX:'p', EUR:'€', CAD:'CA$', AUD:'A$', JPY:'¥', CHF:'Fr' }`
- **Auto-refresh:** Every 60s via `setInterval(loadStockTicker, 60000)`, countdown clock `rc-heatmap`

---

## Environment Variables

```
TRADING212_API_KEY_1        # Portfolio 1 API key
TRADING212_API_KEY_2        # Portfolio 2 API key (optional)
PORTFOLIO_NAME_1            # Display name for portfolio 1 (default "Portfolio 1")
PORTFOLIO_NAME_2            # Display name for portfolio 2 (default "Portfolio 2")
TRADING212_BASE_URL         # https://live.trading212.com/api/v0
PORT                        # default 8080
DB_PATH                     # SQLite path (default portfolio_cache.db)
DATABASE_URL                # PostgreSQL DSN — if set, overrides SQLite
CACHE_TTL_SECONDS           # Portfolio rows TTL (default 600s)
CACHE_TTL_INSTRUMENTS       # Instrument metadata TTL (default 3600s)
CACHE_TTL_DIVIDENDS         # Dividend data TTL (default 1800s)
CACHE_TTL_FX                # FX rate TTL (default 300s)
CACHE_TTL_ORDERS            # Order history TTL (default 300s)
```

---

## Caching Strategy

| Data type | Backend | TTL | Key pattern |
|-----------|---------|-----|-------------|
| Portfolio rows | `rows_get/set` | `CACHE_TTL_SECONDS` (600s) | per `pid` |
| KV values (dividends, PAI) | `kv_get/set` | `TTL_DIV` | `{pid}:{key}` |
| News | `kv_get/set` | `TTL_NEWS` | `news` |
| Portfolio snapshots (sparklines) | `snapshot_get/add` | permanent | `{pid}` |
| Dividend calendar | `localStorage` | 12h (client-side) | `divCal_data` + `divCal_ts` |

---

## Development Notes

- **Run locally:** `python app.py` on port 8080, requires `.env` with API keys
- **Docker:** `docker build -t tracker . && docker run -p 8080:8080 --env-file .env tracker`
- **No build step** — vanilla JS, no npm, no bundler
- **Combined portfolio** uses pid string `"combined"` — handled specially in most endpoints
- **Currency display:** Toggle GBP↔USD stored in `localStorage` key `currency`; all monetary values are stored in GBP, converted client-side via `currency.js`
- **GBX stocks** (UK pence): price divided by 100 in `fx.py` → stored as GBP; currency symbol shown as `p` in heatmap
- **Background threads:** `_background_refresh()` pre-warms portfolio cache; `_background_dividend_refresh()` refreshes dividend data
- **Market status pills** (header): NASDAQ + LSE open/close with session schedule, updates every 60s
- **Fear & Greed gauge:** Drawn on `<canvas id="fg-gauge">` (130×70px), semi-circle arc

---

## Known Gaps / Planned Features

- **Gemini AI integration** — natural language portfolio Q&A, AI-generated insights
- **No unit tests** — no test files exist
- **Sector map is manual** — `sectors.py` needs auto-classification
- **SQLite ephemeral on Cloud Run** — resets on redeploy; set `DATABASE_URL` for persistent PostgreSQL
- **No auth layer** — assumes private/internal deployment
- **Cache doesn't auto-purge** — stale rows accumulate in SQLite over time
- **Allocation chart** — pie/donut for sector breakdown (planned)
- **Benchmark comparison** — portfolio vs FTSE100/S&P500 overlay (planned)
- **Tax year summary** — UK Apr–Apr capital gains + dividend income report (planned)
- **Export to CSV/PDF** — detail page has CSV export; no PDF yet
- **Mobile: Market News sidebar** — appears below widgets on mobile (≤768px); not a sidebar

---

## Constraints (do not change these)

- **Vanilla JS only** — no React, Vue, Angular, or any JS framework
- **Flask only** — no FastAPI or other Python web frameworks
- **SQLite by default** — PostgreSQL only when `DATABASE_URL` is set; no Redis
- **All monetary values stored in GBP** — frontend converts display currency via `currency.js`
- **No price chart library** — Canvas drawn manually in JS
- **Desktop = fixed single-page** — no scroll on desktop (`fixed-layout` class); scroll only on mobile (≤768px)
