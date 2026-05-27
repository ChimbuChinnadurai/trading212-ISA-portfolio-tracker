"""
routes — Flask blueprint package.

Import and re-export all blueprints so app.py can register them with a single
``from routes import *`` or explicit named imports.
"""

from routes.alerts import alerts_bp
from routes.ai import ai_bp
from routes.market import market_bp
from routes.performance import performance_bp
from routes.portfolio import portfolio_bp
from routes.auth import auth_bp

__all__ = ["portfolio_bp", "market_bp", "performance_bp", "ai_bp", "alerts_bp", "auth_bp"]

