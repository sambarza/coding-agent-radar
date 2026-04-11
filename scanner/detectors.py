# Each agent maps to a label, a list of filename signals, and a chart color.
# Signals are exact filenames searched via GitHub Code Search API.

AGENTS: dict[str, dict] = {
    "cursor": {
        "label": "Cursor",
        "signals": [".cursorrules"],
        "color": "#FF6B6B",
    },
    "claude_code": {
        "label": "Claude Code",
        "signals": ["CLAUDE.md"],
        "color": "#4ECDC4",
    },
    "copilot": {
        "label": "GitHub Copilot",
        "signals": ["copilot-instructions.md"],
        "color": "#58a6ff",
    },
    "windsurf": {
        "label": "Windsurf",
        "signals": [".windsurfrules"],
        "color": "#96CEB4",
    },
    "aider": {
        "label": "Aider",
        "signals": [".aider.conf.yml"],
        "color": "#FFEAA7",
    },
    "continue": {
        "label": "Continue",
        "signals": [".continuerc.json"],
        "color": "#DDA0DD",
    },
    "devin": {
        "label": "Devin",
        "signals": ["devin.md"],
        "color": "#F7DC6F",
    },
    "codex": {
        "label": "OpenAI Codex",
        "signals": ["AGENTS.md"],
        "color": "#74AA9C",
    },
}

# Full scan depth: GitHub Code Search caps at 1000 results per query (10 pages).
MAX_PAGES = 10
