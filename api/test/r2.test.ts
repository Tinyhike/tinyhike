import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Readable } from 'node:stream'
import { S3Client, CopyObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

/**
 * The R2 facade, with no network: presigned URLs are computed locally from FAKE
 * credentials, and the I/O helpers run against a stubbed S3Client.send.
 *
 * The presign assertions guard two silent production failures:
 *  - a checksum in the URL (the SDK default signs the CRC32 of an EMPTY body, so
 *    R2 rejects every real upload);
 *  - an unsigned Content-Type/Content-Length (R2 would store text/html, or any size).
 */

const ENV = {
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'FAKEACCESSKEYID0000000',
  R2_SECRET_ACCESS_KEY: 'fake-secret-access-key-for-tests-only',
  R2_STAGING_BUCKET: 'tinyhike-photos-staging',
  R2_BUCKET: 'tinyhike-photos',
  R2_PUBLIC_URL: 'https://photos.example.test',
  // Empty counts as unset: the endpoint is derived from the account id.
  R2_S3_ENDPOINT: '',
}

const saved: Record<string, string | undefined> = {}
let r2: typeof import('../src/lib/r2.js')

function applyEnv() {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
}

beforeAll(async () => {
  for (const k of Object.keys(ENV)) saved[k] = process.env[k]
  applyEnv()
  // Imported only once the fake credentials are in place.
  r2 = await import('../src/lib/r2.js')
})

afterEach(() => {
  vi.restoreAllMocks()
  applyEnv()
})

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** An SDK-shaped service error, as S3Client.send rejects with. */
function s3Error(name: string, httpStatusCode: number) {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } })
}

function stubSend(impl: (command: unknown) => Promise<unknown>) {
  return vi.spyOn(S3Client.prototype, 'send').mockImplementation(impl as never)
}

describe('presignPut', () => {
  it('signs content-type, content-length and host, and carries no checksum', async () => {
    const url = new URL(
      await r2.presignPut({
        bucket: 'tinyhike-photos-staging',
        key: 'uploads/cuser1/3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b.jpg',
        contentType: 'image/jpeg',
        size: 123456,
        expiresIn: 120,
      }),
    )

    const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';')
    expect(signed).toEqual(expect.arrayContaining(['content-length', 'content-type', 'host']))
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)

    const params = [...url.searchParams.keys()].map((k) => k.toLowerCase())
    expect(params.filter((k) => k.startsWith('x-amz-checksum-'))).toEqual([])
    expect(params).not.toContain('x-amz-sdk-checksum-algorithm')

    // Staging bucket, never the public one.
    expect(url.hostname).toBe(`tinyhike-photos-staging.${ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
    expect(url.pathname).toBe('/uploads/cuser1/3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b.jpg')
  })
})

describe('endpoint', () => {
  const presign = () =>
    r2.presignPut({
      bucket: 'tinyhike-photos-staging',
      key: 'uploads/cuser1/3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b.jpg',
      contentType: 'image/jpeg',
      size: 1,
      expiresIn: 120,
    })

  it('uses R2_S3_ENDPOINT, origin only, so a jurisdiction bucket is reachable', async () => {
    // The dashboard's "S3 API" value ends in /<bucket>; that path must not leak into keys.
    process.env.R2_S3_ENDPOINT = `https://${ENV.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com/tinyhike-photos`
    const url = new URL(await presign())
    expect(url.hostname).toBe(`tinyhike-photos-staging.${ENV.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`)
    expect(url.pathname).toBe('/uploads/cuser1/3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b.jpg')
  })

  it.each([
    ['not a URL', 'r2.cloudflarestorage.com'],
    ['plain http', `http://${ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`],
    ['a host that is not R2', 'https://storage.example.test'],
  ])('refuses an R2_S3_ENDPOINT that is %s', async (_label, value) => {
    process.env.R2_S3_ENDPOINT = value
    await expect(presign()).rejects.toThrow(/R2_S3_ENDPOINT/)
  })

  it('refuses to sign without an account id or an endpoint', async () => {
    delete process.env.R2_ACCOUNT_ID
    await expect(presign()).rejects.toThrow(/R2_ACCOUNT_ID/)
  })
})

