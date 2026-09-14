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
| Map, clusters, pins | `web/src/pages/MapPage.tsx` |
| Icon artwork (generated) | `ops/scripts/generate-icons.py` |
| PWA manifest | `web/public/manifest.json` |

## Palette

Every hue has a `-deep` variant. Bright values are for fills, borders and accents;
`-deep` is for anything carrying **white text**, where the bright value doesn't
reach 4.5:1 contrast.

| Token | Hex | Used for |
|---|---|---|
| `--berry` / `--berry-deep` | `#ef476f` / `#d81e5b` | Primary action, map pins, Map tab, close button |
| `--sun` / `--sun-deep` | `#ffd166` / `#e08c00` | Loading pill, tip callouts, icon background, PWA splash |
| `--mint` / `--mint-deep` | `#06d6a0` / `#04936f` | Positive / confirmed |
| `--sky` / `--sky-deep` | `#21a9d8` / `#0b6e8f` | Links, focus rings, Profile tab, language switcher |
| `--grape` / `--grape-deep` | `#9b5de5` / `#7b2cbf` | Map clusters, Lists tab |
| `--ink` | `#073b4c` | Body text — deep teal-navy, not black |
| `--ink-soft` | `#4a6b78` | Secondary text |
| `--surface-tint` | `#fff8ee` | Callout backgrounds — a warm tint of `--sun` |

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

`AppLayout` (tab bar) · `PlaceSheet` (bottom sheet over the map) · `MapPage`
(clustered Mapbox) · `ListsPage` · `ProfilePage` (+ language switcher) · `AuthPage`
(magic link) · shared `.btn`, `.card`, `.field`, `.skeleton`, `.state`.

## Not designed yet

The place sheet currently shows name, description, tips and photos. Still to come,
and the most identity-hungry pieces:

- **The 11 stroller tags** (`napFriendly`, `shaded`, `smooth`, `hasToilets`,
  `hasPlayground`, `wheelchairOk`…) — icons + treatment. This is the product's
  reason to exist and it isn't on screen at all yet.
- A **stroller score** and how it reads at a glance.
- Reviews (the API returns 20, none are rendered).
- Photo upload UI.
- The marketing landing page (`marketing/index.html`, still undeployed).

## Accessibility floor

Non-negotiable, whatever the identity becomes:

- White text only on `-deep` variants.
- Focus rings are visible — `3px solid var(--sky)`, never `outline: none`.
- `prefers-reduced-motion` disables the sheet slide and the skeleton shimmer.
- Inputs stay at `16px`, below which iOS Safari zooms on focus.
- Tap targets ≥ 44px. One-handed, stroller in the other.
