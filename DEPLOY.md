# TinyHike — Production Deploy Plan (Step 5)

> Written 2026-08-07. First production HTTPS deploy of `app.tinyhike.com` /
> `api.tinyhike.com`.

## ✅ Decisions locked (2026-09-09)
- **Architecture:** Option A — native + systemd + nginx.
- **TLS:** Cloudflare Origin certificate (DNS already 🟠, SSL Full-strict).
- **Env vars:** reconciled by refactoring the code to the documented names
  (commit `fc32796`) — blocker #0.1 below is **RESOLVED**.

## Progress
- [x] #0.1 env-var mismatch fixed (`fc32796`)
- [x] #0.2 all prod secrets present in `.env` (verified, names only)
- [x] #0.3 `prisma migrate deploy` → up to date
- [x] API + web production builds pass
- [x] Config drafts written: `ops/systemd/tinyhike-api.service`,
      `ops/nginx/tinyhike.conf`
- [x] Cloudflare Origin cert generated (`*.tinyhike.com`, `tinyhike.com`, exp.
      2041) and installed at `/etc/ssl/cloudflare/tinyhike.{pem,key}`
- [x] nginx 1.28.3 installed, site enabled, `default` removed
- [x] `tinyhike-api` systemd unit installed, enabled, running
- [x] **LIVE:** `https://app.tinyhike.com` + `https://api.tinyhike.com` → 200
- [x] Magic-link cookie bug fixed before it shipped (`d3b5a1c`)
- [x] Real visitor IP + per-IP rate limiting behind Cloudflare (`8b6b2d2`)
- [x] **Magic-link end-to-end verified in production** (14 Sep 2026) — needed two
      fixes first: the cookie host (`d3b5a1c`) and Resend errors being swallowed
      (`98bf333`), plus `RESEND_FROM_EMAIL` moved off the unverified
      `send.tinyhike.com` onto `tinyhike.com`
- [x] Reviews + photo-upload batch (23 Oct 2026), deployed 23 Oct: migration
      `20261023120000_photo_staging_and_review_dedupe`, then API, then web (§3b).
      The session cookie is renamed to `__Host-session`, so **every parent is
      signed out once**. Uploads stay off until §3c is done.
- [ ] Photo uploads: one-time Cloudflare setup + browser smoke test (§3c). The UI
      ships with the batch but stays hidden until `R2_STAGING_BUCKET` is set.
- [ ] Reboot to pick up the pending kernel (`7.0.0-15` → `7.0.0-31`)

**Deployed 2026-09-14.** The app no longer needs the SSH tunnel.

---

Goal: the app used to run dev-only behind an SSH tunnel. It is now reachable over
HTTPS at the real domains and survives reboots.

---

## 0. Pre-deploy blockers (verify BEFORE touching infra)

These will silently break prod if wrong. Resolve first.

1. **⚠️ Env var name mismatch (highest priority).** The code reads names that
   differ from what CLAUDE.md documents in `.env`:
   | Code reads (`api/src`) | CLAUDE.md `.env` documents | Risk if unset/mismatched |
   |---|---|---|
   | `API_URL` | `API_BASE_URL` | magic-link URL in emails is broken |
   | `WEB_URL` | `PUBLIC_BASE_URL` | CORS origin + post-login redirect broken |
   | `EMAIL_DOMAIN` | `RESEND_FROM_EMAIL` | "from" address malformed → Resend rejects |
   | `COOKIE_SECRET` | (not listed) | cookie signing uses fallback (dev secret!) |
   **Action:** reconcile the real `.env` on the VPS so every name the code reads
   actually exists. Either add the code-expected names to `.env`, or (cleaner,
   later) refactor the code to the CLAUDE.md names. For deploy, adding the names
   is the fast path. **Do not print values** — just confirm each key exists.
2. **Confirm all prod secrets present** (names only): `DATABASE_URL`,
   `JWT_SECRET`, `COOKIE_SECRET`, `RESEND_API_KEY`, `MAPBOX_PUBLIC_TOKEN`,
   `R2_*`, `ANTHROPIC_API_KEY`, `ACME_EMAIL`.
3. **DB migrations current on the box:** `npx prisma migrate deploy` should say
   "No pending migrations" (init migration is already committed).
4. **`web/.env` has the prod `VITE_API_URL`** (or empty if same-origin via
   Traefik path routing) and `VITE_MAPBOX_TOKEN`.

---

## 1. Architecture decision (Jerome's call — CLAUDE.md open question #2)

Docker is **not installed** on the VPS. Two paths:

