"""
routes/alerts.py — Price alerts, push notifications, and cache admin.

Manages user-defined price alerts and the notification inbox:

  Price alerts
  ────────────
  GET  /api/alerts          — list all configured alerts
  POST /api/alerts          — create a new alert (ticker, condition, threshold, currency)
  DELETE /api/alerts/<id>   — remove an alert by ID

  Notifications
  ─────────────
  GET  /api/notifications         — list the last 40 notifications + unread count
  POST /api/notifications/read    — mark all notifications as read

  Admin
  ─────
  POST /api/admin/clear-cache     — purge all cached data (forces fresh fetch on next request)

Alert triggering itself happens in the background refresh thread in app.py,
which calls _check_price_alerts() after each portfolio refresh cycle.
"""

import logging

from flask import Blueprint, jsonify, request

from cache import (
    alert_add, alert_delete, alerts_get_all, clear_all_cache,
    notification_add, notifications_get, notifications_mark_all_read,
    notifications_unread_count,
)

logger = logging.getLogger("alerts")

alerts_bp = Blueprint("alerts", __name__)


# ── Price alerts ──────────────────────────────────────────────────────────────

@alerts_bp.route("/api/alerts", methods=["GET"])
def get_alerts():
    """Return all configured price alerts."""
    return jsonify({"status": "ok", "data": alerts_get_all()})


@alerts_bp.route("/api/alerts", methods=["POST"])
def add_alert():
    """Create a new price alert.

    Body: { ticker, condition ("above"|"below"), threshold (float), currency? }
    """
    body      = request.get_json(silent=True) or {}
    ticker    = body.get("ticker", "").strip().upper()
    condition = body.get("condition", "").lower()
    threshold = body.get("threshold")
    currency  = body.get("currency", "GBP").upper()

    if not ticker or condition not in ("above", "below") or threshold is None:
        return jsonify({
            "status":  "error",
            "message": "ticker, condition (above|below), threshold required",
        }), 400

    alert_id = alert_add(ticker, condition, float(threshold), currency)
    return jsonify({"status": "ok", "id": alert_id})


@alerts_bp.route("/api/alerts/<int:alert_id>", methods=["DELETE"])
def delete_alert(alert_id):
    """Delete a price alert by its ID."""
    alert_delete(alert_id)
    return jsonify({"status": "ok"})


# ── Notifications ─────────────────────────────────────────────────────────────

@alerts_bp.route("/api/notifications", methods=["GET"])
def get_notifications():
    """Return the most recent 40 notifications and the current unread count."""
    return jsonify({
        "status": "ok",
        "data":   notifications_get(40),
        "unread": notifications_unread_count(),
    })


@alerts_bp.route("/api/notifications/read", methods=["POST"])
def mark_notifications_read():
    """Mark all notifications as read."""
    notifications_mark_all_read()
    return jsonify({"status": "ok"})


# ── Cache admin ───────────────────────────────────────────────────────────────

@alerts_bp.route("/api/admin/clear-cache", methods=["POST"])
def api_clear_cache():
    """Purge all cached data, forcing a fresh fetch on the next request."""
    try:
        clear_all_cache()
        return jsonify({"status": "ok", "message": "Cache cleared successfully"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
