# Portfolio Tracker — Build Requirements

A complete specification for rebuilding this multi-portfolio Trading 212 tracker from scratch. Use this document as a blueprint: every feature, data flow, endpoint, and rule needed for a working app is listed here. The UI design is yours to choose; the **data, business rules, and feature scope must match exactly**.

---

## 1. Product Overview

A **personal, desktop-first** financial dashboard that fetches positions from the **Trading 212 API** for **up to two named portfolios** plus an aggregated **Combined** view, and enriches them with data from Yahoo Finance, Finnhub, Finviz, Snowball Analytics, TradingView, Savvy Trader, Gemini AI, and YouTube.

**Primary user**: a single power user managing personal Trading 212 ISA positions. Not a multi-tenant SaaS — no user accounts, no auth layer for end users.

**Target deployment**: local dev + Google Cloud Run (Docker), with optional PostgreSQL for persistence.

---

## 2. Tech Stack (Hard Constraints)

These constraints exist because they are load-bearing in production; alternatives must be justified.

| Layer | Choice | Why |
|---|---|---|
| Backend | **Python 3.12 + Flask 3** | Single-process simplicity; no FastAPI |
| Frontend | **Vanilla JS + HTML + CSS** | No React/Vue/Angular |
| Charts | **HTML5 `<canvas>` only** | Hand-drawn; no Chart.js, no D3 |
| DB | **SQLite by default; PostgreSQL via `DATABASE_URL`** | No Redis, no other stores |
| WSGI | **Gunicorn — 1 worker, 8 threads** | Keeps a single background-refresh daemon alive |
| Layout | **Desktop fixed-viewport (no scroll); mobile (≤768px) scrolls** | Information-dense, no infinite scroll |
| Money | All monetary values stored & served in **GBP** | USD is a display-only client conversion |
| Routing | **Hash-based SPA router (`#home`, `#portfolio/1` …)** | Single HTML shell, dynamic view switching |

---

## 3. Configuration & Environment

### 3.1 Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TRADING212_API_KEY_1` | — | T212 API key for portfolio 1 (required for any data) |
| `TRADING212_API_KEY_2` | — | T212 API key for portfolio 2 (optional) |
| `PORTFOLIO_NAME_1` | `Portfolio 1` | Display name for portfolio 1 |
| `PORTFOLIO_NAME_2` | `Portfolio 2` | Display name for portfolio 2 |
| `TRADING212_BASE_URL` | `https://live.trading212.com` | T212 API base |
| `FINNHUB_TOKEN` | — | Finnhub key (earnings, fundamentals, news) |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | — | Gemini key (AI features, YouTube analysis) |
| `YOUTUBE_API_KEY` | — | YouTube Data API v3 key |
| `SHOW_AI_FEATURES` | `0` | Set to `1` to enable the AI Intelligence view |
| `PORT` | `8080` | HTTP port |
| `DB_PATH` | `portfolio_cache.db` | SQLite path |
| `DATABASE_URL` | — | Postgres DSN (overrides SQLite when set) |
| `CACHE_TTL_SECONDS` | `600` | Portfolio rows cache TTL |
| `CACHE_TTL_INSTRUMENTS` | `3600` | Instrument metadata TTL |
| `CACHE_TTL_DIVIDENDS` | `1800` | Dividend history TTL |
| `CACHE_TTL_FX` | `300` | FX rate TTL |
| `CACHE_TTL_ORDERS` | `300` | Recent orders TTL |
| `AUTO_REFRESH_SECONDS` | `300` | Background portfolio refresh interval |
| `DIV_REFRESH_SECONDS` | `21600` | Snowball dividend calendar refresh (6 h) |

### 3.2 Config loader behaviour

Search order, first match wins:
1. `/tmp/config.json` (Cloud Run Secret Manager volume mount, JSON file)
2. `<repo>/.env` (local dev, also JSON format — not key=value)

Keys already present in the OS environment must **NOT be overwritten** (real env vars always win).

---

## 4. Data Sources

| Source | Used for | Notes |
|---|---|---|
| **Trading 212 API** | Positions, instruments, dividends paid, orders, account summary, exchange schedules | `Authorization: Basic <key>` header |
| **Yahoo Finance** (`query1/query2.finance.yahoo.com`) | Live quotes, OHLCV candles, sparklines, fundamentals (summary), GBP/USD rate, S&P 500 / NASDAQ / VIX, sector ETFs | Requires "crumb" + cookies (auth dance) for v10 quoteSummary; v8 chart endpoint is open |
| **Finnhub** (`finnhub.io`) | Market news, stock metrics, company news | Token-based |
| **Finviz** (via `finvizfinance` lib) | Market news/blogs, AI daily digest (scraped from homepage JSON-in-`<script>`) | No key |
| **Snowball Analytics** (`snowball-analytics.com`) | Upcoming dividend calendar (US + UK) | Public API, polite 10 s delay between calls |
| **TradingView** (HTML scrape) | Analyst price targets + consensus recommendation (StrongBuy/Buy/Hold/Sell/StrongSell) | Multiple exchange URLs by country; regex-based extraction |
| **Savvy Trader** (`api.savvytrader.com`) | Upcoming + historical earnings per ticker | No key |
| **CNN Fear & Greed** | Daily F&G index gauge + 30-day history | Public JSON (`production.dataviz.cnn.io`); see home.js |
| **Gemini AI** (`google-genai` SDK) | Market digest, trade signals, chat, YouTube video analysis, Trump-post sentiment | Default model `gemini-2.5-flash` |
| **YouTube Data API v3** | Channel uploads playlist + video metadata | Filter out videos ≤121 s (Shorts) |
| **trumpstruth.org RSS** | Donald Trump's Truth Social posts | Try 4 candidate feed URLs; parse XML |

