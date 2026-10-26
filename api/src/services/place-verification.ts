/**
 * Place verification: an admin's visit, recorded (Jérôme, 26 Oct 2026).
 *
 * Verifying a place records four points seen on site and stamps the date and the
 * admin who verified it. A verified place is public whatever its category
 * (lib/place-visibility.ts): it is the only way a café reaches the map. Answers
 * may be "no". A verified café with a step at the door and no changing table is
 * worth showing: parents learn which cafés to avoid.
 *
 * The four points are written to the existing tri-state tags, so the place sheet
 * shows them like any other amenity, with no web change. A visit is first-hand,
 * so it overwrites whatever OSM or a tag vote said before.
 *
 * Verification is not approval. `status` moderates a parent's proposal; approving
 * one does not verify it. The two are separate actions (Jérôme, 26 Oct).
 *
 * Shared by the CLI (jobs/verify-places.ts, `pnpm places:verify`) and the admin
 * routes (PUT/DELETE /api/admin/places/:id/verification), the same way
 * photo-moderation.ts is shared, so both write the same columns.
 *
 * It also adds, hidden, a place the seeder missed (addPlaceFromOsm, CLI only):
 * a brunch place OSM files as a restaurant can't be verified until it exists.
 */

import { Prisma, PlaceCategory, type PrismaClient } from '@prisma/client'
import type { TagKey } from '../lib/tags.js'
import { isPublicPlace, VISIBLE_CATEGORIES } from '../lib/place-visibility.js'
import {
  categoryOf,
  DEFAULT_BBOX,
  elementCoords,
  insideBbox,
  isSameFeature,
  kindForCategory,
  legacyOsmId,
  mapOsmTags,
  osmIdFor,
  translationsFor,
  type OverpassElement,
} from '../lib/osm.js'
import { fetchOsmElement, type OsmRef } from '../lib/osm-api.js'

export const VERIFICATION_POINTS = {
  // "Entrée praticable en poussette": the step-free tag ("Sans marche", "Step-free").
  stepFree: 'wheelchairOk',
  // "Place pour la poussette à l'intérieur" ("Passage large", "Wide for strollers").
  strollerRoom: 'isStrollerWide',
  // "Table à langer".
  changingTable: 'hasChangingTable',
  // "Toilettes".
  toilets: 'hasToilets',
} as const satisfies Record<string, TagKey>

export type VerificationPoint = keyof typeof VERIFICATION_POINTS
export type VerificationAnswers = Record<VerificationPoint, boolean>

export const VERIFICATION_POINT_KEYS = Object.keys(VERIFICATION_POINTS) as VerificationPoint[]

export type PlaceVerificationErrorCode =
  | 'NotFound'
  | 'NotAdmin'
  // Adding a place from OSM (addPlaceFromOsm):
  | 'NotInOsm'
  | 'NoPosition'
  | 'NoCategory'
  | 'PublicCategory'
  | 'OutsideArea'

const STATUS_FOR: Record<PlaceVerificationErrorCode, number> = {
  NotFound: 404,
  // The session says ADMIN but the account no longer is one (the JWT lives 30 days).
  NotAdmin: 403,
  NotInOsm: 404,
  NoPosition: 400,
  NoCategory: 400,
  PublicCategory: 400,
  OutsideArea: 400,
}

export class PlaceVerificationError extends Error {
  readonly statusCode: number
  constructor(
    readonly code: PlaceVerificationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PlaceVerificationError'
    this.statusCode = STATUS_FOR[code]
  }
}

const SUMMARY_SELECT = {
  id: true,
  osmId: true,
  lat: true,
  lng: true,
  status: true,
  category: true,
  verifiedAt: true,
  wheelchairOk: true,
  isStrollerWide: true,
  hasChangingTable: true,
  hasToilets: true,
  translations: { select: { locale: true, name: true } },
} satisfies Prisma.PlaceSelect

type SummaryRow = Prisma.PlaceGetPayload<{ select: typeof SUMMARY_SELECT }>

/** A place as the admin sees it while verifying. No verifier id: the CLI and the admin UI don't need it. */
export interface VerificationSummary {
  id: string
  name: string | null
  category: PlaceCategory | null
  status: SummaryRow['status']
  osmId: string | null
  lat: number
  lng: number
  verifiedAt: Date | null
  /** Whether the public sees it, i.e. whether it is on the map. */
  visible: boolean
  points: Record<VerificationPoint, boolean | null>
}

const NAME_LOCALES = ['nl', 'fr', 'en']

