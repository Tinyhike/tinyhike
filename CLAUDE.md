# CLAUDE.md — TinyHike

> **For agents (Claude Code, claude.ai, others).** Read this first, every session, before touching any code, command, or commit. This file reflects the **actual state** of the project, not the original aspirations.

Last updated: 5 June 2026 — after first working dev environment.

---

## Quick context

TinyHike is a **mobility + discovery layer for parents with strollers**. Closest analogy: AllTrails × Google Maps Local × stroller accessibility layer. Launch city: **Rotterdam**.

Focused utility, not a parenting social network. The core question users ask:
> "Can I comfortably go there with a stroller and a baby?"

The founder is Jerome (Telegram ID `7581563177`). Solo dev, ~8-week MVP timeline, target soft launch Rotterdam.

---

## Current state (do not assume, this is fact)

### ✅ What works right now
- **Hetzner CPX22** at IP `178.105.100.4`, Ubuntu 26.04 LTS, hardened (UFW, fail2ban, swap 2GB, SSH key-only, root login disabled, user `tinyhike` with NOPASSWD sudo)
- **PostgreSQL 16 + PostGIS 3.6** running natively (no Docker), DB `tinyhike` created with user `tinyhike`, password in `/root/.tinyhike_db_password` and Bitwarden
- **Prisma schema migrated**, 12 models alive (User, MagicToken, Place, PlaceTranslation, Route, RouteTranslation, Track, Photo, Review, List, ListTranslation, ListPlace, ListCollaborator, Follow)
- **PostGIS triggers active**: `Place.geom` (Point 4326) and `Route.geom` (LineString 4326) auto-synced from `lat`/`lng`, with GIST indexes for fast spatial queries
- **API Fastify 5** runs on port 3000 in dev (`cd api && pnpm dev`), all routes loaded (auth, places, routes, photos, lists, admin), CORS configured for `http://localhost:5173`
- **Web Vite 5 + React 18 + Mapbox GL 3** runs on port 5173 in dev (`cd web && pnpm dev`), shows Rotterdam-centered map, proxies `/api/*` to localhost:3000
- **Front+back integration validated** — `/api/places?bbox=...` returns 200 OK with empty array (no POI seeded yet)
- **Git repo**: `https://github.com/Tinyhike/tinyhike` (public, MIT, branch `main`), cloned at `/srv/tinyhike/`
- **External services configured**: Resend (email), Mapbox (tiles, token restricted to `tinyhike.com` / `app.tinyhike.com` / `localhost:5173`), Cloudflare R2 (bucket `tinyhike-photos`, custom domain `photos.tinyhike.com`), Cloudflare Email Routing (`hello@`, `security@`, `conduct@` → Gmail)
- **DNS + SSL**: `tinyhike.com` (+ `app`, `api`, `photos`, `www`) and `tinyhike.app` (redirect 301) live on Cloudflare, proxied 🟠, SSL Full strict

### ⏳ What's not done yet
- **No production deployment** — Traefik + HTTPS routing not set up, services only run in dev mode behind SSH tunnel
- **No POIs in the database** — seed script exists at `api/src/jobs/seed-osm.ts` but never run yet (next step)
- **No real users tested** — auth magic-link flow not exercised end-to-end
- **No photo upload tested** — R2 client wired but no upload flow exercised
- **No Claude enrichment run** — script exists at `api/src/jobs/enrich.ts`, never executed

### ⚠️ Known mismatch between vision and code (to decide later)
Original product vision specified 11 **Place** tags focused on stroller-indoor-friendliness:
`hasChangingTable`, `hasElevator`, `isStepFree`, `hasHighchair`, `isBreastfeedingFriendly`, `hasToilet`, `isStrollerWide`, `isQuiet`, `hasOutdoorSeating`, `isIndoor`, `hasPlayCorner`

Actual Prisma `Place` model has these instead (more outdoor/park-oriented):
`napFriendly`, `shaded`, `smooth`, `enclosed`, `freeEntry`, `hasToilets`, `hasParking`, `hasCafe`, `hasPlayground`, `dogFriendly`, `wheelchairOk`

