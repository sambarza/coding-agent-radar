"""
Backfill stars_timeline.json by walking git history of data.sqlite.

Each commit that touched data.sqlite is treated as a weekly snapshot.
For each snapshot we query the star-bucket distribution per agent and
record it under the ISO week that contains the commit date.

Run once:  uv run backfill-stars-timeline
"""

import json
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

PUBLIC_DIR = Path(__file__).parent.parent / "website" / "public"
OUTPUT = PUBLIC_DIR / "stars_timeline.json"

BUCKETS_SQL = """
    SELECT
        agent,
        CASE
            WHEN stars < 100   THEN '< 100'
            WHEN stars < 1000  THEN '100–1k'
            WHEN stars < 10000 THEN '1k–10k'
            ELSE                    '10k+'
        END AS bucket,
        COUNT(*) AS count
    FROM detections
    WHERE stars IS NOT NULL
    GROUP BY agent, bucket
"""


def git_snapshots() -> list[tuple[str, str]]:
    """Return [(commit_hash, iso_date), ...] for every commit touching data.sqlite, oldest first."""
    out = subprocess.check_output(
        ["git", "log", "--format=%H %aI", "--follow", "--", "data.sqlite"],
        text=True,
    ).strip()
    rows = []
    for line in out.splitlines():
        h, iso = line.split(" ", 1)
        rows.append((h, iso))
    return list(reversed(rows))  # oldest first


def query_snapshot(commit_hash: str) -> list[dict]:
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        tmp = Path(f.name)
    try:
        db_bytes = subprocess.check_output(
            ["git", "show", f"{commit_hash}:data.sqlite"]
        )
        tmp.write_bytes(db_bytes)
        conn = sqlite3.connect(tmp)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(BUCKETS_SQL).fetchall()
        conn.close()
        return [{"agent": r["agent"], "bucket": r["bucket"], "count": r["count"]} for r in rows]
    finally:
        tmp.unlink(missing_ok=True)


def utc_date(iso_date: str) -> str:
    """Convert an ISO 8601 datetime string to a UTC date string (YYYY-MM-DD)."""
    dt = datetime.fromisoformat(iso_date).astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%d")


def run() -> None:
    snapshots = git_snapshots()
    print(f"Found {len(snapshots)} snapshot(s) in git history")

    timeline: list[dict] = []
    seen_dates: set[str] = set()

    for commit_hash, iso_date in snapshots:
        date = utc_date(iso_date)
        if date in seen_dates:
            print(f"  skip {commit_hash[:7]} ({date} already recorded)")
            continue
        seen_dates.add(date)
        rows = query_snapshot(commit_hash)
        for row in rows:
            timeline.append({"week": date, **row})
        print(f"  {commit_hash[:7]} → {date} ({len(rows)} rows)")

    PUBLIC_DIR.mkdir(exist_ok=True)
    OUTPUT.write_text(json.dumps(timeline, indent=2))
    print(f"Written {len(timeline)} rows → {OUTPUT}")


if __name__ == "__main__":
    run()
