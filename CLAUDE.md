# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

Python/Flask backend + vanilla JS/HTML/CSS frontend portfolio tracker. Always consider both backend and frontend implications of any change.

## Code Changes

Before editing any file, read it first. Before modifying a function, grep for all callers. Research before you edit.

When removing a feature or function, search the entire codebase for ALL callers/references before confirming removal is complete.

## Interaction Style

When asked to explore or suggest, give a concise answer first, then offer to dive deeper. Do not read files extensively before responding.

---

## Commands

```bash
make setup          # one-time: creates .venv, installs deps, copies .env.example → .env
source .venv/bin/activate
make run            # python app.py — serves on http://localhost:8080
make freeze         # pip freeze > requirements.txt (after adding a package)
make release        # commit → docker build → Cloud Run deploy → cleanup
make release ARGS="--no-commit --dry-run"   # flag passthrough
# git push is still manual after release.sh
curl -X POST http://localhost:8080/api/admin/clear-cache   # clear cache without restart
```

---

## Non-obvious rules & gotchas

### Money is always GBP server-side
All monetary values are stored and returned in GBP. USD conversion is display-only in `currency.js` via `fmt.currency()`. Never store USD server-side, never use `toFixed(2)` for display — always `fmt.currency(value)`.

### Combined portfolio pid
The aggregated view uses pid string `"combined"` — handled specially in most endpoints and in `router.js`. Don't hardcode numeric pids.

### Cache is the source of truth
Read pattern everywhere: check cache → return if fresh → fetch live → write cache → return. `cache.py` is the single place this logic lives.

### One Gunicorn worker, 8 threads
This keeps exactly one background-refresh daemon alive. Do not increase workers without reconsidering the background thread design.

### config.py must be updated for new env vars
In production, secrets are read from `/tmp/config.json` (Secret Manager). `config.py` falls back to env vars / `.env` locally. **Always update `config.py` when adding a new env variable.**

### SPA navigation — never touch `location.hash` directly
All view transitions go through `navigate(route)` in `router.js`. Direct `location.hash` assignment bypasses the router lifecycle.

### Canvas charts — use requestAnimationFrame
All charts are drawn on `<canvas>` with no library. Always call drawing code inside `requestAnimationFrame` when the element may not yet be visible. DPR pattern: `canvas.width = W * dpr; ctx.scale(dpr, dpr)`.

### CSS flex/overflow/sticky — verify heights after changes
After flex layout or overflow changes, check that container heights are not collapsed to 0px.

### Yahoo Finance is unreliable
Rate-limited and frequently breaks. Use bulk downloads over individual requests. Use SSE for long-running fetches. Always handle stale/incomplete data with fallbacks.

### UK stocks need fallbacks
LSE-listed stock logos and data sources differ from US. Always test with UK ticker symbols (e.g. BARC, VWRL) and implement fallback sources when primary sources fail.

---

## Hard constraints (do not change)

- **Vanilla JS only** — no React, Vue, Angular, or any JS framework
- **Flask only** — no FastAPI
- **SQLite by default** — PostgreSQL only via `DATABASE_URL`; no Redis
- **No chart library** — canvas drawn manually
- **Desktop = fixed viewport** (`fixed-layout` class, no scroll); mobile (≤768px) scrolls normally

---

## Known gaps

- No unit tests
- `sectors.py` ticker→sector map is manual — new tickers may fall through to keyword fallback
- SQLite resets on Cloud Run redeploy — use `DATABASE_URL` (PostgreSQL) for persistence
- Cache does not auto-purge stale rows
- Drawdown chart does not auto-redraw on theme toggle (redraws on next range-tab click)