### Option A — Native + systemd + nginx (RECOMMENDED for first deploy)
- API runs as a `systemd` service (`node dist/index.js`), Postgres stays native
  (already is), nginx terminates TLS and serves the built web `dist/` + proxies
  `/api` to the API.
- **➕** Fewest moving parts; Postgres/PostGIS already native and working; no
  Docker learning curve mid-launch; easy to reason about and roll back.
- **➖** Manual-ish (systemd unit + nginx conf by hand); no container isolation.

### Option B — Docker Compose + Traefik (the existing scaffold)
- Use `ops/docker-compose.yml` + `ops/traefik/traefik.yml` (already scaffolded,
  never run). Traefik does ACME/TLS + routing; api/web/marketing as containers.
- **➕** Matches the committed scaffold; Traefik automates Let's Encrypt; clean
  multi-service routing; reproducible.
- **➖** Requires installing Docker; must containerize + move Postgres into a
  volume or point containers at native Postgres; bigger blast radius for a first
  deploy; more to debug under launch pressure.

**Recommendation:** **Option A now**, revisit Docker (Option B) when a second dev
joins or services multiply — exactly the trigger CLAUDE.md #2 names. Rest of this
plan assumes **Option A**; I'll write an Option-B variant if you prefer it.

---

## 2. Step-by-step (Option A)

