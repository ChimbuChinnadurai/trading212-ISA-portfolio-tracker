#!/bin/bash
# release.sh — Commit, build, deploy, and clean up in one shot.
#              Git push is intentionally left manual.
#
# Build & deploy (Phase 2) is skipped automatically when only non-critical
# files changed (*.md, *.sh, Makefile, .gitignore, etc.). It runs only when
# at least one of these is modified: *.py *.js *.css *.html requirements.txt
# Dockerfile pyproject.toml
#
# Usage:
#   ./scripts/release.sh                         # commit → build → deploy → cleanup
#   ./scripts/release.sh --no-commit             # skip git commit phase
#   ./scripts/release.sh --no-cleanup            # skip cleanup phase
#   ./scripts/release.sh --keep-revisions 5      # keep 5 Cloud Run revisions (default 3)
#   ./scripts/release.sh --keep-images 3         # keep 3 Artifact Registry images (default 5)
#   ./scripts/release.sh --dry-run               # preview cleanup without deleting
#   ./scripts/release.sh --force-deploy          # force Phase 2 even for docs-only changes
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()        { echo -e "${CYAN}[$(date '+%H:%M:%S')]${RESET} $*"; }
ok()         { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${RESET} $*"; }
warn()       { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${RESET}  $*"; }
die()        { echo -e "${RED}[$(date '+%H:%M:%S')] ✗ ERROR:${RESET} $*" >&2; exit 1; }
phase()      { echo -e "\n${BOLD}━━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"; }
step_start() { echo -e "\n${BOLD}── Step $1: $2 ──${RESET}"; STEP_START=$(date +%s); }
step_end()   { local e=$(( $(date +%s) - STEP_START )); ok "Done in ${e}s"; }

trap 'die "Failed at line $LINENO (exit code $?)."' ERR

# ── GCP Configuration ──────────────────────────────────────────────────────────
REPO="europe-west2-docker.pkg.dev/chimbuc-playground/t212/portfolio"
CR_SERVICE="t212"
CR_REGION="europe-west1"
GCP_PROJECT="chimbuc-playground"
AR_LOCATION="europe-west2"
AR_REPOSITORY="t212"
AR_PACKAGE="portfolio"

# ── Defaults ───────────────────────────────────────────────────────────────────
RUN_COMMIT=1
RUN_CLEANUP=1
DRY_RUN=0
FORCE_DEPLOY=0
KEEP_REVISIONS=3
KEEP_IMAGES=5

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-commit)      RUN_COMMIT=0;    shift ;;
        --no-cleanup)     RUN_CLEANUP=0;   shift ;;
        --dry-run)        DRY_RUN=1;       shift ;;
        --force-deploy)   FORCE_DEPLOY=1;  shift ;;
        --keep-revisions)
            [[ "${2:-}" =~ ^[0-9]+$ ]] || die "--keep-revisions requires a positive integer"
            KEEP_REVISIONS="$2"; shift 2 ;;
        --keep-images)
            [[ "${2:-}" =~ ^[0-9]+$ ]] || die "--keep-images requires a positive integer"
            KEEP_IMAGES="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,12p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *)
            die "Unknown argument: $1. Use --help for usage." ;;
    esac
done

command -v git    &>/dev/null || die "git not found."
command -v docker &>/dev/null || die "docker not found."
command -v gcloud &>/dev/null || die "gcloud CLI not found."

# Move to repo root (script lives in scripts/)
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

