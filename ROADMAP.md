# TinyHike — Roadmap & To-Do

> Living planning doc. Pairs with `CLAUDE.md` (source-of-truth state) and `DESIGN.md`
> (visual system). Last updated: **14 September 2026** — after production deploy,
> auth verified, dataset rebuilt, and a product recentering session with Jerome.

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
| Tag schema | **Airbnb-style, pending Jerome's screenshot**: indoor tag set and outdoor tag set, shown by place type. Schema work waits for that reference. |

---

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
  truncation headers, photo flow rebuilt (row only after verified R2 upload).
- **39 Vitest tests green.**

---

## Phase plan (reordered around the pitch)

### Phase A — The contributive loop (next)
The pitch's core: rate, comment, correct, add. Order:
1. **Place sheet, full version** — tags displayed Airbnb-style (awaiting Jerome's
   screenshot for the tag design), rating, reviews list, review form.
   Unknown (null) tags must invite confirmation, not look broken — tri-state is
   the dominant state and the contribution hook.
2. **Tag schema per Jerome's Airbnb reference** — indoor + outdoor sets, additive
   migration.
3. **Photo upload UI** (backend done and tested).
4. **"Add a place" flow** (backend done: USER → PENDING → admin approves).
5. **Admin moderation UI** (routes exist, no interface).

### Phase B — Walks (the differentiator, post-MVP)
- User-recorded/drawn walks shared publicly (Track model exists, minimal).
- Route *generation* by criteria — engine decision deferred.

### Phase C — Light social
- Public lists (Mapstr-style, models + routes exist), follow contributors.
- No messaging. No feeds beyond "what people you follow shared".

### Continuous
- Enrich the 937 new places (nl/fr/en) — **needs Jerome's go, ~937×3 Claude calls**.
- Wire Hostinger crons (OSM diff, enrich, photo moderation, Telegram digest).
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
- 9 legacy places whose OSM element no longer matches the query (renamed/deleted
  upstream) — periodic reconciliation job someday.

---

## Open product decisions (for Jerome)

1. **Tag design** — waiting on the Airbnb-style screenshot; then schema + UI.
2. **Enrichment run for the 937 new places** — cost vs. empty descriptions.
3. Photo moderation latency: 03:00 cron (up to 21h) vs on-upload Claude vision.
4. OSM data ownership when users edit OSM-sourced places (fork vs overlay).
5. Generic-named places ("Speeltuin"): fine at launch, or reverse-geocode street
   names ("Speeltuin Voorhaven") for the top N most-viewed?

---

## Immediate next actions

- [ ] **Jerome: push 6 local commits** (`d55b9c1`…`1823ae7`).
- [ ] **Jerome: Airbnb-style tag screenshot** → unblocks Phase A steps 1–2.
- [ ] Reload the map UX against the 1318-place dataset (clusters got denser).
- [ ] Phase A step 1: place sheet with tags + reviews (can start the tri-state
      tag UI groundwork now; final tag list lands with the screenshot).
