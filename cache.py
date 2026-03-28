import json
import os
import time

DB_PATH      = os.environ.get("DB_PATH", "portfolio_cache.db")
DATABASE_URL = os.environ.get("DATABASE_URL")  # postgresql://user:pass@host:5432/db
TTL_ROWS     = int(os.environ.get("CACHE_TTL_SECONDS",     600))   # 10 min  – computed portfolio rows
TTL_INSTR    = int(os.environ.get("CACHE_TTL_INSTRUMENTS", 3600))  # 1 hour  – instruments metadata
TTL_DIV      = int(os.environ.get("CACHE_TTL_DIVIDENDS",   1800))  # 30 min  – dividend history
TTL_FX       = int(os.environ.get("CACHE_TTL_FX",          300))   #  5 min  – GBP/USD rate
TTL_ORDERS   = int(os.environ.get("CACHE_TTL_ORDERS",      300))   #  5 min  – order history
TTL_NEWS     = int(os.environ.get("CACHE_TTL_NEWS",        300))   #  5 min  – market news

_USE_PG = bool(DATABASE_URL)

if _USE_PG:
    import psycopg2
    import psycopg2.extras
else:
    import sqlite3


# ── PostgreSQL compatibility shim ─────────────────────────────────────────────

class _PGConnWrapper:
    """Make a psycopg2 connection quack like a sqlite3 connection.

    - Translates ? placeholders to %s (psycopg2 style).
    - Returns dict-like rows via RealDictCursor.
    - Commits / rolls back and closes the underlying connection on __exit__.
    """

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        cur = self._conn.cursor()
        cur.execute(sql.replace("?", "%s"), params)
        return cur

    def __enter__(self):
        return self

    def __exit__(self, exc_type, _val, _tb):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()
        self._conn.close()
        return False


