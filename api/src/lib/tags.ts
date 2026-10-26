/**
 * The 19 stroller tag keys — the column names of Place's tri-state booleans.
 *
 * The API validates tag votes against this list, so arbitrary strings never get
 * stored and rendered as "✓ confirmed" chips. It MUST stay identical to TAG_KEYS
 * in web/src/lib/tags.ts (api and web share no package); test/tags.test.ts fails
 * the build when the two drift apart.
 */
export const TAG_KEYS = [
  'hasChangingTable',
  'hasHighchair',
  'isBreastfeedingFriendly',
  'napFriendly',
  'wheelchairOk',
  'smooth',
  'isStrollerWide',
  'hasElevator',
  'hasPlayground',
  'hasPlayCorner',
  'hasOutdoorSeating',
  'hasToilets',
  'hasCafe',
  'hasParking',
  'shaded',
  'enclosed',
  'isQuiet',
  'freeEntry',
  'dogFriendly',
] as const

export type TagKey = (typeof TAG_KEYS)[number]
