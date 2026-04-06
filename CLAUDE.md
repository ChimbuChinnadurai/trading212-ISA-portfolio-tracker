# CLAUDE.md — Trading212 Portfolio Tracker

## Project Overview

Flask + Vanilla JS web app that fetches Trading212 ISA positions and displays them in an
interactive dashboard. Supports **2 named portfolios** simultaneously, plus an aggregated
**Combined** view. Data is enriched with FX conversion, sector classification, dividend history,
Yahoo Finance stock data, Finviz market data, TradingView signals, and AI-generated market digests.

> **Gemini AI is integrated** via `gemini_utils.py` (market digest, trade signals, chat).
> Claude and Finviz digest providers are also available via `/api/market-digest?provider=claude|finviz`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3, Flask |
| Data sources | Trading212 REST API v0, Yahoo Finance (direct HTTP), Finnhub, Finviz, TradingView, CNBC RSS |
| AI | Google Gemini (`gemini_utils.py`), Finviz AI digest (`ai_digest.py`) |
| Cache | SQLite (default) or PostgreSQL (via `DATABASE_URL`) with per-key TTLs |
| Frontend | Vanilla JS (ES2020+), no bundler, no frameworks |
| Styling | Plain CSS with CSS variables (dark/light/glass themes) |
| Deployment | Docker / Google Cloud Run |

---

## Architecture

```
Trading212 API (per portfolio API key)
    ↓
t212.py              — REST client, pagination, order normalisation
    ↓
cache.py             — SQLite/PostgreSQL KV store with TTL
    ↓
portfolio.py         — enrichment: FX conversion, sector, weight, YOC, div yield
sectors.py           — ticker→sector map + keyword fallback
fx.py                — GBP/USD rate, GBX→GBP, ISIN→country
    ↓
app.py               — 50+ Flask REST endpoints + Jinja page routes
finviz_data.py       — Finviz scraping (news, signals, insider, sector perf, stock details)
ai_digest.py         — Finviz AI digest wrapper
gemini_utils.py      — Gemini AI market summary, trade signals, chat
snowball_dividends.py — Dividend data fetcher
    ↓
home.js              — Home / Market / Watchlist / AI views
app.js               — Portfolio detail view
router.js            — Hash-based SPA router
currency.js          — Currency formatting helpers (shared)
    ↓
spa.html             — SPA shell (all views rendered client-side via hash routing)
style.css            — All styles, dark/light/glass theme, responsive
```

---

## File Map

