"""
Export aggregated stats from the current state of data.sqlite.
Useful to generate JSON files mid-scan or after an interrupted run.

Usage:
    uv run export-stats
"""

from scanner.export import export_all


def run() -> None:
    export_all()


if __name__ == "__main__":
    run()
