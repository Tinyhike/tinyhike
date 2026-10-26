# TinyHike — Roadmap & To-Do

> Living planning doc. Pairs with `CLAUDE.md` (source-of-truth state) and `DESIGN.md`
> (visual system). Last updated: **26 October 2026** — unverified cafés hidden,
> admin verification of places, playground ages and equipment from OSM.
> Previous updates: 23 October 2026 (reviews + photo upload), 14 September 2026
> (production deploy, dataset rebuilt, product recentering with Jerome).

---

## The pitch (recentered 14 Sep 2026, Jerome's words)

A **family, cooperative app/website** about the best places to walk with a baby or
child in Rotterdam.

- Places can be **rated and commented** — free text ("parfait pour les enfants")
  and tags ("table à langer").
- The app proposes **walks matching needs** — a 30-min loop through a park, or
  current location → Centraal with a stroller-accessible café on the way.
- Parents **add places or request corrections** (validated by moderation), and
  **share the walks they actually do** (Strava-like) with other users.

### Scope decisions locked (14 Sep 2026)
| Question | Decision |
|---|---|
| Social | **Content sharing only** — public walks & lists, follow. No messaging, no social profiles. Stays "utility, not a social network". |
| Route generation | **Not in the MVP.** Launch is places + reviews + user-added places. Routing (Mapbox Directions vs self-hosted OSRM) decided when traction justifies it. |
| Tag schema | **Airbnb-style**: indoor and outdoor tag sets, shown by place type. **Done 14 Sep**: 19 tri-state tags in 3 groups, validated from `design/mockups/place-tags-mockup.html` (`c173764`). |

### Decisions locked (23 Oct 2026, Jerome)
| Question | Decision |
|---|---|
| Ratings & comments | **Need an account.** One written review per parent per place; posting again updates it. Still **displayed anonymously** ("Un parent"): no handle can be set yet, so the app never promises "sign with your name". |
| Amenity tag votes | **One tap, anonymous, no account.** The voter's id is kept only when they happen to be signed in. |
| Photos | **Unmoderated bytes are never publicly reachable.** Uploads go to a private staging bucket; a human approves; only then is a re-encoded, EXIF-free copy published. |

### Decisions locked (26 Oct 2026, Jerome)
| Question | Decision |
|---|---|
| What the map shows | **Playgrounds, parks and picnic sites, plus verified places.** The 274 cafés and the 17 places that no longer match OSM stay in the DB, hidden until verified. |
| What "verified" means | An admin's visit records **4 points, yes or no**: step-free entrance, room for the stroller inside, changing table, toilets. A verified café may say "no": that tells parents which ones to avoid. Date and author kept, never shown. |
| Approval vs verification | **Two separate actions.** Approving a parent's proposal does not verify it. |
| Admin | Jerome's account is ADMIN. |
| Descriptions | **No AI enrichment for now**, and never of hidden places. Instead, playground ages and equipment from OSM (display still to design). |

---

## What the 26 October 2026 batch delivered

- **Unverified cafés hidden.** `Place.category` from the OSM tag (854 playgrounds,
  159 parks, 14 picnic sites, 274 cafés, 17 with none). One visibility rule
  (`api/src/lib/place-visibility.ts`) replaces four copies, and covers every route,
  `my-review` included (it had no check at all). **1027 public places, 291 hidden.**
  No web change: a hidden café's link answers the existing "not found" sheet.
- **Verification of places** — `pnpm places:verify` on the VPS, and the admin routes
  `GET /api/admin/places`, `PUT`/`DELETE /api/admin/places/:id/verification`.
- **Adding a café the seeder missed** — `pnpm places:verify add node/<id> --category CAFE`
  creates it, hidden, from one OSM element (brunch places OSM files as restaurants,
  e.g. By Jarmusch West). Widening the seeder to them: proposal in
  `docs/plan-cafes-non-verifies.md` §10 (10 restaurants in Rotterdam, 20 with
  pancake and lunch).
- **Playground details from OSM** — `minAge` / `maxAge` and the equipment kinds
  (`pnpm backfill:playgrounds`). Thin coverage: 61 of 854 playgrounds with
  equipment, 3 with an age. Not displayed yet (proposal in
  `docs/plan-cafes-non-verifies.md` §9).
- **Migrations generated offline** with `prisma migrate diff`, never `migrate dev`.
- **612 Vitest tests green** (was 395).
- **`docs/MAINTENANCE.md`** — the maintenance window procedure (apt, PostgreSQL,
  PostGIS, Node, reboot, rollback), prepared, not run.

## What the 23 October 2026 batch delivered

- **Ratings and reviews, end to end.** The place sheet now has a rating header
  (average, count), written reviews newest first with "Load more", and a star +
  comment form that edits your own review when you already left one. Stars and
  comments need an account, one review per parent per place (enforced by a
  partial unique index in the DB). Amenity votes stay anonymous and no longer
  push written reviews out of the list.