Each step notes if it needs **[sudo]** (I'll ask before every sudo command).

1. **Reconcile `.env`** (blocker #0.1). [no sudo] — confirm names, add missing.
2. **Build artifacts:** `cd api && pnpm build` (→ `dist/`); `cd web && pnpm build`
   (→ `dist/`). Verify `pnpm test` green first.
3. **systemd unit** `/etc/systemd/system/tinyhike-api.service` **[sudo]** —
   `WorkingDirectory=/srv/tinyhike/api`, `ExecStart=/usr/bin/node dist/index.js`,
   `EnvironmentFile=/srv/tinyhike/.env`, `Restart=always`, runs as `tinyhike`.
   `systemctl enable --now tinyhike-api`.
4. **nginx** **[sudo]** — install, server blocks for `app.` (static `web/dist` +
   SPA fallback + `/api` proxy to `127.0.0.1:3000`), `api.` (proxy), `photos.`
   already on R2/Cloudflare. Reuse `web/nginx.conf` / `marketing/nginx.conf` as
   starting points.
5. **TLS** — two choices:
   - **(a) Cloudflare Origin cert** (simplest, since DNS is already proxied 🟠
     through Cloudflare with SSL Full-strict): generate an origin cert in CF,
     drop it on the box, point nginx at it. No ACME, no port-80 dance.
   - **(b) Let's Encrypt via certbot** **[sudo]** — needs port 80 reachable +
     temporarily grey-clouding DNS. More steps.
   **Recommend (a) Cloudflare Origin cert** — matches the existing 🟠 setup.
6. **UFW** already allows 80/443 (per CLAUDE.md). Confirm; no change expected.
7. **Cutover:** lower Cloudflare proxy TTL, point `app`/`api` at the origin,
   verify.

---

## 3. Smoke tests (post-deploy, before announcing)

- `https://api.tinyhike.com/api/health` → 200 `{ ok: true }`.
- `https://app.tinyhike.com` loads the map, shows Rotterdam POIs (real domain,
  not tunnel). Mapbox token must allow `app.tinyhike.com` (already configured).
- **Magic-link end-to-end** (never tested!): request link → receive Resend email
  → click → cookie set → `/api/auth/me` returns the user. This is the riskiest
  untested path; do it on a real address.
- Rate-limit headers present; helmet headers present (curl `-I`).
- One **photo upload** to R2, from a browser: see "Smoke test" in §3c.

---

## 3b. Running it day to day

```bash
# Ship a code change (API first: the web build may call routes only the new API has)
cd /srv/tinyhike/api && pnpm test
pnpm db:migrate && pnpm db:generate         # ONLY when api/prisma/migrations/ changed: db:migrate = prisma migrate deploy
                                            #   (never `migrate dev` here, see CLAUDE.md pitfall 22)
pnpm build && sudo systemctl restart tinyhike-api
cd /srv/tinyhike/web && pnpm build          # nginx serves dist/ directly, no reload needed

# Watch the API
systemctl status tinyhike-api
journalctl -u tinyhike-api -f

# nginx
sudo nginx -t && sudo systemctl reload nginx
tail -f /var/log/nginx/access.log

# Refresh Cloudflare's edge ranges (rare, but they do change)
ops/scripts/update-cloudflare-ips.sh
sudo cp ops/nginx/cloudflare-*.conf /etc/nginx/snippets/
sudo nginx -t && sudo systemctl reload nginx
```

Smoke-testing from the box needs a browser User-Agent — Cloudflare's Bot Fight
Mode serves a challenge (HTTP 403) to the default `curl` UA, which looks like an
origin failure but isn't:

```bash
curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
     https://api.tinyhike.com/api/health
```

To bypass Cloudflare entirely and test the origin, resolve to localhost — the
origin returns 403 to any other direct hit, by design:

```bash
curl -sk --resolve app.tinyhike.com:443:127.0.0.1 https://app.tinyhike.com/api/health
```

---

## 3c. Photo uploads setup (one time, Jerome, Cloudflare dashboard)

Uploads land in a **private staging bucket**. A photo reaches
`photos.tinyhike.com` only once a moderator approves it, re-encoded with EXIF
stripped (`api/src/services/photo-moderation.ts`). Uploads stay **off** until
`R2_STAGING_BUCKET` is set: `GET /api/photos/config` answers `{"enabled":false}`,
presign and confirm answer 503, and the web hides "Add a photo". Nothing here is
urgent until you want uploads on. The full why is in the header of
`api/src/lib/r2.ts`.

**Before you start:** the 23 Oct batch is deployed (§3b, migration included).

1. **Create the staging bucket.** R2 → Create bucket → `tinyhike-photos-staging`.
   - Location: **Automatic, no jurisdiction**, the same as `tinyhike-photos`.
     Both buckets go through one S3 endpoint. A bucket under a jurisdiction (EU,
     …) only answers on `<account>.eu.r2.cloudflarestorage.com`, so every call
     from the API would fail with NoSuchBucket.
   - **No custom domain**, and **Public access (r2.dev) OFF**.
2. **CORS on the staging bucket only.** R2 → `tinyhike-photos-staging` →
   Settings → CORS Policy → paste exactly:
   ```json
   [
     {
       "AllowedOrigins": ["https://app.tinyhike.com", "http://localhost:5173"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   - The browser PUTs cross-origin, from the app straight to R2. Without this
     rule every preflight fails and every upload reads as a network error.
     Content-Length is set by the browser itself and needs no entry.
   - **No GET rule is needed.** The moderation view URL (a presigned GET) is
     opened as a plain link, which is a navigation, not a CORS request. An
     `<img src>` in a future admin UI wouldn't need one either; only a `fetch()`
     of it would.
   - The public bucket needs no CORS: `<img>` loads don't use it.
   - Don't script this with the API's key: PutBucketCors needs an Admin token
     (CLAUDE.md pitfall 21). `wrangler r2 bucket cors set` also works, but its
     file format differs from the dashboard's: see `--help`.
3. **Lifecycle rule on the staging bucket.** R2 → `tinyhike-photos-staging` →
   Settings → Object lifecycle rules → add one:
   - prefix `uploads/`, delete objects after **1 day**. These are PUTs that
     were never confirmed (abandoned, or retried under a new key).
   - Add **no rule for `confirmed/`**: those are photos waiting for moderation,
     and moderation deletes them.
4. **R2 API token scope.** R2 → Manage R2 API Tokens → the token behind
   `R2_ACCESS_KEY_ID`: **Object Read & Write** on **both** `tinyhike-photos` and
   `tinyhike-photos-staging`, and **never Admin**. Scoped to the public bucket
   only, the browser's PUT gets a 403 and confirm answers 500. If you create a
   new token instead of editing this one, update Bitwarden and `.env`.
5. **Switch it on.** Edit `/srv/tinyhike/.env` yourself (and Bitwarden):
   ```
   R2_STAGING_BUCKET="tinyhike-photos-staging"
   ```
   Also check that `R2_PUBLIC_URL` is the absolute `https://photos.tinyhike.com`,
   because approvals refuse to run without it. Then clear anything the old flow
   left in the public bucket (before this batch, `/presign` signed PUTs straight
   into `tinyhike-photos` under `uploads/…`). Then restart:
   ```bash
   cd /srv/tinyhike/api
   pnpm photos:moderate purge-legacy --dry-run   # "Nothing to do" = done, skip the next line
   pnpm photos:moderate purge-legacy             # moves pending ones to staging, deletes the rest, prints URLs to purge
   sudo systemctl restart tinyhike-api
   ```
   If purge-legacy printed URLs, purge them (or the prefix
   `photos.tinyhike.com/uploads/`) in Cloudflare → Caching → Configuration →
   Purge Cache → Custom Purge. Check that `/api/photos/config` now answers
   `{"enabled":true}` (browser UA, see §3b), then go straight to the smoke test
   below.
6. **Optional, any time: harden `photos.tinyhike.com`.** Rules → Transform
   Rules → Modify Response Header, for hostname equals `photos.tinyhike.com`, set
   two static headers:
   - `X-Content-Type-Options`: `nosniff`
   - `Content-Security-Policy`: `default-src 'none'; sandbox`

   The public bucket now only receives JPEGs the API encoded itself, so this is
   defence in depth: even a stray non-image object there could never run script
   on a `tinyhike.com` origin. Afterwards, open an approved photo's URL directly
   and check it still displays. If a browser shows it blank, use
   `default-src 'none'; img-src 'self'; sandbox`. Photos inside the app aren't
   affected: an `<img>` load ignores the image's own CSP.

### Smoke test (right after step 5, BEFORE telling anyone)

Sign in on `https://app.tinyhike.com`, open DevTools on any page and run this.
Use the id of an APPROVED place.

```js
const blob = await (await fetch('/icon-192.png')).blob()
const p = await (await fetch('/api/photos/presign', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ contentType: blob.type, size: blob.size }) })).json()
;(await fetch(p.uploadUrl, { method: 'PUT', headers: { 'content-type': blob.type }, body: blob })).status   // 200
const c = await fetch('/api/photos/confirm', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ key: p.key, placeId: '<approved place id>' }) })
;[c.status, await c.json()]   // [201, { id, status: 'PENDING' }]
```

What a failure means:
- Presign answers 503: `R2_STAGING_BUCKET` isn't set, or the API wasn't restarted.
- The PUT fails with a CORS or network error: step 2 is missing or wrong.
- The PUT answers 403: step 4 (token scope) is wrong.
- Confirm answers 500: check `journalctl -u tinyhike-api`. NoSuchBucket points
  to step 1's location or the bucket name.

Then run `pnpm photos:moderate list`. Approve the test photo and open the URL it
prints: that proves the re-encode and the public bucket. Then reject it, which
takes it down, and purge the URL that command prints.

**If anything fails and you can't fix it now:** remove the
`R2_STAGING_BUCKET` line and restart the API. The button disappears again, and
nothing a parent sent is lost: confirmed photos stay in staging, and can be
moderated once the line is back.

### Moderating photos (until the admin UI exists)

```bash
cd /srv/tinyhike/api
pnpm photos:moderate list                       # PENDING, oldest first. Also: list APPROVED / list REJECTED
pnpm photos:moderate approve <photoId>          # re-encode → p/<photoId>.jpg in the public bucket, prints its URL
pnpm photos:moderate reject <photoId> [note…]   # deletes the bytes; the note is optional (max 500 chars)
```

- A PENDING photo's `view:` link is a signed URL into private staging, valid for
  **10 minutes**. Open it in a browser, then approve or reject. Run `list` again
  for a fresh link.
- The same actions exist as admin-only API routes, for a future admin UI:
  `GET /api/admin/photos?status=PENDING` and `PATCH /api/admin/photos/:id` with
  `{ "status": "APPROVED" | "REJECTED", "moderationNote"?: "…" }`.
- **Takedowns.** Rejecting an APPROVED photo deletes it from R2, but Cloudflare
  keeps serving it, because it is cached `immutable` for a year. Purge the URL
  the command prints (or the `purgeUrl` the PATCH returns) in Caching → Purge
  Cache → Custom Purge. **The takedown isn't done until you purge it.**

## 4. Rollback

- API: `systemctl stop tinyhike-api` (dev tunnel still works as before).
- TLS/routing: flip Cloudflare back to the holding page / previous state.
- DB: no destructive migration in this deploy; nothing to roll back there.
- Keep the tunnel-based dev flow intact as the fallback during cutover.

---

## 5. Out of scope for this deploy (later)

- Docker/Traefik migration (Option B).
- The Hostinger cron wiring (OSM diff, enrich, photo moderation, Telegram digest).
- `GET /api/places` pagination beyond the 200 cap.
- CI running `pnpm test` on push + branch protection.

---

## Open questions for Jerome before we start
1. **Option A (native+systemd) or B (Docker/Traefik)?** (I recommend A.)
2. **TLS via Cloudflare Origin cert (recommended) or Let's Encrypt/certbot?**
3. **`.env` reconciliation:** add code-expected names now (fast), or refactor
   code to CLAUDE.md names (cleaner, slightly more work)?
4. Deploy `marketing/` static site at the apex/`www` in the same pass, or later?
