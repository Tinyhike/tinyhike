# CLAUDE.md — TinyHike

> **For agents (Claude Code, claude.ai, others).** Read this first, every session, before touching any code, command, or commit. This file reflects the **actual state** of the project, not the original aspirations.

Last updated: 27 October 2026 — **maintenance window done** (kernel 7.0.0-38, PostgreSQL 16.15, PostGIS 3.6.4, Node 22.23.4; `docs/MAINTENANCE.md`). Previous: 26 October 2026, **dev separated from production** (`/srv/tinyhike-dev`, see "Dev and production" below), unverified cafés hidden (place category + admin verification), playground ages and equipment imported from OSM, `places:verify add` (a place the seeder missed, from one OSM element).

---

## Dev and production: the rule (Jerome, 26 Oct 2026)

**Code is written and tested in the dev checkout, `/srv/tinyhike-dev`. Production, `/srv/tinyhike`, is only touched to deploy a commit: `git pull`, `migrate deploy`, `build`, `restart`.** No edit, `pnpm dev`, test run or experiment in `/srv/tinyhike`; its `git status` stays empty. Commit in the dev checkout; Jerome pushes from there. Full procedure and the dev environment: `DEPLOY.md` §3a.

- The dev checkout has its own `node_modules` (installed as copies), its own `.env` (API on `127.0.0.1:3100`, `NODE_ENV=development`, sign-in links written to the log with `EMAIL_DELIVERY=log`, no Resend/R2/Anthropic/Telegram key) and its own database `tinyhike_dev` (role `tinyhike_dev`), rebuilt from production by `ops/scripts/dev-db-refresh.sh` **without accounts, reviews, sign-in tokens, photos, lists, follows or tracks**. Nothing is shared with the `tinyhike-api` service or nginx.
- Operating production **data** is not coding and runs from `/srv/tinyhike` (production's `.env`): `pnpm places:verify`, `pnpm photos:moderate`, the backfills a deploy calls for.
- Your shell may start in `/srv` or `/srv/tinyhike` (this file is `/srv/CLAUDE.md` → the production checkout's copy): `cd /srv/tinyhike-dev` before any change.

---

## Quick context

TinyHike is a **mobility + discovery layer for parents with strollers**. Closest analogy: AllTrails × Google Maps Local × stroller accessibility layer. Launch city: **Rotterdam**.

Focused utility, not a parenting social network. The core question users ask:
> "Can I comfortably go there with a stroller and a baby?"

The founder is Jerome (Telegram ID `7581563177`). Solo dev, ~8-week MVP timeline, target soft launch Rotterdam.

---

## Current state (do not assume, this is fact)

### ✅ What works right now
- **Hetzner CPX22** at IP `178.105.100.4`, Ubuntu 26.04 LTS, kernel `7.0.0-38-generic` (since the 27 Oct 2026 reboot), hardened (UFW, fail2ban, swap 2GB, SSH key-only, root login disabled, user `tinyhike` with NOPASSWD sudo)
- **PostgreSQL 16.15 + PostGIS 3.6.4** (since 27 Oct 2026, extension updated in both databases) running natively (no Docker), DB `tinyhike` created with user `tinyhike`, password in `/root/.tinyhike_db_password` and Bitwarden
- **Prisma schema migrated**, 12 models alive (User, MagicToken, Place, PlaceTranslation, Route, RouteTranslation, Track, Photo, Review, List, ListTranslation, ListPlace, ListCollaborator, Follow)
- **PostGIS triggers active**: `Place.geom` (Point 4326) and `Route.geom` (LineString 4326) auto-synced from `lat`/`lng`, with GIST indexes for fast spatial queries
- **IN PRODUCTION since 14 Sep 2026** — `https://app.tinyhike.com` (PWA) and `https://api.tinyhike.com` are live over HTTPS. No SSH tunnel needed any more. See `DEPLOY.md` for the runbook.
  - API runs as the `tinyhike-api` **systemd** service (`node dist/index.js`), enabled, survives reboot
  - **nginx 1.28.3** terminates TLS with a **Cloudflare Origin cert** (`/etc/ssl/cloudflare/tinyhike.{pem,key}`, `*.tinyhike.com`, expires 2041), serves `web/dist` with SPA fallback, and proxies `/api/*` to `127.0.0.1:3000`
  - nginx resolves the **real visitor IP** from `CF-Connecting-IP`, and returns **403 to any request that didn't come through Cloudflare**
  - Config lives in git: `ops/systemd/tinyhike-api.service`, `ops/nginx/tinyhike.conf`, `ops/nginx/cloudflare-*.conf` (regenerate with `ops/scripts/update-cloudflare-ips.sh`), and the cloud-init drop-in `ops/systemd/cloud-init-local.service.d/10-after-apparmor.conf` (`docs/MAINTENANCE.md`, "cloud-init")
- **API Fastify 5** — all routes loaded (auth, places, routes, photos, lists, admin), helmet, rate limiting, `trustProxy`, global error handler. Dev: `cd /srv/tinyhike-dev/api && pnpm dev` on `127.0.0.1:3100` (`HOST`, `PORT`); production listens on `0.0.0.0:3000` behind nginx
  - **Rate-limit keys fold IPv6 to its /64** — every `keyGenerator` goes through `clientKey(req.ip)` (`api/src/lib/client-key.ts`): IPv4 as-is, IPv4-mapped IPv6 back to IPv4, any other IPv6 cut to its /64. One machine owns a whole /64, so the full address would let it rotate past every limit. The photo routes key per account instead (`user:<id>`, hook `preHandler` so it runs after `requireAuth`).
  - **Session cookie is `__Host-session`** (HttpOnly, Secure, SameSite=Lax, Path=/, no Domain; `SESSION_COOKIE` / `SESSION_COOKIE_OPTIONS` in `api/src/plugins/auth.ts`). The prefix stops a sibling subdomain (`photos.` serves user content) from planting or shadowing a session. Clearing it needs the same Secure + Path=/ attributes, or browsers ignore the clear. Three guards: `requireAuth` (401), `optionalAuth` (attaches the session when valid, never replies), `requireAdmin`.
  - **Magic link returns you where you were** — `POST /api/auth/magic` takes an optional `next` (allowlist `^/(places/<id>|profile|lists)?$`, checked again on `/verify`); an invalid `next` falls back to `/`, never an error.
  - **Place visibility and privacy** — one rule, `api/src/lib/place-visibility.ts` (Jerome, 26 Oct 2026): the public sees APPROVED places whose `category` is PLAYGROUND, PARK or PICNIC_SITE, **plus any APPROVED place an admin has verified** (`verifiedAt` set). Cafés and places with a null category stay in the DB, hidden until verified. **A place OSM marks `access=private` (or `no`) is hidden too, unless verified** (`Place.access` = PRIVATE; Jerome, 26 Oct 2026: if a parent reports one open, an admin checks and verifies it, and it comes back); `access=customers` stays on the map with "Réservé aux clients" / "Alleen voor klanten" / "Customers only" under the sheet's title. It is an allowlist on both columns: a null or new category, or a new access value, fails closed. Every route goes through it (`publicPlaceWhere` for queries and counts, `canSeePlace()` per place): map + `X-Total-Count`, detail, reviews, my-review, review/tag-vote POST, photo confirm, lists (content, counts, add), admin stats, enrichment. A hidden place is 404 to everyone but its submitter and ADMINs. Public payloads never carry user ids (`submittedById`, `verifiedById`, `uploadedById`, a review's `userId`, a list owner's id), the verification date (`verifiedAt`, and `updatedAt`, which a verification stamps to the same instant), or moderation notes.
  - **Place verification = an admin's visit** — four points, each yes or no: step-free entrance (`wheelchairOk`), room for the stroller inside (`isStrollerWide`), changing table (`hasChangingTable`), toilets (`hasToilets`). They are written to those existing tags, so the sheet shows them with no web change, "no" included (a verified café can be one to avoid). `verifiedAt` + `verifiedById` record when and who. `pnpm places:verify` (CLI) and `PUT`/`DELETE /api/admin/places/:id/verification` share `api/src/services/place-verification.ts`; the verifier must be ADMIN **in the DB**, not just in the JWT (same check on unverify, and on a `category` change through `PATCH`, since both change what the public sees). Approving a parent's proposal (`PATCH /api/admin/places/:id`, which can also set `category`) is a separate action and never verifies. Jerome's account is ADMIN since 26 Oct 2026 (the only account); the role is read from the JWT, so it takes effect at his next sign-in (log out, then sign in again).
  - **Brunch restaurants are cafés** (Jerome, 26 Oct 2026, the wide filter) — the seeder also takes `amenity=restaurant` whose `cuisine` lists `breakfast`, `brunch`, `coffee_shop`, `pancake`, `lunch` or `lunchroom` (`isBrunchRestaurant()` in `lib/osm.ts`, pancake houses included). They get category CAFE and `hasCafe`, so they stay hidden until verified like every café. 20 in Rotterdam: By Jarmusch West, added by hand first, and 19 imported on 26 Oct (`docs/plan-cafes-non-verifies.md` §10).
  - **Adding a place the seeder missed** — a café OSM files under something else, or a brunch restaurant whose cuisine isn't tagged (De Brunch Club, Lunchroom Fröbel). `pnpm places:verify add node/<id> --category CAFE` creates it from that one element: name, position (a way or relation gets its bounding-box centre, like Overpass `out center`) and the stroller tags OSM states, read from the OSM editing API (`api/src/lib/osm-api.ts`, not Overpass, which is often at capacity). It stays hidden until verified: `add` only creates hidden categories (today CAFE), refuses an element outside the Rotterdam bbox (a mistyped id; **that limit has to go with the European map**, Jerome 26 Oct, not changed yet), and never duplicates (an `osmId` already in the DB, typed or legacy, is shown and left untouched). `addPlaceFromOsm()` in `place-verification.ts`, CLI only. Widening the seeder to brunch restaurants is a proposal, not done (`docs/plan-cafes-non-verifies.md` §10).
- **Reviews: stars and comments need an account** — one written review (score and/or comment) per parent per place; posting again updates it (200) instead of adding one (201). Enforced in the DB by the partial unique index `Review_one_written_per_user_per_place` (migration `20261023120000_photo_staging_and_review_dedupe`, see pitfall 22). Reviews are **displayed anonymously** ("Un parent"): no UI sets a handle yet, so the web always sends `anonymous: true`. The place detail carries the first 20 written reviews, `reviewCount`, `scoreAvg`, `scoreCount`, `voteCount` and `nextCursor`; `GET /api/places/:id/reviews?cursor=` pages the rest, `GET /api/places/:id/my-review` prefills the form. `POST /api/places/:id/reviews` is limited to 30/min per client, body 8 KB, comment 500 chars.
- **Amenity tag votes stay one tap and anonymous** — the "À confirmer" yes/no chips need no account. A vote is a tag-only Review row; `userId` is stored when the voter happens to be signed in. Tags are checked against `TAG_KEYS` (`api/src/lib/tags.ts`, the 19 keys, held in sync with `web/src/lib/tags.ts` by `api/test/tags.test.ts`). Tag-only rows never count as reviews and never push written reviews out of the list.
- **Photo pipeline built end to end, OFF in production until the one-time setup** (`DEPLOY.md` §3c). Unmoderated bytes are never publicly reachable:
  - `POST /api/photos/presign` (signed in) → a 120 s PUT URL into the **private staging bucket** (`R2_STAGING_BUCKET`) at `uploads/<userId>/<uuid>.<ext>`, with Content-Type **and** Content-Length signed. JPEG/PNG/WebP, 10 MB max, 20 PENDING photos per account max.
  - The browser PUTs straight to R2. `POST /api/photos/confirm` copies the upload to `confirmed/<userId>/<uuid>.<ext>` (a key no client can write), checks the copy's type and size, deletes the upload and creates a PENDING `Photo` row with `r2Url: null`. Idempotent.
  - **Approval** re-encodes with sharp (`rotate()`, fit inside 2048×2048, JPEG q82 mozjpeg, `limitInputPixels` 50M). That strips EXIF/GPS and proves the file is a real image. The result goes to the **public** bucket at `p/<photoId>.jpg`, cached `immutable` for a year; only then does the row get an `r2Url`. **Rejection** deletes the bytes. Rejecting an approved photo is a takedown: purge its URL from the Cloudflare cache by hand.
  - Moderation runs from the shell, `pnpm photos:moderate list|approve|reject`, or through `GET`/`PATCH /api/admin/photos` (admin). Both share `api/src/services/photo-moderation.ts`.
  - Without `R2_STAGING_BUCKET`, uploads fail closed: presign/confirm answer 503 and `GET /api/photos/config` says `{ enabled: false }`, so the web hides "Add a photo".
- **Web Vite 5 + React 18 + Mapbox GL 3** — clustered Rotterdam map. Dev: `cd /srv/tinyhike-dev/web && pnpm dev` on `127.0.0.1:5173`, proxies `/api/*` to the dev API on :3100 (`DEV_HOST`, `DEV_API_TARGET` in `web/.env`)
- **1379 places from OSM** (26 Oct 2026: 882 playgrounds, 166 parks, 14 picnic sites, 300 cafés (280 `amenity=cafe` and 20 brunch restaurants), 17 that no longer match OSM). **1038 are public** (`X-Total-Count` 1037 on the default bbox), 341 hidden: the cafés and the 17 until verified, plus 22 playgrounds and 2 parks OSM marks `access=private`. 14 playgrounds, 1 picnic site and 1 café are `access=customers`. The last full `pnpm seed:osm` (26 Oct) added the 41 places OSM had gained since the first one (28 playgrounds, 7 parks, 6 cafés). 13 playgrounds, 1 picnic site and 1 café are `access=customers`. `Place.category` comes from the OSM tag (`categoryOf()` in `lib/osm.ts`, filled by `pnpm backfill:osm-tags`). 381 were enriched by Claude into nl/fr/en, 260 of them cafés: about 11% of the public places have a description. **No AI enrichment for now** (Jerome, 26 Oct), and `enrich.ts` only ever takes public places.
- **Playground details from OSM** — `minAge`, `maxAge` (`min_age` / `max_age`) and `playEquipment` (`playground=*` features inside the playground's outline), filled by `pnpm backfill:playgrounds`, only where unset. Coverage is thin: 62 of 882 playgrounds have equipment, 3 have an age. Returned by the detail (not by the map list); **not displayed yet** (proposal in `docs/plan-cafes-non-verifies.md` §9).
- **Vitest** — 665 tests green in 16 files via a `buildApp()` factory in `api/src/app.ts` (single source of truth for app wiring; `index.ts` only listens). Prisma is mocked (`api/test/helpers.ts`), R2 is `vi.mock`ed: no test touches the network or the DB. `vitest.config.ts` pins `EMAIL_DELIVERY=resend` and a fake `RESEND_API_KEY`, so the suite gives the same result in either checkout (pitfall 25)
- **Magic-link auth works end to end in production** (verified 14 Sep 2026): email delivered by Resend, `/api/auth/verify` hit on the web origin, 302, session cookie usable by the app
- **Web app has a real shell** — tab bar (Carte/Listes/Profil), place detail as a sheet over a still-mounted map, loading/error states everywhere, interface in nl/fr/en with a switcher, bright toy-box identity (see `DESIGN.md`), generated PWA icons
  - The place sheet carries the amenities (19 tri-state tags with one-tap votes), the rating header + reviews + review form, and "Add a photo" (re-encoded on the device, PUT with progress, cancel, retry).
  - Every session gate reads one `useMe()` hook (`web/src/lib/session.ts`): `pending` / `signedIn` / `signedOut` / `unknown`. `unknown` (a 502, a Cloudflare challenge, offline) shows a retry line, never a sign-in prompt. Logout, and a 401 from the review or photo calls, flip it with `markSignedOut()` (pitfall 23).
  - User-facing errors always come from an i18n key (`web/src/lib/errors.ts`), never from the server's English `message`. An unsent review draft is kept per place in `localStorage` for a day, so it survives the magic-link round trip.
- **Git repo**: `https://github.com/Tinyhike/tinyhike` (public, MIT, branch `main`), cloned at `/srv/tinyhike/` (production, deploys only) and `/srv/tinyhike-dev/` (where code is written)
- **External services configured**: Resend (email), Mapbox (tiles, token restricted to `tinyhike.com` / `app.tinyhike.com` / `localhost:5173`), Cloudflare R2 (public bucket `tinyhike-photos`, custom domain `photos.tinyhike.com`; private staging bucket `tinyhike-photos-staging` still to create, see `DEPLOY.md` §3c), Cloudflare Email Routing (`hello@`, `security@`, `conduct@` → Gmail)
- **DNS + SSL**: `tinyhike.com` (+ `app`, `api`, `photos`, `www`) and `tinyhike.app` (redirect 301) live on Cloudflare, proxied 🟠, SSL Full strict

### ⏳ What's not done yet
- **Photo uploads are off in production** until Jerome does the one-time Cloudflare setup in `DEPLOY.md` §3c: create the private staging bucket, set its CORS and its `uploads/` lifecycle rule, widen the R2 token to both buckets, set `R2_STAGING_BUCKET`. The code ships dark: the web hides the button until then.
- **No admin UI yet (CLI only)** — photos are moderated with `pnpm photos:moderate` on the VPS (or the admin-only `/api/admin/photos` routes), proposals with `PATCH /api/admin/places/:id`, and places are verified with `pnpm places:verify` (or `GET /api/admin/places`, `PUT`/`DELETE /api/admin/places/:id/verification`). No Claude vision auto-moderation either: every photo waits for a human.
- **No way to set a handle** — `User.handle` has no writer, so every review shows as "Un parent". Signed reviews need a product decision first (handles vs first names, opt-in toggle).
- **Maintenance follow-up** — the window ran on 27 Oct 2026 (`docs/MAINTENANCE.md`, results and procedure for the next one). Left: delete the Hetzner snapshot `pre-maint-27oct` around 3 Nov, then purge the old kernels' residual configs ("Plus tard" there; `apt autoremove` alone removes nothing). At the next reboot, check that cloud-init no longer fails (its section there).
- **No design pass yet** for the "stroller score" and place-card icons (the identity and the a11y floor are in `DESIGN.md`)
- **`marketing/` not deployed** — apex and `www` have no origin server block yet
- **No CI** — `pnpm test` runs locally only; `main` is unprotected
- **`GET /api/places` caps at 200** results with no pagination

### ⚠️ Known mismatch between vision and code (to decide later)
Original product vision specified 11 **Place** tags focused on stroller-indoor-friendliness:
`hasChangingTable`, `hasElevator`, `isStepFree`, `hasHighchair`, `isBreastfeedingFriendly`, `hasToilet`, `isStrollerWide`, `isQuiet`, `hasOutdoorSeating`, `isIndoor`, `hasPlayCorner`

Actual Prisma `Place` model has these instead (more outdoor/park-oriented):
`napFriendly`, `shaded`, `smooth`, `enclosed`, `freeEntry`, `hasToilets`, `hasParking`, `hasCafe`, `hasPlayground`, `dogFriendly`, `wheelchairOk`

The scaffold drifted from the vision. **Do not refactor this without discussing with Jerome first.** The current tags work for parks/playgrounds (Rotterdam OSM seed). The original 11 might be added in a follow-up migration when going beyond parks (cafés, restaurants).

Since 14 Sep 2026 the model has 19 tags (8 indoor/baby ones added, `hasChangingTable`, `isStrollerWide`, `hasElevator`… among them). Café verification (26 Oct) reuses four of them, so their meaning is now fixed by that use: `wheelchairOk` = step-free entrance (labelled "Sans marche"), `isStrollerWide` = room for the stroller inside (labelled "Place pour la poussette" / "Ruimte voor de kinderwagen" / "Room for the stroller" since 26 Oct 2026; it was "Passage large", narrower than what is checked).

---

## Tech stack (what's actually installed)

### Hetzner VPS (178.105.100.4)
- Ubuntu 26.04 LTS, user `tinyhike` (sudo NOPASSWD), home `/home/tinyhike`
- Production checkout `/srv/tinyhike/`, dev checkout `/srv/tinyhike-dev/`, both owned by `tinyhike`
- Node.js 22 LTS (22.23.4, nodesource), pnpm 11.x
- PostgreSQL 16.15 + PostGIS 3.6.4 (pgdg), listening only on `127.0.0.1:5432` (UFW blocks public). Neither pgdg nor nodesource is updated automatically: `docs/MAINTENANCE.md`
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
- `02:30` → trigger `pnpm enrich:pending` on TinyHike VPS — **paused**: no AI enrichment for now (Jerome, 26 Oct 2026); don't wire it
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
│   ├── package.json            # scripts: dev, build, start, test, db:generate, db:migrate (= prisma migrate deploy), db:studio,
│   │                           #          enrich:pending, seed:osm, backfill:osm-tags, backfill:playgrounds,
│   │                           #          photos:moderate, places:verify
│   ├── tsconfig.json
│   ├── prisma/
│   │   ├── schema.prisma       # 12 models, source of truth for DB (except the partial index, pitfall 22)
│   │   └── migrations/         # versioned migrations, run via prisma migrate deploy in prod
│   ├── src/
│   │   ├── app.ts              # buildApp(): plugins, rate limit, routes. Tests build the app from here
│   │   ├── index.ts            # Fastify entrypoint, only listens
│   │   ├── plugins/
│   │   │   └── auth.ts         # __Host-session cookie, requireAuth / optionalAuth / requireAdmin
│   │   ├── lib/
│   │   │   ├── client-key.ts   # rate-limit key: IPv4 as-is, IPv6 cut to its /64
│   │   │   ├── osm.ts          # Overpass query + OSM tags → stroller booleans and category (shared by the OSM jobs)
│   │   │   ├── osm-api.ts      # one element from the OSM editing API (places:verify add)
│   │   │   ├── osm-playgrounds.ts  # playground ages + equipment: outlines, point-in-polygon, normalisation
│   │   │   ├── place-visibility.ts # THE visibility rule: publicPlaceWhere, canSeePlace, private columns
│   │   │   ├── r2.ts           # the only S3 client: staging + public buckets, presign, copy, head, get, put
│   │   │   └── tags.ts         # TAG_KEYS, the 19 amenity tags (mirrors web/src/lib/tags.ts)
│   │   ├── services/
│   │   │   ├── photo-moderation.ts  # list / approve (sharp re-encode → public bucket) / reject / purge-legacy
│   │   │   └── place-verification.ts # list / verify (4 points + date + admin) / unverify / add from OSM (hidden)
│   │   ├── routes/
│   │   │   ├── auth.ts         # magic-link send (with `next`), verify, me, logout
│   │   │   ├── places.ts       # GET (bbox + locale), GET detail, POST, reviews: list, my-review, post (upsert)
│   │   │   ├── routes.ts       # routes CRUD
│   │   │   ├── photos.ts       # config, presign into private staging, confirm → PENDING row
│   │   │   ├── lists.ts        # Mapstr-style lists CRUD
│   │   │   └── admin.ts        # stats, place moderation, photo moderation (list, approve/reject), seed bulk
│   │   └── jobs/
│   │       ├── seed-osm.ts     # Overpass API → Place INSERT (Rotterdam bbox default)
│   │       ├── backfill-osm-tags.ts  # fill null stroller tags and category on already-seeded places from OSM
│   │       ├── backfill-playground-details.ts  # fill playground ages + equipment from OSM
│   │       ├── enrich.ts       # Claude Sonnet 4.6 → PlaceTranslation (nl/fr/en), public places only
│   │       ├── moderate-photos.ts    # pnpm photos:moderate list | approve | reject | purge-legacy
│   │       └── verify-places.ts      # pnpm places:verify list | verify | unverify | add
│   ├── test/                   # Vitest: mocked Prisma (helpers.ts), R2 mocked, never the network
│   └── Dockerfile              # not used yet, kept for future Docker setup
├── web/
│   ├── .env                    # VITE_API_URL (empty, uses Vite proxy) + VITE_MAPBOX_TOKEN
│   ├── package.json            # scripts: dev, build, preview
│   ├── vite.config.ts          # dev server 127.0.0.1:5173 (DEV_HOST), proxy /api → DEV_API_TARGET, PWA config
│   ├── tsconfig.json
│   ├── nginx.conf              # for future Docker prod
│   ├── Dockerfile              # not used yet
│   ├── public/manifest.json    # PWA manifest
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx             # router root
│       ├── index.css           # component styles (tokens live in styles/tokens.css, see DESIGN.md)
│       ├── lib/
│       │   ├── api.ts          # fetch wrapper with credentials, reads VITE_API_URL, throws ApiError
│       │   ├── errors.ts       # ApiError → i18n key (user-facing text never comes from the server)
│       │   ├── i18n.tsx        # nl/fr/en strings + provider
│       │   ├── next-path.ts    # sign-in return path allowlist (same regex as api/src/routes/auth.ts)
│       │   ├── review-draft.ts # unsent review kept per place in localStorage for a day
│       │   ├── session.ts      # useMe() + markSignedOut(): the one session gate
│       │   └── tags.ts         # the 19 amenity tags, groups and order
│       ├── components/
│       │   ├── PlaceSheet.tsx  # place detail as a bottom sheet over the map
│       │   ├── PlaceAmenities.tsx, PlaceReviews.tsx, PhotoUpload.tsx, SessionRetry.tsx
│       │   └── AppLayout.tsx   # tab bar
│       └── pages/
│           ├── MapPage.tsx     # Mapbox + bbox-driven /api/places fetch
│           ├── AuthPage.tsx    # magic-link form (carries `next`)
│           ├── ListsPage.tsx
│           └── ProfilePage.tsx # account + language switcher + logout
├── marketing/
│   ├── index.html              # static landing page, Dutch
│   ├── nginx.conf
│   └── Dockerfile
└── ops/
    ├── docker-compose.yml      # not used yet, for future Traefik + DB + api + web + marketing setup
    ├── scripts/
    │   ├── provision.sh        # idempotent VPS setup, already executed
    │   ├── dev-db-refresh.sh   # rebuild tinyhike_dev from production, without accounts or reviews
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
RESEND_FROM_EMAIL     # hello@tinyhike.com — must be on the domain VERIFIED in Resend.
                      # `tinyhike.com` is the verified one; `send.tinyhike.com` is NOT
                      # a Resend domain, it only holds the bounce-return MX/SPF records.
MAPBOX_PUBLIC_TOKEN   # pk.eyJ1... (also in web/.env as VITE_MAPBOX_TOKEN)
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET             # tinyhike-photos (PUBLIC: approved, re-encoded photos only)
R2_STAGING_BUCKET     # tinyhike-photos-staging (PRIVATE: no custom domain, public access off).
                      # Unset, empty or equal to R2_BUCKET = photo uploads disabled (fail closed).
R2_PUBLIC_URL         # https://photos.tinyhike.com (absolute https URL; approvals refuse to run without it)
R2_S3_ENDPOINT        # https://<account-id>.r2.cloudflarestorage.com
TELEGRAM_BOT_TOKEN    # shared with OpenClaw on Hostinger
TELEGRAM_USER_ID      # 7581563177
NODE_ENV              # production (even in dev for now)
PORT                  # 3000
HOST                  # unset in production (0.0.0.0, behind nginx); 127.0.0.1 in dev
EMAIL_DELIVERY        # unset or "resend" in production; "log" in dev only (refused when NODE_ENV=production)
PUBLIC_BASE_URL       # https://app.tinyhike.com
API_BASE_URL          # https://api.tinyhike.com
ACME_EMAIL            # hello@tinyhike.com (for Let's Encrypt later)
```

### Web `.env` (`/srv/tinyhike/web/.env`)
```
VITE_API_URL          # empty in dev (Vite proxy handles /api/*)
VITE_MAPBOX_TOKEN     # same as MAPBOX_PUBLIC_TOKEN
DEV_HOST              # dev checkout only: 127.0.0.1 (the Vite dev server's address)
DEV_API_TARGET        # dev checkout only: http://127.0.0.1:3100
```

### Dev `.env` (`/srv/tinyhike-dev/.env`, chmod 600)
Its own `DATABASE_URL` (role and database `tinyhike_dev`), its own `JWT_SECRET`, `NODE_ENV=development`, `HOST=127.0.0.1`, `PORT=3100`, `PUBLIC_BASE_URL=http://localhost:5173`, `EMAIL_DELIVERY=log`. **Never a production secret**: no Resend, R2, Anthropic or Telegram key (`DEPLOY.md` §3a).

### Source of truth for secrets
**Bitwarden vault** owned by Jerome. Never read or write secrets to any other location. Never commit `.env` or any file containing real secrets.

---

## Daily dev workflow

### Starting a dev session
Workflow assumes tmux on the VPS to survive SSH disconnects (see `FICHE_RELANCE.md` for full tmux/SSH setup). Everything happens in the **dev checkout**.

```bash
# From laptop
ssh tinyhike    # or ssh tinyhike@178.105.100.4

# On VPS
tmux new -A -s tinyhike    # attach if exists, create if not
cd /srv/tinyhike-dev && git pull --ff-only

# In pane 0
cd /srv/tinyhike-dev/api && pnpm dev    # API on 127.0.0.1:3100, dev database

# Ctrl+B " — split pane 1
cd /srv/tinyhike-dev/web && pnpm dev    # Web on 127.0.0.1:5173, proxies /api to :3100

# Ctrl+B % — split pane 2
cd /srv/tinyhike-dev                    # free pane for git, claude, ad-hoc
```

On the laptop, open the SSH tunnel to the dev web server only:
```powershell
ssh -L 5173:127.0.0.1:5173 tinyhike    # the old tinyhike-tunnel also forwarded :3000, production's API: not needed
```

Then browse `http://localhost:5173` on laptop. To sign in, ask for a link: it is written in pane 0 ("magic link written to the log"), not mailed.

### Detaching (do NOT exit)
`Ctrl+B` then `D` — session keeps running. Reattach with `tmux attach -t tinyhike` anytime.

### Commands you'll use often
```bash
# Restart the dev API after .env change
cd /srv/tinyhike-dev/api && pnpm dev    # tsx watch auto-restarts on file save

# Tests, before every commit (dev checkout)
cd /srv/tinyhike-dev/api && pnpm test

# Prisma after schema change, in the dev checkout. Never `migrate dev`, in either
# database (it diffs against the live DB, sees geom/triggers/the partial index as
# drift and offers a reset). Generate the SQL offline from the two schema files:
cd /srv/tinyhike-dev/api
npx prisma format
git show HEAD:api/prisma/schema.prisma > /tmp/schema.before.prisma
mkdir prisma/migrations/<YYYYMMDDHHMMSS>_<name>
npx prisma migrate diff --from-schema-datamodel /tmp/schema.before.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<…>/migration.sql
# Read migration.sql (no DROP, nothing on geom / trg_place_geom / Review_one_written_per_user_per_place).
# Apply it to the dev database first: pnpm db:migrate && pnpm db:generate (db:migrate = migrate deploy, never resets).
# Production gets it with the deploy (DEPLOY.md §3a): pg_dump, then the same two commands in /srv/tinyhike/api.

# Fresh dev data from production (drops tinyhike_dev; accounts, reviews etc. left out)
/srv/tinyhike-dev/ops/scripts/dev-db-refresh.sh

# Deploy a commit to production: DEPLOY.md §3a (git pull, migrate deploy, build, restart; nothing else)

# --- Operating production data: from /srv/tinyhike (production's .env), not code ---

# Verify a café after a visit (until the admin UI exists)
cd /srv/tinyhike/api
pnpm places:verify list --category CAFE --unverified --name <text>   # find it: id, four points, OSM link
pnpm places:verify list --category PLAYGROUND --access PRIVATE        # the playgrounds hidden because OSM says private
pnpm places:verify verify <placeId> --step-free yes --stroller-room no --changing-table yes --toilets yes
pnpm places:verify unverify <placeId>      # hides it again; the four answers stay (--by <email> on both if several ADMINs)
pnpm places:verify add node/<osmId> --category CAFE   # a café OSM files as a restaurant: added hidden, then verify it
                                           # (way/<id>, relation/<id> or the openstreetmap.org link work too)

# Moderate photos (until the admin UI exists). A PENDING photo's view URL is a 10-min signed link.
cd /srv/tinyhike/api
pnpm photos:moderate list                  # PENDING queue, oldest first (also: list APPROVED / list REJECTED)
pnpm photos:moderate approve <photoId>     # re-encode → public bucket, prints the public URL
pnpm photos:moderate reject <photoId> [note...]   # deletes the bytes; on an APPROVED photo it prints a URL to purge

# Seed OSM POIs for Rotterdam, then fill categories, tags and playground details
# (run it in /srv/tinyhike-dev first, against the dev database). DRY_RUN=1 lists what
# it would add; ONLY=key=value keeps one kind (ONLY=amenity=restaurant: the brunch places)
cd /srv/tinyhike/api && DRY_RUN=1 pnpm seed:osm && pnpm seed:osm
DRY_RUN=1 pnpm backfill:osm-tags && pnpm backfill:osm-tags        # category + tags, only where null
DRY_RUN=1 pnpm backfill:playgrounds && pnpm backfill:playgrounds  # min/max age + equipment, only where unset

# Run Claude enrichment on pending POIs (paused: no AI enrichment for now, Jerome 26 Oct)
cd /srv/tinyhike/api && pnpm enrich:pending

# --- Back to dev ---
# Apply PostGIS triggers (only after a fresh migrate that touched Place or Route; production: -d tinyhike)
sudo -u postgres psql -d tinyhike_dev -f /srv/tinyhike-dev/ops/scripts/postgis_setup.sql

# Inspect DB (tinyhike_dev for the dev one)
sudo -u postgres psql -d tinyhike
\dt          # list tables
\d "Place"   # show Place schema
SELECT COUNT(*) FROM "Place" WHERE status = 'PENDING';

# Prisma Studio (visual DB browser, runs on :5555), on the dev database
cd /srv/tinyhike-dev/api && npx prisma studio
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

6. **The Vite dev server listens on 127.0.0.1 only** — `DEV_HOST` in the dev `web/.env`, `127.0.0.1` by default. An SSH tunnel (`ssh -L 5173:127.0.0.1:5173 tinyhike`) reaches it; nothing else does. It used to be `0.0.0.0` (UFW was the only thing keeping it private). Keep port 5173: it is the one the Mapbox token allows (pitfall 7).

7. **Mapbox URL restrictions** — token is restricted to `tinyhike.com`, `app.tinyhike.com`, `localhost:5173`. If you change ports or domains, update the token in Mapbox dashboard or the map renders blank/gray with 403 in Network tab.

8. **SSH disconnects kill `pnpm dev`** — always run dev commands inside tmux. Use the SSH config in `FICHE_RELANCE.md` with `ServerAliveInterval 30` to keep the connection alive longer.

9. **Hetzner password reset needs `qemu-guest-agent`** — already installed and running. If a future reset fails, check `systemctl status qemu-guest-agent`. If down, restart it.

10. **Root SSH login is disabled** — only `ssh tinyhike@` works. Don't try `ssh root@`. For emergencies, use the Hetzner web console (lifeboat) with the root password in Bitwarden.

11. **Cloudflare challenges `curl`** — a plain `curl https://api.tinyhike.com/...` gets HTTP 403 and a "Just a moment…" page from Bot Fight Mode. That is the edge, not our origin. Pass a browser `-A` User-Agent, or bypass Cloudflare with `--resolve <host>:443:127.0.0.1`.

12. **`realip` runs before the access phase** — once `real_ip_header CF-Connecting-IP` is set, `$remote_addr` is the *visitor's* IP, so `allow <cloudflare ranges>; deny all;` rejects everyone. Test `$realip_remote_addr` instead (that's what `ops/nginx/cloudflare-geo.conf` does).

13. **Fastify needs `trustProxy` behind nginx** — without it `request.ip` is always `127.0.0.1`, so every visitor shares one rate-limit bucket. Pair it with `proxy_set_header X-Forwarded-For $remote_addr` (not `$proxy_add_x_forwarded_for`), otherwise a caller can prepend a fake IP and dodge the limits.

14. **The magic link must point at `PUBLIC_BASE_URL`** — `/api/auth/verify` sets a host-only cookie. Sending the link to `api.tinyhike.com` sets it on a host the web app never calls, then redirects to `app.tinyhike.com` where the browser won't send it: login fails silently. nginx proxies `/api/*` on the web origin, so keep the whole flow same-origin.

15. **The Resend SDK does NOT throw on API errors** — `resend.emails.send()` resolves with `{ data: null, error: {...} }`. `await` it without inspecting the result and every failed send looks like a success: the endpoint answers 200, the user is told to check their inbox, and nothing is logged. Always destructure `{ error }` and act on it. The same shape applies to the other Resend methods.

16. **Resend's DNS layout is counter-intuitive** — for the verified domain `tinyhike.com`, the MX and SPF records live on **`send.tinyhike.com`** (that's the bounce return-path subdomain), while DKIM sits at **`resend._domainkey.tinyhike.com`** on the root. Looking for DKIM under `send.` finds nothing and leads to the wrong conclusion. And `send.tinyhike.com` is *not* a sending domain: `RESEND_FROM_EMAIL` must be on `tinyhike.com` or Resend refuses the send.

17. **Cloudflare Origin cert gotchas** — generate it in the **`tinyhike.com`** zone (not `tinyhike.app`, which is only a 301 redirect), list **both** `tinyhike.com` and `*.tinyhike.com` (the wildcard doesn't cover the apex), and use the "Click to copy" button: a mouse selection silently drops the `-----BEGIN/END-----` lines and OpenSSL then refuses the file. The private key is shown once — Bitwarden it immediately.

18. **AWS SDK v3 ≥ 3.729 breaks presigned PUTs to R2** — its default (`requestChecksumCalculation: 'WHEN_SUPPORTED'`) adds a flexible checksum to every PutObject. A presigner can't see the body the browser will send, so it signs the CRC32 of an **empty** body (`x-amz-checksum-crc32=AAAAAA==`) into the URL, and R2 rejects every real upload with a checksum mismatch. The S3Client in `api/src/lib/r2.ts` sets `requestChecksumCalculation` and `responseChecksumValidation` to `'WHEN_REQUIRED'`. Any new S3 client needs the same.

19. **A presigned URL signs only `host` unless you pass `signableHeaders`** — setting `ContentType` and `ContentLength` on the `PutObjectCommand` constrains nothing by default: whoever holds the URL can PUT `text/html`, or a multi-GB body, behind a "10 MB JPEG" check. `presignPut()` passes `signableHeaders: new Set(['content-type', 'content-length'])`. Check `X-Amz-SignedHeaders` in a generated URL. The client must then send exactly that Content-Type, with a body of exactly the declared size.

20. **An R2 custom domain serves the WHOLE bucket** — there is no private prefix: `photos.tinyhike.com/<key>` answers for every object in `tinyhike-photos`. Before 23 Oct 2026 uploads went into that bucket under `uploads/`, so each one was public (raw, EXIF included) as soon as the PUT finished, whatever moderation said. Unmoderated bytes need a **separate bucket** with no custom domain and r2.dev access off (`R2_STAGING_BUCKET`). The public bucket only ever receives JPEGs the API re-encoded itself.

21. **Bucket CORS and lifecycle rules need an Admin token** — `PutBucketCors` and lifecycle configuration are bucket-level calls, refused (AccessDenied) to an "Object Read & Write" token. Don't widen the API's token to Admin so a script can set them. An always-on process holding an account-wide admin key can delete buckets or switch public access on, and a leaked `.env` would expose all of R2. Set CORS and lifecycle in the dashboard (`DEPLOY.md` §3c) and keep `R2_ACCESS_KEY_ID` at Object Read & Write on the two buckets.

22. **The partial unique index on `Review` is invisible to Prisma** — `Review_one_written_per_user_per_place` (`… WHERE "userId" IS NOT NULL AND ("score" IS NOT NULL OR "comment" IS NOT NULL)`) is what enforces "one written review per parent per place". Prisma's schema language can't express a partial index, so it lives only in migration `20261023120000_photo_staging_and_review_dedupe`, and Prisma doesn't know it exists. `prisma migrate dev` may report it as drift and offer a reset, or generate a migration that drops it. **Never accept a reset** (it wipes the database). Read every generated `migration.sql` before applying it (generate it offline with `prisma migrate diff`, see the commands above), and delete any `DROP INDEX "Review_one_written_per_user_per_place"`: dropping it silently re-opens rating stuffing. The reviews route relies on it, retrying a concurrent duplicate insert (P2002) as an update. Same family as pitfall 5.

23. **TanStack Query v5 keeps the old data when a refetch fails** — if the `['me']` query threw on a 401, the cached user would stay on screen and every session gate would stay open. A parent whose session expired would keep seeing the review form until the post failed. `web/src/lib/session.ts` follows two rules. The query function resolves `null` for 401/404, because signed out is data, not an error. And whatever learns the session is gone calls `markSignedOut()`, which does `setQueryData(['me'], null)` at once. Invalidating `['me']` is not enough: the stale user stays until a refetch succeeds.

24. **`NOT` over a nullable column skips the NULL rows** — Postgres logic is three-valued: for a place whose `category` is NULL, `category IN (…)` is unknown, and `NOT (unknown)` is still unknown, so the row matches neither a filter nor its negation. `{ NOT: publicPlaceWhere }` would silently miss every place with no category, exactly the hidden ones. Count hidden places by subtraction (total − public), as `GET /api/admin/stats` does, or test `category: null` explicitly. The JS side has the mirror trap: in a test fixture that lacks `verifiedAt`, `verifiedAt !== null` is true, so `isPublicPlace()` compares with `!= null` to stay closed on undefined.

25. **Tests read the checkout's `.env`** — `app.ts` loads `.env` through dotenv, which never overrides a variable already set. In the dev checkout that `.env` says `EMAIL_DELIVERY=log` and has no Resend key, so building the app in tests either took the log path or threw `Missing API key` (265 failures on the first run). `vitest.config.ts` pins `EMAIL_DELIVERY=resend` and a fake `RESEND_API_KEY`: the suite gives the same result in the prod and the dev checkout, and no test holds the real key. Anything new a test relies on goes there too, never into a `.env`.

---

## Code style

- **TypeScript strict mode everywhere.** No `any` types. If you must, use `unknown` and narrow with type guards.
- **Fastify schema validation** on every route — Zod or JSON Schema. Reject requests with malformed input before they hit Prisma.
- **Prisma for all DB access**, no raw SQL in route handlers. The only exception: PostGIS spatial queries via `prisma.$queryRaw`, with a comment explaining why.
- **ESM imports with `.js` extension** in source code even though files are `.ts`. This is the Node ESM convention with `tsx`/native ESM, and the scaffold follows it. Don't "fix" it.
- **One concern per file.** Route handlers stay thin; logic in `src/services/*.ts` (e.g. `photo-moderation.ts`, shared by the admin routes and the CLI).
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
> "Audit `/srv/tinyhike-dev/api/src/` for security issues. Focus on: SQL injection in `$queryRaw` calls, missing auth checks on routes that modify data, secret leakage in logs or error responses, JWT verification correctness, CORS configuration too permissive, missing rate limiting on auth endpoints, predictable IDs (cuid is fine but check), photo upload validation (file size, mime type, no path traversal in R2 keys). Output a markdown report with severity (critical/high/medium/low) and a concrete fix proposal per finding. Don't apply fixes yet, just propose them."

### Schema integrity check
> "Read `/srv/tinyhike-dev/api/prisma/schema.prisma` and `/srv/tinyhike-dev/ops/scripts/postgis_setup.sql`. Verify: every model has matching opposite relations, no orphaned foreign keys, every nullable field is intentional, every Prisma `Unsupported` type has a corresponding setup in postgis_setup.sql, every GIST index is correctly defined. Output discrepancies as a list with line numbers."

### Route coverage matrix
> "Read all files in `/srv/tinyhike-dev/api/src/routes/`. For each route, list: HTTP method, path, auth required (yes/no/optional), Zod or JSON schema validation present (yes/no), error handling (yes/no), Prisma calls (count), logs (yes/no). Output as a markdown table. Flag any route missing schema validation or auth where it should have one."

### Frontend audit
> "Audit `/srv/tinyhike-dev/web/src/`. Check: every page has a loading state, every API call handles errors, no hardcoded URLs (should use `VITE_API_URL` or relative paths), no `any` types, no `useEffect` infinite loops, Mapbox cleanup on unmount, accessibility (alt text, aria labels, focus management). Output a list of issues with file:line references."

### Performance scan
> "Read `/srv/tinyhike-dev/api/src/routes/places.ts` and the corresponding Prisma calls. For the `GET /api/places?bbox=...` endpoint specifically: estimate the query complexity, check if PostGIS GIST index is used (via `EXPLAIN`), check if we paginate or limit results, check if we include too many relations. Suggest concrete optimizations. Same for any other route doing spatial queries."

### Dependency hygiene
> "Run `pnpm outdated` in both `/srv/tinyhike-dev/api` and `/srv/tinyhike-dev/web`. Identify: major version bumps available (call them out, don't upgrade), security advisories via `pnpm audit`, deprecated subdependencies. Output a prioritized upgrade plan, distinguishing 'safe patch updates', 'minor needs testing', 'major needs Jerome's call'."

### Test scaffolding
> "We have zero tests right now. Set up Vitest in `/srv/tinyhike-dev/api` with: `vitest.config.ts`, a `test/` directory, one example test for `places.ts` (mocking Prisma), one integration test using a real test DB. Add `pnpm test` script. Do NOT modify existing source code, just add the testing infrastructure."

### Documentation generation
> "Read every route file and generate a clean OpenAPI 3.1 spec at `/srv/tinyhike-dev/api/openapi.yaml`. Use Fastify's built-in `getSchemas()` if schemas are already JSON Schema, otherwise extract from code. Include auth requirements, request/response shapes, error codes. Validate the YAML against the OpenAPI 3.1 schema."

### Refactor `lat/lng` → PostGIS-aware helper
> "Currently `Place` and `Route` use `lat: Float, lng: Float` with a trigger syncing `geom`. Create a helper `api/src/lib/geo.ts` with: `latLngFromGeom(geom: string)`, `bboxToPolygon(bbox: string)`, `withinBbox(bbox)` returning a Prisma `where` clause for `ST_Intersects`. Refactor `places.ts` to use these helpers. Add JSDoc and one example call in a comment."

### Cleanup
> "Find and remove dead code in `/srv/tinyhike-dev/`: unused imports, unreferenced functions, empty TypeScript files, commented-out code blocks older than the latest commit, `console.log` statements, `TODO` comments older than 7 days (list them, don't delete). Run `tsc --noEmit` after changes to verify nothing breaks."

### When using these prompts
- Always run in a tmux pane, not in the main dev pane
- Always start with `cd /srv/tinyhike-dev && git status` — clean working tree before audits (never run them in `/srv/tinyhike`, production)
- After agent finishes, review the proposed changes with `git diff` before committing
- If the agent suggests upgrades or refactors, **commit them as separate commits** with clear conventional commit messages

---

## When you're a fresh Claude Code session, do this first

1. `cd /srv/tinyhike-dev && git status` — the dev checkout, where code is written. Clean tree?
2. `git pull --ff-only` — sync with GitHub (production, `/srv/tinyhike`, is only touched to deploy: `DEPLOY.md` §3a)
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
| R2 buckets | https://dash.cloudflare.com (R2 → tinyhike-photos, public; tinyhike-photos-staging, private) |

---

## Contact

- **Founder**: Jerome (Telegram `7581563177`)
- **Repo**: https://github.com/Tinyhike/tinyhike
- **Automation pings**: via OpenClaw → Telegram bot from Hostinger n8n