function toSummary(row: SummaryRow): VerificationSummary {
  const name =
    NAME_LOCALES.map((locale) => row.translations.find((t) => t.locale === locale)?.name).find(Boolean) ??
    row.translations[0]?.name ??
    null
  return {
    id: row.id,
    name,
    category: row.category,
    status: row.status,
    osmId: row.osmId,
    lat: row.lat,
    lng: row.lng,
    verifiedAt: row.verifiedAt,
    visible: isPublicPlace(row),
    points: {
      stepFree: row.wheelchairOk,
      strollerRoom: row.isStrollerWide,
      changingTable: row.hasChangingTable,
      toilets: row.hasToilets,
    },
  }
}

function isMissingRow(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

export interface ListOptions {
  /** A category, or 'NONE' for places with no category. */
  category?: PlaceCategory | 'NONE'
  verified?: boolean
  /** Case-insensitive match on any translated name. */
  name?: string
  take: number
}

/** Places to verify (or already verified), with how many match in total. */
export async function listPlacesForVerification(
  prisma: PrismaClient,
  { category, verified, name, take }: ListOptions,
): Promise<{ places: VerificationSummary[]; total: number }> {
  const where: Prisma.PlaceWhereInput = {
    ...(category === 'NONE' ? { category: null } : category ? { category } : {}),
    ...(verified === undefined ? {} : { verifiedAt: verified ? { not: null } : null }),
    ...(name ? { translations: { some: { name: { contains: name, mode: 'insensitive' } } } } : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.place.findMany({ where, select: SUMMARY_SELECT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take }),
    prisma.place.count({ where }),
  ])
  return { places: rows.map(toSummary), total }
}

/**
 * Whether this account is an admin, checked against the database rather than the
 * session: a JWT keeps its role for 30 days after an account is demoted, and the
 * CLI has no session at all. Every write that changes what the public sees
 * (verify, unverify, a category change) goes through it.
 */
export async function assertAdmin(prisma: PrismaClient, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role !== 'ADMIN') throw new PlaceVerificationError('NotAdmin', 'Only an admin can do this')
}

const YES = new Set(['yes', 'y', 'oui', 'o', 'ja', 'j', 'true'])
const NO = new Set(['no', 'n', 'non', 'nee', 'false'])

/** A yes/no answer typed on the CLI, in English, French or Dutch; null if it is neither. */
export function parseYesNo(value: string): boolean | null {
  const v = value.trim().toLowerCase()
  if (YES.has(v)) return true
  if (NO.has(v)) return false
  return null
}

/**
 * Record a visit: the four answers, now, by this admin. Verifying an already
 * verified place records the new visit (answers, date and admin replaced). It
 * never touches `status`: approving a proposal is a separate action.
 */
export async function verifyPlace(
  prisma: PrismaClient,
  placeId: string,
  answers: VerificationAnswers,
  verifierId: string,
): Promise<VerificationSummary> {
  await assertAdmin(prisma, verifierId)

  const tags = Object.fromEntries(
    VERIFICATION_POINT_KEYS.map((point) => [VERIFICATION_POINTS[point], answers[point]]),
  ) as Record<(typeof VERIFICATION_POINTS)[VerificationPoint], boolean>

  try {
    const row = await prisma.place.update({
      where: { id: placeId },
      data: { ...tags, verifiedAt: new Date(), verifiedById: verifierId },
      select: SUMMARY_SELECT,
    })
    return toSummary(row)
  } catch (err) {
    if (isMissingRow(err)) throw new PlaceVerificationError('NotFound', 'Place not found')
    throw err
  }
}

/**
 * Withdraw a verification: the place is hidden again unless its category is
 * public. The four answers stay on the place, since they were seen on site; a
 * new visit replaces them.
 */
export async function unverifyPlace(
  prisma: PrismaClient,
  placeId: string,
  adminId: string,
): Promise<VerificationSummary> {
  await assertAdmin(prisma, adminId)
  try {
    const row = await prisma.place.update({
      where: { id: placeId },
      data: { verifiedAt: null, verifiedById: null },
      select: SUMMARY_SELECT,
    })
    return toSummary(row)
  } catch (err) {
    if (isMissingRow(err)) throw new PlaceVerificationError('NotFound', 'Place not found')
    throw err
  }
}

/** The categories `add` may create: those the public does not see until a visit (today, CAFE). */
export const ADDABLE_CATEGORIES: PlaceCategory[] = Object.values(PlaceCategory).filter(
  (category) => !(VISIBLE_CATEGORIES as readonly PlaceCategory[]).includes(category),
)