---

## 5. Database Schema

Both SQLite and PostgreSQL must be supported via a shim that translates `?` placeholders to `%s` and exposes dict-like rows. All connections close on context-manager exit (commit on success, rollback on exception).

### Tables

```
portfolio_cache      (id, data TEXT, fetched_at REAL)
                     — legacy/unused for current code, kept for compatibility

kv_cache             (key TEXT PRIMARY KEY, data TEXT, fetched_at REAL)
                     — the generic key/value store; >90% of cache lives here

portfolio_history    (id, fetched_at, value, invested, dividends)
                     — legacy; not actively written by current code

portfolio_snapshots  (id, pid TEXT, ts REAL, value REAL)
                     — appended on every background refresh; powers sparklines,
                       daily-history, monthly-returns, risk-metrics
INDEX idx_snap_pid_ts ON portfolio_snapshots(pid, ts)

excluded_tickers     (ticker TEXT PRIMARY KEY)
                     — user-toggled exclusions for Trade Signals

trump_sentiment      (post_id TEXT PRIMARY KEY, data TEXT, created_at REAL)
                     — Gemini sentiment per Trump post (persistent; analyse once)

price_alerts         (id, ticker, condition ("above"|"below"), threshold REAL,
                      currency TEXT DEFAULT 'GBP', enabled INTEGER DEFAULT 1,
                      created_at REAL, triggered_at REAL)

notifications        (id, type TEXT, title TEXT, message TEXT, data TEXT,
                      created_at REAL, is_read INTEGER DEFAULT 0)

yt_channels          (channel_id TEXT PRIMARY KEY, name TEXT, added_at REAL)

yt_videos            (video_id TEXT PRIMARY KEY, channel_id, channel_name,
                      title, thumbnail TEXT DEFAULT '', published_at TEXT DEFAULT '',
                      duration_seconds INTEGER DEFAULT 0,
                      gemini_analysis TEXT DEFAULT '',
                      analyzed_at REAL DEFAULT 0)
```

### Caching semantics

- Every cache key in `kv_cache` is namespaced per portfolio when relevant: `<pid>:<key>` (e.g. `"1:rows"`, `"2:dividends"`). Keys without a pid prefix are global.
- `kv_get(key, ttl, pid=None)` returns the cached value if `time.time() - fetched_at < ttl`, else None.
- `kv_set(key, value, pid=None)` upserts; uses `INSERT OR REPLACE` (SQLite) or `INSERT … ON CONFLICT DO UPDATE` (Postgres).
- `clear_all_cache()` truncates all cache tables (SQLite only; Postgres skips for safety).

### Read-through pattern (mandatory, used everywhere)

> Check cache → return if fresh → fetch live → write cache → return.

This is the **only** way data is fetched. No bypass paths.

---

## 6. Background Threads

Started as daemons at app import time. Five threads in total.

| Name | Interval | Job |
|---|---|---|
| `portfolio-refresh` | `AUTO_REFRESH_SECONDS` (5 min) | For each configured pid: `fetch_and_cache_portfolio(force=True)`, append `portfolio_snapshots` row, run `_check_price_alerts(rows)` |
| `div-refresh` | `DIV_REFRESH_SECONDS` (6 h) | Fetch upcoming dividends per held US + UK ticker via Snowball Analytics (10 s polite delay between calls) |
| `market-refresh` | 25 min (TTL is 30 min) | Keep `market_indicators` (S&P 500, NASDAQ, VIX) warm |
| `news-refresh` | 5 min | Keep Finnhub general news warm |
| `yt-refresh` | 15 min | Fetch new uploads from every YouTube channel; trigger Gemini analysis for new videos in a worker thread |

Threads stagger their startup (sleep 5/30/10/15/60 seconds respectively) so the boot does not hammer external APIs.

---

## 7. Core Data Model — Holdings Row

Every `row` in any portfolio response is normalised to this dict shape:

```json
{
  "company_name":   "NVIDIA Corporation",
  "ticker":         "NVDA",          // Mapped base symbol (e.g. FB → META)
  "country":        "US",            // 2-letter; UK, US, DE, FR, NL, IE, CH, CA, AU, JP, ES, IT, SE, DK, NO, FI, BE, HK, CN
  "quantity":       12.5,
  "avg_price":      300.40,          // GBP
  "current_price":  450.10,          // GBP
  "native_price":   450.10,          // Raw price from T212 in stock's native currency
  "invested":       3755.00,         // GBP
  "current_value":  5626.25,         // GBP
  "total_returns":  1871.25,         // GBP (T212's "ppl" field)
  "fx_impact":      24.50,           // GBP — null for UK stocks
  "returns_pct":    49.82,
  "dividends":      45.20,           // GBP, lifetime per ticker
  "sector":         "Information Technology",
  "currency_code":  "USD",           // GBP/USD/EUR/...
  "native_currency":"USD",
  "ret1d": 1.2, "ret1w": 3.4, "ret1m": 8.0,
  "ret3m": 15.0, "ret6m": 22.0, "ret1y": 60.0,
  "ret3y": 250.0, "ret5y": 800.0     // % returns from Yahoo Finance, null if unavailable
}
```

### Country derivation (priority order)
1. ISIN prefix (`GB` → UK, `US` → US, `DE` → DE, etc.)
2. T212 ticker middle segment (`AAPL_US_EQ` → US; `BMW_DE_EQ` → DE)
3. Bare `<SYMBOL>_EQ` → UK
4. Otherwise `?`

### Price conversion (T212 → GBP)
- Pence countries (`UK`, `ES`): raw price ÷ 100
- USD countries (`US`, `CA`): raw price ÷ `GBPUSD` rate
- Otherwise: raw price unchanged (assume GBP)

### Ticker normalisation
Hardcoded map: `FB → META`, `ATOp → ATO`. Apply both when reading positions and when consolidating dividends.

### Sector
Lookup order: exact ticker → base symbol (strip trailing `l` or `p`) → company-name keyword fallback (`bank` → Financials, `etf` → Index Funds, `mining` → Materials, …) → `"Other"`.

### FX impact
- `null` for UK stocks (no FX exposure)
- Otherwise rounded float of T212's `fxPpl` field

---

## 8. API Endpoints — Complete List

All endpoints return `{"status": "ok"|"error", "data": ..., ...}`. The frontend never reaches an upstream API directly; everything is proxied.

### 8.1 Portfolio blueprint (`/api`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | SPA shell (Jinja `spa.html`) |
| GET | `/favicon.ico` | SVG favicon |
| GET | `/portfolio/<pid>` | 302 → `/#portfolio/<pid>` (bookmark compat) |
| GET | `/health` | `{"status": "healthy"}` |
| GET | `/api/fx-rate` | `{rate: <GBP/USD>}` |
| GET | `/api/overview` | Aggregated portfolios summary (per-pid + combined) |
| GET | `/api/home-data` | One-shot: overview + activity + top/under performers + market indicators + FX |
| GET | `/api/dividends/overview?pid=combined\|1\|2` | Full dividend analytics (monthly/annual + by-ticker + totals/TTM/YoC) |
| GET | `/api/upcoming-dividends` | Snowball calendar for all held tickers, payment_date ≥ today |
| GET | `/api/pcombined/portfolio` | Merged holdings (sum financial fields per ticker) |
| GET | `/api/pcombined/activity` | Recent orders across all portfolios |
| GET | `/api/pcombined/dividend-monthly` | Monthly dividend totals (combined) |
| GET | `/api/pcombined/daily-history` | Last 365 days end-of-day total values |
| GET | `/api/pcombined/top-performers` | Top 5 by total returns (combined) |
| GET | `/api/pcombined/recent-dividends` | Newest 15 dividend payments (combined) |
| GET | `/api/p<pid>/portfolio` | Single-portfolio holdings |
| GET | `/api/p<pid>/diversification-details` | Sector breakdown + concentration warnings |
| GET | `/api/p<pid>/activity` | Recent orders for one portfolio |
| GET | `/api/p<pid>/dividend-monthly` | Monthly dividends for one portfolio |
| GET | `/api/p<pid>/recent-dividends` | 10 newest dividends for one portfolio |
| GET | `/api/p<pid>/stock-activity/<ticker>` | Order + dividend history for a stock (pid=combined spans all) |
| GET | `/api/p<pid>/history` | 48-hour value snapshots (sparklines); combined buckets to 5 min |

### 8.2 Market blueprint

