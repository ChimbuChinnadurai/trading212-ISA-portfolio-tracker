# ── Build stage ──────────────────────────────────────────────────────────────
# Target amd64 explicitly — Cloud Run runs linux/amd64; building on Apple Silicon
# without this flag produces an arm64 image that won't run on Cloud Run.
FROM --platform=linux/amd64 python:3.12-slim AS base

# Prevent .pyc files and enable unbuffered stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install deps first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# ── Runtime config ────────────────────────────────────────────────────────────
# Cloud Run injects PORT (default 8080). Gunicorn binds to it.
ENV PORT=8080

# Non-root user for security
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser /app
USER appuser

EXPOSE 8080

# Single worker + 8 threads: keeps exactly one background-refresh thread alive.
# Cloud Run handles concurrency at the instance level so one worker is sufficient.
CMD exec gunicorn \
      --bind "0.0.0.0:${PORT}" \
      --workers 1 \
      --threads 8 \
      --timeout 60 \
      --access-logfile - \
      --error-logfile - \
      app:app
