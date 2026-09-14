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
- [ ] Photo upload smoke test — backend rebuilt and tested, but no UI calls it yet
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
- One **photo upload** to R2 (also never tested end-to-end).

---

## 3b. Running it day to day

```bash
# Ship a code change
cd /srv/tinyhike/api && pnpm build && sudo systemctl restart tinyhike-api
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
