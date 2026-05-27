import logging
from flask import Blueprint, jsonify, request, session, redirect
from werkzeug.security import generate_password_hash, check_password_hash
from cache import user_get, user_update_password

logger = logging.getLogger("auth")
auth_bp = Blueprint("auth", __name__)

@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    """Verify credentials and initiate session."""
    data = request.get_json(silent=True) or request.form
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"status": "error", "message": "Username and password are required"}), 400

    user = user_get(username)
    if not user or not check_password_hash(user["password_hash"], password):
        logger.warning("Failed login attempt for user: %s", username)
        return jsonify({"status": "error", "message": "Invalid username or password"}), 401

    # Initialize session
    session["username"] = user["username"]
    session["logged_in"] = True
    session["password_changed"] = bool(user["password_changed"])
    
    logger.info("User logged in successfully: %s", username)
    
    return jsonify({
        "status": "ok",
        "message": "Login successful",
        "password_changed": session["password_changed"]
    })

@auth_bp.route("/api/auth/logout", methods=["GET", "POST"])
def logout():
    """Clear session and redirect/respond."""
    username = session.get("username")
    session.clear()
    if username:
        logger.info("User logged out: %s", username)
        
    if request.accept_mimetypes.accept_json and (request.headers.get("Accept") == "application/json" or request.is_json):
        return jsonify({"status": "ok", "message": "Logged out successfully"})
    return redirect("/")

@auth_bp.route("/api/auth/change-password", methods=["POST"])
def change_password():
    """Change password for the logged-in user."""
    if not session.get("logged_in"):
        return jsonify({"status": "error", "message": "Unauthorized"}), 401

    data = request.get_json(silent=True) or request.form
    current_password = data.get("current_password", "")
    new_password = data.get("new_password", "")
    confirm_password = data.get("confirm_password", "")

    if not current_password or not new_password or not confirm_password:
        return jsonify({"status": "error", "message": "All fields are required"}), 400

    if new_password != confirm_password:
        return jsonify({"status": "error", "message": "New passwords do not match"}), 400

    if len(new_password) < 5:
        return jsonify({"status": "error", "message": "New password must be at least 5 characters long"}), 400

    username = session["username"]
    user = user_get(username)
    if not user or not check_password_hash(user["password_hash"], current_password):
        return jsonify({"status": "error", "message": "Incorrect current password"}), 400

    # Ensure the new password is not the same as the old default if it's currently 'admin'
    if check_password_hash(user["password_hash"], new_password):
        return jsonify({"status": "error", "message": "New password must be different from current password"}), 400

    new_hash = generate_password_hash(new_password)
    user_update_password(username, new_hash)
    
    session["password_changed"] = True
    logger.info("Password changed successfully for user: %s", username)
    
    return jsonify({"status": "ok", "message": "Password changed successfully"})

@auth_bp.route("/api/auth/status", methods=["GET"])
def status():
    """Check current session status."""
    return jsonify({
        "authenticated": bool(session.get("logged_in")),
        "username": session.get("username"),
        "password_changed": bool(session.get("password_changed"))
    })