| File | Purpose | Lines |
|------|---------|-------|
| `app.py` | Flask app, all API endpoints (~50), background refresh threads | ~2500 |
| `t212.py` | Trading212 API client, pagination, instrument cache | ~220 |
| `portfolio.py` | Builds enriched row dicts from raw T212 data | ~64 |
| `cache.py` | SQLite/Postgres KV store: `kv_get/set`, `rows_get/set`, `snapshot_get/add` | ~107 |
| `fx.py` | GBP/USD rate (Yahoo), GBX pence→GBP, ISIN→country | ~76 |
| `sectors.py` | Hardcoded ticker→sector map + keyword fallback | ~76 |
| `finviz_data.py` | Finviz scraper: news, signals, insider, sector performance, stock details, market digest | ~varies |
| `ai_digest.py` | Multi-provider market digest (Finviz/Claude/Gemini) | ~varies |
| `gemini_utils.py` | Gemini AI: market summary, trade signals, portfolio chat | ~varies |
| `snowball_dividends.py` | Dividend data fetch + background refresh | ~varies |
| `static/app.js` | Detail view: portfolio table, allocation bars, price charts, side panel, CSV export | ~2400 |
| `static/home.js` | Home / Market / Watchlist / AI views: heatmap, sparklines, F&G, drawdown, signals, watchlist | ~4200 |
| `static/router.js` | Hash-based SPA router: view lifecycle, timers, back button, header updates | ~530 |
| `static/currency.js` | `setCurrency()`, GBP↔USD display conversion | small |
| `static/style.css` | Dark/light/glass CSS vars, all component styles, responsive breakpoints | ~8100 |
| `templates/spa.html` | SPA shell — all views rendered client-side via hash routing (Jinja: `names`, `show_ai`) | ~1350 |

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
| `GET /api/overview` | Combined overview: portfolio values, returns, positions |
| `GET /api/home-data` | Single call: overview + activity + performers + indicators + fx |
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
| `GET /api/p<pid>/history` | Portfolio value snapshots (sparkline data) |
| `GET /api/p<pid>/monthly-returns` | Monthly return % per month (last 12 months) |
| `GET /api/p<pid>/monthly-performance` | Per-ticker monthly returns heatmap (last 12 months) |
| `GET /api/p<pid>/stock-activity/<ticker>` | Buy/sell history for a specific ticker |
| `GET /api/pcombined/daily-history` | Daily portfolio value vs S&P 500 for charts |
| `GET /api/pcombined/risk-metrics` | TWR, Beta, Sharpe, Sortino, Volatility, weighted P/E |
| `GET /api/stock-tickers` | Real-time prices + % change for all held tickers (Yahoo Finance) |
| `GET /api/stock-sparklines` | 48h sparkline data per ticker (Yahoo Finance) |
| `GET /api/stock-metrics/<ticker>` | Fundamentals via Finnhub (P/E, market cap, 52w range, beta) |
| `GET /api/stock-news/<ticker>` | Company-specific news via Finnhub |
| `GET /api/market-indicators` | Fear & Greed index history, S&P 500 + VIX sparklines |
| `GET /api/market-status` | NASDAQ + LSE open/close status with schedule |
| `GET /api/earnings` | Upcoming earnings dates for held tickers |
| `GET /api/upcoming-dividends` | Upcoming ex-div + pay dates for held tickers |
| `GET /api/analyst-ratings` | Analyst buy/hold/sell consensus per held ticker (TradingView) |
| `GET /api/fx-rate` | Current GBP/USD rate |
| `GET /api/news` | General market news (CNBC RSS) |
| `GET /api/trade-signals` | AI trade signals for held tickers (TradingView TA + AI) |
| `POST /api/trade-signals/exclude` | Toggle ticker exclusion from trade signals |
| `GET /api/trade-signals/excluded` | List of excluded tickers |
| `GET /api/watchlist/tickers` | Get persisted watchlist ticker list |
| `POST /api/watchlist/tickers` | Save watchlist ticker list |
| `GET /api/watchlist/price` | Live price + company name for any ticker |
| `GET /api/watchlist/signals` | TradingView targets + signal for any ticker |
| `GET /api/watchlist/fundamentals` | Mkt cap, revenue, P/S, P/E, Forward P/E, 5yr avg P/E |
| `GET /api/finviz/news` | Market news from Finviz |
| `GET /api/finviz/insider` | Insider trading activity (Finviz) |
| `GET /api/finviz/signals` | Market signals: gainers, losers, unusual volume (Finviz) |
| `GET /api/finviz/stock/<ticker>` | Full stock detail: fundamentals, signals, analyst, insider |
| `GET /api/market/sector-performance` | S&P 500 sector performance bars (Finviz) |
| `GET /api/market-digest` | Daily market digest (`?provider=finviz\|claude\|gemini`) |
| `GET /api/ai/market-digest` | Gemini-generated market digest |
| `GET /api/ai/trade-signals` | Gemini-generated trade signals from portfolio data |
| `POST /api/ai/chat` | Interactive Gemini chat with portfolio context |
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
| `loadMarketNews()` | Fetches `/api/news`, renders news items into the standalone `#view-news` page |
| `loadDividendCalendar()` | Fetches upcoming dividends, caches to localStorage (12h TTL) |
| `loadEarnings()` | Fetches `/api/earnings`, renders upcoming earnings cards |
| `loadActivity()` | Fetches `/api/pcombined/activity`, renders recent trades |
| `_initClock(el)` | Builds SVG countdown ring and starts setInterval |
| `initRefreshClocks()` | Initialises all `.refresh-clock` elements on DOMContentLoaded |
| `resetClock(id)` | Resets a specific clock to full after data refresh |
| `loadMarketStatus()` | Fetches `/api/market-status`, renders NASDAQ/LSE pills with tooltips |
| `loadPortfolioVsMarket()` | Fetches `/api/pcombined/daily-history`, draws Portfolio vs S&P chart + drawdown chart |
| `_drawPortfolioVsChart()` | Canvas chart: combined portfolio value vs S&P 500 (indexed, range-filterable) |
| `_calcDrawdown(data)` | Computes running-peak drawdown series from `[{date, value}]` array |
| `_drawDrawdownChart()` | Canvas drawdown chart: red fill below 0, Y-axis %, hover crosshair + tooltip |
| `_initDrawdownRangeTabs()` | Attaches click + hover listeners to `#ddRangeTabs` and `#drawdownChart` |
| `_renderPortfolioGain()` | Updates 1M/6M/12M/YTD/Total return cells from cached daily-history |

