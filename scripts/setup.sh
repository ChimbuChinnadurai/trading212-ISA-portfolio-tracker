#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
log()  { echo -e "${CYAN}→${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }

# Check uv is installed
if ! command -v uv &>/dev/null; then
    echo "uv not found — install it first:" >&2
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
    exit 1
fi

log "Installing dependencies with uv …"
uv sync
ok "Dependencies installed"

# Copy .env if missing
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    warn ".env created from .env.example — edit it to add your API keys"
fi

echo ""
echo -e "${GREEN}Setup complete.${RESET}"
echo "  Run : uv run python app.py"
echo "  Or  : source .venv/bin/activate && python app.py"
