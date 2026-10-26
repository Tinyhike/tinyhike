# TinyHike — design system

> Written for a design handoff (Claude Design `/design-sync`, Figma, or a palette
> pasted into chat). If you change the identity, this file tells you every place
> that has to move.

## Direction

**Bright toy-box.** Primary colours — the register of a nursery, or a room full of
toys. Explicitly *not* the pastel/cream palette this category defaults to.

Target user: a parent pushing a stroller, one-handed, outdoors, in daylight. So:
large tap targets, high contrast, chunky shapes, nothing subtle.

## Where things live

| What | File |
|---|---|
| **Tokens (edit here first)** | `web/src/styles/tokens.css` |
| Component styles | `web/src/index.css` |
| App shell + tab bar | `web/src/components/AppLayout.tsx` |
| Place sheet | `web/src/components/PlaceSheet.tsx` |
| Amenities, reviews, photo upload | `web/src/components/PlaceAmenities.tsx`, `PlaceReviews.tsx`, `PhotoUpload.tsx` |
| Mockups (standalone HTML) | `design/mockups/` |
| Map, clusters, pins | `web/src/pages/MapPage.tsx` |
| Icon artwork (generated) | `ops/scripts/generate-icons.py` |
| PWA manifest | `web/public/manifest.json` |

## Palette

Every hue has a `-deep` variant. Bright values are for fills, borders and accents;
`-deep` is for anything carrying **white text**, where the bright value doesn't
reach 4.5:1 contrast, and for coloured text on light backgrounds.

| Token | Hex | Used for |
|---|---|---|
| `--berry` / `--berry-deep` | `#ef476f` / `#d81e5b` | Primary action, map pins, Map tab, close button |
| `--sun` / `--sun-deep` | `#ffd166` / `#a35f00` | Loading pill, tip callouts, icon background, PWA splash; `-deep`: star ratings, the "Note des parents" kicker |
| `--mint` / `--mint-deep` | `#06d6a0` / `#037a5c` | Positive / confirmed; `-deep`: "✓" chips, the photo Send button, "photo sent" |
| `--sky` / `--sky-deep` | `#21a9d8` / `#0b6e8f` | Links, focus rings, Profile tab, language switcher |
| `--grape` / `--grape-deep` | `#9b5de5` / `#7b2cbf` | Map clusters, Lists tab |
| `--ink` | `#073b4c` | Body text — deep teal-navy, not black |
| `--ink-soft` | `#4a6b78` | Secondary text |
| `--surface-tint` | `#fff8ee` | Callout backgrounds — a warm tint of `--sun` |

**Measured contrast (WCAG 2, 4.5:1 needed for body text).** Every `-deep` passes
with white: berry 4.93, sun 5.01, mint 5.33, sky 5.77, grape 7.11. They also pass
as text on `--surface-tint` (berry 4.68, sun 4.75, mint 5.05). On the mint tint
`#dff8ef`, only mint, sky and grape pass (4.77, 5.17, 6.37); berry and sun fall
just short, so don't put them there. The bright values never carry text: `--sky`
with white is 2.72. `--sun-deep` and `--mint-deep` were darkened on 23 Oct 2026
from `#e08c00` (2.65 with white) and `#04936f` (3.88), which failed. Re-measure
whenever a hex moves; `tokens.css` keeps the same figures in its header.

The identity comes from using the **whole palette semantically** rather than
tinting one brand colour: each tab lights up in its own hue, and the place sheet
wears a four-colour band across its top edge.

## Type

`--font-ui` is a system rounded stack (`ui-rounded`). That resolves to a genuinely
rounded face only on Apple platforms; elsewhere it falls back to the regular UI
font.

**Swapping in a real rounded webfont — Nunito, Baloo 2, Fredoka — is the single
highest-impact typographic change available.** It needs a dependency install
(`pnpm add @fontsource-variable/nunito`), so it's a deliberate call, not a default.

## Shape

- `--radius: 18px` — cards, inputs, callouts
- `--radius-lg: 26px` — the place sheet
- `--shadow-pop` is a **flat offset shadow**, not a blur. Toy-like, not material.
- Borders are `2px`, not `1px`. Chunky reads as playful and survives sunlight.

## ⚠️ Two places colours are duplicated

Tokens are CSS custom properties, and two consumers can't read CSS. **Change these
by hand whenever the palette moves**, or the app will drift out of sync with itself:

1. **`web/src/pages/MapPage.tsx`** — Mapbox paint properties take literal colours,
   not `var()`. Currently `#9b5de5` (clusters) and `#ef476f` (pins).
2. **`ops/scripts/generate-icons.py`** — the constants at the top of the file. After
   editing, re-run `python3 ops/scripts/generate-icons.py` and rebuild.

`web/public/manifest.json` and `web/index.html` also carry `#ffd166` as the theme
and splash colour.

The mockups in `design/mockups/` are standalone HTML with their own `:root` copy of
the palette. Update them too, or the next design pass copies the old values back
into the app.

## Changing the identity, end to end

```bash
# 1. Edit the palette
$EDITOR web/src/styles/tokens.css

# 2. Mirror the two duplicated spots
$EDITOR web/src/pages/MapPage.tsx              # cluster + pin colours
$EDITOR ops/scripts/generate-icons.py          # icon constants
$EDITOR web/public/manifest.json web/index.html  # theme_color / background_color

# 3. Regenerate artwork and ship
python3 ops/scripts/generate-icons.py
cd web && pnpm build
```

nginx serves `web/dist` directly, so a build is the deploy. No service restart.

## Components in play today