- **Photo upload, end to end, shipped dark.** "Add a photo" on the place sheet
  (re-encoded on the phone, progress, cancel, retry) → private staging bucket →
  PENDING. Hidden until `R2_STAGING_BUCKET` is set, which waits on Jerome's
  Cloudflare checklist (`DEPLOY.md` §3c).
- **Photo moderation, first version.** Correction to the 14 Sep state below: there
  was **no** photo moderation route then. The only moderation route was
  `PATCH /api/admin/places/:id`, so an upload would have stayed PENDING forever,
  while its bytes would already have been public at `photos.tinyhike.com`. Now:
  `pnpm photos:moderate list|approve|reject` on the VPS, plus
  `GET`/`PATCH /api/admin/photos`. Approval re-encodes with sharp (EXIF/GPS
  stripped) into the public bucket. Rejection deletes the bytes; taking down an
  approved photo also needs a manual Cloudflare cache purge. **No admin UI yet.**
- **Security fixes** from a multi-agent review (30 defects):
  - the `__Host-session` cookie, so no subdomain can plant a session;
  - presigned uploads pinned to type and exact size;
  - rate-limit keys that fold IPv6 to its /64;
  - no user ids or moderation notes in public payloads;
  - pending places answer 404 to everyone but their submitter.
- **Sign-in brings you back** to the place you were on (`next`, allowlisted).
- **Accessibility and i18n:**
  - `--sun-deep` and `--mint-deep` darkened to pass AA;
  - 44px tap targets and visible focus rings on every new control;
  - singular/plural counts, and decimals and relative dates in the UI locale;
  - every error message localized.
- **395 Vitest tests green** (was 39).

## Where we are (14 September 2026)

**In production, HTTPS, no tunnel**: `app.tinyhike.com` + `api.tinyhike.com`
(systemd + nginx + Cloudflare Origin TLS, real-IP rate limiting, WAF-only origin).

- **1318 places** — rebuilt 14 Sep: 859 playgrounds (65%), 276 cafes (21%). The
  original seed was 69% cafes because the Overpass query missed area-drawn
  playgrounds and dropped unnamed ones; both fixed (`45adcd2`, `1823ae7`).
- **Stroller tags populated from OSM where OSM is explicit** (never guessed):
  hasPlayground 859, hasCafe 276, wheelchairOk 37y/7n, smooth 6y/46n, hasToilets 21.
  napFriendly / shaded / hasParking: still all null (no OSM equivalent — these
  belong to enrichment or reviews).
- **Magic-link auth verified end-to-end in production** (real inbox). Took three
  fixes: cookie host (`d3b5a1c`), Resend SDK swallowing errors (`98bf333`),
  `RESEND_FROM_EMAIL` on the wrong domain (.env + docs).
- **Web app**: tab-bar shell, place sheet over a persistent map, clustering,
  nl/fr/en interface with switcher, bright toy-box identity (`DESIGN.md`),
  generated PWA icons. 381 original places have nl/fr/en descriptions.
- **API**: helmet, per-IP rate limits, error envelope, bbox+limit validation,
  truncation headers, photo flow rebuilt (row only after verified R2 upload). No
  photo moderation route yet, and uploads went straight into the public bucket
  (both fixed 23 Oct, above).
- **39 Vitest tests green.**

---

## Phase plan (reordered around the pitch)

### Phase A — The contributive loop (in progress)
The pitch's core: rate, comment, correct, add. Order:
1. ✅ **Place sheet, full version** — tags displayed Airbnb-style (14 Sep), then
   rating, reviews list and review form (23 Oct). Unknown (null) tags invite
   confirmation through a one-tap vote: tri-state is the dominant state and the
   contribution hook.
2. ✅ **Tag schema** — indoor + outdoor sets, 19 tags, additive migration (14 Sep).
3. ✅ **Photo upload UI** (23 Oct) — built and tested, **off in production** until
   `DEPLOY.md` §3c is done.
4. **"Add a place" flow** (backend done: USER → PENDING → admin approves).
5. **Admin moderation UI** — the routes exist since 23 Oct for photos
   (`GET`/`PATCH /api/admin/photos`; before that only places had one,
   `PATCH /api/admin/places/:id`). Today photos are moderated from the shell
   (`pnpm photos:moderate`). The screen needs: the PENDING queue with the
   10-minute view link, approve/reject with a note, and the takedown reminder to
   purge the Cloudflare cache.
6. **Claude vision auto-moderation** — a first pass on each PENDING photo that
   settles the clear cases and leaves the rest to a human (criteria to agree
   with Jerome). It goes through the same `approvePhoto`/`rejectPhoto` service,
   so the re-encode and the takedown rules stay in one place. Latency choice:
   cron vs on upload (open decision 3).

### Phase B — Walks (the differentiator, post-MVP)
- User-recorded/drawn walks shared publicly (Track model exists, minimal).
- Route *generation* by criteria — engine decision deferred.

### Phase C — Light social
- Public lists (Mapstr-style, models + routes exist), follow contributors.
- No messaging. No feeds beyond "what people you follow shared".

