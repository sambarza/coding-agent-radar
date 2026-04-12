import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS detections (
    repo_id           INTEGER NOT NULL,
    repo_name         TEXT    NOT NULL,
    owner             TEXT    NOT NULL,
    stars             INTEGER,
    language          TEXT,
    agent             TEXT    NOT NULL,
    signal_file       TEXT    NOT NULL,
    repo_created_at   TEXT,
    first_detected_at TEXT    NOT NULL,
    last_seen_at      TEXT    NOT NULL,
    PRIMARY KEY (repo_id, agent)
);

CREATE TABLE IF NOT EXISTS scan_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at       TEXT    NOT NULL,
    finished_at      TEXT,
    tier             INTEGER,
    repos_scanned    INTEGER DEFAULT 0,
    new_detections   INTEGER DEFAULT 0,
    status           TEXT    DEFAULT 'running'
);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(_SCHEMA)


def upsert_detection(
    repo_id: int,
    repo_name: str,
    owner: str,
    stars: int | None,
    language: str | None,
    agent: str,
    signal_file: str,
    repo_created_at: str | None,
) -> bool:
    """Insert or refresh a detection. Returns True if it was a new detection."""
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM detections WHERE repo_id = ? AND agent = ?",
            (repo_id, agent),
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE detections
                   SET stars = ?, last_seen_at = ?,
                       language = COALESCE(language, ?)
                   WHERE repo_id = ? AND agent = ?""",
                (stars, now, language, repo_id, agent),
            )
            return False

        conn.execute(
            """INSERT INTO detections
               (repo_id, repo_name, owner, stars, language, agent, signal_file,
                repo_created_at, first_detected_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (repo_id, repo_name, owner, stars, language, agent, signal_file,
             repo_created_at, now, now),
        )
        return True


def start_scan_run(tier: int) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO scan_runs (started_at, tier) VALUES (?, ?)",
            (now, tier),
        )
        return cur.lastrowid


def finish_scan_run(
    run_id: int,
    repos_scanned: int,
    new_detections: int,
    status: str = "completed",
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            """UPDATE scan_runs
               SET finished_at = ?, repos_scanned = ?, new_detections = ?, status = ?
               WHERE id = ?""",
            (now, repos_scanned, new_detections, status, run_id),
        )