RELEASE_START=$(date +%s)
echo -e "\n${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   Trading212 Portfolio Tracker Release   ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
log "Project  : $GCP_PROJECT"
log "Service  : $CR_SERVICE  Region: $CR_REGION"
log "Phases   : $([ $RUN_COMMIT -eq 1 ] && echo 'commit → ')build+deploy$([ $RUN_CLEANUP -eq 1 ] && echo ' → cleanup')"
[[ "$DRY_RUN" -eq 1 ]] && warn "DRY-RUN: cleanup preview only — build/deploy still runs"

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1 — Git commit
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$RUN_COMMIT" -eq 1 ]]; then
    phase "PHASE 1 — Git Commit"

    if git diff --quiet && git diff --cached --quiet; then
        warn "Nothing to commit — working tree is clean. Continuing to build."
    else
        step_start 1 "Stage & commit changes"

        git add -A

        CHANGED_PY=$(git diff --cached --name-only | grep '\.py$'   | xargs -I{} basename {} .py   2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//' || true)
        CHANGED_JS=$(git diff --cached --name-only | grep '\.js$'   | xargs -I{} basename {} .js   2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//' || true)
        CHANGED_CSS=$(git diff --cached --name-only | grep '\.css$' | xargs -I{} basename {} .css  2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//' || true)
        CHANGED_HTML=$(git diff --cached --name-only | grep '\.html$' | xargs -I{} basename {} .html 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//' || true)
        CHANGED_OTHER=$(git diff --cached --name-only | grep -Ev '\.(py|js|css|html)$' | xargs -I{} basename {} 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//' || true)

        TOTAL_FILES=$(git diff --cached --name-only | wc -l | tr -d ' ')
        TOTAL_LINES=$(git diff --cached --stat | tail -1 | grep -oE '[0-9]+ insertion|[0-9]+ deletion' | grep -oE '[0-9]+' | awk '{s+=$1}END{print s}')

        PARTS=()
        [ -n "$CHANGED_PY" ]    && PARTS+=("py:$CHANGED_PY")
        [ -n "$CHANGED_JS" ]    && PARTS+=("js:$CHANGED_JS")
        [ -n "$CHANGED_CSS" ]   && PARTS+=("css:$CHANGED_CSS")
        [ -n "$CHANGED_HTML" ]  && PARTS+=("html:$CHANGED_HTML")
        [ -n "$CHANGED_OTHER" ] && PARTS+=("$CHANGED_OTHER")

        SUBJECT=$(IFS=' | '; echo "${PARTS[*]}")
        SUBJECT="${SUBJECT:0:72}"
        BODY=$(git diff --cached --stat | grep -E '^\s+\S+.*\|' | awk '{printf "- %s\n", $0}' | head -30)
        TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
        FULL_MSG="Update $SUBJECT

$BODY

Files changed: $TOTAL_FILES  |  Lines changed: ${TOTAL_LINES:-?}  |  $TIMESTAMP"

        log "Committing $TOTAL_FILES file(s)..."
        echo -e "\n${BOLD}Message:${RESET}"
        echo "$FULL_MSG"
        echo ""
        git commit -m "$FULL_MSG"
        ok "Committed. (push manually when ready)"
        echo ""
        git log --oneline -5
        step_end
    fi
fi

# ── Deploy gate: skip Phase 2 if only non-critical files changed ──────────────
# Core files: anything that affects the running application
CORE_RE='\.(py|js|css|html)$|requirements\.txt$|Dockerfile$|pyproject\.toml$'
SKIP_DEPLOY=0
FULL_IMAGE=""

if [[ "$FORCE_DEPLOY" -eq 0 ]]; then
    if git rev-parse HEAD~1 &>/dev/null; then
        LAST_COMMIT_CORE=$(git diff HEAD~1 HEAD --name-only | grep -E "$CORE_RE" || true)
        if [[ -z "$LAST_COMMIT_CORE" ]]; then
            SKIP_DEPLOY=1
            CHANGED_ALL=$(git diff HEAD~1 HEAD --name-only | tr '\n' ' ')
            SKIP_REASON="Only non-critical files changed: ${CHANGED_ALL:-none}"
        fi
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — Docker build, push & Cloud Run deploy
# ══════════════════════════════════════════════════════════════════════════════
phase "PHASE 2 — Build & Deploy"

if [[ "$SKIP_DEPLOY" -eq 1 ]]; then
    warn "Skipping build & deploy — $SKIP_REASON"
    warn "Deploy only runs when these change: *.py *.js *.css *.html requirements.txt Dockerfile pyproject.toml"
    warn "Use --force-deploy to override."
else

step_start 1 "Resolve version tag"
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

log "Latest: ${LATEST_VERSION:-(none)}  →  New: ${BOLD}${NEW_VERSION}${RESET}"
FULL_IMAGE="$REPO:$NEW_VERSION"
step_end

step_start 2 "Docker build  →  $FULL_IMAGE"
docker build --platform=linux/amd64 -t "$FULL_IMAGE" .
step_end

step_start 3 "Docker push  →  $FULL_IMAGE"
docker push "$FULL_IMAGE"
step_end

step_start 4 "Cloud Run deploy"
log "Deploying $CR_SERVICE @ $CR_REGION with $NEW_VERSION..."
gcloud beta run deploy "$CR_SERVICE" \
    --image="$FULL_IMAGE" \
    --min-instances=0 \
    --set-secrets=/tmp/config.json=t212:latest \
    --no-cpu-boost \
    --region="$CR_REGION" \
    --project="$GCP_PROJECT"
step_end

step_start 5 "Shift traffic to latest revision"
gcloud run services update-traffic "$CR_SERVICE" \
    --region="$CR_REGION" \
    --to-latest
step_end

fi  # end SKIP_DEPLOY check

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3 — Cleanup old revisions & images
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$RUN_CLEANUP" -eq 1 ]]; then
    phase "PHASE 3 — Cleanup"
    [[ "$DRY_RUN" -eq 1 ]] && warn "DRY-RUN mode — nothing will be deleted"

    # ── Cloud Run revisions ──────────────────────────────────────────────────
    echo -e "${BOLD}── Cloud Run Revisions ──${RESET}"
    ACTIVE_REVISIONS=$(gcloud run services describe "$CR_SERVICE" \
        --region="$CR_REGION" --project="$GCP_PROJECT" \
        --format="value(spec.traffic[].revisionName)" 2>/dev/null \
        | tr ';' '\n' | sort -u)

    ALL_REVISIONS=$(gcloud run revisions list \
        --service="$CR_SERVICE" --region="$CR_REGION" --project="$GCP_PROJECT" \
        --sort-by="~metadata.creationTimestamp" \
        --format="value(metadata.name)" 2>/dev/null)

    if [[ -z "$ALL_REVISIONS" ]]; then
        ok "No revisions found."
    else
        TOTAL=$(echo "$ALL_REVISIONS" | wc -l | tr -d ' ')
        TO_DELETE=$(echo "$ALL_REVISIONS" | tail -n +"$(( KEEP_REVISIONS + 1 ))")

        if [[ -z "$TO_DELETE" ]]; then
            ok "$TOTAL revision(s) exist — nothing to delete (keeping $KEEP_REVISIONS)."
        else
            SAFE_TO_DELETE=(); SKIPPED=()
            while IFS= read -r rev; do
                if echo "$ACTIVE_REVISIONS" | grep -qx "$rev"; then
                    SKIPPED+=("$rev")
                else
                    SAFE_TO_DELETE+=("$rev")
                fi
            done <<< "$TO_DELETE"

            [[ "${#SKIPPED[@]}" -gt 0 ]] && warn "Skipping ${#SKIPPED[@]} active revision(s): ${SKIPPED[*]}"

            if [[ "${#SAFE_TO_DELETE[@]}" -eq 0 ]]; then
                ok "No revisions eligible for deletion."
            else
                CR_DELETED=0; CR_FAILED=0
                for rev in "${SAFE_TO_DELETE[@]}"; do
                    if [[ "$DRY_RUN" -eq 1 ]]; then
                        warn "[dry-run] Would delete: $rev"
                    elif gcloud run revisions delete "$rev" \
                            --region="$CR_REGION" --project="$GCP_PROJECT" \
                            --quiet 2>/dev/null; then
                        ok "Deleted $rev"; (( CR_DELETED++ )) || true
                    else
                        warn "Failed to delete $rev"; (( CR_FAILED++ )) || true
                    fi
                done
                [[ "$DRY_RUN" -eq 0 ]] && ok "Revisions: deleted $CR_DELETED, failed $CR_FAILED"
            fi
        fi
    fi
    echo

    # ── Artifact Registry images ─────────────────────────────────────────────
    echo -e "${BOLD}── Artifact Registry Images ──${RESET}"
    VERSIONS_TO_DELETE=$(gcloud artifacts versions list \
        --project="$GCP_PROJECT" --location="$AR_LOCATION" \
        --repository="$AR_REPOSITORY" --package="$AR_PACKAGE" \
        --sort-by="~CREATE_TIME" --format="value(name)" 2>/dev/null \
        | sed "1,${KEEP_IMAGES}d")

    if [[ -z "$VERSIONS_TO_DELETE" ]]; then
        ok "Nothing to delete — $KEEP_IMAGES or fewer versions exist."
    else
        AR_DELETED=0; AR_FAILED=0
        while IFS= read -r version; do
            if [[ "$DRY_RUN" -eq 1 ]]; then
                warn "[dry-run] Would delete: $version"
            elif gcloud artifacts versions delete "$version" \
                    --project="$GCP_PROJECT" --location="$AR_LOCATION" \
                    --repository="$AR_REPOSITORY" --package="$AR_PACKAGE" \
                    --delete-tags --quiet 2>/dev/null; then
                ok "Deleted $version"; (( AR_DELETED++ )) || true
            else
                warn "Failed to delete $version"; (( AR_FAILED++ )) || true
            fi
        done <<< "$VERSIONS_TO_DELETE"
        [[ "$DRY_RUN" -eq 0 ]] && ok "Images: deleted $AR_DELETED, failed $AR_FAILED"
    fi
fi

# ── Summary ────────────────────────────────────────────────────────────────────
TOTAL=$(( $(date +%s) - RELEASE_START ))
echo -e "\n${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Done in ${TOTAL}s${RESET}"
if [[ "$SKIP_DEPLOY" -eq 1 ]]; then
    echo -e "${YELLOW}${BOLD}  Deploy: skipped (docs-only change)${RESET}"
    echo -e "${YELLOW}${BOLD}  Tip   : use --force-deploy to override${RESET}"
else
    echo -e "${GREEN}${BOLD}  Image : ${FULL_IMAGE}${RESET}"
    echo -e "${YELLOW}${BOLD}  Push  : git push   ← still manual${RESET}"
fi
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