def _db():
    """Return a database connection (sqlite3 or psycopg2-wrapped)."""
    if _USE_PG:
        conn = psycopg2.connect(
            DATABASE_URL,
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        return _PGConnWrapper(conn)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ── Schema initialisation ─────────────────────────────────────────────────────

def init_db() -> None:
    if _USE_PG:
        _init_pg()
    else:
        _init_sqlite()


def _init_sqlite() -> None:
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS portfolio_cache (
                id         INTEGER PRIMARY KEY,
                data       TEXT    NOT NULL,
                fetched_at REAL    NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kv_cache (
                key        TEXT PRIMARY KEY,
                data       TEXT NOT NULL,
                fetched_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS portfolio_history (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                fetched_at REAL NOT NULL,
                value      REAL NOT NULL,
                invested   REAL NOT NULL,
                dividends  REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS portfolio_snapshots (
                id    INTEGER PRIMARY KEY AUTOINCREMENT,
                pid   TEXT NOT NULL,
                ts    REAL NOT NULL,
                value REAL NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_snap_pid_ts ON portfolio_snapshots (pid, ts)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS excluded_tickers (
                ticker TEXT PRIMARY KEY
            )
        """)


def _init_pg() -> None:
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS portfolio_cache (
                id         SERIAL PRIMARY KEY,
                data       TEXT             NOT NULL,
                fetched_at DOUBLE PRECISION NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kv_cache (
                key        TEXT PRIMARY KEY,
                data       TEXT             NOT NULL,
                fetched_at DOUBLE PRECISION NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS portfolio_history (
                id         SERIAL PRIMARY KEY,
                fetched_at DOUBLE PRECISION NOT NULL,
                value      DOUBLE PRECISION NOT NULL,
                invested   DOUBLE PRECISION NOT NULL,
                dividends  DOUBLE PRECISION NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS portfolio_snapshots (
                id    SERIAL PRIMARY KEY,
                pid   TEXT             NOT NULL,
                ts    DOUBLE PRECISION NOT NULL,
                value DOUBLE PRECISION NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_snap_pid_ts ON portfolio_snapshots (pid, ts)"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS excluded_tickers (
                ticker TEXT PRIMARY KEY
            )
        """)


# ── Computed portfolio rows ────────────────────────────────────────────────────

def rows_get(pid: str = "default") -> tuple:
    """Return (rows, age_seconds) if a fresh entry exists, else (None, None)."""
    key = f"{pid}:rows"
    with _db() as conn:
        row = conn.execute(
            "SELECT data, fetched_at FROM kv_cache WHERE key = ?", (key,)
        ).fetchone()
    if row:
        age = time.time() - row["fetched_at"]
        if age < TTL_ROWS:
            return json.loads(row["data"]), int(age)
    return None, None


def rows_set(rows: list, pid: str = "default") -> None:
    key = f"{pid}:rows"
    kv_set(key, rows)


# ── Generic key-value cache (instruments, dividends, …) ───────────────────────

def kv_get(key: str, ttl: int, pid: str = None):
    """Return the cached value for key if within TTL, else None."""
    full_key = f"{pid}:{key}" if pid else key
    with _db() as conn:
        row = conn.execute(
            "SELECT data, fetched_at FROM kv_cache WHERE key = ?", (full_key,)
        ).fetchone()
    if row and (time.time() - row["fetched_at"]) < ttl:
        return json.loads(row["data"])
    return None


def kv_set(key: str, value, pid: str = None) -> None:
    full_key = f"{pid}:{key}" if pid else key
    with _db() as conn:
        if _USE_PG:
            conn.execute(
                "INSERT INTO kv_cache (key, data, fetched_at) VALUES (?, ?, ?)"
                " ON CONFLICT (key) DO UPDATE SET"
                "   data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at",
                (full_key, json.dumps(value), time.time()),
            )
        else:
            conn.execute(
                "INSERT OR REPLACE INTO kv_cache (key, data, fetched_at) VALUES (?, ?, ?)",
                (full_key, json.dumps(value), time.time()),
            )


def kv_delete(key: str, pid: str = None) -> None:
    """Remove a single cache key."""
    full_key = f"{pid}:{key}" if pid else key
    with _db() as conn:
        conn.execute("DELETE FROM kv_cache WHERE key = ?", (full_key,))


def kv_age(key: str, pid: str = None) -> int | None:
    """Return seconds since key was last written, or None if not found."""
    full_key = f"{pid}:{key}" if pid else key
    with _db() as conn:
        row = conn.execute(
            "SELECT fetched_at FROM kv_cache WHERE key = ?", (full_key,)
        ).fetchone()
    return int(time.time() - row["fetched_at"]) if row else None


# ── Ticker Exclusions (Trade Signals) ──────────────────────────────────────────

def get_excluded_tickers() -> list[str]:
    """Return a list of all tickers excluded from trade signals."""
    with _db() as conn:
        rows = conn.execute("SELECT ticker FROM excluded_tickers").fetchall()
    return [r["ticker"] for r in rows]


def set_ticker_excluded(ticker: str, excluded: bool) -> None:
    """Add or remove a ticker from the exclusion list."""
    with _db() as conn:
        if excluded:
            if _USE_PG:
                conn.execute(
                    "INSERT INTO excluded_tickers (ticker) VALUES (?) ON CONFLICT DO NOTHING",
                    (ticker,)
                )
            else:
                conn.execute(
                    "INSERT OR IGNORE INTO excluded_tickers (ticker) VALUES (?)",
                    (ticker,)
                )
        else:
            conn.execute("DELETE FROM excluded_tickers WHERE ticker = ?", (ticker,))


# ── Portfolio value snapshots (for sparkline charts) ──────────────────────────

def snapshot_add(pid: str, value: float) -> None:
    """Record a portfolio value data point. Data is retained permanently until manually cleared."""
    with _db() as conn:
        conn.execute(
            "INSERT INTO portfolio_snapshots (pid, ts, value) VALUES (?, ?, ?)",
            (pid, time.time(), value),
        )


def snapshot_get(pid: str, hours: int = 24) -> list:
    """Return [{ts, value}] for a portfolio over the last N hours, oldest first."""
    cutoff = time.time() - hours * 3600
    with _db() as conn:
        rows = conn.execute(
            "SELECT ts, value FROM portfolio_snapshots "
            "WHERE pid = ? AND ts >= ? ORDER BY ts ASC",
            (pid, cutoff),
        ).fetchall()
    return [{"ts": int(r["ts"]), "value": r["value"]} for r in rows]


def clear_all_cache() -> None:
    """Wipe all cached tables in the database."""
    with _db() as conn:
        conn.execute("DELETE FROM portfolio_cache")
        conn.execute("DELETE FROM kv_cache")
        conn.execute("DELETE FROM portfolio_history")
        conn.execute("DELETE FROM portfolio_snapshots")