describe('presignGet', () => {
  it('signs a short-lived GET with no checksum mode', async () => {
    const url = new URL(await r2.presignGet({ bucket: 'tinyhike-photos-staging', key: 'confirmed/u/x.jpg', expiresIn: 600 }))
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect([...url.searchParams.keys()].map((k) => k.toLowerCase())).not.toContain('x-amz-checksum-mode')
  })
})

describe('config', () => {
  it('uses the staging bucket when one is configured', () => {
    expect(r2.stagingBucket()).toBe('tinyhike-photos-staging')
    expect(r2.uploadsEnabled()).toBe(true)
  })

  it('disables uploads when the staging bucket is unset or blank (fail closed)', () => {
    delete process.env.R2_STAGING_BUCKET
    expect(r2.stagingBucket()).toBeUndefined()
    expect(r2.uploadsEnabled()).toBe(false)

    process.env.R2_STAGING_BUCKET = '  '
    expect(r2.uploadsEnabled()).toBe(false)
  })

  it('disables uploads when "staging" is the public bucket', () => {
    process.env.R2_STAGING_BUCKET = ENV.R2_BUCKET
    expect(r2.stagingBucket()).toBeUndefined()
    expect(r2.uploadsEnabled()).toBe(false)
  })

  it('builds public URLs without a double slash', () => {
    process.env.R2_PUBLIC_URL = 'https://photos.example.test/'
    expect(r2.publicUrl('p/abc.jpg')).toBe('https://photos.example.test/p/abc.jpg')
  })

  it.each([
    ['unset', undefined],
    ['blank', '  '],
    ['relative', '/photos'],
    ['missing its scheme', 'photos.tinyhike.com'],
    ['plain http', 'http://photos.example.test'],
  ])('refuses to build a public URL when R2_PUBLIC_URL is %s', (_label, value) => {
    // A relative URL would resolve against app.tinyhike.com and hit the SPA fallback.
    if (value === undefined) delete process.env.R2_PUBLIC_URL
    else process.env.R2_PUBLIC_URL = value
    expect(() => r2.publicUrl('p/abc.jpg')).toThrow(/R2_PUBLIC_URL/)
  })

  it('refuses to guess the public bucket', () => {
    delete process.env.R2_BUCKET
    expect(() => r2.publicBucket()).toThrow(/R2_BUCKET/)
  })

  it('allows exactly JPEG, PNG and WebP', () => {
    expect(r2.isAllowedImageType('image/jpeg')).toBe(true)
    expect(r2.isAllowedImageType('image/png')).toBe(true)
    expect(r2.isAllowedImageType('image/webp')).toBe(true)
    expect(r2.isAllowedImageType('image/svg+xml')).toBe(false)
    expect(r2.isAllowedImageType('text/html')).toBe(false)
    expect(r2.isAllowedImageType('toString')).toBe(false)
    expect(r2.isAllowedImageType(undefined)).toBe(false)
  })
})

describe('headObject', () => {
  it('maps the object metadata', async () => {
    stubSend(async () => ({ ContentType: 'image/png', ContentLength: 42 }))
    await expect(r2.headObject({ bucket: 'b', key: 'k' })).resolves.toEqual({ contentType: 'image/png', contentLength: 42 })
  })

  it('resolves null for a missing key', async () => {
    stubSend(async () => {
      throw s3Error('NotFound', 404)
    })
    await expect(r2.headObject({ bucket: 'b', key: 'k' })).resolves.toBeNull()
  })

  it('throws any other failure', async () => {
    stubSend(async () => {
      throw s3Error('AccessDenied', 403)
    })
    await expect(r2.headObject({ bucket: 'b', key: 'k' })).rejects.toThrow('AccessDenied')
  })
})

