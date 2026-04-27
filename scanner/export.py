import json
from datetime import datetime, timezone
from pathlib import Path

from .db import get_conn
from .detectors import AGENTS

PUBLIC_DIR = Path(__file__).parent.parent / "website" / "public"


def export_all() -> None:
    PUBLIC_DIR.mkdir(exist_ok=True)
    _export_agents()
    _export_timeline()
    _export_languages()
    _export_stars()
    _export_stars_timeline()
    _export_scan_meta()
    print(f"Exported JSON files → {PUBLIC_DIR}")


# --- individual exporters ---

def _export_agents() -> None:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT agent, COUNT(*) AS count
            FROM detections
            GROUP BY agent
            ORDER BY count DESC
        """).fetchall()

    total = sum(r["count"] for r in rows)
    data = [
        {
            "agent":   r["agent"],
            "label":   AGENTS.get(r["agent"], {}).get("label", r["agent"]),
            "color":   AGENTS.get(r["agent"], {}).get("color", "#cccccc"),
            "signals": AGENTS.get(r["agent"], {}).get("signals", []),
            "count":   r["count"],
            "pct":     round(r["count"] / total * 100, 1) if total else 0,
        }
        for r in rows
    ]
    _write("agents.json", data)


def _export_timeline() -> None:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT strftime('%Y-%m-%d', first_detected_at) AS month,
                   agent,
                   COUNT(*) AS count
            FROM detections
            GROUP BY month, agent
            ORDER BY month ASC
        """).fetchall()

    data = [{"month": r["month"], "agent": r["agent"], "count": r["count"]} for r in rows]
    _write("timeline.json", data)


def _export_languages() -> None:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT language, agent, COUNT(*) AS count
            FROM detections
            WHERE language IS NOT NULL
            GROUP BY language, agent
            ORDER BY count DESC
        """).fetchall()

    data = [{"language": r["language"], "agent": r["agent"], "count": r["count"]} for r in rows]
    _write("languages.json", data)


def _export_stars() -> None:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT
                agent,
                CASE
                    WHEN stars < 100              THEN '< 100'
                    WHEN stars < 1000             THEN '100–1k'
                    WHEN stars < 10000            THEN '1k–10k'
                    ELSE                               '10k+'
                END AS bucket,
                COUNT(*) AS count
            FROM detections
            WHERE stars IS NOT NULL
            GROUP BY agent, bucket
            ORDER BY agent, bucket
        """).fetchall()

    data = [{"agent": r["agent"], "bucket": r["bucket"], "count": r["count"]} for r in rows]
    _write("stars.json", data)


def _export_stars_timeline() -> None:
    """Append this week's star-bucket snapshot to stars_timeline.json."""
    week = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = PUBLIC_DIR / "stars_timeline.json"

    existing: list[dict] = json.loads(path.read_text()) if path.exists() else []

    # Remove any prior entries for this week (idempotent re-runs)
    existing = [r for r in existing if r.get("week") != week]

    with get_conn() as conn:
        rows = conn.execute("""
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
        """).fetchall()

    for r in rows:
        existing.append({"week": week, "agent": r["agent"], "bucket": r["bucket"], "count": r["count"]})

    existing.sort(key=lambda r: (r["week"], r["agent"], r["bucket"]))
    path.write_text(json.dumps(existing, indent=2))
    print(f"  → stars_timeline.json (week {week}, {len(rows)} rows)")


def _export_scan_meta() -> None:
    with get_conn() as conn:
        last = conn.execute("""
            SELECT finished_at, repos_scanned, new_detections
            FROM scan_runs
            WHERE status = 'completed' AND tier != 0
            ORDER BY finished_at DESC
            LIMIT 1
        """).fetchone()

        total = conn.execute("SELECT COUNT(*) AS c FROM detections").fetchone()["c"]

    data = {
        "last_scan":              last["finished_at"] if last else None,
        "repos_scanned_last_run": last["repos_scanned"] if last else 0,
        "new_detections_last_run": last["new_detections"] if last else 0,
        "total_detections":       total,
        "generated_at":           datetime.now(timezone.utc).isoformat(),
    }
    _write("scan_meta.json", data)


def _write(filename: str, data: object) -> None:
    path = PUBLIC_DIR / filename
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  → {filename}")
