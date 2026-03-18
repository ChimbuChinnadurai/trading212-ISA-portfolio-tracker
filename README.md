# Trading212 Portfolio Tracker

A lightweight web application that fetches your **Shares ISA** positions from the Trading212 API and displays them in a clean, sortable dashboard.

## Features

- Live portfolio table: company name, ticker, shares, avg price, current value, invested amount, returns, returns %, dividends
- Summary cards (total invested, current value, total returns, dividends)
- Client-side search and column sorting
- Totals footer row
- Deployed on **GCP Cloud Run** via Docker

## Local development

```bash
# 1. Create a virtual environment
python -m venv .venv && source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure your API key
cp .env.example .env
# Edit .env and set TRADING212_API_KEY

# 4. Run (loads .env automatically via your shell or python-dotenv)
export $(cat .env | xargs) && python app.py
```

Open http://localhost:8080

## Docker

```bash
docker build -t portfolio-tracker .
docker run -p 8080:8080 -e TRADING212_API_KEY=your_key_here portfolio-tracker
```

## Deploy to GCP Cloud Run

```bash
# 1. Build & push to Artifact Registry
PROJECT_ID=your-gcp-project
IMAGE=us-central1-docker.pkg.dev/$PROJECT_ID/portfolio/tracker

docker build -t $IMAGE .
docker push $IMAGE

# 2. Deploy
gcloud run deploy portfolio-tracker \
  --image $IMAGE \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars TRADING212_API_KEY=your_key_here,TRADING212_BASE_URL=https://live.trading212.com
```

The API key should be stored in **Secret Manager** in production:

```bash
# Store secret
echo -n "your_key_here" | gcloud secrets create trading212-api-key --data-file=-

# Deploy with secret
gcloud run deploy portfolio-tracker \
  --image $IMAGE \
  --region us-central1 \
  --set-secrets TRADING212_API_KEY=trading212-api-key:latest
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TRADING212_API_KEY` | `YOUR_API_KEY_HERE` | Your Trading212 API key |
| `TRADING212_BASE_URL` | `https://live.trading212.com` | API base URL (`demo` or `live`) |
| `PORT` | `8080` | HTTP port (Cloud Run sets this automatically) |

## Trading212 API key

Generate your key at **Settings → API (Beta)** in your Trading212 account. Grant at minimum: **Portfolio read**, **History read**.
