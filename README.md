# Coding Agent Stats

A dashboard tracking the adoption of AI coding agents across public GitHub repositories.

Live at: **[your-username.github.io/coding-agent-stats](https://your-username.github.io/coding-agent-stats)**

---

## How data is gathered

### Detection strategy

The scanner does not read file contents or use any LLM. It relies entirely on the **presence of agent-specific config files** as a signal that a repo uses a given coding agent.

| Agent | Signal file |
|---|---|
| Cursor | `.cursorrules` |
| Claude Code | `CLAUDE.md` |
| GitHub Copilot | `copilot-instructions.md` |
| Windsurf | `.windsurfrules` |
| Aider | `.aider.conf.yml` |
| Continue | `.continuerc.json` |
| Devin | `devin.md` |
| OpenAI Codex | `AGENTS.md` |

Each signal is a **configuration file** — one that developers create specifically to define how the tool behaves in their project. Housekeeping files like `.cursorignore` or `.aiderignore` (which only control what the tool indexes) are excluded because they can exist without the tool being actively used, increasing false-positive risk.

### GitHub API usage

For each signal file, the scanner queries the **GitHub Code Search API**:

```
GET /search/code?q=filename:{signal_file}&per_page=100&page={n}
```

Results are returned in best-match order, which correlates with repository popularity, so the first pages naturally surface the most relevant repos.

Because the Code Search API returns limited repository metadata, each matched repo is then enriched via a separate call:

```
GET /repos/{owner}/{repo}
```

This provides star count, primary language, and creation date. An in-memory cache avoids redundant fetches when the same repo is matched by multiple signals.

### Scan depth

Each signal is scanned up to 10 pages (100 results/page), hitting GitHub's hard cap of 1000 results per Code Search query. Results are returned in best-match order, so the first pages naturally surface the most popular repos and the signal quality stays high throughout.

### Deduplication

A repo is stored once per agent regardless of how many signal files it matches. The database uses `(repo_id, agent)` as a primary key — if a repo is found via two signals for the same agent, the second hit updates the star count and last-seen date but does not create a duplicate.

---

## How aggregated data is calculated

After each scan, the raw detections in `data.sqlite` are pre-aggregated into four static JSON files served by the dashboard.

### `agents.json` — ranking

Counts the total number of distinct repos detected per agent, computes each agent's percentage share of all detections, and sorts by count descending.

```
count(repo_id) GROUP BY agent
```

### `timeline.json` — adoption over time

Groups detections by the month they were first detected (`first_detected_at`) and by agent. The dashboard renders this as a cumulative line chart so you can see when each tool started gaining traction.

```
COUNT(*) GROUP BY strftime('%Y-%m', first_detected_at), agent
```

Note: on the first scan all detections fall in the same month. The timeline becomes meaningful after several weeks of runs.

### `languages.json` — breakdown by language

Groups detections by the primary language of the repository and by agent, allowing comparison of which tools are more popular in which ecosystems.

```
COUNT(*) GROUP BY language, agent
```

### `scan_meta.json` — scan metadata

Records the date of the last scan, how many repos were processed, and the total number of detections in the database.

---

## Limitations

- **Signal-based detection only** — repos that use an agent without committing a config file are not counted.
- **GitHub only** — GitLab, Bitbucket, and self-hosted repos are not covered.
- **1000 result cap** — GitHub Code Search returns at most 1000 results per query. Less popular agents with fewer than 1000 repos are fully counted; popular agents are capped.
- **`first_detected_at` is scan date** — we record when our scanner first found a repo, not when the config file was originally committed. This slightly delays the timeline relative to actual adoption.

---

## Running locally

```bash
# 1. Install dependencies
uv sync

# 2. Add your GitHub PAT (needs public_repo read scope)
cp .env.example .env

# 3. Run a quick test scan (default: claude_code, 1 page ≈ 100 repos)
uv run test-scan

# Scan a specific agent
uv run test-scan --agent cursor
uv run test-scan --agent copilot
uv run test-scan --agent codex

# Available agents: cursor, claude_code, copilot, windsurf, aider, continue, devin, codex

# Scan all agents with limited depth (1 page each)
uv run test-scan --agent all --pages 1

# Increase depth without running a full scan
uv run test-scan --agent all --pages 3

# Skip JSON export (DB only, faster iteration)
uv run test-scan --agent cursor --no-export

# 4. Run the full scan (all agents, up to 1000 repos per signal)
uv run scan

# 5. View the dashboard
uv run serve
```
