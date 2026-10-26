import { describe, it, expect, vi, afterEach } from 'vitest'
import { elementFromOsmApi, fetchOsmElement, osmApiUrl, parseOsmRef } from '../src/lib/osm-api.js'

describe('parseOsmRef', () => {
  it.each([
    ['node/11007237505', { type: 'node', id: 11007237505 }],
    [' way/275591110 ', { type: 'way', id: 275591110 }],
    ['relation/42', { type: 'relation', id: 42 }],
    ['osm:node/11007237505', { type: 'node', id: 11007237505 }],
    ['https://www.openstreetmap.org/node/11007237505', { type: 'node', id: 11007237505 }],
    ['https://www.openstreetmap.org/node/11007237505#map=19/51.91018/4.45008', { type: 'node', id: 11007237505 }],
    ['https://openstreetmap.org/way/275591110/history', { type: 'way', id: 275591110 }],
  ])('reads %j', (input, ref) => {
    expect(parseOsmRef(input)).toEqual(ref)
  })

  it.each([
    '',
    '11007237505',
    'node/',
    'node/0',
    'node/12a',
    'nodes/1',
    'osm:11007237505',
    'https://example.com/node/1',
    'node/1 way/2',
    'node/1234567890123456',
  ])('refuses %j', (input) => {
    expect(parseOsmRef(input)).toBeNull()
  })
})

describe('osmApiUrl', () => {
  it('asks for a node alone, and for a way or relation with its nodes', () => {
    expect(osmApiUrl({ type: 'node', id: 1 })).toBe('https://api.openstreetmap.org/api/0.6/node/1.json')
    expect(osmApiUrl({ type: 'way', id: 2 })).toBe('https://api.openstreetmap.org/api/0.6/way/2/full.json')
    expect(osmApiUrl({ type: 'relation', id: 3 })).toBe('https://api.openstreetmap.org/api/0.6/relation/3/full.json')
  })
})

const JARMUSCH = {
  type: 'node',
  id: 11007237505,
  lat: 51.9101778,
  lon: 4.4500768,
  tags: { amenity: 'restaurant', cuisine: 'breakfast', name: 'By Jarmusch West' },
}

describe('elementFromOsmApi', () => {
  it('keeps a node’s own position and tags', () => {
    expect(elementFromOsmApi({ type: 'node', id: 11007237505 }, [JARMUSCH])).toEqual(JARMUSCH)
  })

  it('places a way at the centre of its nodes’ bounding box, like Overpass `out center`', () => {
    const elements = [
      { type: 'node', id: 1, lat: 51.9, lon: 4.4 },
      { type: 'node', id: 2, lat: 51.902, lon: 4.401 },
      { type: 'node', id: 3, lat: 51.901, lon: 4.404 },
      { type: 'way', id: 7, tags: { amenity: 'restaurant', name: 'Het Theehuis' } },
    ]
    const el = elementFromOsmApi({ type: 'way', id: 7 }, elements)
    expect(el).toMatchObject({ type: 'way', id: 7, tags: { name: 'Het Theehuis' } })
    expect(el?.center?.lat).toBeCloseTo(51.901, 9)
    expect(el?.center?.lon).toBeCloseTo(4.402, 9)
    expect(el?.lat).toBeUndefined()
  })

  it('does the same for a relation', () => {
    const elements = [
      { type: 'node', id: 1, lat: 51.9, lon: 4.4 },
      { type: 'node', id: 2, lat: 51.91, lon: 4.42 },
      { type: 'way', id: 5 },
      { type: 'relation', id: 9, tags: { amenity: 'cafe' } },
    ]
    expect(elementFromOsmApi({ type: 'relation', id: 9 }, elements)?.center).toEqual({ lat: 51.905, lon: 4.41 })
  })

  it('a way whose nodes did not come back has no position, not a made-up one', () => {
    const el = elementFromOsmApi({ type: 'way', id: 7 }, [{ type: 'way', id: 7, tags: {} }])
    expect(el).toEqual({ type: 'way', id: 7, tags: {} })
  })

  it('does not mistake another type with the same number for the element', () => {
    expect(elementFromOsmApi({ type: 'way', id: 11007237505 }, [JARMUSCH])).toBeNull()
    expect(elementFromOsmApi({ type: 'node', id: 1 }, [])).toBeNull()
  })
})

describe('fetchOsmElement', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('fetches the element from the OSM API with a User-Agent', async () => {
    const fetchMock = stubFetch(200, { elements: [JARMUSCH] })
    expect(await fetchOsmElement({ type: 'node', id: 11007237505 })).toEqual(JARMUSCH)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openstreetmap.org/api/0.6/node/11007237505.json')
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^TinyHike\//)
  })

  it.each([404, 410])('answers null when OSM says %d (no such element, or deleted)', async (status) => {
    stubFetch(status, 'gone')
    expect(await fetchOsmElement({ type: 'node', id: 1 })).toBeNull()
  })

  it('throws on any other failure rather than call the element missing', async () => {
    stubFetch(503, 'Service Unavailable')
    await expect(fetchOsmElement({ type: 'node', id: 1 })).rejects.toThrow('OSM API HTTP 503')
  })
})