`AppLayout` (tab bar) · `PlaceSheet` (bottom sheet over the map) · `PlaceAmenities`
· `PlaceReviews` · `PhotoUpload` · `SessionRetry` · `MapPage` (clustered Mapbox) ·
`ListsPage` · `ProfilePage` (+ language switcher) · `AuthPage` (magic link) · shared
`.btn`, `.card`, `.field`, `.skeleton`, `.state`, `.link-btn`.

## Built and validated (don't redesign without a reason)

- **The amenities section** — "Ce que propose ce lieu", Airbnb-style, 19 tri-state
  tags in 3 groups ordered by place kind, with the "À confirmer" chip opening an
  anonymous yes/no vote. Validated by Jerome from
  `design/mockups/place-tags-mockup.html`, live since 14 Sep 2026.
  Note for fine-tuning later: some tags (e.g. `shaded`) may deserve lower display
  priority — Jerome's call, list order lives in `web/src/lib/tags.ts`.
- **Rating + reviews** (23 Oct 2026), built from
  `design/mockups/place-reviews-mockup.html`. Score header (average with the UI
  locale's decimal mark, star row, "12 avis · 9 infos confirmées"), written
  reviews newest first ("Voir les N avis" expands, "Charger plus d'avis" pages
  older ones), star + comment form, first-reviewer empty state. **The form is
  gated on the account:**
  - **Signed out:** a sign-in card replaces the form. "Connecte-toi pour donner
    ton avis" is a full-width `.btn--sky` link, and the magic link brings the
    parent back to this place. A hint says the yes/no amenity questions need no
    account.
  - **Signed in:** stars (a radio group, 44×44 per star) and a labelled, optional
    comment. If the parent already reviewed the place, the form opens prefilled
    in "edit" mode; posting replaces the old review.
  - The hint says the review appears anonymously, as "Un parent", and that
    posting again replaces the previous one. **Never promise "sign with your
    name"**: no handle can be set yet.
  - While `/me` can't be checked (API restarting, offline), the form and the
    photo prompt are both replaced by **one** "couldn't check, try again" line.
  - An unsent draft stays on the device for a day, so it survives the magic-link
    round trip. When a session runs out mid-post, the sign-in card says the
    draft was kept.
- **Photo upload** (23 Oct 2026), under the photos on the place sheet. One state
  at a time:
  - *disabled* (`/api/photos/config` says so): nothing rendered at all;
  - *signed out*: a full-width "Connecte-toi pour ajouter une photo" button;
  - *idle*: the dashed sky "📷 Ajouter une photo" button;
  - *picked*: a preview with Send (`.btn--mint`) and Cancel;
  - *preparing → uploading N% → finishing*: the preview dims, a mint→sky
    progress bar runs, and Cancel stays available;
  - *done*: "Photo envoyée ! Elle sera visible après modération." on the mint
    tint, with "Ajouter une autre photo" below;
  - *error*: a localized message with Retry, which keeps the picked photo, and
    the uploaded file when only the last step failed. A stall (45 s without
    progress) has its own message.

  Focus follows the flow (Send → progress → result) and a single polite live
  region announces start, result and errors, never each percent.

## Not designed yet — the identity-hungry pieces

- A **stroller score** at a glance (the one number a parent wants) — relates to
  the rating header above; not the same thing as the star average.
- "Add a place" flow (backend done: USER → PENDING → admin).
- Admin moderation screen. Photos are moderated from the shell for now
  (`pnpm photos:moderate`); the API routes for a screen exist.
- Signed reviews (handle or first name, opt-in): a product decision first, see
  `ROADMAP.md`.
- The marketing landing page (`marketing/index.html`, still undeployed) — needs
  the toy-box identity, OG/Twitter meta, favicon.

## Jerome's visual ideas (14 Sep 2026 — to explore, not yet committed)

- **Logo rework**: the generated icon is a placeholder. Direction: something with a
  small **stroller**. Jerome plans to iterate in an external image/logo generator;
  whatever comes back must land as SVG (+ the PNG/ICO set regenerated — see
  `ops/scripts/generate-icons.py`, which can be retired once a real logo exists).
- **Landing page motion**: a scene scrolling left→right — a parent pushing a
  stroller, pausing on a bench under a tree, moving on, pausing at a terrace
  table, passing between houses. Gives the page life and *is* the product's story
  (a walk with stops at stroller-friendly places). Feasible as pure SVG/CSS
  keyframe animation, no video: flat characters in the toy-box palette, one long
  horizontal SVG strip, `animation-play-state` pauses at each stop.
  Must respect `prefers-reduced-motion` (static frame instead).

## Accessibility floor

Non-negotiable, whatever the identity becomes:

- White text only on `-deep` variants. Coloured text on a light background uses
  `-deep` too, and must reach 4.5:1 (measured figures under "Palette").
- Focus rings are visible — `3px solid var(--sky)`, never `outline: none`. That
  includes text fields: a border colour change alone is not a focus indicator.
- `prefers-reduced-motion` disables the sheet slide, the skeleton shimmer, the
  star scale and the progress-bar transition.
- Inputs stay at `16px`, below which iOS Safari zooms on focus.
- Tap targets ≥ 44px. One-handed, stroller in the other. In practice:
  - `.btn`, `.link-btn`, `.photo-add` and `.photo-cancel` carry `min-height: 44px`;
  - each star in the picker is a 44×44 box, with the scale on the glyph, not the
    hit box;
  - a link styled as a button needs a box display (`a.btn` is `inline-flex`),
    otherwise its padding adds no tap height;
  - a sign-in prompt is a full-width button, never a line of small text.
