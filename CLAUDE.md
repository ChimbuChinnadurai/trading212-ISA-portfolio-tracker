# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

This is a Python/Flask + HTML/CSS/JavaScript portfolio tracker app. The backend is app.py (Flask with Yahoo Finance API calls), frontend is HTML templates with vanilla JS and CSS. Always consider both backend and frontend implications of any change.

## Code Changes

When removing a feature or function, always search the entire codebase for ALL callers/references before confirming the removal is complete. Use Grep to find every import, function call, and template reference.

## Interaction Style

When asked to explore the codebase or generate suggestions, provide an initial concise answer FIRST, then offer to dive deeper. Do not spend extended time reading files before giving any response.

## Commands

```bash
# Run locally (requires .env with API keys)
python app.py                      # serves on http://localhost:8080

# Docker build + run
docker build --platform=linux/amd64 -t tracker .
docker run -p 8080:8080 --env-file .env tracker

# Deploy to Google Cloud Run (bumps version tag automatically)
./build.sh

# Clear cache without restarting
curl -X POST http://localhost:8080/api/admin/clear-cache
```

No build step for the frontend — vanilla JS, no npm, no bundler.

---

## Architecture

```
Trading212 API (per-portfolio API key)
    ↓
t212.py          — REST client, pagination, order normalisation
cache.py         — SQLite/PostgreSQL KV store (kv_get/set, rows_get/set, snapshot_get/add)
portfolio.py     — enriches raw T212 rows: FX, sector, weight, YOC, div yield
fx.py            — GBP/USD rate (Yahoo Finance), GBX→GBP, ISIN→country
sectors.py       — hardcoded ticker→sector map + keyword fallback
    ↓
app.py           — 50+ Flask REST endpoints + background refresh threads
finviz_data.py   — Finviz scraper: news, signals, insider, sector perf, stock details
ai_digest.py     — multi-provider market digest (Finviz / Claude / Gemini)
gemini_utils.py  — Gemini AI: market summary, trade signals, portfolio chat
snowball_dividends.py — dividend data fetcher (Snowball Analytics)
    ↓
templates/spa.html   — single Jinja shell; all views rendered client-side
static/router.js     — hash-based SPA router: view lifecycle, timers, breadcrumbs
static/home.js       — Home / Market / Watchlist / AI views (~4200 lines)
static/app.js        — Portfolio detail view (~2400 lines)
static/ai_intelligence.js — AI Intelligence view
static/currency.js   — GBP↔USD display conversion (shared)
static/style.css     — all styles, dark/light/glass themes (~8100 lines)
```

### Key design decisions

- **All monetary values stored and returned in GBP.** Currency conversion to USD is display-only, done in `currency.js` via `fmt.currency()`. Never store USD values server-side.
- **Combined portfolio** uses pid string `"combined"` — handled specially in most endpoints and in `router.js`.
- **Cache is the source of truth for reads.** The pattern everywhere is: check cache → return if fresh → fetch live → write cache → return. `cache.py` is the single place this logic lives.
- **One Gunicorn worker, 8 threads.** This keeps exactly one background-refresh daemon thread alive. Do not increase workers without reconsidering the background thread design.
- **No auth layer** — deployment assumes private/internal access (Cloud Run + IAM or VPN).

### SPA routing

`router.js` owns all view transitions. Navigation always goes through `navigate(route)` → `location.hash = route` → `hashchange` event → `_router()`. Never manipulate `location.hash` directly outside `navigate()`. Routes:

```
#home                → Home view
#portfolio/1|2|combined  → Portfolio detail
#stocks/1|2|combined     → Holdings table
#dividends/1|2|combined  → Dividends view
#market              → Market view
#metrics             → Metrics view
#news                → News view
#calendar            → Calendar view
#activity            → Activity view
#watchlist           → Watchlist view
#ai-intelligence     → AI Intelligence view
```

### Configuration loading (production)

In production (Cloud Run), secrets are mounted from Google Secret Manager at `/tmp/config.json`. `config.py` reads that file and falls back to environment variables / `.env` for local development. **Always update `config.py` when adding a new env variable.**

---

## Frontend patterns

### Skeletons
Apply `.skeleton.skeleton-text` while loading; remove both classes when data arrives. Skeleton elements need explicit `min-width`/`height` if they would otherwise collapse. See `showSkeletons()` / `hideSkeletons()` in `app.js`.

