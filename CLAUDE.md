# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies and install project scripts
uv sync

# Run the full scanner (requires GITHUB_PAT in .env)
uv run python -m scanner

# Or via the installed project script (requires uv sync first)
uv run scan

# Run a limited test scan
uv run test-scan
uv run test-scan --agent copilot --pages 2
uv run test-scan --agent all --pages 1
```

The scanner updates `data.sqlite` and regenerates all files in `website/public/`. After a run, commit both to deploy.

**Always test website changes locally before committing:** run `uv run serve` and verify in the browser, then commit and push.

## Architecture

Two independent components share nothing at runtime — they communicate only through files on disk.

### Scanner (`scanner/`)

A single async Python script run weekly via GitHub Actions (or locally). Flow:

1. **`detectors.py`** — defines which agents to look for and their filename signals (e.g. `.cursorrules` → Cursor)
2. **`github.py`** — GitHub Code Search API client. For each signal file, pages through results (up to 1000 repos/signal), deduplicates repos, then batch-fetches full metadata (stars, language). In-memory cache avoids redundant fetches across signals.
3. **`db.py`** — upserts detections into `data.sqlite`. A detection is keyed on `(repo_id, agent)` — re-runs only update `stars` and `last_seen_at`, preserving `first_detected_at`.
4. **`export.py`** — reads `data.sqlite` and writes four pre-aggregated JSON files to `website/public/`.
5. **`main.py`** — orchestrates agents → signals, calls the above in order.

`MAX_PAGES` in `detectors.py` controls scan depth (default: 10 = GitHub's hard cap of 1000 results per signal). `test-scan` overrides this via `--pages` for quick test runs.

### Website (`website/`)

Static page served by GitHub Pages. Fetches the four JSON files from `website/public/` at load time and renders five Chart.js charts:

- **Agent distribution** — horizontal bar, count per agent
- **Adoption over time** — cumulative line chart per agent by month (`first_detected_at`)
- **Repository popularity** — grouped bar, star buckets × agent (log scale)
- **Agent share by language** — grouped bar, for each language what % of its detections belong to each agent (sums to 100% per language)
- **Language share by agent** — grouped bar, for each agent what % of its repos use each language

No build step, no dependencies, no server.

### Data files (versioned)

| File | Purpose |
|---|---|
| `data.sqlite` | Raw detections + scan run history |
| `website/public/agents.json` | Agent ranking with labels and colors |
| `website/public/timeline.json` | Monthly detection counts per agent |
| `website/public/languages.json` | Detection counts by language × agent |
| `website/public/scan_meta.json` | Last scan date + totals |

## Configuration

Copy `.env.example` to `.env` and add a GitHub PAT with `public_repo` read scope.

To add a new agent: add an entry to `AGENTS` in `scanner/detectors.py` with a `label`, `signals` list, and `color`.
