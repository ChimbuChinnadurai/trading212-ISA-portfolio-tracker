#!/bin/bash
# cleanup.sh — Delete old Cloud Run revisions AND old Artifact Registry image versions.
#
# Usage:
#   ./scripts/cleanup.sh                          # defaults: keep 3 revisions, 5 images
#   ./scripts/cleanup.sh --keep-revisions 5       # keep 5 Cloud Run revisions
#   ./scripts/cleanup.sh --keep-images 3          # keep 3 Artifact Registry images
#   ./scripts/cleanup.sh --revisions-only         # skip Artifact Registry cleanup
#   ./scripts/cleanup.sh --artifacts-only         # skip Cloud Run revision cleanup
#   ./scripts/cleanup.sh --dry-run                # preview without deleting anything
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${RESET} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${RESET} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${RESET}  $*"; }
die()  { echo -e "${RED}[$(date '+%H:%M:%S')] ✗ ERROR:${RESET} $*" >&2; exit 1; }

trap 'die "Script failed at line $LINENO (exit code $?)."' ERR

# ── Configuration ──────────────────────────────────────────────────────────────
GCP_PROJECT="chimbuc-playground"

# Cloud Run
CR_SERVICE="t212"
CR_REGION="europe-west1"
KEEP_REVISIONS=3

# Artifact Registry
AR_LOCATION="europe-west2"
AR_REPOSITORY="t212"
AR_PACKAGE="portfolio"
KEEP_IMAGES=5

# Flags
DRY_RUN=0
RUN_REVISIONS=1
RUN_ARTIFACTS=1

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --keep-revisions)
            [[ "${2:-}" =~ ^[0-9]+$ ]] || die "--keep-revisions requires a positive integer"
            KEEP_REVISIONS="$2"; shift 2 ;;
        --keep-images)
            [[ "${2:-}" =~ ^[0-9]+$ ]] || die "--keep-images requires a positive integer"
            KEEP_IMAGES="$2"; shift 2 ;;
        --revisions-only)
            RUN_ARTIFACTS=0; shift ;;
        --artifacts-only)
            RUN_REVISIONS=0; shift ;;
        --dry-run)
            DRY_RUN=1; shift ;;
        -h|--help)
            sed -n '2,9p' "$0" | sed 's/^# \?//'
            exit 0 ;;
        *)
            die "Unknown argument: $1. Use --help for usage." ;;
    esac
done

[[ "$KEEP_REVISIONS" -ge 1 ]] || die "--keep-revisions must be at least 1"
[[ "$KEEP_IMAGES"    -ge 1 ]] || die "--keep-images must be at least 1"
command -v gcloud &>/dev/null  || die "gcloud CLI not found. Install the Google Cloud SDK."