### Count-up animation
Use `_animateCardValue(el, toValue, formatter)` in `app.js` or `_animateValue(el, toValue, formatter)` in `home.js` for monetary values in summary cards. Reads `el.dataset.rawValue` as the "from" value (0 on first load).

### Canvas charts
All charts are drawn manually on `<canvas>` — no chart library. The pattern is: compute `W = canvas.offsetWidth`, set `canvas.width = W * dpr`, `canvas.height = H * dpr`, `ctx.scale(dpr, dpr)`, then draw. Always call inside `requestAnimationFrame` when the element may not yet be visible.

### Tooltip
`showTooltip(event, htmlString)` / `hideTooltip()` — shared singleton `#tooltip` div. Use `onmouseenter`/`onmouseleave` on the target element.

### Currency formatting
Always use `fmt.currency(value)` for monetary display — never `toFixed(2)` directly. This respects the active currency and rate stored in `currency.js`.

After implementing CSS changes, especially involving flex layouts, overflow, sticky positioning, or height calculations, verify that existing components still render correctly. Test by checking that container heights are not collapsed to 0px.

---

## Data model — enriched portfolio row

```python
{
    "ticker": str,          # "GOOGL", "LLOY"
    "company_name": str,
    "country": str,         # "UK", "US", "DE" — from ISIN prefix in fx.py
    "quantity": float,
    "avg_price": float,     # GBP (GBX already ÷100)
    "invested": float,      # GBP cost basis
    "current_value": float, # GBP market value
    "total_returns": float, # GBP P&L
    "returns_pct": float,
    "fx_impact": float | None,
    "dividends": float,     # GBP lifetime total
    "sector": str,
    "currency_code": str,   # original trade currency "GBP"/"USD"/"GBX"
    "weight": float,        # % of total portfolio value
    "div_yield": float,     # dividends / current_value %
    "yoc": float,           # dividends / invested %
    "pid": str,             # "1" or "2" — added in combined views
}
```

---

## Environment variables

```
TRADING212_API_KEY_1   # required
TRADING212_API_KEY_2   # optional (second portfolio)
PORTFOLIO_NAME_1       # display name (default "Portfolio 1")
PORTFOLIO_NAME_2       # display name (default "Portfolio 2")
TRADING212_BASE_URL    # https://live.trading212.com/api/v0
FINNHUB_TOKEN          # for stock-metrics + stock-news endpoints
GEMINI_API_KEY         # also accepts GOOGLE_API_KEY
SHOW_AI_FEATURES       # "1" to show AI tab
PORT                   # default 8080
DB_PATH                # SQLite path (default portfolio_cache.db)
DATABASE_URL           # PostgreSQL DSN — overrides SQLite
CACHE_TTL_SECONDS      # portfolio rows TTL (default 600)
AUTO_REFRESH_SECONDS   # background refresh interval (default 300)
```

---

## Constraints (do not change)

- **Vanilla JS only** — no React, Vue, Angular, or any JS framework
- **Flask only** — no FastAPI
- **SQLite by default** — PostgreSQL only via `DATABASE_URL`; no Redis
- **All monetary values stored in GBP** — USD is display-only via `currency.js`
- **No chart library** — canvas drawn manually
- **Desktop = fixed viewport** (`fixed-layout` class, no scroll); mobile (≤768px) scrolls normally

---

## Known gaps

- No unit tests
- `sectors.py` ticker map is manual — new tickers may fall through to keyword fallback
- SQLite resets on Cloud Run redeploy — use `DATABASE_URL` for persistence
- Cache does not auto-purge stale rows
- Drawdown chart does not auto-redraw on theme toggle (redraws on next range-tab click)
- For UK stocks (LSE-listed), logos and data sources often differ from US stocks. Always test with UK ticker symbols (e.g., BARC.L, VWRL.L) and implement fallback sources when primary sources fail for non-US equities.


## API & Data Fetching

Yahoo Finance API is rate-limited and unreliable. When implementing data fetching: (1) always use bulk downloads over individual requests where possible, (2) implement progressive/streaming responses (SSE) for long-running fetches, (3) handle stale/incomplete data gracefully with fallbacks.