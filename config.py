"""
config.py — Load app configuration from a JSON secrets file into os.environ.

Search order (first match wins):
  1. /tmp/config.json     — Cloud Run secret volume mount
  2. .env                 — Local development (JSON format)

Keys already present in the process environment (e.g. real Cloud Run env vars)
are NOT overwritten, so env vars always take precedence over the file.
"""

import json
import logging
import os

logger = logging.getLogger("config")

_SEARCH_PATHS = [
    "/tmp/config.json",  # Cloud Run: Secret Manager volume mount
    os.path.join(os.path.dirname(__file__), ".env"),  # Local dev
]


def _load():
    for path in _SEARCH_PATHS:
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            logger.warning("config: %s is not valid JSON — skipping (%s)", path, e)
            continue
        except OSError as e:
            logger.warning("config: cannot read %s — skipping (%s)", path, e)
            continue

        injected = 0
        for key, value in data.items():
            if key not in os.environ:
                os.environ[key] = str(value)
                injected += 1
            # else: real env var takes precedence, skip silently

        logger.info("config: loaded %d key(s) from %s (%d already set by env)",
                    injected, path, len(data) - injected)
        return  # stop at first valid file

    logger.info("config: no JSON config file found — relying on process environment variables")


_load()
