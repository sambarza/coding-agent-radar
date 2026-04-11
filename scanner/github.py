import asyncio
import os
import time
from datetime import datetime

import httpx
from dotenv import load_dotenv

load_dotenv()

_BASE = "https://api.github.com"


def _headers() -> dict:
    pat = os.getenv("GITHUB_PAT", "")
    if not pat:
        raise RuntimeError(
            "GITHUB_PAT is not set. Copy .env.example to .env and add your token."
        )
    return {
        "Authorization": f"Bearer {pat}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

# In-memory cache: avoids fetching the same repo's metadata twice across signals
_repo_cache: dict[str, dict] = {}


async def _get(client: httpx.AsyncClient, url: str, params: dict | None = None) -> dict | None:
    for attempt in range(3):
        try:
            resp = await client.get(url, params=params, headers=_headers(), timeout=30)
        except httpx.RequestError as exc:
            print(f"  [network error] {exc}")
            await asyncio.sleep(2 ** attempt)
            continue

        if resp.status_code == 200:
            return resp.json()

        if resp.status_code in (403, 429):
            reset = int(resp.headers.get("X-RateLimit-Reset", time.time() + 60))
            wait = max(reset - time.time(), 1) + 2
            retry_at = datetime.fromtimestamp(reset + 2).strftime("%H:%M:%S")
            print(f"  [rate limit] retrying at {retry_at} (in {int(wait)}s)...")
            await asyncio.sleep(wait)
            continue

        if resp.status_code in (404, 422, 451):
            return None  # not found / invalid query / DMCA

        print(f"  [HTTP {resp.status_code}] {url}")
        await asyncio.sleep(2 ** attempt)

    return None


async def _search_code(client: httpx.AsyncClient, filename: str, page: int = 1) -> dict | None:
    # Code Search is rate-limited to 30 req/min — sleep ~2s between calls
    await asyncio.sleep(2.1)
    return await _get(
        client,
        f"{_BASE}/search/code",
        params={"q": f"filename:{filename}", "per_page": 100, "page": page},
    )


async def _get_repo(client: httpx.AsyncClient, owner: str, repo: str) -> dict | None:
    key = f"{owner}/{repo}"
    if key in _repo_cache:
        return _repo_cache[key]

    # Gentle pacing for general API (5000 req/hr)
    await asyncio.sleep(0.1)
    data = await _get(client, f"{_BASE}/repos/{owner}/{repo}")
    if data:
        _repo_cache[key] = data
    return data


async def collect_repos_for_signal(
    client: httpx.AsyncClient,
    filename: str,
    max_pages: int = 5,
) -> list[dict]:
    """
    Search GitHub code for repos containing `filename`, then enrich each
    unique repo with full metadata (stars, language, created_at).

    Returns a list of dicts: {id, name, owner, stars, language, created_at}.
    """
    seen: set[int] = set()
    stubs: list[tuple[str, str]] = []  # (owner, repo_name)

    # --- Phase 1: collect unique repos from code search ---
    for page in range(1, max_pages + 1):
        data = await _search_code(client, filename, page)
        if not data or "items" not in data:
            break

        for item in data["items"]:
            r = item["repository"]
            if r["id"] not in seen:
                seen.add(r["id"])
                stubs.append((r["owner"]["login"], r["name"]))

        if len(data["items"]) < 100:
            break  # last page reached

        if len(seen) >= min(data.get("total_count", 0), 1000):
            break  # GitHub caps results at 1000

    print(f"    [{filename}] found {len(stubs)} unique repos across {min(page, max_pages)} pages")

    # --- Phase 2: enrich with full metadata (batched, semaphore-limited) ---
    sem = asyncio.Semaphore(5)

    async def fetch_one(owner: str, repo: str) -> dict | None:
        async with sem:
            return await _get_repo(client, owner, repo)

    metadata = await asyncio.gather(*[fetch_one(o, r) for o, r in stubs])

    results = []
    for full in metadata:
        if full:
            results.append({
                "id":         full["id"],
                "name":       full["name"],
                "owner":      full["owner"]["login"],
                "stars":      full.get("stargazers_count"),
                "language":   full.get("language"),
                "created_at": full.get("created_at"),
            })

    return results