# ── Banner ─────────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║          GCP Resource Cleanup Tool       ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
log "Project  : $GCP_PROJECT"
[[ "$RUN_REVISIONS" -eq 1 ]] && log "Revisions: keep $KEEP_REVISIONS  ($CR_SERVICE @ $CR_REGION)"
[[ "$RUN_ARTIFACTS" -eq 1 ]] && log "Images   : keep $KEEP_IMAGES  ($AR_REPOSITORY/$AR_PACKAGE @ $AR_LOCATION)"
[[ "$DRY_RUN"       -eq 1 ]] && warn "DRY-RUN mode — nothing will be deleted"
echo

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Cloud Run revisions
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$RUN_REVISIONS" -eq 1 ]]; then
    echo -e "${BOLD}── Cloud Run Revisions ───────────────────────────────────────────────${RESET}"

    log "Fetching active traffic assignments..."
    ACTIVE_REVISIONS=$(gcloud run services describe "$CR_SERVICE" \
        --region="$CR_REGION" \
        --project="$GCP_PROJECT" \
        --format="value(spec.traffic[].revisionName)" 2>/dev/null \
        | tr ';' '\n' | sort -u)

    [[ -z "$ACTIVE_REVISIONS" ]] && warn "Could not determine active revisions — none will be excluded."

    log "Listing all revisions for '$CR_SERVICE'..."
    ALL_REVISIONS=$(gcloud run revisions list \
        --service="$CR_SERVICE" \
        --region="$CR_REGION" \
        --project="$GCP_PROJECT" \
        --sort-by="~metadata.creationTimestamp" \
        --format="value(metadata.name)" 2>/dev/null)

    if [[ -z "$ALL_REVISIONS" ]]; then
        ok "No revisions found. Nothing to do."
    else
        TOTAL=$(echo "$ALL_REVISIONS" | wc -l | tr -d ' ')
        log "Found $TOTAL revision(s) total."

        TO_DELETE=$(echo "$ALL_REVISIONS" | tail -n +"$(( KEEP_REVISIONS + 1 ))")

        if [[ -z "$TO_DELETE" ]]; then
            ok "Only $TOTAL revision(s) exist — nothing to delete (keeping $KEEP_REVISIONS)."
        else
            SAFE_TO_DELETE=(); SKIPPED=()
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
            else
                log "${#SAFE_TO_DELETE[@]} revision(s) queued for deletion:"
                for rev in "${SAFE_TO_DELETE[@]}"; do log "  • $rev"; done

                CR_DELETED=0; CR_FAILED=0
                for rev in "${SAFE_TO_DELETE[@]}"; do
                    if [[ "$DRY_RUN" -eq 1 ]]; then
                        warn "[dry-run] Would delete revision: $rev"
                    else
                        if gcloud run revisions delete "$rev" \
                                --region="$CR_REGION" \
                                --project="$GCP_PROJECT" \
                                --quiet 2>/dev/null; then
                            ok "Deleted $rev"
                            (( CR_DELETED++ )) || true
                        else
                            warn "Failed to delete $rev — skipping"
                            (( CR_FAILED++ )) || true
                        fi
                    fi
                done

                [[ "$DRY_RUN" -eq 0 ]] && ok "Revisions: deleted $CR_DELETED, failed $CR_FAILED"
            fi
        fi
    fi
    echo
fi

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Artifact Registry image versions
# ══════════════════════════════════════════════════════════════════════════════
if [[ "$RUN_ARTIFACTS" -eq 1 ]]; then
    echo -e "${BOLD}── Artifact Registry Images ──────────────────────────────────────────${RESET}"

    log "Listing image versions for '$AR_REPOSITORY/$AR_PACKAGE'..."
    VERSIONS_TO_DELETE=$(gcloud artifacts versions list \
        --project="$GCP_PROJECT" \
        --location="$AR_LOCATION" \
        --repository="$AR_REPOSITORY" \
        --package="$AR_PACKAGE" \
        --sort-by="~CREATE_TIME" \
        --format="value(name)" 2>/dev/null | sed "1,${KEEP_IMAGES}d")

    if [[ -z "$VERSIONS_TO_DELETE" ]]; then
        ok "Nothing to delete — $KEEP_IMAGES or fewer versions exist."
    else
        VERSION_COUNT=$(echo "$VERSIONS_TO_DELETE" | wc -l | tr -d ' ')
        log "$VERSION_COUNT version(s) queued for deletion:"
        while IFS= read -r v; do log "  • $v"; done <<< "$VERSIONS_TO_DELETE"

        AR_DELETED=0; AR_FAILED=0
        while IFS= read -r version; do
            if [[ "$DRY_RUN" -eq 1 ]]; then
                warn "[dry-run] Would delete image: $version"
            else
                if gcloud artifacts versions delete "$version" \
                        --project="$GCP_PROJECT" \
                        --location="$AR_LOCATION" \
                        --repository="$AR_REPOSITORY" \
                        --package="$AR_PACKAGE" \
                        --delete-tags \
                        --quiet 2>/dev/null; then
                    ok "Deleted $version"
                    (( AR_DELETED++ )) || true
                else
                    warn "Failed to delete $version — skipping"
                    (( AR_FAILED++ )) || true
                fi
            fi
        done <<< "$VERSIONS_TO_DELETE"

        [[ "$DRY_RUN" -eq 0 ]] && ok "Images: deleted $AR_DELETED, failed $AR_FAILED"
    fi
    echo
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
if [[ "$DRY_RUN" -eq 1 ]]; then
    echo -e "${YELLOW}${BOLD}  Dry-run complete — no resources were deleted${RESET}"
else
    echo -e "${GREEN}${BOLD}  Cleanup complete${RESET}"
fi
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