### Market View (`spa.html` + `home.js`)

**Route:** `#market` — loaded via `_initMarketView()` → `loadMarketView()`

**Layout:** `.market-body` — CSS grid `1fr 1fr 280px`, 2 explicit rows + overflow row

| Cell | Widget | Data source |
|------|--------|-------------|
| Row 1, Col 1 | Portfolio vs S&P 500 chart (`#pvsChart`) | `/api/pcombined/daily-history` + `/api/market-indicators` |
| Row 1, Col 2 | Sector Performance bars (`#sectorBarsList`) | `/api/finviz/sp500-heatmap` |
| Row 1, Col 3 | Market Signals (`#signalsList`) | `/api/finviz/signals?type=…` |
| Row 2, Col 1–2 | Portfolio Gain stats (`#pvsGain*`) | Same daily-history data, no extra fetch |
| Row 2, Col 3 | **Drawdown Analysis** (`#drawdownChart`) | Same daily-history data, no extra fetch |
| Row 3, Col 3 | Insider Trading (`#insiderList`) | `/api/finviz/insider?period=…` |

**Drawdown Analysis widget:**
- Range tabs: 1M / 3M / 6M / **1Y** (default) / ALL — state in `_ddActiveRange`
- Chart: canvas filled-area red chart; Y-axis 0% → min drawdown (5% grid steps); X-axis month labels
- Stat bar: **Max DD** | **Current** | **Days in DD**
- Hover: crosshair line + dot + tooltip showing date, drawdown %, portfolio value
- Data: reuses `_portfolioVsData` cached by `loadPortfolioVsMarket()` — no extra API call

**Portfolio vs S&P 500 chart:**
- Range tabs: 1M / 3M / 6M / **1Y** (default) / ALL
- Chart types: line or bar (toggle button)
- Legend toggles: S&P 500 and Portfolio series independently hideable
- Both series normalised to 100 at range start (indexed % gain)

---

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
.dashboard-news       — Right column: Market News panel (home view sidebar)
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

/* Market View */
.market-body          — CSS grid: 1fr 1fr 280px, 2 rows, gap 12px
.market-chart-card    — Portfolio vs S&P chart card, height 400px
.pvs-gain-widget      — Portfolio gain stats card (row 2, cols 1–2)
.drawdown-widget      — Drawdown Analysis widget (row 2, col 3)
.drawdown-chart-wrap  — flex:1 canvas container, position:relative
.drawdown-stat-bar    — Stats footer: Max DD | Current | Days in DD
.drawdown-stat-item   — Individual stat (label + value stacked)
.drawdown-stat-val    — Value text; .pos → green, .neg → red
.drawdown-stat-sep    — 1px vertical divider between stats
.widget-signals       — Market Signals panel (row 1, col 3), height 400px
.widget-insider       — Insider Trading panel, height 400px
.mkt-range-tabs       — Range tab row (.mkt-range-tab buttons, .active state)
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
TRADING212_API_KEY_1        # Portfolio 1 API key
TRADING212_API_KEY_2        # Portfolio 2 API key (optional)
PORTFOLIO_NAME_1            # Display name for portfolio 1 (default "Portfolio 1")
PORTFOLIO_NAME_2            # Display name for portfolio 2 (default "Portfolio 2")
TRADING212_BASE_URL         # https://live.trading212.com/api/v0
FINNHUB_TOKEN               # Finnhub API key (stock metrics endpoint)
GEMINI_API_KEY              # Google Gemini API key (also accepts GOOGLE_API_KEY)
SHOW_AI_FEATURES            # Set to "1" to enable AI tab in UI (default "0")
PORT                        # default 8080
DB_PATH                     # SQLite path (default portfolio_cache.db)
DATABASE_URL                # PostgreSQL DSN — if set, overrides SQLite
CACHE_TTL_SECONDS           # Portfolio rows TTL (default 600s)
CACHE_TTL_INSTRUMENTS       # Instrument metadata TTL (default 3600s)
CACHE_TTL_DIVIDENDS         # Dividend data TTL (default 1800s)
CACHE_TTL_FX                # FX rate TTL (default 300s)
CACHE_TTL_ORDERS            # Order history TTL (default 300s)
AUTO_REFRESH_SECONDS        # Background portfolio refresh interval (default 300s)
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
| Watchlist fundamentals | `kv_get/set` | `TTL_EARNINGS` (24h) | `wl:fundamentals2:{ticker}:{country}` |
| Trade signals | `kv_get/set` | 12h | `trade_signals:v2` |
| AI digest | `kv_get/set` | 5 min | `ai_digest:{provider}` |
| Risk metrics | `kv_get/set` | 1h | `risk_metrics` |
| Monthly performance | `kv_get/set` | 15 min | `monthly_perf:{pid}` |

