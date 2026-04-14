#!/bin/bash
# cleanup.sh — Delete old Cloud Run revisions, keeping the N most recent.
#
# Usage:
#   ./scripts/cleanup.sh           # keeps 3 most recent revisions (default)
#   ./scripts/cleanup.sh --keep 5  # keeps 5 most recent revisions
#   ./scripts/cleanup.sh --dry-run # preview without deleting
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()   { echo -e "${CYAN}[$(date '+%H:%M:%S')]${RESET} $*"; }
ok()    { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${RESET} $*"; }
warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${RESET}  $*"; }
die()   { echo -e "${RED}[$(date '+%H:%M:%S')] ✗ ERROR:${RESET} $*" >&2; exit 1; }

trap 'die "Script failed at line $LINENO (exit code $?)."' ERR

# ── Configuration ──────────────────────────────────────────────────────────────
CLOUD_RUN_SERVICE="t212"
CLOUD_RUN_REGION="europe-west1"
GCP_PROJECT="chimbuc-playground"
KEEP=3       # revisions to keep (overridden by --keep)
DRY_RUN=0

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --keep)
            [[ "${2:-}" =~ ^[0-9]+$ ]] || die "--keep requires a positive integer"
            KEEP="$2"; shift 2 ;;
        --dry-run)
            DRY_RUN=1; shift ;;
        -h|--help)
            sed -n '2,5p' "$0" | sed 's/^# \?//'
            exit 0 ;;
        *)
            die "Unknown argument: $1. Use --help for usage." ;;
    esac
done

[[ "$KEEP" -ge 1 ]] || die "--keep must be at least 1"

# ── Banner ─────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║     Cloud Run Revision Cleanup Tool      ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
log "Service : $CLOUD_RUN_SERVICE"
log "Region  : $CLOUD_RUN_REGION"
log "Project : $GCP_PROJECT"
log "Keep    : $KEEP most recent revision(s)"
[[ "$DRY_RUN" -eq 1 ]] && warn "DRY-RUN mode — no revisions will be deleted"

# ── Prerequisite check ─────────────────────────────────────────────────────────
command -v gcloud &>/dev/null || die "gcloud CLI not found. Install the Google Cloud SDK."

# ── Fetch active (traffic-serving) revision names ──────────────────────────────
log "Fetching active traffic assignments..."
ACTIVE_REVISIONS=$(gcloud run services describe "$CLOUD_RUN_SERVICE" \
    --region="$CLOUD_RUN_REGION" \
    --project="$GCP_PROJECT" \
    --format="value(spec.traffic[].revisionName)" 2>/dev/null | tr ';' '\n' | sort -u)

if [[ -z "$ACTIVE_REVISIONS" ]]; then
    warn "Could not determine active revisions — none will be excluded from deletion."
fi

# ── Fetch all revisions, newest first ─────────────────────────────────────────
log "Listing all revisions for '$CLOUD_RUN_SERVICE'..."
ALL_REVISIONS=$(gcloud run revisions list \
    --service="$CLOUD_RUN_SERVICE" \
    --region="$CLOUD_RUN_REGION" \
    --project="$GCP_PROJECT" \
    --sort-by="~metadata.creationTimestamp" \
    --format="value(metadata.name)" 2>/dev/null)

if [[ -z "$ALL_REVISIONS" ]]; then
    ok "No revisions found. Nothing to do."
    exit 0
fi

TOTAL=$(echo "$ALL_REVISIONS" | wc -l | tr -d ' ')
log "Found $TOTAL revision(s) total."

# ── Determine which revisions to delete ───────────────────────────────────────
TO_DELETE=$(echo "$ALL_REVISIONS" | tail -n +"$(( KEEP + 1 ))")

if [[ -z "$TO_DELETE" ]]; then
    ok "Only $TOTAL revision(s) exist — nothing to delete (keeping $KEEP)."
    exit 0
fi

# Filter out any actively-serving revisions as a safety net
SAFE_TO_DELETE=()
SKIPPED=()
while IFS= read -r rev; do
    if echo "$ACTIVE_REVISIONS" | grep -qx "$rev"; then
        SKIPPED+=("$rev")
    else
        SAFE_TO_DELETE+=("$rev")
    fi
done <<< "$TO_DELETE"

if [[ "${#SKIPPED[@]}" -gt 0 ]]; then
    warn "Skipping ${#SKIPPED[@]} revision(s) still serving traffic:"
    for rev in "${SKIPPED[@]}"; do warn "  • $rev (active)"; done
fi

if [[ "${#SAFE_TO_DELETE[@]}" -eq 0 ]]; then
    ok "No revisions eligible for deletion after excluding active ones."
    exit 0
fi

log "${#SAFE_TO_DELETE[@]} revision(s) queued for deletion:"
for rev in "${SAFE_TO_DELETE[@]}"; do log "  • $rev"; done

# ── Delete ─────────────────────────────────────────────────────────────────────
DELETED=0
FAILED=0
for rev in "${SAFE_TO_DELETE[@]}"; do
    if [[ "$DRY_RUN" -eq 1 ]]; then
        warn "[dry-run] Would delete: $rev"
    else
        if gcloud run revisions delete "$rev" \
                --region="$CLOUD_RUN_REGION" \
                --project="$GCP_PROJECT" \
                --quiet 2>/dev/null; then
            ok "Deleted $rev"
            (( DELETED++ )) || true
        else
            warn "Failed to delete $rev — skipping"
            (( FAILED++ )) || true
        fi
    fi
done

# ── Summary ────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo -e "${YELLOW}${BOLD}  Dry-run complete — ${#SAFE_TO_DELETE[@]} revision(s) would be deleted${RESET}"
else
    echo -e "${GREEN}${BOLD}  Done — deleted $DELETED, skipped $FAILED failure(s)${RESET}"
fi
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${RESET}\n"