| Method | Path | TTL | Purpose |
|---|---|---|---|
| GET | `/api/market-indicators` | 30 min | S&P 500 (125-day MA) + NASDAQ (50 MA) + VIX (50 MA) from Yahoo, 5y daily |
| GET | `/api/market-sp500-insights` | 15 min | S&P 500 YTD daily % performance |
| GET | `/api/market-status` | 60 s | NASDAQ + LSE session (open/pre-market/after-hours/closed) from T212 exchanges metadata |
| GET | `/api/market/sector-performance` | 5 min | SPDR sector ETF daily % change (XLK, XLF, XLE, …) |
| GET | `/api/market-digest?provider=finviz&refresh=0` | 5 min | Finviz scraped daily digest (headline/bullets/sentiment) |
| GET | `/api/macro-events` | 24 h | Hardcoded FOMC/BoE/CPI/NFP/GDP calendar, next 60 days |
| GET | `/api/news?force=0` | 5 min | Finnhub general market news |
| GET | `/api/finviz/news` | 5 min | Finviz news + blogs |
| GET | `/api/earnings` | 24 h/ticker | Upcoming earnings for held US stocks (next 183 days), Savvy Trader |
| GET | `/api/stock-earnings/<ticker>` | 24 h | Full earnings history for one ticker |
| GET | `/api/stock-tickers` | 5 s/ticker | Live price + today's change for all held stocks (Yahoo batch v7 quote) |
| GET | `/api/stock-sparklines?tickers=...&countries=...&range=2d\|5d` | 15 min | Hourly sparklines |
| GET | `/api/stock-chart/<ticker>?period=1d\|1w\|1m\|1y\|5y&country=US` | 60s–1h | OHLCV candles |
| GET | `/api/stock-metrics/<ticker>` | 24 h | Finnhub stock metrics (`metric=all`) |
| GET | `/api/stock-news/<ticker>` | 30 min | Finnhub company news (last year) |
| GET | `/api/stock-historical-returns?tickers=...&countries=...` | 24 h/ticker | Batch 1d–5y returns for arbitrary tickers (parallel) |
| GET | `/api/analyst-ratings` | 24 h/ticker | TradingView analyst consensus for every held stock |
| GET | `/api/watchlist/signals?ticker=&country=` | 24 h | TradingView for any ticker |
| GET | `/api/watchlist/fundamentals?ticker=&country=` | 24 h | Market cap, Revenue LTM, P/E, Fwd P/E, 5yr avg P/E, 6m/1y/YTD returns |
| GET | `/api/watchlist/price?ticker=&country=` | 60 s | Single live quote |
| GET | `/api/watchlist/prices?tickers=&countries=` | 5 s/ticker | Bulk live quotes (powers heatmap auto-refresh) |
| GET/POST | `/api/watchlist/tickers` | ~10 y | Persisted ticker list |
| GET/POST | `/api/watchlist/categories` | ~10 y | Persisted categories (defaults: Stock, ETF, Crypto, Commodity) |
| GET | `/api/yt/channels` | — | List configured channels |
| POST | `/api/yt/channels` | — | Add `{channel_id, name}`; immediately fetches videos, kicks off Gemini analysis in background |
| DELETE | `/api/yt/channel/<id>` | — | Remove channel + its videos |
| GET | `/api/yt/videos` | — | Latest 60 videos across all channels |

### 8.3 Performance blueprint

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/p<pid>/monthly-returns` | Portfolio MoM % returns + SPY benchmark column |
| GET | `/api/pcombined/risk-metrics` | TWR, SPY TWR, Beta, Volatility, Sharpe, SPY Sharpe, Sortino, Weighted trailing P/E |
| GET | `/api/p<pid>/monthly-performance` | 12-month per-ticker % heatmap + S&P 500 row |
| GET | `/api/p<pid>/daily-performance` | MTD daily % heatmap |
| GET | `/api/p<pid>/yearly-performance` | 15-year annual % heatmap |
| GET | `/api/p<pid>/return-attribution` | 12-month per-sector return contribution (weight × monthly%) |
| GET | `/api/p<pid>/daily-returns?range=1W\|1M` | Daily portfolio value % change |

### 8.4 AI blueprint

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/trade-signals?refresh=0` | TradingView-based BUY/SELL/HOLD signals for all held stocks. Cached 12 h. Includes target, stop, expected return, conviction (HIGH/MEDIUM/LOW), suggested weight |
| POST | `/api/trade-signals/exclude` | `{ticker, excluded: bool}` — toggle exclusion |
| GET | `/api/trade-signals/excluded` | List of excluded tickers |
| GET | `/api/trump-posts?per_page=25` | Trump's posts from trumpstruth.org RSS, cached 5 min |
| GET | `/api/trump-posts/sentiment` | Per-post Gemini sentiment {impact, confidence, sectors[≤3], summary}; analyses only new posts |
| GET | `/api/ai/market-digest` | Gemini-generated digest from cached news headlines |
| GET | `/api/ai/trade-signals` | Gemini freeform 3-5 trade insights |
| POST | `/api/ai/chat` | `{message, history: [{role, parts}]}` → Gemini chat response |