---

## Background Threads

| Thread | Purpose | Interval |
|--------|---------|---------|
| `portfolio-refresh` | Force-refresh portfolio rows cache | `AUTO_REFRESH_SECONDS` (5 min) |
| `div-refresh` | Refresh dividend data via Snowball Analytics | `DIV_REFRESH_INTERVAL` (6h) |
| `market-refresh` | Pre-warm market indicators cache | 25 min |
| `news-refresh` | Pre-warm CNBC news cache | 5 min |

---

## Development Notes

- **Run locally:** `python app.py` on port 8080, requires `.env` with API keys
- **Docker:** `docker build -t tracker . && docker run -p 8080:8080 --env-file .env tracker`
- **No build step** — vanilla JS, no npm, no bundler
- **Combined portfolio** uses pid string `"combined"` — handled specially in most endpoints
- **Currency display:** Toggle GBP↔USD stored in `localStorage` key `currency`; all monetary values stored in GBP, converted client-side via `currency.js`
- **GBX stocks** (UK pence): price divided by 100 in `fx.py` → stored as GBP; currency symbol shown as `p` in heatmap
- **Market status pills** (header): NASDAQ + LSE open/close with session schedule, updates every 60s
- **Fear & Greed gauge:** Drawn on `<canvas id="fg-gauge">` (130×70px), semi-circle arc
- **Yahoo Finance auth:** Uses crumb + cookie from `/v1/test/getcrumb`, cached 1h in `yf:crumb:v3`
- **Watchlist persistence:** Ticker list stored in cache DB via `kv_get/set("watchlist_tickers")`
- **5yr avg P/E:** Computed in `watchlist_fundamentals` from `incomeStatementHistory` + 5y monthly price history; typically 3–4 years of data available
- **AI features gate:** `SHOW_AI_FEATURES=1` env var controls visibility of AI tab in the SPA

---

## Known Gaps / Planned Features

- **No unit tests** — no test files exist
- **Sector map is manual** — `sectors.py` needs auto-classification for new tickers
- **SQLite ephemeral on Cloud Run** — resets on redeploy; set `DATABASE_URL` for persistent PostgreSQL
- **No auth layer** — assumes private/internal deployment
- **Cache doesn't auto-purge** — stale rows accumulate in SQLite over time
- **Benchmark comparison vs FTSE100** — Portfolio vs S&P 500 is implemented; FTSE100 overlay not yet added
- **Tax year summary** — UK Apr–Apr capital gains + dividend income report (planned)
- **Export to CSV/PDF** — detail page has CSV export; no PDF yet
- **Drawdown chart theme redraw** — does not auto-redraw on theme toggle; redraws on next range-tab click or view re-entry

---

## Constraints (do not change these)

- **Vanilla JS only** — no React, Vue, Angular, or any JS framework
- **Flask only** — no FastAPI or other Python web frameworks
- **SQLite by default** — PostgreSQL only when `DATABASE_URL` is set; no Redis
- **All monetary values stored in GBP** — frontend converts display currency via `currency.js`
- **No price chart library** — Canvas drawn manually in JS
- **Desktop = fixed single-page** — no scroll on desktop (`fixed-layout` class); scroll only on mobile (≤768px)
