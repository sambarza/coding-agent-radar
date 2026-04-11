"""
Limited scan for local testing.

Usage:
    uv run test-scan                        # 1 agent (claude_code), 1 page
    uv run test-scan --pages 2              # 1 agent, 2 pages
    uv run test-scan --agent copilot        # specific agent
    uv run test-scan --agent all --pages 1  # all agents, 1 page each
    uv run test-scan --no-export            # skip JSON export
"""

import argparse
import asyncio

from scanner.detectors import AGENTS
from scanner.main import main


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Limited scanner run for testing")
    parser.add_argument(
        "--agent",
        default="claude_code",
        help=f"Agent key to scan, or 'all'. Available: {', '.join(AGENTS)}. Default: claude_code",
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=1,
        help="Max pages per signal (100 repos/page). Default: 1",
    )
    parser.add_argument(
        "--no-export",
        action="store_true",
        help="Skip JSON export after scan",
    )
    return parser.parse_args()


def run() -> None:
    args = parse_args()

    if args.agent == "all":
        agents = AGENTS
    elif args.agent in AGENTS:
        agents = {args.agent: AGENTS[args.agent]}
    else:
        print(f"Unknown agent '{args.agent}'. Available: {', '.join(AGENTS)}")
        raise SystemExit(1)

    asyncio.run(main(max_pages=args.pages, agents=agents, export=not args.no_export))


if __name__ == "__main__":
    run()
