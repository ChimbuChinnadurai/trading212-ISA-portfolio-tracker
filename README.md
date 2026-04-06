# Trading212 Portfolio Tracker

A full-featured web application that fetches your **Shares ISA** positions from the Trading212 API and displays them in a rich, interactive dashboard. Supports **two named portfolios** simultaneously plus an aggregated **Combined** view.

## Features

### Home / Overview
- Three portfolio cards (Portfolio 1, Portfolio 2, Combined) with live values, returns, and 90-day sparklines
- **Portfolio Heatmap** — real-time price tiles sorted by biggest movers (auto-refreshes every 60s)
- **Fear & Greed Index** — gauge + 30-day history
- Recent combined activity feed
- Top performers (by total return %)
- Dividend Calendar (upcoming ex-div and pay dates)
- Upcoming Earnings calendar
- Market News sidebar (CNBC RSS, refreshes every 5 min)
- Market status pills (NASDAQ + LSE open/close)

### Market View
- Portfolio vs S&P 500 chart (indexed, range-filterable: 1M / 3M / 6M / 1Y / ALL)
- Portfolio gain stats (1M / 6M / 12M / YTD / Total)
- **Drawdown Analysis** chart with Max DD / Current / Days-in-DD stats
- Sector Performance bars (Finviz S&P 500 data)
- Market Signals (Finviz top gainers, losers, signals)
- Insider Trading activity feed
- AI Market Digest (Finviz, Claude, or Gemini — configurable)

### Portfolio Detail (per portfolio or combined)
- Sortable, filterable positions table with allocation bars and 48h sparklines
- Summary cards: total value, P&L, Projected Annual Income (PAI)
- Sector / currency / country allocation bars
- Monthly dividend bar chart
- Analyst ratings (TradingView consensus)
- Trade history
- Upcoming dividend table
- Stock side panel (metrics, price chart, news, analyst ratings, activity)

### Watchlist
- Add any global ticker with country selection
- Live price + today's % change
- Analyst price targets (Min / Avg / Max) and signal badge
- Fundamentals: Market Cap, Revenue LTM, P/S, P/E (trailing), **Forward P/E**, **5-year avg P/E**
- 48h price sparkline
- Persistent storage (survives page reload)

### Risk & Analytics
- Portfolio risk metrics: TWR, Beta vs S&P 500, Volatility, Sharpe, Sortino ratios
- Weighted portfolio P/E ratio
- Monthly returns heatmap per ticker (last 12 months)
- Monthly performance breakdown

### AI Features (optional, requires `SHOW_AI_FEATURES=1`)
- AI Trade Signals (TradingView TA + AI analysis) with ticker exclusions
- AI Market Digest (Finviz / Claude / Gemini)
- Interactive Gemini chat

---

## Local Development

```bash
# 1. Create a virtual environment
python -m venv .venv && source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env — set TRADING212_API_KEY_1 and any optional keys

# 4. Run
python app.py
```

Open http://localhost:8080

---

## Docker

```bash
docker build -t portfolio-tracker .
docker run -p 8080:8080 --env-file .env portfolio-tracker
```

---

## Deploy to GCP Cloud Run

```bash
PROJECT_ID=your-gcp-project
IMAGE=us-central1-docker.pkg.dev/$PROJECT_ID/portfolio/tracker

# Build & push
docker build -t $IMAGE .
docker push $IMAGE

# Deploy
gcloud run deploy portfolio-tracker \
  --image $IMAGE \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "TRADING212_API_KEY_1=xxx,PORTFOLIO_NAME_1=Chimbu,PORTFOLIO_NAME_2=Poornima"
```

Store secrets in Secret Manager for production:

```bash
echo -n "your_key" | gcloud secrets create trading212-api-key-1 --data-file=-

gcloud run deploy portfolio-tracker \
  --image $IMAGE \
  --region us-central1 \
  --set-secrets "TRADING212_API_KEY_1=trading212-api-key-1:latest"
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TRADING212_API_KEY_1` | — | Trading212 API key for portfolio 1 |
| `TRADING212_API_KEY_2` | — | Trading212 API key for portfolio 2 (optional) |
| `PORTFOLIO_NAME_1` | `Portfolio 1` | Display name for portfolio 1 |
| `PORTFOLIO_NAME_2` | `Portfolio 2` | Display name for portfolio 2 |
| `TRADING212_BASE_URL` | `https://live.trading212.com` | API base URL (live or demo) |
| `FINNHUB_TOKEN` | — | Finnhub API key (stock metrics endpoint) |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | — | Gemini API key (AI features) |
| `SHOW_AI_FEATURES` | `0` | Set to `1` to enable AI tab in the UI |
| `PORT` | `8080` | HTTP port (Cloud Run sets this automatically) |
| `DB_PATH` | `portfolio_cache.db` | SQLite database path |
| `DATABASE_URL` | — | PostgreSQL DSN — overrides SQLite when set |
| `CACHE_TTL_SECONDS` | `600` | Portfolio rows cache TTL (seconds) |
| `CACHE_TTL_INSTRUMENTS` | `3600` | Instrument metadata TTL |
| `CACHE_TTL_DIVIDENDS` | `1800` | Dividend data TTL |
| `CACHE_TTL_FX` | `300` | FX rate TTL |
| `CACHE_TTL_ORDERS` | `300` | Order history TTL |
| `AUTO_REFRESH_SECONDS` | `300` | Background portfolio refresh interval |

---

## Trading212 API Key

Generate your key at **Settings → API (Beta)** in your Trading212 account. Grant at minimum: **Portfolio read**, **History read**.
