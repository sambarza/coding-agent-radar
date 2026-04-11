import asyncio
from datetime import datetime, timezone

import httpx

from .db import init_db, upsert_detection, start_scan_run, finish_scan_run
from .detectors import AGENTS, MAX_PAGES
from .export import export_all
from .github import collect_repos_for_signal


async def main(
    max_pages: int = MAX_PAGES,
    agents: dict | None = None,
    export: bool = True,
) -> None:
    agents = agents or AGENTS

    print(f"Scan started at {datetime.now(timezone.utc).isoformat()}")
    print(f"Agents: {list(agents)}, pages per signal: {max_pages}\n")
    init_db()

    run_id = start_scan_run(tier=1)
    repos_scanned = 0
    new_detections = 0

    try:
        async with httpx.AsyncClient() as client:
            for agent_key, agent_info in agents.items():
                for signal_file in agent_info["signals"]:
                    print(f"  {agent_info['label']} — scanning '{signal_file}'")

                    repos = await collect_repos_for_signal(client, signal_file, max_pages)

                    for repo in repos:
                        repos_scanned += 1
                        is_new = upsert_detection(
                            repo_id=repo["id"],
                            repo_name=repo["name"],
                            owner=repo["owner"],
                            stars=repo["stars"],
                            language=repo["language"],
                            agent=agent_key,
                            signal_file=signal_file,
                            repo_created_at=repo["created_at"],
                        )
                        if is_new:
                            new_detections += 1

                    print(f"    {len(repos)} repos processed, {new_detections} new detections total")

        finish_scan_run(run_id, repos_scanned, new_detections, "completed")

    except Exception as exc:
        finish_scan_run(run_id, repos_scanned, new_detections, f"error: {exc}")
        raise

    if export:
        print("\nExporting aggregated data...")
        export_all()
        print("\nDone. Commit and push data.sqlite + website/public/ to deploy.")