The scaffold drifted from the vision. **Do not refactor this without discussing with Jerome first.** The current tags work for parks/playgrounds (Rotterdam OSM seed). The original 11 might be added in a follow-up migration when going beyond parks (cafés, restaurants).

---

## Tech stack (what's actually installed)

### Hetzner VPS (178.105.100.4)
- Ubuntu 26.04 LTS, user `tinyhike` (sudo NOPASSWD), home `/home/tinyhike`
- Project at `/srv/tinyhike/` owned by `tinyhike`
- Node.js 22 LTS, pnpm 11.x
- PostgreSQL 16 + PostGIS 3.6, listening only on `127.0.0.1:5432` (UFW blocks public)
- Claude Code CLI installed globally under `~/.npm-global/bin/claude`
- tmux 3.6 for persistent sessions
- Firewall: UFW (only 22/tcp, 80/tcp, 443/tcp open), fail2ban active on SSH

### Application
- **API** — Node.js + Fastify v5 + Prisma 6 + TypeScript strict + ESM modules
- **Web** — React 18 + Vite 5 + Mapbox GL JS v3 + TanStack Query v5 + React Router v6 + vite-plugin-pwa
- **Marketing** — static HTML (`marketing/index.html`, Dutch copy), served by nginx in prod (not yet)
- **Auth** — Magic-link email via Resend → JWT in HttpOnly cookie via `@fastify/cookie` + `jose`
- **Photos** — Cloudflare R2 via `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
- **AI** — Claude Sonnet 4.6 via `@anthropic-ai/sdk` (model ID: `claude-sonnet-4-6`)

### Hostinger VPS (separate, do not touch from TinyHike)
IP `69.62.105.48`. Runs n8n + OpenClaw for Jerome's personal projects. **Cron jobs targeting TinyHike** (not yet wired):
- `02:00` → OSM Overpass diff → POST to TinyHike API
- `02:30` → trigger `pnpm enrich:pending` on TinyHike VPS
- `03:00` → Claude vision moderation on uploaded photos
- `06:30` → Telegram digest to Jerome

**Never put TinyHike app code on Hostinger.** Hostinger is automation-only.

---

## Repository layout

```
/srv/tinyhike/
├── .env                        # real secrets — chmod 600, never commit
├── .env.example                # template, safe to commit
├── .gitignore                  # blocks **/.env etc.
├── README.md
├── LICENSE                     # MIT
├── api/
│   ├── .env -> ../.env         # symlink to root .env (Prisma reads from here)
│   ├── package.json            # scripts: dev, build, start, db:generate, db:migrate, db:studio, enrich:pending, seed:osm
│   ├── tsconfig.json
│   ├── prisma/
│   │   ├── schema.prisma       # 12 models, source of truth for DB
│   │   └── migrations/         # versioned migrations, run via prisma migrate deploy in prod
│   ├── src/
│   │   ├── index.ts            # Fastify entrypoint, registers all routes
│   │   ├── plugins/
│   │   │   └── auth.ts         # JWT cookie middleware
│   │   ├── routes/
│   │   │   ├── auth.ts         # magic-link send, verify, me, logout
│   │   │   ├── places.ts       # GET (bbox + locale), GET detail, POST, POST reviews
│   │   │   ├── routes.ts       # routes CRUD
│   │   │   ├── photos.ts       # presigned upload to R2 + moderation queue
│   │   │   ├── lists.ts        # Mapstr-style lists CRUD
│   │   │   └── admin.ts        # stats, moderation (approve/reject), seed bulk
│   │   └── jobs/
│   │       ├── seed-osm.ts     # Overpass API → Place INSERT (Rotterdam bbox default)
│   │       └── enrich.ts       # Claude Sonnet 4.6 → PlaceTranslation (nl/fr/en)
│   └── Dockerfile              # not used yet, kept for future Docker setup
├── web/
│   ├── .env                    # VITE_API_URL (empty, uses Vite proxy) + VITE_MAPBOX_TOKEN
│   ├── package.json            # scripts: dev, build, preview
│   ├── vite.config.ts          # host 0.0.0.0, port 5173, proxy /api → :3000, PWA config
│   ├── tsconfig.json
│   ├── nginx.conf              # for future Docker prod
│   ├── Dockerfile              # not used yet
│   ├── public/manifest.json    # PWA manifest
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx             # router root
│       ├── index.css
│       ├── lib/api.ts          # fetch wrapper with credentials, reads VITE_API_URL
│       └── pages/
│           ├── MapPage.tsx     # Mapbox + bbox-driven /api/places fetch
│           ├── AuthPage.tsx    # magic-link form
│           ├── PlacePage.tsx   # place detail + photos
│           ├── ListsPage.tsx   # (probably stub — to audit)
│           └── ProfilePage.tsx # (probably stub — to audit)
├── marketing/
│   ├── index.html              # static landing page, Dutch
│   ├── nginx.conf
│   └── Dockerfile
└── ops/
    ├── docker-compose.yml      # not used yet, for future Traefik + DB + api + web + marketing setup
    ├── scripts/
    │   ├── provision.sh        # idempotent VPS setup, already executed
    │   └── postgis_setup.sql   # geom columns + triggers + GIST indexes, already applied
    └── traefik/
        └── traefik.yml         # not active yet
