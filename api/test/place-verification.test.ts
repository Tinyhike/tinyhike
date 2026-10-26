import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  addPlaceFromOsm,
  ADDABLE_CATEGORIES,
  listPlacesForVerification,
  verifyPlace,
  unverifyPlace,
  parseYesNo,
  PlaceVerificationError,
  VERIFICATION_POINTS,
} from '../src/services/place-verification.js'
import { TAG_KEYS } from '../src/lib/tags.js'
import type { OverpassElement } from '../src/lib/osm.js'
import { makePrismaMock, asPrisma, type PrismaMock } from './helpers.js'

const ADMIN = 'cadmin0000000000000000001'
const ANSWERS = { stepFree: false, strollerRoom: true, changingTable: true, toilets: false }

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    osmId: 'osm:node/1',
    lat: 51.9,
    lng: 4.4,
    status: 'APPROVED',
    category: 'CAFE',
    access: 'OPEN',
    verifiedAt: null,
    wheelchairOk: null,
    isStrollerWide: null,
    hasChangingTable: null,
    hasToilets: null,
    translations: [],
    ...over,
  }
}

const missing = () =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found', { code: 'P2025', clientVersion: 'test' })

describe('place verification', () => {
  let db: PrismaMock

  beforeEach(() => {
    db = makePrismaMock()
    db.user.findUnique.mockResolvedValue({ role: 'ADMIN' })
  })

  it('maps the four points to existing amenity tags', () => {
    expect(VERIFICATION_POINTS).toEqual({
      stepFree: 'wheelchairOk',
      strollerRoom: 'isStrollerWide',
      changingTable: 'hasChangingTable',
      toilets: 'hasToilets',
    })
    for (const tag of Object.values(VERIFICATION_POINTS)) expect(TAG_KEYS).toContain(tag)
  })

  describe('verifyPlace', () => {
    it('writes the four answers, the date and the admin, and nothing else (status untouched)', async () => {
      db.place.update.mockResolvedValueOnce(row({ verifiedAt: new Date() }))
      const before = Date.now()
      await verifyPlace(asPrisma(db), 'p1', ANSWERS, ADMIN)

      const arg = db.place.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
      expect(arg.where).toEqual({ id: 'p1' })
      expect(arg.data).toEqual({
        wheelchairOk: false,
        isStrollerWide: true,
        hasChangingTable: true,
        hasToilets: false,
        verifiedAt: expect.any(Date),
        verifiedById: ADMIN,
      })
      expect((arg.data.verifiedAt as Date).getTime()).toBeGreaterThanOrEqual(before)
    })

    it('verifies a café whose four answers are all no: a café to avoid is still shown', async () => {
      const allNo = { stepFree: false, strollerRoom: false, changingTable: false, toilets: false }
      db.place.update.mockResolvedValueOnce(
        row({ verifiedAt: new Date(), wheelchairOk: false, isStrollerWide: false, hasChangingTable: false, hasToilets: false }),
      )
      const result = await verifyPlace(asPrisma(db), 'p1', allNo, ADMIN)

      const arg = db.place.update.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data).toEqual({
        wheelchairOk: false,
        isStrollerWide: false,
        hasChangingTable: false,
        hasToilets: false,
        verifiedAt: expect.any(Date),
        verifiedById: ADMIN,
      })
      expect(result.visible).toBe(true)
      expect(result.points).toEqual(allNo)
    })

    it.each([[null], [{ role: 'MEMBER' }], [{ role: 'STEWARD' }]])(
      'refuses a verifier who is not an admin in the database (%j)',
      async (user) => {
        db.user.findUnique.mockResolvedValue(user)
        const err = await verifyPlace(asPrisma(db), 'p1', ANSWERS, ADMIN).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(PlaceVerificationError)
        expect(err).toMatchObject({ code: 'NotAdmin', statusCode: 403 })
        expect(db.place.update).not.toHaveBeenCalled()
      },
    )

    it('turns an unknown place into NotFound', async () => {
      db.place.update.mockRejectedValueOnce(missing())
      await expect(verifyPlace(asPrisma(db), 'nope', ANSWERS, ADMIN)).rejects.toMatchObject({
        code: 'NotFound',
        statusCode: 404,
      })
    })

    it('lets other database errors through', async () => {
      db.place.update.mockRejectedValueOnce(new Error('connection lost'))
      await expect(verifyPlace(asPrisma(db), 'p1', ANSWERS, ADMIN)).rejects.toThrow('connection lost')
    })

    it('never selects the verifier id back', async () => {
      db.place.update.mockResolvedValueOnce(row())
      await verifyPlace(asPrisma(db), 'p1', ANSWERS, ADMIN)
      const arg = db.place.update.mock.calls[0][0] as { select: Record<string, unknown> }
      expect(arg.select).not.toHaveProperty('verifiedById')
    })
  })

  describe('unverifyPlace', () => {
    it('clears only the date and the admin', async () => {
      db.place.update.mockResolvedValueOnce(row({ hasToilets: true }))
      const result = await unverifyPlace(asPrisma(db), 'p1', ADMIN)
      const arg = db.place.update.mock.calls[0][0] as { data: Record<string, unknown> }
      expect(arg.data).toEqual({ verifiedAt: null, verifiedById: null })
      expect(result).toMatchObject({ visible: false, points: { toilets: true } })
    })

    it('turns an unknown place into NotFound', async () => {
      db.place.update.mockRejectedValueOnce(missing())
      await expect(unverifyPlace(asPrisma(db), 'nope', ADMIN)).rejects.toMatchObject({ code: 'NotFound' })
    })

    it('refuses an account that is no longer an admin in the database', async () => {
      db.user.findUnique.mockResolvedValue({ role: 'MEMBER' })
      await expect(unverifyPlace(asPrisma(db), 'p1', ADMIN)).rejects.toMatchObject({ code: 'NotAdmin', statusCode: 403 })
      expect(db.place.update).not.toHaveBeenCalled()
    })
  })

  describe('parseYesNo (the CLI answers)', () => {
    it.each(['yes', 'Y', 'oui', 'o', 'ja', 'J', 'true', ' yes '])('%j is yes', (v) => {
      expect(parseYesNo(v)).toBe(true)
    })
    it.each(['no', 'N', 'non', 'NEE', 'false'])('%j is no', (v) => {
      expect(parseYesNo(v)).toBe(false)
    })
    it.each(['', 'maybe', 'si', '1', '0', 'yesno'])('%j is neither', (v) => {
      expect(parseYesNo(v)).toBeNull()
    })
  })

  describe('listPlacesForVerification', () => {
    it('names a place in nl, then fr, then en, then whatever there is', async () => {
      db.place.findMany.mockResolvedValueOnce([
        row({ id: 'a', translations: [{ locale: 'en', name: 'Coffee' }, { locale: 'fr', name: 'Café' }] }),
        row({ id: 'b', translations: [{ locale: 'de', name: 'Kaffee' }] }),
        row({ id: 'c', translations: [] }),
      ])
      const { places } = await listPlacesForVerification(asPrisma(db), { take: 10 })
      expect(places.map((p) => p.name)).toEqual(['Café', 'Kaffee', null])
    })

    it('counts every match with the same filter', async () => {
      db.place.count.mockResolvedValueOnce(274)
      const { total } = await listPlacesForVerification(asPrisma(db), { category: 'CAFE', verified: false, take: 10 })
      expect(total).toBe(274)
      const listWhere = (db.place.findMany.mock.calls[0][0] as { where: unknown }).where
      expect(db.place.count).toHaveBeenCalledWith({ where: listWhere })
    })

    it('filters on OSM access, to find the private playgrounds', async () => {
      db.place.findMany.mockResolvedValueOnce([row({ category: 'PLAYGROUND', access: 'PRIVATE' })])
      const { places } = await listPlacesForVerification(asPrisma(db), { category: 'PLAYGROUND', access: 'PRIVATE', take: 10 })
      expect((db.place.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({ category: 'PLAYGROUND', access: 'PRIVATE' })
      expect(places[0]).toMatchObject({ access: 'PRIVATE', visible: false })
    })

    it('with no filter, lists everything', async () => {
      await listPlacesForVerification(asPrisma(db), { take: 10 })
      expect((db.place.findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({})
    })
  })

  describe('addPlaceFromOsm', () => {
    const JARMUSCH = { type: 'node' as const, id: 11007237505 }
    const jarmusch: OverpassElement = {
      type: 'node',
      id: 11007237505,
      lat: 51.9101778,
      lon: 4.4500768,
      tags: {
        amenity: 'restaurant',
        cuisine: 'breakfast',
        name: 'By Jarmusch West',
        'addr:street': 'Nieuwe Binnenweg',
        'addr:housenumber': '575',
      },
    }
    const osm = (el: OverpassElement | null) => vi.fn().mockResolvedValue(el)
    const createArg = () => db.place.create.mock.calls[0][0] as { data: Record<string, unknown>; select: Record<string, unknown> }

    beforeEach(() => {
      db.place.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
        row({ id: 'new', ...data, translations: [{ locale: 'nl', name: 'By Jarmusch West' }] }),
      )
    })

    it('only cafés can be added today: every other category is public at once', () => {
      expect(ADDABLE_CATEGORIES).toEqual(['CAFE'])
    })

    it('adds a brunch place OSM files as a restaurant, as a hidden café', async () => {
      const fetchElement = osm(jarmusch)
      const result = await addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement })

      expect(fetchElement).toHaveBeenCalledWith(JARMUSCH)
      expect(createArg().data).toEqual({
        lat: 51.9101778,
        lng: 4.4500768,
        osmId: 'osm:node/11007237505',
        source: 'OSM',
        status: 'APPROVED',
        category: 'CAFE',
        access: 'OPEN',
        hasCafe: true,
        translations: { create: [{ locale: 'nl', name: 'By Jarmusch West' }] },
      })
      expect(createArg().select).not.toHaveProperty('verifiedById')
      expect(result.created).toBe(true)
      expect(result.place).toMatchObject({ id: 'new', name: 'By Jarmusch West', category: 'CAFE', verifiedAt: null, visible: false })
    })

    it('carries over the stroller tags OSM states, and nothing it does not', async () => {
      const tagged = { ...jarmusch, tags: { ...jarmusch.tags, wheelchair: 'yes', changing_table: 'yes', outdoor_seating: 'no' } }
      await addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement: osm(tagged) })
      expect(createArg().data).toMatchObject({ wheelchairOk: true, hasChangingTable: true, hasOutdoorSeating: false })
      expect(createArg().data).not.toHaveProperty('hasToilets')
      expect(createArg().data).not.toHaveProperty('isStrollerWide')
    })

    it('records OSM’s access tag', async () => {
      const customersOnly = { ...jarmusch, tags: { ...jarmusch.tags, access: 'customers' } }
      await addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement: osm(customersOnly) })
      expect(createArg().data).toMatchObject({ access: 'CUSTOMERS' })
    })

    it('takes an amenity=cafe element’s own category when none is given', async () => {
      const cafe = { ...jarmusch, tags: { amenity: 'cafe', name: 'Hopper' } }
      await addPlaceFromOsm(asPrisma(db), JARMUSCH, { fetchElement: osm(cafe) })
      expect(createArg().data).toMatchObject({ category: 'CAFE', hasCafe: true })
    })

    it('names an unnamed café generically in the three languages', async () => {
      const unnamed = { ...jarmusch, tags: { amenity: 'restaurant' } }
      await addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement: osm(unnamed) })
      expect(createArg().data.translations).toEqual({
        create: [
          { locale: 'nl', name: 'Café' },
          { locale: 'fr', name: 'Café' },
          { locale: 'en', name: 'Café' },
        ],
      })
    })

    it('places a way at its centre', async () => {
      const way: OverpassElement = { type: 'way', id: 275591110, center: { lat: 51.9, lon: 4.47 }, tags: { amenity: 'restaurant' } }
      await addPlaceFromOsm(asPrisma(db), { type: 'way', id: 275591110 }, { category: 'CAFE', fetchElement: osm(way) })
      expect(createArg().data).toMatchObject({ lat: 51.9, lng: 4.47, osmId: 'osm:way/275591110' })
    })

    it('never duplicates: a known osmId is returned as it is, before asking OSM', async () => {
      db.place.findUnique.mockResolvedValueOnce(row({ id: 'p-known', osmId: 'osm:node/11007237505', verifiedAt: null }))
      const fetchElement = osm(jarmusch)
      const result = await addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement })

      expect(db.place.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { osmId: 'osm:node/11007237505' } }))
      expect(fetchElement).not.toHaveBeenCalled()
      expect(db.place.create).not.toHaveBeenCalled()
      expect(db.place.update).not.toHaveBeenCalled()
      expect(result).toMatchObject({ created: false, place: { id: 'p-known' } })
    })

    it('recognises a row seeded under the legacy untyped id at the same spot', async () => {
      db.place.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ id: 'p-legacy', osmId: 'osm:11007237505', lat: 51.9101778, lng: 4.4500768 }))
      const result = await addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement: osm(jarmusch) })

      expect(db.place.findUnique.mock.calls[1][0]).toMatchObject({ where: { osmId: 'osm:11007237505' } })
      expect(db.place.create).not.toHaveBeenCalled()
      expect(result).toMatchObject({ created: false, place: { id: 'p-legacy' } })
    })

    it('adds the element when the legacy id belongs to another feature elsewhere', async () => {
      db.place.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ id: 'p-other', osmId: 'osm:11007237505', lat: 51.88, lng: 4.51 }))
      const result = await addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement: osm(jarmusch) })
      expect(result.created).toBe(true)
    })

    it('returns the row another run inserted between the lookup and the insert', async () => {
      db.place.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      )
      db.place.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row({ id: 'p-raced', osmId: 'osm:node/11007237505' }))
      const result = await addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement: osm(jarmusch) })
      expect(result).toMatchObject({ created: false, place: { id: 'p-raced' } })
    })

    it('a brunch restaurant needs no --category: OSM’s cuisine makes it a café', async () => {
      await addPlaceFromOsm(asPrisma(db), JARMUSCH, { fetchElement: osm(jarmusch) })
      expect(createArg().data).toMatchObject({ category: 'CAFE', hasCafe: true })
    })

    it('asks for a category when OSM files the element under none of ours', async () => {
      const italian = { ...jarmusch, tags: { ...jarmusch.tags, cuisine: 'italian' } }
      const err = await addPlaceFromOsm(asPrisma(db), JARMUSCH, { fetchElement: osm(italian) }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(PlaceVerificationError)
      expect(err).toMatchObject({ code: 'NoCategory', statusCode: 400 })
      expect((err as Error).message).toContain('amenity=restaurant')
      expect(db.place.create).not.toHaveBeenCalled()
    })

    it.each(['PLAYGROUND', 'PARK', 'PICNIC_SITE'] as const)('refuses to add a %s, which the public would see at once', async (category) => {
      const fetchElement = osm(jarmusch)
      await expect(addPlaceFromOsm(asPrisma(db), JARMUSCH, { category, fetchElement })).rejects.toMatchObject({
        code: 'PublicCategory',
      })
      expect(fetchElement).not.toHaveBeenCalled()
      expect(db.place.create).not.toHaveBeenCalled()
    })

    it('refuses a playground element given no category: the seeder imports those, visible', async () => {
      const playground = { ...jarmusch, tags: { leisure: 'playground' } }
      await expect(addPlaceFromOsm(asPrisma(db), JARMUSCH, { fetchElement: osm(playground) })).rejects.toMatchObject({
        code: 'PublicCategory',
      })
      expect(db.place.create).not.toHaveBeenCalled()
    })

    it('reports an element OSM does not have', async () => {
      await expect(addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement: osm(null) })).rejects.toMatchObject({
        code: 'NotInOsm',
        statusCode: 404,
      })
      expect(db.place.create).not.toHaveBeenCalled()
    })

    it('refuses an element with no position', async () => {
      const way: OverpassElement = { type: 'way', id: 1, tags: { amenity: 'cafe' } }
      await expect(
        addPlaceFromOsm(asPrisma(db), { type: 'way', id: 1 }, { category: 'CAFE', fetchElement: osm(way) }),
      ).rejects.toMatchObject({ code: 'NoPosition' })
      expect(db.place.create).not.toHaveBeenCalled()
    })

    it('refuses an element outside the area, such as a mistyped id landing on a café abroad', async () => {
      const paris = { ...jarmusch, lat: 48.8566, lon: 2.3522 }
      await expect(
        addPlaceFromOsm(asPrisma(db), JARMUSCH, { category: 'CAFE', fetchElement: osm(paris) }),
      ).rejects.toMatchObject({ code: 'OutsideArea' })
      expect(db.place.create).not.toHaveBeenCalled()
    })

    it('honours another area when one is given', async () => {
      const paris = { ...jarmusch, lat: 48.8566, lon: 2.3522 }
      const result = await addPlaceFromOsm(asPrisma(db), JARMUSCH, {
        category: 'CAFE',
        area: '48.8,2.3,48.9,2.4',
        fetchElement: osm(paris),
      })
      expect(result.created).toBe(true)
    })
  })
})
