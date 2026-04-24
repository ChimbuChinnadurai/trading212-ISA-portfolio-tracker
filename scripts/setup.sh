#!/bin/bash
set -euo pipefail

VENV_DIR=".venv"
PYTHON="${PYTHON:-python3}"

# Colours
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✓${RESET} $*"; }
log()  { echo -e "${CYAN}→${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }

# Verify Python 3.10+
PY_VERSION=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
    echo "Python 3.10+ required (found $PY_VERSION)" >&2
    exit 1
fi
log "Python $PY_VERSION detected"

# Create venv if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    log "Creating virtual environment in $VENV_DIR …"
    $PYTHON -m venv "$VENV_DIR"
    ok "Virtual environment created"
else
    warn "Virtual environment already exists — skipping creation"
fi

# Activate and install dependencies
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
log "Installing dependencies from requirements.txt …"
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
ok "Dependencies installed"

# Copy .env if missing
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    warn ".env created from .env.example — edit it to add your API keys"
fi

echo ""
echo -e "${GREEN}Setup complete.${RESET}"
echo "  Activate : source $VENV_DIR/bin/activate"
echo "  Run      : python app.py"
