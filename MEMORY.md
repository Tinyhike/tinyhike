# TinyHike — Project Memory

> Durable decisions, gotchas, and non-obvious context that isn't captured by code or commits.
> `CLAUDE.md` = state of the world. `ROADMAP.md` = what to do next. This file = *why* and *how we got here*.
> Append-only-ish; prune entries that become wrong. Last updated: 13 June 2026.

---

## Decisions made (and why)

- **Enrichment preserves the OSM place name.** `enrich.ts` upsert only backfills `description`/`tips` on the `update` branch; it does not overwrite an existing translation's `name`. Reason: the seeded `nl` name is the real, OSM-curated name; letting Claude rewrite it is lossy mutation of source data (adjacent to CLAUDE.md open question #4). Reversible — change the `update` payload in `enrich.ts` if Claude-renaming is wanted.
- **Enrichment is gated and atomic.** A place is only flipped to `source=CLAUDE` (and logged ✓) when ≥1 validated translation is written, inside a single `$transaction`. Prevents half-enriched places that silently drop out of future runs.
- **`ENRICH_MAX` env cap.** Cron default stays 50/run (documented behavior); pass `ENRICH_MAX=N` to drain more in one go. Used `ENRICH_MAX=400` to enrich all 381 in one session.

## Gotchas / hard-won lessons

- **Overpass requires a `User-Agent`.** `overpass-api.de` (Apache) returns HTTP 406 with an HTML body to header-less `fetch`, which crashes `JSON.parse` with a misleading `Unexpected token '<'`. Always send a UA. (Fixed in `seed-osm.ts`.)
- **Overpass bbox order is `south,west,north,east` (lat,lon).** The original default was lon,lat and pointed at open ocean → 0 results. Rotterdam = `51.8,4.4,51.95,4.6`.
- **`pnpm seed:osm` / `enrich:pending` are long-running** — run detached and poll. Note: putting `nohup … &` *inside* a tracked background wrapper double-backgrounds it; the wrapper reports "done (exit 0)" immediately while the real job keeps running. Poll the log for the `Done.` summary line, not the wrapper exit.
- **`git push` does not work from the agent environment.** The `origin` remote is HTTPS, there is no `gh` CLI, and no `GH_TOKEN`/`GITHUB_TOKEN`; the credential helper cache is empty. Jerome must push manually (`! git -C /srv/tinyhike push origin main` and enter a PAT), or provide a token/`gh` auth, before the agent can push.

## Current data state (changes over time — verify before trusting)

- `Place`: 381 rows, all `source=OSM`→`CLAUDE` after enrichment, all `status=PENDING`.
- `PlaceTranslation`: 1143 rows (381 × nl/fr/en), every one has description + tips.
- Boolean accessibility tags (`napFriendly`, `shaded`, …) are still mostly **null** — the highest-value data gap (see ROADMAP "moat").

## Known uncommitted repo state (as of 13 June 2026)

These were already modified/untracked before this session's work and were intentionally left alone:
`.gitignore`, `api/package.json`, `api/prisma/schema.prisma`, `web/vite.config.ts` (modified); `api/pnpm-lock.yaml`, `api/pnpm-workspace.yaml`, `web/pnpm-lock.yaml`, `web/pnpm-workspace.yaml`, `api/prisma/migrations/` (untracked). Looks like initial-setup work never committed — review and commit deliberately.

## Pointers

- Roadmap & prioritized to-do: `ROADMAP.md`
- Project state of the world & guardrails: `CLAUDE.md`
- Agent audit prompts (security, schema, routes, perf, etc.): `CLAUDE.md` → "Agent swarm playbook"
