# TinyHike — Roadmap & To-Do

> Living planning doc. Pairs with `CLAUDE.md` (source-of-truth state) and `MEMORY.md` (decision log).
> Last updated: 13 June 2026.

The north star: a parent opens the app and can answer **"Can I comfortably go there with a stroller and a baby?"** in seconds. Utility first, calm UI, Rotterdam density at launch.

---

## Where we are (13 June 2026)

- Dev environment working end-to-end (API :3000, Web :5173), PostGIS live.
- **381 Rotterdam POIs seeded** from OSM (`seed-osm.ts` fixed & committed).
- **All 381 enriched** with nl/fr/en name + description + tips (1143 translations, 0 failures). `enrich.ts` hardened & committed.
- Still **dev-only** — no production HTTPS deployment. Auth, photo upload, and end-to-end user flows never exercised with real users.

---

## Phase plan to soft launch

### Phase 0 — Harden before exposure (do before any public URL)
Security + correctness gaps that are cheap now and expensive later. See **Security** below. Nothing public should go up until rate limiting, security headers, and a global error handler exist.

### Phase 1 — First production deploy
- Traefik + Let's Encrypt (ACME email already in `.env`), route `app.` `api.` `photos.` over HTTPS.
- Decide Docker-compose vs native systemd services (CLAUDE.md open question #2). Recommendation: ship native + systemd first (less moving parts), containerize when a second dev joins.
- Set prod `WEB_URL`/CORS origin, `PUBLIC_BASE_URL`, `API_BASE_URL`.
- Smoke-test the real magic-link flow against Resend, and a real photo upload to R2.

### Phase 2 — Make the data trustworthy & visible
- Review/approve seeded POIs (all are `PENDING`). Decide moderation policy: auto-approve OSM-sourced + Claude-enriched? Or admin sweep first?
- Tag backfill: the 381 places have descriptions but the boolean tags (`napFriendly`, `shaded`, `smooth`, …) are still mostly null. These are the *moat* (route/place quality layer). Plan: infer from OSM tags during seed where possible, then crowd-correct via reviews.
- Wire the Hostinger cron jobs (OSM diff, enrich, photo moderation, Telegram digest).

### Phase 3 — Close the loop with real parents
- Recruit ~10 Rotterdam parents. Watch them try the core task on a phone.
- Add the first **Route** quality data (pavement/noise/shade/stairs) — the differentiator.
- Ko-fi link for donations (only monetization at launch).

---

## Security (Phase 0 — prioritized)

From a grounded audit of `api/src/`. Severity in brackets. **Most items DONE 13 June 2026** (commit `3228ada`, verified live).

1. ~~**[CRITICAL] No rate limiting**~~ — ✅ DONE. `@fastify/rate-limit`: 200/min global, 5/5min on `/auth/magic`, 20/min on `/auth/verify`, 10/min on reviews.
2. ~~**[HIGH] No security headers**~~ — ✅ DONE. `@fastify/helmet` (CSP, HSTS, X-Frame-Options, nosniff verified in response).
3. ~~**[HIGH] No global error handler**~~ — ✅ DONE. `app.setErrorHandler()` returns `{ error, message }`, masks 5xx stack traces.
4. ~~**[MED] `bbox` not validated**~~ — ✅ DONE. Rejects non-numeric / out-of-range / inverted bbox with 400.
5. ~~**[MED] Photo MIME allowlist**~~ — ✅ DONE. Explicit `jpeg/png/webp` allowlist, SVG excluded.
6. ~~**[MED] Review endpoint abuse**~~ — ✅ DONE (rate-limited; still intentionally unauthenticated for anonymous reviews).
7. **[LOW] Document JWT expiry behavior** — ⏳ TODO. `jose` checks `exp` automatically; make it explicit and add a test.

**Still TODO before deploy:** run the full **Security audit** prompt in CLAUDE.md and triage; set prod CORS origin (`WEB_URL`) and secrets; add tests for the auth flow.

**Already good (keep):** crypto-random 32-byte magic tokens, 15-min TTL, single-use enforcement, HttpOnly+Secure+SameSite=lax cookie, admin routes behind `requireAdmin`, no string-interpolated SQL, FK cascades.

Run the full **Security audit** prompt in CLAUDE.md before deploy and triage the report.

---

## Web / UX / design (mobile-first, one-handed, calm)

Design principles to hold the line on: **fast, uncluttered, reduces uncertainty.** Parents are cognitively overloaded — every screen should answer one question.

Concrete fixes found in the audit:
1. **[HIGH] MapPage leaks** (`MapPage.tsx`) — no `map.remove()` on unmount; markers accumulate on every bbox change. Clear markers before re-adding; add cleanup in the `useEffect` return.
2. **[HIGH] Missing error states** — `AuthPage` and `MapPage` have no error UI; API errors fail silently. Every async action needs loading + error + empty states.
3. **[MED] API error parsing** (`lib/api.ts`) — throws raw `res.text()`; parse the `{ error, message }` body so users see human-readable messages.
4. **Audit pass needed** for accessibility (alt text, aria, focus management) and loading skeletons.

Design direction to decide with Jerome:
- Visual identity: calm palette, large tap targets, a "stroller score" at a glance (the one number a parent wants).
- Place card: lead with the 3-4 tags that matter most (step-free, toilet/changing, smooth, shade) as icons, not prose.
- Map vs list as the default landing view on mobile.

---

## Marketing site (`marketing/index.html`)

Already lightweight (~7 KB, inline CSS, no heavy deps), bilingual EN/NL, clear value prop, CTA → `app.tinyhike.com`. Gaps:
1. **[MED] Social/SEO meta** — add Open Graph (`og:title/description/image/url/type`) + Twitter card + `canonical`. Needed before sharing in parent groups.
2. **[MED] Favicon + `og:image`** — a simple logo/hero image; the site currently references no images.
3. **[LOW] JSON-LD structured data** (Organization / WebSite) for search.
4. Consider a 2-3 line "how it works" and a screenshot once the app UI is presentable.

Keep it static and fast. No frameworks.

---

## Data quality (the moat)

- 381 places enriched (text). **Boolean accessibility tags are the differentiator and are mostly empty.** Prioritize populating them.
- Enrichment preserves the OSM name and only backfills description/tips (a deliberate non-lossy choice — see `MEMORY.md`). Revisit if Claude-renamed places are wanted.
- All places are `PENDING` → need a moderation/approval decision (CLAUDE.md open question #3 & #4).

---

## Testing & ops (currently zero)

- **No tests exist.** Stand up Vitest in `api/` (mock Prisma) — start with the magic-link flow and `GET /api/places` bbox query. Then web component tests.
- `tsc --noEmit` clean today; add it + tests to a CI check before enabling branch protection.
- Backups: confirm a Postgres dump cron exists before real users.

---

## Open product decisions (don't decide alone — for Jerome)

Carried from CLAUDE.md, plus new:
1. Place-tag schema drift: add the 11 stroller-indoor tags, or a separate `PlaceFeature` model?
2. Docker vs native for prod (Phase 1).
3. Photo moderation: async 03:00 cron (up to 21 h wait) vs on-upload Claude vision (better UX, more cost)?
4. OSM data ownership when users edit OSM-sourced places (fork vs overlay).
5. Should enrichment rename places, or always keep the OSM name? (Currently: keep OSM name.)
6. Moderation policy for the 381 PENDING seeded places: auto-approve vs admin sweep.

---

## Immediate next actions (top of stack)

- [ ] Push the local commits (needs GitHub creds in this env — see `MEMORY.md`). Branch is `ahead 4`.
- [x] Phase 0 security: helmet + rate-limit + global error handler + bbox validation + photo allowlist (commit `3228ada`).
- [ ] Fix MapPage marker/cleanup leaks + add error states (high-visibility UX) — *suggested next*.
- [ ] Decide moderation policy for the 381 PENDING places.
- [ ] Stand up Vitest + first tests (auth flow, bbox query).
