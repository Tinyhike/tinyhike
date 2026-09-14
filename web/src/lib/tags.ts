/**
 * The 19 stroller tags: registry, grouping, and per-place-kind ordering.
 *
 * Labels live in i18n.tsx (`tag.<key>`), so a missing translation is a build
 * error. Icons are emoji for now — deliberate for the toy-box identity and zero
 * dependencies; swappable for line icons later without touching this structure.
 */

export type TagGroup = 'baby' | 'stroller' | 'onsite'

export interface TagDef {
  key: TagKey
  group: TagGroup
  emoji: string
}

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

export const TAGS: TagDef[] = [
  // 👶 Pour bébé
  { key: 'hasChangingTable', group: 'baby', emoji: '🚼' },
  { key: 'hasHighchair', group: 'baby', emoji: '🪑' },
  { key: 'isBreastfeedingFriendly', group: 'baby', emoji: '🤱' },
  { key: 'napFriendly', group: 'baby', emoji: '😴' },
  // 🍼 Accès poussette
  { key: 'wheelchairOk', group: 'stroller', emoji: '♿' },
  { key: 'smooth', group: 'stroller', emoji: '🛞' },
  { key: 'isStrollerWide', group: 'stroller', emoji: '↔️' },
  { key: 'hasElevator', group: 'stroller', emoji: '🛗' },
  // 📍 Sur place
  { key: 'hasPlayground', group: 'onsite', emoji: '🛝' },
  { key: 'hasPlayCorner', group: 'onsite', emoji: '🧸' },
  { key: 'hasOutdoorSeating', group: 'onsite', emoji: '🌤️' },
  { key: 'hasToilets', group: 'onsite', emoji: '🚻' },
  { key: 'hasCafe', group: 'onsite', emoji: '☕' },
  { key: 'hasParking', group: 'onsite', emoji: '🅿️' },
  { key: 'shaded', group: 'onsite', emoji: '🌳' },
  { key: 'enclosed', group: 'onsite', emoji: '🚧' },
  { key: 'isQuiet', group: 'onsite', emoji: '🤫' },
  { key: 'freeEntry', group: 'onsite', emoji: '🆓' },
  { key: 'dogFriendly', group: 'onsite', emoji: '🐕' },
]

/** A Place's tag fields as the API returns them. */
export type PlaceTags = Partial<Record<TagKey, boolean | null>>

/**
 * Group order by place kind: a cafe leads with the baby amenities, an outdoor
 * place with what's on site. Kind is inferred from the tags themselves — the
 * schema has no explicit type column, and hasCafe/hasPlayground are reliably set
 * by the seeder for exactly these two kinds.
 */
export function groupOrder(place: PlaceTags): TagGroup[] {
  if (place.hasCafe) return ['baby', 'stroller', 'onsite']
  return ['onsite', 'stroller', 'baby']
}

/**
 * The rows worth showing while the section is collapsed: everything known
 * (true/false), plus up to `maxUnknown` unknowns so the "À confirmer" invitation
 * is always visible without drowning the card in 15 question marks.
 */
export function collapsedTags(place: PlaceTags, maxUnknown = 4): TagDef[] {
  const order = groupOrder(place)
  const sorted = [...TAGS].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
  const known = sorted.filter((t) => place[t.key] === true || place[t.key] === false)
  const unknown = sorted.filter((t) => place[t.key] === null || place[t.key] === undefined)
  return [...known, ...unknown.slice(0, maxUnknown)].sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group),
  )
}

/** All 19, in the kind-appropriate group order (the expanded view). */
export function allTags(place: PlaceTags): TagDef[] {
  const order = groupOrder(place)
  return [...TAGS].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
}

export function unknownCount(place: PlaceTags): number {
  return TAGS.filter((t) => place[t.key] === null || place[t.key] === undefined).length
}
