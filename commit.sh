#!/bin/bash
set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; RESET='\033[0m'

log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${RESET} $*"; }
ok()   { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${RESET} $*"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${RESET}  $*"; }
die()  { echo -e "\033[0;31m[$(date '+%H:%M:%S')] ✗ ERROR:${RESET} $*" >&2; exit 1; }

cd "$(dirname "$0")"

# ── Check there is something to commit ────────────────────────────────────────
if git diff --quiet && git diff --cached --quiet; then
    warn "Nothing to commit — working tree is clean."
    exit 0
fi

# ── Stage all changes ──────────────────────────────────────────────────────────
git add -A

# ── Build commit message from staged diff ─────────────────────────────────────
# Collect changed file basenames grouped by type
CHANGED_PY=$(git diff --cached --name-only | grep '\.py$' | xargs -I{} basename {} .py 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//')
CHANGED_JS=$(git diff --cached --name-only | grep '\.js$' | xargs -I{} basename {} .js 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//')
CHANGED_CSS=$(git diff --cached --name-only | grep '\.css$' | xargs -I{} basename {} .css 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//')
CHANGED_HTML=$(git diff --cached --name-only | grep '\.html$' | xargs -I{} basename {} .html 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//')
CHANGED_OTHER=$(git diff --cached --name-only | grep -Ev '\.(py|js|css|html)$' | xargs -I{} basename {} 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//')

TOTAL_FILES=$(git diff --cached --name-only | wc -l | tr -d ' ')
TOTAL_LINES=$(git diff --cached --stat | tail -1 | grep -oE '[0-9]+ insertion|[0-9]+ deletion' | grep -oE '[0-9]+' | awk '{s+=$1}END{print s}')

# Build subject line
PARTS=()
[ -n "$CHANGED_PY" ]   && PARTS+=("py:$CHANGED_PY")
[ -n "$CHANGED_JS" ]   && PARTS+=("js:$CHANGED_JS")
[ -n "$CHANGED_CSS" ]  && PARTS+=("css:$CHANGED_CSS")
[ -n "$CHANGED_HTML" ] && PARTS+=("html:$CHANGED_HTML")
[ -n "$CHANGED_OTHER" ] && PARTS+=("$CHANGED_OTHER")

SUBJECT=$(IFS=' | '; echo "${PARTS[*]}")
# Truncate subject to 72 chars
SUBJECT="${SUBJECT:0:72}"

# Build body: one bullet per changed file with its +/- stats
BODY=$(git diff --cached --stat | grep -E '^\s+\S+.*\|' | \
    awk '{printf "- %s\n", $0}' | head -30)

TIMESTAMP=$(date '+%Y-%m-%d %H:%M')

FULL_MSG="Update $SUBJECT

$BODY

Files changed: $TOTAL_FILES  |  Lines changed: ${TOTAL_LINES:-?}  |  $TIMESTAMP"

# ── Commit ─────────────────────────────────────────────────────────────────────
log "Committing $TOTAL_FILES file(s)..."
echo -e "\n${BOLD}Message:${RESET}"
echo "$FULL_MSG"
echo ""

git commit -m "$FULL_MSG"

ok "Committed successfully."
echo ""
git log --oneline -5