export interface AddResult {
  /** false when the element was already in the database: nothing was written. */
  created: boolean
  place: VerificationSummary
}

/** What OSM files an element under, for an error message: `amenity=restaurant`. */
function osmKind(tags: Record<string, string> | undefined): string {
  const keys = ['amenity', 'leisure', 'tourism', 'shop'].filter((key) => tags?.[key])
  return keys.map((key) => `${key}=${tags![key]}`).join(', ') || 'no amenity, leisure, tourism or shop tag'
}

async function findByOsmId(prisma: PrismaClient, osmId: string): Promise<SummaryRow | null> {
  return prisma.place.findUnique({ where: { osmId }, select: SUMMARY_SELECT })
}

/**
 * Add one place from an OSM element, hidden until an admin verifies it (Jérôme,
 * 26 Oct 2026).
 *
 * The seeder only takes amenity=cafe, so a brunch place OSM files as
 * amenity=restaurant + cuisine=breakfast (By Jarmusch West, node 11007237505)
 * never reached the database and could not be verified. This brings one in by
 * hand: its name, its position and the stroller tags OSM states (mapOsmTags),
 * under the category the admin gives, or the element's own. Only hidden
 * categories: nothing reaches the map before a visit. A missing playground, park
 * or picnic site is the seeder's job.
 *
 * Never a duplicate: an element already in the database (typed or legacy id) is
 * returned untouched. The element must lie inside `area` (the Rotterdam bbox by
 * default), which also catches a mistyped id that lands on a café elsewhere.
 */
export async function addPlaceFromOsm(
  prisma: PrismaClient,
  ref: OsmRef,
  {
    category,
    area = DEFAULT_BBOX,
    fetchElement = fetchOsmElement,
  }: {
    category?: PlaceCategory
    area?: string
    fetchElement?: (ref: OsmRef) => Promise<OverpassElement | null>
  } = {},
): Promise<AddResult> {
  if (category && !ADDABLE_CATEGORIES.includes(category)) {
    throw new PlaceVerificationError('PublicCategory', `A ${category} is public at once; add only creates hidden places`)
  }

  const osmId = osmIdFor(ref)
  const known = await findByOsmId(prisma, osmId)
  if (known) return { created: false, place: toSummary(known) }

  const element = await fetchElement(ref)
  const label = `${ref.type}/${ref.id}`
  if (!element) throw new PlaceVerificationError('NotInOsm', `${label} is not in OpenStreetMap (or was deleted)`)
  const coords = elementCoords(element)
  if (!coords) throw new PlaceVerificationError('NoPosition', `${label} has no position in OpenStreetMap`)
  if (!insideBbox(coords, area)) {
    throw new PlaceVerificationError('OutsideArea', `${label} lies outside the area TinyHike covers (${area})`)
  }

  // Rows seeded before ids carried their type read `osm:<id>`; the position tells
  // whether it is this element or an unrelated one sharing the number.
  const legacy = await findByOsmId(prisma, legacyOsmId(element))
  if (legacy && isSameFeature(element, legacy)) return { created: false, place: toSummary(legacy) }

  const chosen = category ?? categoryOf(element.tags)
  if (!chosen) {
    throw new PlaceVerificationError(
      'NoCategory',
      `OSM files ${label} as ${osmKind(element.tags)}: add it with --category ${ADDABLE_CATEGORIES.join('|')}`,
    )
  }
  if (!ADDABLE_CATEGORIES.includes(chosen)) {
    throw new PlaceVerificationError('PublicCategory', `${label} is a ${chosen}, public at once: pnpm seed:osm imports those`)
  }

  try {
    const row = await prisma.place.create({
      data: {
        lat: coords.lat,
        lng: coords.lng,
        osmId,
        source: 'OSM',
        // As the seeder does: OSM is trusted. Approved is not public: the category
        // keeps it hidden until a visit (lib/place-visibility.ts).
        status: 'APPROVED',
        category: chosen,
        ...mapOsmTags(element.tags),
        // Whatever OSM files it under, the admin says it is a café, and every café
        // row carries hasCafe (pnpm backfill:osm-tags checks the two agree).
        ...(chosen === 'CAFE' ? { hasCafe: true } : {}),
        translations: { create: translationsFor(element.tags?.name, kindForCategory(chosen)) },
      },
      select: SUMMARY_SELECT,
    })
    return { created: true, place: toSummary(row) }
  } catch (err) {
    // Added by someone else between the lookup and the insert: osmId is unique.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await findByOsmId(prisma, osmId)
      if (raced) return { created: false, place: toSummary(raced) }
    }
    throw err
  }
}
