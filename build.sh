#!/bin/bash
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ── Helpers ────────────────────────────────────────────────────────────────────
log()   { echo -e "${CYAN}[$(date '+%H:%M:%S')]${RESET} $*"; }
ok()    { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${RESET} $*"; }
warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${RESET}  $*"; }
die()   { echo -e "${RED}[$(date '+%H:%M:%S')] ✗ ERROR:${RESET} $*" >&2; exit 1; }

step_start() { echo -e "\n${BOLD}── Step $1: $2 ──${RESET}"; STEP_START=$(date +%s); }
step_end()   {
    local elapsed=$(( $(date +%s) - STEP_START ))
    ok "Done in ${elapsed}s"
}

# ── Error trap ─────────────────────────────────────────────────────────────────
trap 'die "Build failed at line $LINENO (exit code $?). Check output above."' ERR

# ── Configuration ──────────────────────────────────────────────────────────────
REPO="europe-west2-docker.pkg.dev/chimbuc-playground/t212/portfolio"
CLOUD_RUN_SERVICE="t212"
CLOUD_RUN_REGION="europe-west1"
GCP_PROJECT="chimbuc-playground"

BUILD_START=$(date +%s)
echo -e "\n${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║    Trading212 Portfolio Tracker Build    ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
log "Repo  : $REPO"
log "Service: $CLOUD_RUN_SERVICE  Region: $CLOUD_RUN_REGION  Project: $GCP_PROJECT"

# ── Step 1: Resolve next version tag ──────────────────────────────────────────
step_start 1 "Resolve version tag"
log "Fetching tags from Artifact Registry..."

RAW_TAGS=$(gcloud artifacts docker images list "$REPO" \
    --include-tags --format="value(TAGS)" 2>&1) \
    || die "gcloud artifacts list failed:\n$RAW_TAGS"

LATEST_VERSION=$(echo "$RAW_TAGS" | tr ',' '\n' | \
    grep -E '^v[0-9]+$' | sed 's/^v//' | sort -n | tail -n 1)

if [ -z "$LATEST_VERSION" ]; then
    warn "No existing v* tags found — starting at v1."
    NEW_VERSION="v1"
else
    NEW_VERSION="v$(( LATEST_VERSION + 1 ))"
fi

log "Latest published : ${LATEST_VERSION:-(none)}"
log "New version      : ${BOLD}${NEW_VERSION}${RESET}"
FULL_IMAGE="$REPO:$NEW_VERSION"
step_end

# ── Step 2: Docker build ───────────────────────────────────────────────────────
step_start 2 "Docker build  →  $FULL_IMAGE"
docker build --platform=linux/amd64 -t "$FULL_IMAGE" . \
    || die "docker build failed"
step_end

# ── Step 3: Docker push ────────────────────────────────────────────────────────
step_start 3 "Docker push  →  $FULL_IMAGE"
docker push "$FULL_IMAGE" \
    || die "docker push failed — check Artifact Registry permissions"
step_end

# ── Step 4: Cloud Run deploy ───────────────────────────────────────────────────
step_start 4 "Cloud Run deploy"
log "Deploying $CLOUD_RUN_SERVICE with image $NEW_VERSION..."

gcloud run deploy "$CLOUD_RUN_SERVICE" \
    --image="$FULL_IMAGE" \
    --min-instances=0 \
    --set-env-vars=PORTFOLIO_NAME_1=Chimbu,PORTFOLIO_NAME_2=Poornima \
    --set-secrets=FINNHUB_TOKEN=finhub:latest,TRADING212_API_KEY_1=t212-chimbu:latest,TRADING212_API_KEY_2=t212-poornima:latest,MASSIVE_API_KEY=MASSIVE_API_KEY:latest,DATABASE_URL=t212-database-url:latest \
    --no-cpu-boost \
    --region="$CLOUD_RUN_REGION" \
    --project="$GCP_PROJECT" \
    || die "gcloud run deploy failed"
step_end

# ── Step 5: Route traffic to latest ───────────────────────────────────────────
step_start 5 "Shift traffic to latest revision"
gcloud run services update-traffic "$CLOUD_RUN_SERVICE" \
    --region="$CLOUD_RUN_REGION" \
    --to-latest \
    || die "update-traffic failed"
step_end

# ── Summary ────────────────────────────────────────────────────────────────────
TOTAL=$(( $(date +%s) - BUILD_START ))
echo -e "\n${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Build & deploy complete in ${TOTAL}s${RESET}"
echo -e "${GREEN}${BOLD}  Image : ${FULL_IMAGE}${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${RESET}\n"