### Continuous
- **Verify cafés** on visits (`pnpm places:verify`): each verified café comes back on
  the map, with its four points.
- AI enrichment **paused** (Jerome, 26 Oct). When it resumes, `enrich.ts` only takes
  public places: about 918 of them have no description today (11% have one).
- Wire Hostinger crons (OSM diff, enrich, photo moderation, Telegram digest). The
  digest is a natural place for "N photos waiting for review".
- CI running `pnpm test` on push; Postgres dump cron before real users.

---

## Known debt (tracked, not urgent)

- Map payload: ~340 KB per pan (full Place objects). Fine on wifi, heavy on 4G —
  a slim `/api/places` projection (id, lat, lng, name, key tags) would cut ~80%.
- Kernel reboot pending on the VPS (`7.0.0-15` → `7.0.0-31`; systemd makes it safe).
- `marketing/index.html` not deployed (apex + www have no origin server block);
  needs OG/Twitter meta + favicon before sharing in parent groups.
- Vestigial `CLAUDE` value in `PlaceSource` enum (provenance now via `enrichedAt`).
- JWT expiry behaviour: document + test (jose checks `exp`; make it explicit).
- 17 places whose OSM element no longer matches the query (9 legacy: a pub, a
  fast-food, a restaurant, an untagged node, 5 deleted; 8 typed: 2 ex-cafés, 5
  ex-playgrounds, 1 untagged). Hidden since 26 Oct (no category). A periodic
  reconciliation job someday.
- 22 OSM playgrounds are `access=private` and 14 `access=customers` (schoolyards,
  residential courtyards, café terraces): still on the map. Hiding them is a product
  call.
- `requireAdmin`, and the ADMIN branch of `canSeePlace()`, trust the role in the
  JWT, which lives 30 days: a demoted admin keeps admin reads (and photo
  moderation) until then. The writes that change what the public sees (verify,
  unverify, category) re-check the role in the DB. With one account this is
  theory; a role/version claim or a shorter session would close it.
- The web orders a sheet's amenity groups from `hasCafe`; `category` is now in the
  payload and would be the right signal.
- Photo takedowns need a manual Cloudflare cache purge (public photos are cached
  `immutable` for a year). Automating it needs a Cloudflare API token with
  cache-purge rights only, not the R2 key.
- User content (`photos.tinyhike.com`) is same-site with the app. `__Host-session`
  and API-encoded JPEGs close the known attacks; a separate registrable domain
  for user content would be the long-term fix.

---

## Open product decisions (for Jerome)

1. ~~**Tag design**~~ — resolved 14 Sep (validated mockup, shipped in `c173764`).
2. ~~**Enrichment run for the 937 new places**~~ — paused (26 Oct): no AI
   enrichment for now; OSM playground details instead.
3. Photo moderation latency: today a human runs `pnpm photos:moderate`. Next:
   03:00 cron (up to 21h) vs on-upload Claude vision.
4. OSM data ownership when users edit OSM-sourced places (fork vs overlay).
5. Generic-named places ("Speeltuin"): fine at launch, or reverse-geocode street
   names ("Speeltuin Voorhaven") for the top N most-viewed?
6. **Signed reviews** — reviews show as "Un parent" because nothing sets
   `User.handle`. To sign them: handles or first names? An opt-in "sign with
   my name" toggle (anonymous by default)? Needs a handle setter on the profile.

---

## Immediate next actions

- [x] ~~Jerome: push 6 local commits~~ (`main` is in sync with GitHub).
- [x] ~~Jerome: Airbnb-style tag screenshot~~ (resolved through the validated mockup).
- [x] ~~Phase A step 1: place sheet with tags + reviews~~ (14 Sep + 23 Oct).
- [x] **Deploy the 23 Oct batch** (done 23 Oct) (`DEPLOY.md` §3b): migration, then API, then
      web. Every parent gets signed out once (cookie renamed to `__Host-session`).
- [ ] **Jerome: push the 26 Oct commits**, then sign out and in again: the ADMIN
      role is read from the session.
- [ ] **Jerome: verify the first cafés** (`pnpm places:verify`, see `CLAUDE.md`).
- [ ] **Jerome: maintenance window** (`docs/MAINTENANCE.md`, from his own SSH
      session).
- [ ] Decide how the sheet shows playground ages and equipment
      (`docs/plan-cafes-non-verifies.md` §9).
- [ ] Decide whether the seeder takes brunch restaurants, hidden like cafés
      (`docs/plan-cafes-non-verifies.md` §10: strict filter or with pancake/lunch).
- [ ] **Jerome: photo uploads setup** — the Cloudflare checklist and smoke test
      in `DEPLOY.md` §3c (staging bucket, CORS, lifecycle, token scope,
      `R2_STAGING_BUCKET`).
- [ ] Admin moderation UI (Phase A step 5), then Claude vision (step 6).
- [ ] Reload the map UX against the 1318-place dataset (clusters got denser).