### 8.5 Alerts blueprint

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/alerts` | All alerts |
| POST | `/api/alerts` | `{ticker, condition, threshold, currency}` |
| DELETE | `/api/alerts/<id>` | Delete alert |
| GET | `/api/notifications` | Last 40 notifications + unread count |
| POST | `/api/notifications/read` | Mark all read |
| POST | `/api/admin/clear-cache` | Truncate all cache tables (SQLite only) |

---

## 9. Business Logic — Critical Rules

These have all been hard-won by past bugs; do **not** deviate.

1. **Money is GBP server-side, always.** USD display is a frontend-only conversion via `fmt.currency()`. Never `toFixed(2)`; always use the shared formatter.
2. **Combined pid** is the string `"combined"`. Endpoints that branch on pid use this sentinel. Don't hardcode numeric pids in router or business logic.
3. **One Gunicorn worker, 8 threads.** Background daemons rely on this. Scaling up = multiple daemon copies hammering APIs.
4. **Heatmap cells use `value: 1`** in the treemap algorithm so every cell gets equal area. Heatmaps visualise daily % moves, not position size. The same rule applies on the home stocks heatmap and watchlist heatmap.
5. **Live price refresh = 5 seconds.** Backend cache TTL for `/api/watchlist/prices` and `/api/stock-tickers` per-ticker entries must also be 5 s; do not lengthen it or the animation appears stale.
6. **Yahoo Finance is flaky.** Always:
   - Prefer batch quote endpoints over per-symbol calls.
   - Retry once on 401 (refresh the crumb cookie).
   - Fall back to last cached value when a fetch returns 0/None.
   - Use a real browser User-Agent.
7. **UK stocks need fallback paths.** LSE symbols get suffix `.L`; strip the trailing lowercase `l` from base tickers (e.g. `BARCl` → `BARC.L`). Prices come back in pence (÷100). Logos and instrument data often miss; degrade gracefully.
8. **Crumb auth caches for 1 hour.** Refresh by `kv_set("yf:crumb:v3", None)` on 401 and retry once.
9. **Macro events are hardcoded.** Update the `_MACRO_CALENDAR` list each January when central banks publish.
10. **Price alerts trigger inside the background refresh thread**, not at request time. The alerts route only does CRUD.
11. **Trump-post sentiment is persisted permanently.** Only new post IDs hit the Gemini API; existing IDs are served from `trump_sentiment`.
12. **CSS desktop layout is fixed-viewport (no body scroll).** Use flex columns and `min-height: 0` everywhere. Mobile breakpoint at 768px allows scrolling.
13. **Charts use `requestAnimationFrame` and DPR scaling**: `canvas.width = W * dpr; ctx.scale(dpr, dpr)`. No chart library.
14. **Watchlist heatmap tab uses the sentinel string `"__heatmap__"`** as its tab id (not a real category). Multiple guards check for it.
15. **Routing**: never assign `location.hash` directly outside `navigate(route)`. All view transitions go through the router lifecycle.

---

## 10. SPA Views (Frontend Feature Spec)

The UI is one HTML file with hash-based routing. View dimensions/layout can be designed freely; data and interaction must match.

### 10.1 Sidebar navigation
Items (mobile-collapsible, desktop-collapsible-and-persistent via localStorage):
- **Home** (`#home`)
- **Portfolio** (`#portfolio/combined` by default)
- **Holdings** (`#stocks/combined`)
- **Dividends** (`#dividends/combined`)
- **Metrics** (`#metrics`)
- **Market** (`#market`)
- **Watchlist** (`#watchlist`)
- **News** (`#news`)
- **AI Intelligence** (`#ai-intelligence`) — only if `SHOW_AI_FEATURES=1`
- External link → trading212.com

