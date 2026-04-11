"""
Serve the dashboard locally.

Usage:
    uv run serve
    uv run serve --port 8080
"""

import argparse
import http.server
import os
import webbrowser
from pathlib import Path

ROOT = Path(__file__).parent.parent / "website"


def run() -> None:
    parser = argparse.ArgumentParser(description="Serve the dashboard locally")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    args = parser.parse_args()

    os.chdir(ROOT)

    url = f"http://localhost:{args.port}"
    print(f"Serving at {url}  (Ctrl+C to stop)")
    webbrowser.open(url)

    http.server.test(
        HandlerClass=http.server.SimpleHTTPRequestHandler,
        port=args.port,
        bind="127.0.0.1",
    )


if __name__ == "__main__":
    run()