describe('copyObject', () => {
  it('copies within one bucket', async () => {
    const send = stubSend(async () => ({}))
    await expect(r2.copyObject({ bucket: 'stg', from: 'uploads/u1/a b.jpg', to: 'confirmed/u1/a b.jpg' })).resolves.toBe(true)

    const command = send.mock.calls[0][0] as unknown as CopyObjectCommand
    expect(command).toBeInstanceOf(CopyObjectCommand)
    expect(command.input).toEqual({ Bucket: 'stg', Key: 'confirmed/u1/a b.jpg', CopySource: 'stg/uploads/u1/a%20b.jpg' })
  })

  it('copies from another bucket when asked', async () => {
    const send = stubSend(async () => ({}))
    await r2.copyObject({ bucket: 'stg', sourceBucket: 'pub', from: 'uploads/u1/a.jpg', to: 'confirmed/u1/a.jpg' })
    const command = send.mock.calls[0][0] as unknown as CopyObjectCommand
    expect(command.input).toEqual({ Bucket: 'stg', Key: 'confirmed/u1/a.jpg', CopySource: 'pub/uploads/u1/a.jpg' })
  })

  it('resolves false when nothing was uploaded', async () => {
    stubSend(async () => {
      throw s3Error('NoSuchKey', 404)
    })
    await expect(r2.copyObject({ bucket: 'stg', from: 'a', to: 'b' })).resolves.toBe(false)
  })

  it('does not mistake a missing bucket for a missing upload', async () => {
    stubSend(async () => {
      throw s3Error('NoSuchBucket', 404)
    })
    await expect(r2.copyObject({ bucket: 'stg', from: 'a', to: 'b' })).rejects.toThrow('NoSuchBucket')
  })
})

describe('getObjectBytes', () => {
  it('reads the body', async () => {
    stubSend(async () => ({ ContentLength: 6, Body: Readable.from([Buffer.from('abc'), Buffer.from('def')]) }))
    const res = await r2.getObjectBytes({ bucket: 'b', key: 'k', maxBytes: 10 })
    expect(res.status).toBe('ok')
    expect(res.status === 'ok' && res.bytes.toString()).toBe('abcdef')
  })

  it('refuses an advertised length over the cap without reading', async () => {
    const body = Readable.from([Buffer.alloc(4)])
    stubSend(async () => ({ ContentLength: 11, Body: body }))
    await expect(r2.getObjectBytes({ bucket: 'b', key: 'k', maxBytes: 10 })).resolves.toEqual({ status: 'too_large' })
    expect(body.destroyed).toBe(true)
  })

  it('stops reading once the stream passes the cap, whatever the header said', async () => {
    stubSend(async () => ({ Body: Readable.from([Buffer.alloc(6), Buffer.alloc(6), Buffer.alloc(6)]) }))
    await expect(r2.getObjectBytes({ bucket: 'b', key: 'k', maxBytes: 10 })).resolves.toEqual({ status: 'too_large' })
  })

  it('reports a missing key', async () => {
    stubSend(async () => {
      throw s3Error('NoSuchKey', 404)
    })
    await expect(r2.getObjectBytes({ bucket: 'b', key: 'k', maxBytes: 10 })).resolves.toEqual({ status: 'missing' })
  })
})

describe('listObjectKeys', () => {
  it('pages through a prefix until the listing is complete', async () => {
    const send = stubSend(async (command) => {
      const { ContinuationToken } = (command as ListObjectsV2Command).input
      return ContinuationToken
        ? { Contents: [{ Key: 'uploads/u/3.jpg' }], IsTruncated: false }
        : { Contents: [{ Key: 'uploads/u/1.jpg' }, { Key: 'uploads/u/2.jpg' }], IsTruncated: true, NextContinuationToken: 't1' }
    })

    const pages: string[][] = []
    for await (const page of r2.listObjectKeys({ bucket: 'pub', prefix: 'uploads/' })) pages.push(page)

    expect(pages).toEqual([['uploads/u/1.jpg', 'uploads/u/2.jpg'], ['uploads/u/3.jpg']])
    const inputs = send.mock.calls.map(([command]) => (command as unknown as ListObjectsV2Command).input)
    expect(inputs).toEqual([
      { Bucket: 'pub', Prefix: 'uploads/', ContinuationToken: undefined },
      { Bucket: 'pub', Prefix: 'uploads/', ContinuationToken: 't1' },
    ])
  })

  it('yields nothing for an empty prefix', async () => {
    stubSend(async () => ({ KeyCount: 0, IsTruncated: false }))
    const pages: string[][] = []
    for await (const page of r2.listObjectKeys({ bucket: 'pub', prefix: 'uploads/' })) pages.push(page)
    expect(pages).toEqual([])
  })
})