```

---

## Secrets and config

### Root `.env` (`/srv/tinyhike/.env`, symlinked from `api/.env`)
```
DATABASE_URL          # postgresql://tinyhike:<password>@localhost:5432/tinyhike
JWT_SECRET            # 32 bytes base64, generated via openssl rand -base64 32
ANTHROPIC_API_KEY     # sk-ant-... dedicated TinyHike key (separate from OpenClaw)
RESEND_API_KEY        # re_...
RESEND_FROM_EMAIL     # hello@send.tinyhike.com
MAPBOX_PUBLIC_TOKEN   # pk.eyJ1... (also in web/.env as VITE_MAPBOX_TOKEN)
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET             # tinyhike-photos
R2_PUBLIC_URL         # https://photos.tinyhike.com
R2_S3_ENDPOINT        # https://<account-id>.r2.cloudflarestorage.com
TELEGRAM_BOT_TOKEN    # shared with OpenClaw on Hostinger
TELEGRAM_USER_ID      # 7581563177
NODE_ENV              # production (even in dev for now)
PORT                  # 3000
PUBLIC_BASE_URL       # https://app.tinyhike.com
API_BASE_URL          # https://api.tinyhike.com
ACME_EMAIL            # hello@tinyhike.com (for Let's Encrypt later)
```

### Web `.env` (`/srv/tinyhike/web/.env`)
```
VITE_API_URL          # empty in dev (Vite proxy handles /api/*)
VITE_MAPBOX_TOKEN     # same as MAPBOX_PUBLIC_TOKEN
```

### Source of truth for secrets
**Bitwarden vault** owned by Jerome. Never read or write secrets to any other location. Never commit `.env` or any file containing real secrets.

---

## Daily dev workflow

### Starting a dev session
Workflow assumes tmux on the VPS to survive SSH disconnects (see `FICHE_RELANCE.md` for full tmux/SSH setup).

```bash
# From laptop
ssh tinyhike    # or ssh tinyhike@178.105.100.4

# On VPS
tmux new -A -s tinyhike    # attach if exists, create if not
git pull origin main

# In pane 0
cd /srv/tinyhike/api && pnpm dev    # API on :3000

# Ctrl+B " — split pane 1
cd /srv/tinyhike/web && pnpm dev    # Web on :5173

# Ctrl+B % — split pane 2
cd /srv/tinyhike                    # free pane for git, claude, ad-hoc
```

In a separate PowerShell on laptop, open the SSH tunnel:
```powershell
ssh tinyhike-tunnel    # forwards :5173 and :3000 to localhost
```

Then browse `http://localhost:5173` on laptop. Magic.

### Detaching (do NOT exit)
`Ctrl+B` then `D` — session keeps running. Reattach with `tmux attach -t tinyhike` anytime.

