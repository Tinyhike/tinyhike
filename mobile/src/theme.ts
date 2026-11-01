// The app's visual tokens: colours, spacing, shape and type. Provisional until
// the design pass, which plugs in here: components read these names, never raw
// values. The palette is the web's (web/src/styles/tokens.css, DESIGN.md), kept
// identical by test/web-sync.test.mjs.
//
// Every hue has a deep variant. The bright value is for fills, borders and
// accents; the deep one carries white text or sits as text on a light
// background, where the bright value would not reach 4.5:1 (DESIGN.md).

/** The web's tokens, one for one: `--berry-deep` is `berryDeep`. */
export const palette = {
  berry: '#ef476f',
  berryDeep: '#d81e5b',
  sun: '#ffd166',
  sunDeep: '#a35f00',
  mint: '#06d6a0',
  mintDeep: '#037a5c',
  sky: '#21a9d8',
  skyDeep: '#0b6e8f',
  grape: '#9b5de5',
  grapeDeep: '#7b2cbf',

  ink: '#073b4c',
  inkSoft: '#4a6b78',
  surface: '#ffffff',
  surfaceTint: '#fff8ee',
  border: '#e4ebee',

  dangerBg: '#ffe3ea',
  dangerFg: '#b0123f',
} as const

/** What each colour is for. Components use these. */
export const colors = {
  ...palette,
  /** The tint behind a confirmed amenity chip (web: .rev-chip--yes). */
  mintTint: '#dff8ef',
  /** The tint behind an "À confirmer" chip (web: .amen-chip). */
  skyTint: '#e7f5fb',
  /** A pressed button's overlay. */
  pressed: 'rgba(7, 59, 76, 0.08)',

  /** The map's own places: a pin, and a group of pins. */
  pin: palette.berry,
  cluster: palette.grape,
  /** Stars and the "Note des parents" kicker. */
  rating: palette.sunDeep,
} as const

/** Spacing steps, in dp. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const

/** Corner radii, in dp (web: --radius, --radius-lg). */
export const radius = {
  sm: 10,
  md: 18,
  lg: 26,
  pill: 999,
} as const

/** The smallest tap target, in dp: one-handed, the stroller in the other (DESIGN.md). */
export const touchTarget = 44

/**
 * The type scale, after the web's sheet. The web asks for a rounded system face
 * (`ui-rounded`), which Android doesn't have: `family` stays the system font
 * until the design pass picks one (DESIGN.md, "Swapping in a real rounded webfont").
 */
export const type = {
  family: undefined as string | undefined,
  title: { fontSize: 23, fontWeight: '800', lineHeight: 28 },
  heading: { fontSize: 17, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 22 },
  bodySmall: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 13.5, fontWeight: '600' },
  caption: { fontSize: 12.5, fontWeight: '600' },
  kicker: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase' },
} as const

/** Raised surfaces: the sheet and the floating buttons. */
export const elevation = {
  sheet: {
    elevation: 12,
    shadowColor: palette.ink,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -3 },
  },
  button: {
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
} as const