### 10.2 Topbar (persistent)
- Greeting + breadcrumb / contextual subtitle ("Good morning, $name 👋 · Friday, 23 May 2026 · Portfolio overview")
- **PID switcher** (`Combined / Name1 / Name2`) — visible on portfolio/stocks/dividends routes
- Market status pills (NASDAQ + LSE: open / pre-market / after-hours / closed) with hover tooltip showing today's open/close + upcoming day-pairs
- Currency toggle (GBP ↔ USD)
- **Notification bell** with unread badge; clicking opens panel with notifications, "Mark all read", "Add Alert" button, list of configured alerts
- Privacy toggle (hides monetary values — replace with blurred mask)
- Theme toggle (light ↔ dark; light = warm cream paper; dark = warm dark paper. Never cold navy.)
- AI Market Digest open-sidebar button
- Refresh button (re-runs the current view's loader)

### 10.3 Mobile bottom-nav (≤768px)
Home, Portfolio, Watchlist, News, More (opens bottom sheet with full menu).

### 10.4 Home view

**Left column**:
- 3 portfolio cards (P1 / P2 / Combined). Each shows:
  - Total value (large), unrealised P&L (£+%), 24-h delta
  - Mini stats: Invested, Unrealized, Realized, Cash
  - 90-day value sparkline canvas
  - Click → `#portfolio/<pid>`
- **Stocks Heatmap** — treemap of all held tickers, equal-size cells, colour-coded by today's % change, auto-refreshes every 5 s with flash animation. Sector grouping background overlay at `z-index: 0` with `opacity: 0.2`.
- **Latest Trade Signals** — top N TradingView-based signals; "View All" opens a right-side panel with full list + Excluded tab

**Right column**:
- **Fear & Greed Index** — CNN gauge canvas + score + rating, opens detail side panel on click (30-day history)
- **Upcoming Events** — next-60-day combined feed of earnings (US), ex-dividend/pay dates (Snowball), macro events (FOMC, BoE, ECB, US CPI, UK CPI, NFP, GDP). Grouped by week with day labels.
- **Contributors to Returns** — top performers chart

### 10.5 Portfolio detail view (per pid or combined)

- **Summary row**: 3 cards
  - Portfolio Value (with invested + holdings count badge)
  - Returns (toggle All-time / 24h; shows realized/unrealized split, winners-losers tally, best/worst %)
  - Dividends Received (with mini monthly bar chart, top dividend stock, total FX impact)
- **Portfolio Heatmap card** — two panels: By Company + By Industry. Size = weight, colour = today's change
- **Dynamics of Portfolio Returns** — line/bar chart with toggle:
  - **Returns** view — MoM % change vs SPY benchmark
  - **Attribution** view — per-sector return contribution
  - Range tabs: 1W / 1M / 12m / all + dynamically injected year tabs
- **Recent Activity** panel with tabs (All / Stocks / Dividends)

### 10.6 Holdings (Stocks) view

- **Top Movers strip** — today's biggest gainers/losers (live)
- Full-width sortable, filterable holdings table with these columns (column picker to hide/show):
  Ticker · Company · Country flag · **48h Trend** (mini canvas) · **7d Chart** (mini canvas) · Shares · Avg Price · Current Price · **Breakeven** (dividend-adjusted) · Invested · Value (GBP) · Weight (with allocation bar) · P&L · FX Impact · Returns % · 1d/1w/1M/3M/6M/1y/3y/5y % · Div Yield · Rating
- Search box (filters by company or ticker)
- **Export CSV** button
- **Rebalance** button → opens side panel with sector target weights
- Row click → opens **Stock side panel** (see §10.13)

### 10.7 Dividends view

- 4 KPI cards: Total Received · This Year (with YoY) · Projected Annual (TTM-based) · Avg per Month
- Annual Income bar chart
- Monthly Income bar chart (last 24 months)
- **Top Payers** table (Stock, Received, Yield, YOC, Share %)
- **Upcoming Dividends** calendar list (Snowball)
- **Recent Payments** list

### 10.8 Market view

- **Sector Performance** radial chart (SPDR ETFs)
- **S&P 500 chart** — 1M/6M/1Y/5Y tabs, current price + change, MA crossover stats, VIX context
- **VIX chart** — same range tabs, vs 50MA, signal label
- **S&P 500 Annual % Change** bar chart
- **S&P 500 YTD Performance** line chart
- **Performance Heatmap** — full-width per-ticker heatmap with MTD/1Y/15Y toggle

### 10.9 Metrics view

- **Portfolio vs S&P 500** line/bar chart (indexed); ranges 1M/3M/6M/1Y/ALL; legend toggles
- Footer stats: portfolio %, S&P %, Alpha
- **Portfolio Gain** widget (1M / 6M / 12M / YTD / Total returns)
- **Drawdown Analysis** chart with Max DD / Current / Days-in-DD stats (range tabs)
- **Risk Metrics grid**: TWR · vs SPY · Beta · Volatility · Sharpe · Sortino · Weighted P/E (+ insufficient_data state when <5 days of snapshots)

### 10.10 Watchlist view

- Add bar: Ticker input + Country select (US/UK/DE/FR/CA/AU/JP) + Type toggle (Stock/ETF/Crypto/Commodity) + Columns picker + Add button
- **Tabs** (categories) with drag-to-reorder; first tab is special **Heatmap** (id `"__heatmap__"`):
  - Heatmap tab renders treemap of all watchlist tickers, equal cells, 5-second live refresh with flash animation
- Other tabs render a table with columns: Ticker · Company · Price · Change · Min/Avg/Max Target · Signal (badge) · Mkt Cap · Revenue LTM · P/S · P/E · Fwd P/E · 5yr P/E · 6M/1Y/YTD Return · 7D Chart · Delete
- Default categories: Stock, ETF, Crypto (auto-suffix `=X` or known crypto symbols, country-less), Commodity (no country, e.g. `GC=F` Gold)
- Add-category modal (icon + label)
- Persisted to `/api/watchlist/tickers` and `/api/watchlist/categories` (server-side, ~10 year TTL)

### 10.11 News view

3-column layout:
- **Market News** — Finnhub items (5-min auto-refresh) with "Load new posts" pill when refresh brings new items
- **Donald J. Trump** — Truth Social posts with image, timestamp, optional sentiment badge (bullish/bearish/neutral + sectors + 1-line summary)
- **Videos** — YouTube videos from configured channels, channel filter chips, click opens YT sidebar with embed + Gemini analysis

### 10.12 AI Intelligence view (only when `SHOW_AI_FEATURES=1`)

Three columns:
- **Market Digest** — Gemini-generated summary of recent headlines
- **Trade Signals** — Gemini freeform 3-5 portfolio insights
- **AI Assistant** — multi-turn chat with Gemini (last 20 turns retained client-side; 4000-char message cap)

### 10.13 Global side panels & modals

- **Stock side panel** (right-sliding, accessible from any holdings row): brand + ticker, metrics grid (Value/Return/Shares/Avg/Current/Breakeven), Price Chart (Candle ↔ Line toggle, 1D/1W/1M/1Y/5Y tabs), Analyst Ratings, Earnings History (Beat/Miss markers), Fundamentals, Activity & Dividends, Company News
- **Summary side panel** (PAI / sector breakdown details)
- **Fear & Greed detail panel** (30-day history)
- **Rebalance panel** (sector target weights)
- **Signals sidebar** (Signals / Excluded tabs)
- **Digest sidebar** (full Market Digest)
- **YT video sidebar** (embed + analysis)
- **Price Alert modal** (Ticker / Condition above|below / Currency / Threshold)
- **YT channels manage modal**
- **Market Digest fullscreen modal**

---

## 11. Frontend Behaviours

### 11.1 Theming
- Light theme = warm paper cream (`#f5f2eb` bg, `#fffefc` cards, ink-stamp shadows `4px 4px 0px`).
- Dark theme = warm dark paper.
- **Banned**: cobalt blues (`#0058be`, `#2170e4`), navy backgrounds (`#0f1629`, `#1e2d4a`), pure `#000`/`#fff`, gradient-clip text, glassmorphism decoration.
- Semantic colours are inviolable: **green = gain, red = loss, amber = warning, accent purple = primary**.
- Sharp 2 px border radii (scrapbook feel). Monospace `JetBrains Mono` for all numbers; `Inter` for labels; `PT Serif` italic for headline values.

### 11.2 Currency conversion
- Cached `currentCurrency` ∈ {`GBP`, `USD`} in localStorage.
- `fmt.currency(n)` converts GBP→USD on the fly using the cached FX rate.
- `fmt.currencyNative(n, code)` formats in any currency including pence (`GBX`) which shows as `123.45p`.
- Toggle triggers a CSS flash animation on every monetary value.

### 11.3 Privacy mode
Hides every monetary number (blurred / dotted overlay). State persists in localStorage.

### 11.4 Auto-refresh cadence (per active view)
- Home stocks heatmap + watchlist heatmap: 5 s
- Live ticker prices (any open heatmap): 5 s
- Market indicators, news, Finviz: 5 min
- Fear & Greed: 30 min
- Background snapshot refresh: 5 min

### 11.5 Charts (canvas, no library)
All charts hand-drawn. DPR scaling mandatory. Each chart has:
- Tooltip on hover (`<div class="*-chart-tooltip">`)
- Theme-aware colours (read CSS vars at draw time)
- Skeleton placeholder before data arrives
- Redraw on theme change (where supported)

### 11.6 SPA router lifecycle
Each view has init/activate/deactivate hooks. Timers are started on activate and cleared on deactivate to prevent leaks when switching views.

---

## 12. Risk Metrics Formulas (Combined Portfolio)

Daily portfolio value series from `portfolio_snapshots`, end-of-day values per pid summed across active portfolios.

```
returns_t   = V_t / V_{t-1} − 1                                      (per day)
TWR         = (Π(1 + returns_t) − 1) × 100                           (cumulative %)
mean_r      = mean(returns − r_f_daily)                              r_f = (1.045)^(1/252) − 1
std_r       = sample stdev(returns − r_f_daily)                      (n-1)
volatility  = std_r × √252 × 100                                     (% annualised)
Sharpe      = mean_r / std_r × √252
Sortino     = mean_r / √(mean(neg_returns²)) × √252                  (downside dev)
Beta        = cov(portfolio_excess, spy_excess) / var(spy_excess)    (SPY = ^GSPC)
SPY_TWR, SPY_Sharpe — same formula on SPY daily closes
Weighted P/E = Σ (weight_i × pe_i) / Σ weight_i                      requires ≥50% weight coverage
```

Requires ≥5 days of snapshots to compute anything; otherwise return `{"insufficient_data": true}`.

---

## 13. Trade Signal Generation

For every held ticker (excluding the `excluded_tickers` set):

1. Scrape TradingView forecast page (try every exchange URL for the country; up to 3 retries each).
2. Extract avg/high/low price targets and recommendation text.
3. Derive consensus: weighted score = `(SB×1 + B×2 + H×3 + S×4 + SS×5) / total`; ≤1.5 Strong Buy … >4.5 Strong Sell.
4. Compute:
   - `exp_return = (target − entry) / entry × 100` (flip sign for SELL rec)
   - `stop` = low target for BUY, high target for SELL
   - `conviction` = HIGH (STRONG_*) / MEDIUM (BUY|SELL) / LOW (else)
   - `suggested_weight` = 5% / 2.5% / 0%
5. Sort by `exp_return` descending. Cache 12 h.

---

## 14. Deployment

### 14.1 Local

```bash
make setup        # uv sync + .env scaffold
make run          # uv run python app.py → http://localhost:8080
make lock         # update uv.lock
```

### 14.2 Docker

```bash
make docker       # build amd64 image
make docker-run   # run on port 8080
```

Image must:
- Build for `linux/amd64` (Cloud Run requirement)
- Use Python 3.12-slim base
- Install deps with `uv sync --frozen --no-dev --no-install-project`
- Run as non-root `appuser`
- Use Gunicorn: `--workers 1 --threads 8 --timeout 60 app:app`

### 14.3 Cloud Run

- Secrets via Secret Manager → mounted at `/tmp/config.json`
- `release.sh` script handles: optional git commit → docker build → push to Artifact Registry → `gcloud run deploy` → old revision/image cleanup → optional `--dry-run`
- `git push` is **manual** after release (intentional safety gate)

---

## 15. Code Organisation (target layout)

```
app.py                 — Flask app, blueprint registration, background threads, one-time migrations
config.py              — JSON-file env loader (Secret Manager + .env)
cache.py               — DB init, kv cache, snapshots, alerts, notifications, yt tables — only place SQL lives
helpers.py             — API_KEYS, PORTFOLIO_NAMES, fetch_and_cache_portfolio, overview builders
portfolio.py           — build_rows() — T212 positions → enriched holdings
t212.py                — T212 API client (positions/instruments/dividends/orders/account-summary/exchanges)
yf.py                  — Yahoo Finance helpers (crumb dance, batch quotes, sparkline points, hist returns enrichment)
fx.py                  — GBP/USD rate + country detection + price conversion
sectors.py             — ticker → sector map + keyword fallback
snowball_dividends.py  — upcoming dividend calendar fetcher
finviz_data.py         — Finviz news + scraped daily digest
ai_digest.py           — Finviz daily digest formatter
gemini_utils.py        — google-genai client + retry + prompts (digest/signals/chat/trump sentiment)

routes/
  __init__.py          — blueprint re-exports
  portfolio.py         — SPA shell + portfolio + dividends + activity endpoints
  market.py            — market data + stocks + watchlist + YouTube endpoints
  performance.py       — risk metrics + monthly/daily/yearly perf + attribution
  ai.py                — TradingView signals + Trump posts + Gemini AI endpoints
  alerts.py            — price alerts + notifications + cache admin

static/
  style.css            — single CSS bundle, theming via CSS custom properties
  router.js            — hash router, view lifecycle, sidebar, topbar, theme/privacy/currency toggles
  home.js              — home view + heatmap + signals sidebar + Fear&Greed + upcoming events + news + watchlist
  app.js               — portfolio detail + stocks table + side panels + alerts + analyst ratings + risk metrics
  currency.js          — currency toggle + fmt formatters + FX fetch
  ai_intelligence.js   — AI view (digest, signals, chat)
  favicon.svg

templates/
  spa.html             — single HTML shell, all view containers inline (display: none until route active)
```

---

## 16. Acceptance Checklist

A successful rebuild must demonstrate ALL of the following on a fresh deploy:

- [ ] Add `TRADING212_API_KEY_1` → home page shows live portfolio values within 30 s
- [ ] Holdings table renders all columns, sortable, filterable, exportable to CSV
- [ ] Click a row → side panel opens with metrics, candle chart, fundamentals, news, activity
- [ ] Stocks heatmap on home updates colours every 5 s with smooth flash animation
- [ ] Switching `GBP ↔ USD` instantly reformats every monetary value
- [ ] Toggle privacy → all £/$ values become blurred / dotted
- [ ] Light/dark theme toggle persists; both themes are warm paper, never cold navy
- [ ] Sidebar collapses on desktop (persists); mobile bottom-nav appears at ≤768 px
- [ ] PID switcher visible on portfolio/stocks/dividends routes only
- [ ] Combined view sums financial fields per ticker, dedup correctly
- [ ] Background refresh creates a `portfolio_snapshots` row every 5 minutes
- [ ] After ≥5 days of snapshots, Risk Metrics shows TWR / Beta / Sharpe / Sortino / Vol / weighted P/E
- [ ] Price alerts trigger notifications (visible in bell panel) when threshold crossed
- [ ] Trade Signals page lists every held stock with TradingView target + conviction; can exclude tickers
- [ ] Dividends view shows monthly bar, by-ticker table, upcoming calendar
- [ ] Market view: S&P 500 + VIX charts with range tabs work and tooltips show on hover
- [ ] Metrics view: Portfolio-vs-SPY line chart + drawdown chart + risk grid
- [ ] Watchlist: add a ticker → live price + analyst targets within ~5 s; heatmap tab updates every 5 s
- [ ] News view: 3 columns (Finnhub news, Trump posts, YouTube videos)
- [ ] YouTube: add a channel → recent videos appear; Gemini analysis renders in side panel (when key configured)
- [ ] `SHOW_AI_FEATURES=1` exposes AI Intelligence view with digest, signals, chat
- [ ] All Yahoo endpoints survive transient 401 → automatic crumb refresh and one retry
- [ ] `make release` builds + deploys + cleans up on Cloud Run; `--no-commit` and `--dry-run` flags honoured

---

## 17. Known Gaps (acceptable in v1)

- No unit tests (manual verification only)
- `sectors.py` ticker map is manual — new tickers fall through to keyword fallback
- SQLite resets on Cloud Run redeploy — use `DATABASE_URL` for persistence
- Cache does not auto-purge stale rows (unbounded growth eventually)
- Macro events list needs annual update each January
- Drawdown chart does not auto-redraw on theme toggle (redraws on next range click)

These are documented gaps, not blockers — leave them as-is in v1.
