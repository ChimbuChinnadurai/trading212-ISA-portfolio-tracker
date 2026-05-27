# Trading212 Portfolio Tracker

![Dashboard Screenshot](static/screenshots/dashboard.png)

A self-hosted web dashboard for **Trading212 Shares ISA** accounts. Fetches your positions via the Trading212 API and displays them in a rich, interactive single-page app. Supports **one or more portfolios** simultaneously — add a `TRADING212_API_KEY_<id>` for each account and the app discovers them automatically. When two or more portfolios are configured, an aggregated **Combined** view is shown.

Built with Python/Flask (backend) and vanilla JS/HTML/CSS (frontend). No framework dependencies. Deployable to GCP Cloud Run in a single command.

---

## Features

### Home / Overview
- Three portfolio cards (Portfolio 1, Portfolio 2, Combined) with live values, returns, and 90-day sparklines
- **Stocks Heatmap** — equal-size live price tiles colour-coded by daily % change, auto-refreshes every 5 s
- **Upcoming Events** — earnings dates, ex-dividend/pay dates, and macro calendar (FOMC, BoE, ECB, US CPI, UK CPI, NFP, GDP) for the next 60 days
- **Fear & Greed Index** — gauge + 30-day history
- Recent combined activity feed and top performers (by total return %)
- Market news sidebar (Finviz + Finnhub, refreshes every 5 min)
- Live market status pills (NASDAQ + LSE open/close)

### Market View
- Portfolio vs S&P 500 chart (indexed, range-filterable: 1 M / 3 M / 6 M / 1 Y / ALL)
- Portfolio gain stats (1 M / 6 M / 12 M / YTD / Total)
- **Drawdown Analysis** chart with Max DD / Current DD / Days-in-DD stats
- Sector performance bars (Finviz S&P 500 data)
- Market signals (Finviz top gainers, losers, unusual volume)
- Insider trading activity feed
- AI Market Digest (Finviz scraped digest, or Gemini AI — configurable)

### Portfolio Detail (per-portfolio or combined)
- Sortable, filterable positions table with allocation bars and 48 h sparklines
- Summary cards: total value, unrealised P&L, Projected Annual Income (PAI)
- Sector / currency / country allocation bars
- Monthly dividend bar chart and upcoming dividend table
- Analyst ratings (TradingView consensus)
- Full trade history
- Stock side panel — metrics, price chart, news, analyst ratings, and activity per ticker

### Performance Analytics
- Monthly portfolio returns vs SPY benchmark (bar + line chart)
- Risk metrics: TWR, Beta vs S&P 500, Volatility, Sharpe ratio, Sortino ratio, Weighted P/E
- Monthly per-ticker performance heatmap (last 12 months)
- Per-sector return attribution
- Daily/weekly portfolio value change series

### Watchlist
- Add any global ticker with country selection
- Live price + today's % change, 48 h sparklines
- Analyst price targets (Min / Avg / Max) and signal badge
- Fundamentals: Market Cap, Revenue LTM, P/S, P/E (trailing), Forward P/E, 5-year avg P/E
- **Heatmap tab** — treemap of all watchlist tickers colour-coded by daily % change, auto-refreshes every 5 s
- Category tabs with drag-to-reorder, persistent across reloads

### Price Alerts & Notifications
- Set price alerts for any ticker (above / below threshold, in any currency)
- Alerts evaluated after each background portfolio refresh cycle
- In-app notification inbox with unread count badge

### YouTube Feed
- Subscribe to YouTube channels for market/finance content
- Videos fetched and optionally AI-summarised via Gemini on add
- Background refresh keeps the feed current

---

## Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | Python package manager | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python 3.11+ | Runtime | Managed by uv automatically |
| [Docker](https://docs.docker.com/get-docker/) | Container builds (optional, for deploy) | docker.com |
| [gcloud CLI](https://cloud.google.com/sdk/docs/install) | GCP deployment (optional) | cloud.google.com |

---

## Quick Start (Local)

```bash
# 1. Clone the repo
git clone <repo-url> && cd tracker

# 2. One-time setup: creates .venv, installs deps, copies .env.example → .env
make setup

# 3. Edit .env — add your Trading212 API key at minimum (see "API Keys" below)
#    The file is JSON format:
#    {
#      "TRADING212_API_KEY_1": "your-key-here",
#      ...
#    }

# 4. Run
make run
```

Open **http://localhost:8080**

> **Without Make:**
> ```bash
> uv sync
> cp .env.example .env
> # edit .env, then:
> uv run python app.py
> ```

---

## API Keys

The app needs at least a **Trading212 API key** to show portfolio data. All other keys are optional and unlock additional features.

### Trading212 API Key (required)

1. Log in to [Trading212](https://www.trading212.com)
2. Go to **Settings → API (Beta)**
3. Click **Generate** to create a new key
4. Grant at minimum: **Equity → Read** and **History → Read**
5. Copy the values and convert it to base64 encoded `echo -n "<T212_API_KEY>:<T212_API_SECRET>" | base64`
6. Paste it into `.env` as `TRADING212_API_KEY_1`

**To add more portfolios**, generate an API key for each account and add numbered entries:
```json
{
  "TRADING212_API_KEY_1": "key-for-account-one",
  "PORTFOLIO_NAME_1":     "ISA",
  "TRADING212_API_KEY_2": "key-for-account-two",
  "PORTFOLIO_NAME_2":     "SIPP",
  "TRADING212_API_KEY_3": "key-for-account-three",
  "PORTFOLIO_NAME_3":     "Junior ISA"
}
```

The suffix (1, 2, 3 …) can be any string — numeric suffixes are sorted in ascending order, non-numeric suffixes follow alphabetically. There is no upper limit on the number of portfolios.

> To use the **demo** account instead of live, set `TRADING212_BASE_URL` to `https://demo.trading212.com`.

---

### Finnhub Token (optional — earnings, stock metrics, market news)

1. Sign up at [finnhub.io](https://finnhub.io) — free tier is sufficient
2. Go to your [Dashboard](https://finnhub.io/dashboard) and copy the **API key**
3. Set `FINNHUB_TOKEN` in `.env`

---

### Google Gemini API Key (optional — YouTube video summaries)

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click **Create API key**
3. Set `GEMINI_API_KEY` in `.env`

---

### YouTube Data API Key (optional — YouTube feed)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Navigate to **APIs & Services → Library** and enable **YouTube Data API v3**
4. Go to **APIs & Services → Credentials → Create Credentials → API key**
5. Set `YOUTUBE_API_KEY` in `.env`

---

## Environment Variables

All config is loaded from `.env` (local) or `/tmp/config.json` (Cloud Run Secret Manager mount). The file is **JSON format**, not KEY=VALUE.

| Variable | Default | Required | Description |
|---|---|---|---|
| `TRADING212_API_KEY_<id>` | — | **Yes (at least one)** | Trading212 API key for portfolio `<id>`. Add as many as needed — the app discovers all matching env vars automatically. |
| `PORTFOLIO_NAME_<id>` | `Portfolio <id>` | No | Display name for portfolio `<id>`. Must match the suffix of the corresponding API key. |
| `TRADING212_BASE_URL` | `https://live.trading212.com` | No | Switch to `https://demo.trading212.com` for the demo account |
| `FINNHUB_TOKEN` | — | No | Finnhub API key (earnings, stock metrics, news) |
| `GEMINI_API_KEY` | — | No | Google Gemini API key (YouTube video summaries) |
| `GOOGLE_API_KEY` | — | No | Alias for `GEMINI_API_KEY` |
| `YOUTUBE_API_KEY` | — | No | YouTube Data API v3 key |
| `PORT` | `8080` | No | HTTP port (Cloud Run sets this automatically) |
| `DB_PATH` | `portfolio_cache.db` | No | SQLite database file path |
| `DATABASE_URL` | — | No | PostgreSQL DSN — overrides SQLite when set. Required for persistent storage on Cloud Run |
| `CACHE_TTL_SECONDS` | `600` | No | Portfolio rows cache TTL (seconds) |
| `CACHE_TTL_INSTRUMENTS` | `3600` | No | Instrument metadata TTL |
| `CACHE_TTL_DIVIDENDS` | `1800` | No | Dividend data TTL |
| `CACHE_TTL_FX` | `300` | No | FX rate TTL |
| `CACHE_TTL_ORDERS` | `300` | No | Order history TTL |
| `AUTO_REFRESH_SECONDS` | `300` | No | Background portfolio refresh interval |

---

## Docker

```bash
make docker      # build image (linux/amd64)
make docker-run  # run on port 8080, using local .env for config
```

---

## Deploy to GCP Cloud Run

The release script handles git commit, Docker build, Artifact Registry push, Cloud Run deploy, and old-revision cleanup in one step.

### 1. One-time GCP setup

```bash
# Authenticate
gcloud auth login
gcloud auth configure-docker <REGION>-docker.pkg.dev

# Create an Artifact Registry repository
gcloud artifacts repositories create portfolio-tracker \
  --repository-format=docker \
  --location=us-central1

# Create the Secret Manager secret from your local .env file
gcloud secrets create portfolio-tracker-config \
  --data-file=.env \
  --project=your-gcp-project-id

# Grant Cloud Run's service account access to the secret
PROJECT_NUMBER=$(gcloud projects describe your-gcp-project-id --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding portfolio-tracker-config \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=your-gcp-project-id
```

### 2. Configure the release script

Edit the defaults at the top of [scripts/release.sh](scripts/release.sh), or export environment variables before running:

```bash
export GCP_PROJECT=your-gcp-project-id
export CR_SERVICE=portfolio-tracker
export CR_REGION=us-central1
export AR_LOCATION=us-central1
export AR_REPOSITORY=portfolio-tracker
export AR_PACKAGE=app
export GCP_SECRET_NAME=portfolio-tracker-config
```

### 3. Deploy

```bash
./scripts/release.sh                      # commit + build + deploy + cleanup
./scripts/release.sh --no-commit          # skip git commit (already committed)
./scripts/release.sh --no-cleanup         # skip old revision/image pruning
./scripts/release.sh --dry-run            # preview cleanup without deleting
./scripts/release.sh --force-deploy       # force deploy even for docs-only changes
make release                              # shorthand for ./scripts/release.sh
make release ARGS="--no-commit --dry-run" # pass flags via make
```

> **`git push` is manual** — run `git push` after the script completes.

### 4. Update the secret

When you change your `.env` configuration (e.g. rotate an API key), update the secret and redeploy:

```bash
# Add a new secret version from your updated .env
gcloud secrets versions add portfolio-tracker-config \
  --data-file=.env \
  --project=your-gcp-project-id

# Then redeploy
./scripts/release.sh --no-commit
```

### Persistent storage on Cloud Run

Cloud Run instances are ephemeral — the SQLite database resets on each redeploy. For persistent storage, provision a **Cloud SQL (PostgreSQL)** instance and set `DATABASE_URL`:

```bash
gcloud sql instances create portfolio-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1

# Add DATABASE_URL to your secret and redeploy
```

---

## Development

```bash
make setup      # uv sync + copy .env.example → .env (one-time)
make run        # run dev server on http://localhost:8080
make lock       # update uv.lock after changing pyproject.toml
make docker     # build Docker image
make release    # full GCP release pipeline

# Clear the cache without restarting the server
curl -X POST http://localhost:8080/api/admin/clear-cache
```

---

## Architecture

- **Backend**: Python/Flask, single Gunicorn worker + 8 threads
- **Frontend**: Vanilla JS SPA, no framework, canvas-drawn charts
- **Cache**: SQLite (default) or PostgreSQL via `DATABASE_URL`
- **Config**: JSON file loaded by `config.py` — `/tmp/config.json` (Cloud Run) or `.env` (local)
- **Background refresh**: One daemon thread per worker refreshes portfolio data every `AUTO_REFRESH_SECONDS`

See [CLAUDE.md](CLAUDE.md) for development guidance, known constraints, and gotchas.

---

## Security

- Never commit your `.env` file — it is excluded by `.gitignore` by default
- Restrict your Trading212 API key to **read-only** permissions
- On Cloud Run, secrets are injected via Secret Manager volume mount — never stored in the image or plain env vars
- See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy

---

## License

[MIT](LICENSE)