### Commands you'll use often
```bash
# Restart API after .env change
cd /srv/tinyhike/api && pnpm dev    # tsx watch auto-restarts on file save

# Prisma after schema change
cd /srv/tinyhike/api
npx prisma format
npx prisma migrate dev --name describe_change_briefly
npx prisma generate

# Apply PostGIS triggers (only after a fresh migrate that touched Place or Route)
sudo -u postgres psql -d tinyhike -f /srv/tinyhike/ops/scripts/postgis_setup.sql

# Seed OSM POIs for Rotterdam
cd /srv/tinyhike/api && pnpm seed:osm

# Run Claude enrichment on pending POIs
cd /srv/tinyhike/api && pnpm enrich:pending

# Inspect DB
sudo -u postgres psql -d tinyhike
\dt          # list tables
\d "Place"   # show Place schema
SELECT COUNT(*) FROM "Place" WHERE status = 'PENDING';

# Prisma Studio (visual DB browser, runs on :5555)
cd /srv/tinyhike/api && npx prisma studio
# Tunnel from laptop: ssh -L 5555:localhost:5555 tinyhike
```

### Commit conventions (conventional commits)
`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `style:`

Examples:
- `feat(api): add /api/places/:id/photos endpoint`
- `fix(web): correct Mapbox bbox calculation on zoom`
- `chore(deps): update fastify to 5.9.0`

Push to `main` directly (solo dev, no PR review for now). When a steward joins, switch to PR + protected `main`.

---

## Pitfalls already encountered (do NOT make these again)

These are real bugs we hit. Reading this list saves 30 min each time.

1. **`.env` reading on api/** — Prisma reads `.env` from the directory it's run from. `api/.env` must exist. Solution: symlink `api/.env -> ../.env`. The `.gitignore` blocks `**/.env` so the symlink is ignored.

2. **Prisma `shadow database` permission** — `prisma migrate dev` creates a temporary DB to diff schemas. The `tinyhike` user needs `CREATEDB`:
   ```bash
   sudo -u postgres psql -c "ALTER USER tinyhike CREATEDB;"
   ```

3. **`dotenv` not installed** — the scaffold's `src/index.ts` does `import 'dotenv/config'` but `dotenv` was never in `package.json`. Fixed once. If it happens again on a new sub-project: `pnpm add dotenv`.

4. **`ListCollaborator` missing relation** — Prisma demands both sides of relations. If you see `Validating field X: missing opposite relation field on model Y`, add the `@relation(...)` line on the missing side, run `npx prisma format`, regenerate.

5. **PostGIS columns are NOT in Prisma schema** — `Place.geom` and `Route.geom` are managed by `postgis_setup.sql`. Do not add them to `schema.prisma` — Prisma can't handle `geometry(Point, 4326)` cleanly. To query them, use `prisma.$queryRaw` with `ST_DWithin`, `ST_Intersects`, `ST_AsGeoJSON`, etc.

6. **Vite default host is localhost-only** — for dev access via SSH tunnel, `vite.config.ts` must set `server.host: '0.0.0.0'`. Already done.

7. **Mapbox URL restrictions** — token is restricted to `tinyhike.com`, `app.tinyhike.com`, `localhost:5173`. If you change ports or domains, update the token in Mapbox dashboard or the map renders blank/gray with 403 in Network tab.

8. **SSH disconnects kill `pnpm dev`** — always run dev commands inside tmux. Use the SSH config in `FICHE_RELANCE.md` with `ServerAliveInterval 30` to keep the connection alive longer.

9. **Hetzner password reset needs `qemu-guest-agent`** — already installed and running. If a future reset fails, check `systemctl status qemu-guest-agent`. If down, restart it.

10. **Root SSH login is disabled** — only `ssh tinyhike@` works. Don't try `ssh root@`. For emergencies, use the Hetzner web console (lifeboat) with the root password in Bitwarden.

---

## Code style

- **TypeScript strict mode everywhere.** No `any` types. If you must, use `unknown` and narrow with type guards.
- **Fastify schema validation** on every route — Zod or JSON Schema. Reject requests with malformed input before they hit Prisma.
- **Prisma for all DB access**, no raw SQL in route handlers. The only exception: PostGIS spatial queries via `prisma.$queryRaw`, with a comment explaining why.
- **ESM imports with `.js` extension** in source code even though files are `.ts`. This is the Node ESM convention with `tsx`/native ESM, and the scaffold follows it. Don't "fix" it.
- **One concern per file.** Route handlers stay thin; logic in `src/services/*.ts` (create the folder when needed).
- **Logs are structured** (Pino default in Fastify). Use `request.log.info({ ... })`, never `console.log`.
- **Errors** — throw with `fastify.httpErrors.badRequest('Reason')` (via `@fastify/sensible` if installed) or return a 4xx with a clear `{ error: 'Code', message: 'Human readable' }` body.

---

## Non-goals (do not build these unless explicitly asked)

These are explicitly out of scope for the MVP. Bringing them up wastes a session.

- Real-time features (WebSockets, live location sharing, presence)
- Notifications system (push, email digest is OK as a cron)
- Multi-city support beyond Rotterdam (defer to month 3+)
- Native mobile apps (PWA only, install from browser)
- Advanced GPS recording (basic `Track` model is fine, no fancy real-time post-processing)
- Ads, dynamic pricing, complex monetization (Ko-fi donations only at launch)
- Self-hosted map tiles, custom basemaps (Mapbox free tier is enough for MVP)
- Federation, ActivityPub, fediverse stuff (no)

---

## Open product/architecture questions (don't decide alone)

Raise these in chat with Jerome, never resolve them yourself.

1. **Place tags drift** — should we add the 11 stroller-specific tags (`hasChangingTable`, etc.) alongside the current outdoor-leaning ones, or keep current schema and add a separate `PlaceFeature` model for indoor features?
2. **Docker switchover** — when to migrate from dev native to Docker Compose for prod? Triggers: first 10 real users, or first deploy to `app.tinyhike.com` HTTPS, whichever comes first.
3. **Photo moderation latency** — Claude vision at 03:00 cron means up to 21h wait for users. Is async OK, or should we trigger Claude on upload (better UX, more API cost)?
4. **OSM data ownership** — POIs sourced from OSM keep `source: OSM` and `osmId`. When users edit such places (rename, add tags), do we fork into a TinyHike-owned record, or layer overrides on top?
5. **Stewards** — when launching outside Rotterdam, do stewards have a separate role with neighborhood scope, or just `ADMIN` everywhere?

---

## Agent swarm playbook (use Claude Code for these)

Beyond regular dev, agents are great for **targeted audits** and **batch refactors**. Run these as dedicated sessions in tmux panes when Jerome is asleep or busy. Each task below is a self-contained prompt — start a fresh `claude` session, paste the task, and let it run.

### Security audit (high priority before any prod deploy)
> "Audit `/srv/tinyhike/api/src/` for security issues. Focus on: SQL injection in `$queryRaw` calls, missing auth checks on routes that modify data, secret leakage in logs or error responses, JWT verification correctness, CORS configuration too permissive, missing rate limiting on auth endpoints, predictable IDs (cuid is fine but check), photo upload validation (file size, mime type, no path traversal in R2 keys). Output a markdown report with severity (critical/high/medium/low) and a concrete fix proposal per finding. Don't apply fixes yet, just propose them."

### Schema integrity check
> "Read `/srv/tinyhike/api/prisma/schema.prisma` and `/srv/tinyhike/ops/scripts/postgis_setup.sql`. Verify: every model has matching opposite relations, no orphaned foreign keys, every nullable field is intentional, every Prisma `Unsupported` type has a corresponding setup in postgis_setup.sql, every GIST index is correctly defined. Output discrepancies as a list with line numbers."

### Route coverage matrix
> "Read all files in `/srv/tinyhike/api/src/routes/`. For each route, list: HTTP method, path, auth required (yes/no/optional), Zod or JSON schema validation present (yes/no), error handling (yes/no), Prisma calls (count), logs (yes/no). Output as a markdown table. Flag any route missing schema validation or auth where it should have one."

### Frontend audit
> "Audit `/srv/tinyhike/web/src/`. Check: every page has a loading state, every API call handles errors, no hardcoded URLs (should use `VITE_API_URL` or relative paths), no `any` types, no `useEffect` infinite loops, Mapbox cleanup on unmount, accessibility (alt text, aria labels, focus management). Output a list of issues with file:line references."

### Performance scan
> "Read `/srv/tinyhike/api/src/routes/places.ts` and the corresponding Prisma calls. For the `GET /api/places?bbox=...` endpoint specifically: estimate the query complexity, check if PostGIS GIST index is used (via `EXPLAIN`), check if we paginate or limit results, check if we include too many relations. Suggest concrete optimizations. Same for any other route doing spatial queries."

### Dependency hygiene
> "Run `pnpm outdated` in both `/srv/tinyhike/api` and `/srv/tinyhike/web`. Identify: major version bumps available (call them out, don't upgrade), security advisories via `pnpm audit`, deprecated subdependencies. Output a prioritized upgrade plan, distinguishing 'safe patch updates', 'minor needs testing', 'major needs Jerome's call'."

### Test scaffolding
> "We have zero tests right now. Set up Vitest in `/srv/tinyhike/api` with: `vitest.config.ts`, a `test/` directory, one example test for `places.ts` (mocking Prisma), one integration test using a real test DB. Add `pnpm test` script. Do NOT modify existing source code, just add the testing infrastructure."

### Documentation generation
> "Read every route file and generate a clean OpenAPI 3.1 spec at `/srv/tinyhike/api/openapi.yaml`. Use Fastify's built-in `getSchemas()` if schemas are already JSON Schema, otherwise extract from code. Include auth requirements, request/response shapes, error codes. Validate the YAML against the OpenAPI 3.1 schema."

### Refactor `lat/lng` → PostGIS-aware helper
> "Currently `Place` and `Route` use `lat: Float, lng: Float` with a trigger syncing `geom`. Create a helper `api/src/lib/geo.ts` with: `latLngFromGeom(geom: string)`, `bboxToPolygon(bbox: string)`, `withinBbox(bbox)` returning a Prisma `where` clause for `ST_Intersects`. Refactor `places.ts` to use these helpers. Add JSDoc and one example call in a comment."

### Cleanup
> "Find and remove dead code in `/srv/tinyhike/`: unused imports, unreferenced functions, empty TypeScript files, commented-out code blocks older than the latest commit, `console.log` statements, `TODO` comments older than 7 days (list them, don't delete). Run `tsc --noEmit` after changes to verify nothing breaks."

### When using these prompts
- Always run in a tmux pane, not in the main dev pane
- Always start with `cd /srv/tinyhike && git status` — clean working tree before audits
- After agent finishes, review the proposed changes with `git diff` before committing
- If the agent suggests upgrades or refactors, **commit them as separate commits** with clear conventional commit messages

---

## When you're a fresh Claude Code session, do this first

1. `cd /srv/tinyhike && git status` — clean tree?
2. `git pull origin main` — sync with GitHub
3. `cat .env.example` — refresh your memory on which secrets exist
4. `ls api/src/routes/` and `ls web/src/pages/` — current surface
5. `npx prisma migrate status` (from `api/`) — any pending migrations?
6. `tmux ls` — what's already running?
7. **Then** read what Jerome asks and proceed. Don't start coding without alignment on intent.

If you're picking up mid-task, look at recent git commits: `git log --oneline -20`.

---

## Useful URLs (bookmarks)

| Service | URL |
|---------|-----|
| Repo | https://github.com/Tinyhike/tinyhike |
| Hetzner Console (lifeboat) | https://console.hetzner.com/projects/14660195/servers/132172470 |
| Cloudflare DNS | https://dash.cloudflare.com (zone: tinyhike.com) |
| Resend dashboard | https://resend.com/domains |
| Mapbox tokens | https://account.mapbox.com/access-tokens |
| Anthropic Console | https://console.anthropic.com (separate key for TinyHike) |
| R2 bucket | https://dash.cloudflare.com (R2 → tinyhike-photos) |

---

## Contact

- **Founder**: Jerome (Telegram `7581563177`)
- **Repo**: https://github.com/Tinyhike/tinyhike
- **Automation pings**: via OpenClaw → Telegram bot from Hostinger n8n
