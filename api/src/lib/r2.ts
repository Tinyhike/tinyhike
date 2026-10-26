/**
 * Cloudflare R2 facade: the only place in the API that builds an S3 client.
 *
 * Two buckets, two trust levels:
 *  - STAGING (R2_STAGING_BUCKET): private, no custom domain, no r2.dev access.
 *    Browsers PUT raw uploads here through presigned URLs. Nothing in it is ever
 *    publicly reachable, so an unmoderated or abusive upload can't be served.
 *  - PUBLIC (R2_BUCKET, served at R2_PUBLIC_URL = photos.tinyhike.com): holds only
 *    images a moderator approved, re-encoded server-side (EXIF stripped). See
 *    src/services/photo-moderation.ts.
 *
 * Provisioning the staging bucket (Cloudflare dashboard, once, BEFORE setting
 * R2_STAGING_BUCKET: that variable switches uploads on, /api/photos/config starts
 * answering enabled:true and the web shows "Add a photo"):
 *  1. Create the bucket with no custom domain and r2.dev public access OFF.
 *     Location: Automatic, NO jurisdiction, the same as R2_BUCKET. Both buckets
 *     are reached through one S3 endpoint (see r2Endpoint()), and a bucket created
 *     under a jurisdiction (EU, FedRAMP) only answers on its own
 *     <account>.<jurisdiction>.r2.cloudflarestorage.com host: from the default one
 *     every call fails with NoSuchBucket. To move to a jurisdiction, move BOTH
 *     buckets and set R2_S3_ENDPOINT to that host.
 *  2. CORS on the STAGING bucket: the browser PUTs cross-origin from the app
 *     straight to <staging>.<account>.r2.cloudflarestorage.com, so without a rule
 *     every preflight fails and every upload reads as a network error.
 *       AllowedOrigins ["https://app.tinyhike.com", "http://localhost:5173"]
 *       AllowedMethods ["PUT"]   AllowedHeaders ["content-type"]   MaxAgeSeconds 3600
 *     Set it in the dashboard (R2 → bucket → Settings → CORS Policy) or with
 *     `wrangler r2 bucket cors set`. Never from this API: PutBucketCors needs an
 *     Admin token, and the API must not hold one. The public bucket needs no CORS
 *     (<img> loads don't use it).
 *  3. Lifecycle on the staging bucket: expire uploads/ after 1 day (abandoned or
 *     unconfirmed PUTs); confirmed/ never expires, moderation deletes from it.
 *  4. The API token (R2_ACCESS_KEY_ID) must be "Object Read & Write" on BOTH
 *     R2_STAGING_BUCKET and R2_BUCKET. Scoped to the public bucket only, the
 *     browser's PUT gets a 403 and confirm's copy/head answer 500. Object-level
 *     rights are all this file uses (Put/Get/Head/Copy/Delete/List), never Admin.
 *  5. Set R2_STAGING_BUCKET, then clear what the pre-staging upload flow left in
 *     the PUBLIC bucket. Until then /presign signed PUTs straight into R2_BUCKET
 *     under uploads/<userId>/…, which photos.tinyhike.com serves in full: raw,
 *     unmoderated, EXIF intact, and naming the uploader's user id.
 *       pnpm photos:moderate purge-legacy --dry-run   (what would change)
 *       pnpm photos:moderate purge-legacy
 *     It moves every PENDING row's original into private staging, deletes every
 *     object under uploads/ that no APPROVED row serves (unconfirmed PUTs
 *     included), and prints the URLs to purge from the Cloudflare cache
 *     (or purge the prefix photos.tinyhike.com/uploads/). When the dry run finds
 *     nothing, there is nothing to do. See purgeLegacyUploads() in
 *     src/services/photo-moderation.ts.
 *  6. Restart the API, then smoke-test presign → PUT → confirm from a browser on
 *     app.tinyhike.com before shipping a web build that offers uploads.
 *
 * Routes and services call these helpers instead of the SDK so tests can
 * vi.mock('../src/lib/r2.js') and never touch the network.
 *
 * Config is read from the environment at call time, not import time: the CLI jobs
 * load dotenv themselves, and tests set variables per case.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Raster image types an upload may declare, mapped to the key extension.
 * SVG is excluded on purpose: it is a script-capable document, not an image.
 */
export const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type AllowedImageType = keyof typeof ALLOWED_IMAGE_TYPES

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function isAllowedImageType(value: string | undefined): value is AllowedImageType {
  return value !== undefined && Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, value)
}

/** R2 hosts: <account>.r2.cloudflarestorage.com, or <account>.<jurisdiction>.r2… */
const R2_HOST = /^[0-9a-f]{32}(\.[a-z0-9-]+)?\.r2\.cloudflarestorage\.com$/

/**
 * The S3 endpoint for BOTH buckets: R2_S3_ENDPOINT when set, else the account's
 * default host. Only the origin of R2_S3_ENDPOINT is used: the dashboard's "S3
 * API" value ends in /<bucket>, and a path here would be prefixed to every key.
 * Anything that is not an R2 host fails loudly rather than signing URLs for it.
 */
function r2Endpoint(): string {
  const configured = process.env.R2_S3_ENDPOINT?.trim()
  if (configured) {
    let url: URL
    try {
      url = new URL(configured)
    } catch {
      throw new Error('R2_S3_ENDPOINT is not a valid URL')
    }
    if (url.protocol !== 'https:' || !R2_HOST.test(url.hostname)) {
      throw new Error('R2_S3_ENDPOINT must be https://<account-id>[.<jurisdiction>].r2.cloudflarestorage.com')
    }
    return url.origin
  }
  const account = process.env.R2_ACCOUNT_ID?.trim()
  if (!account) throw new Error('R2_ACCOUNT_ID is not set')
  return `https://${account}.r2.cloudflarestorage.com`
}

// One client per endpoint. Rebuilt only if the endpoint changes, which in practice
// means tests switching configuration.
let cached: { endpoint: string; client: S3Client } | undefined

function s3(): S3Client {
  const endpoint = r2Endpoint()
  if (cached?.endpoint === endpoint) return cached.client
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
    // Since SDK v3.729 the default ('WHEN_SUPPORTED') adds a flexible checksum to
    // every PutObject. For a PRESIGNED put the SDK can't see the body the browser
    // will send, so it signs the CRC32 of an EMPTY body (x-amz-checksum-crc32=
    // AAAAAA==) into the URL, and R2 then rejects every real upload with a checksum
    // mismatch. 'WHEN_REQUIRED' only adds checksums to operations that mandate one.
    // Validation is relaxed the same way: R2 does not return the checksums the
    // default mode would try to verify on GetObject.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  cached = { endpoint, client }
  return client
}

/**
 * The private staging bucket, or undefined when uploads are disabled.
 *
 * Fails closed: unset, empty, or equal to the public bucket all count as "no
 * staging bucket". Pointing both at the same bucket would publish unmoderated
 * bytes at photos.tinyhike.com, which is exactly what staging exists to prevent.
 */
export function stagingBucket(): string | undefined {
  const staging = process.env.R2_STAGING_BUCKET?.trim()
  if (!staging) return undefined
  if (staging === process.env.R2_BUCKET?.trim()) return undefined
  return staging
}

/** Photo upload is available only with a private staging bucket configured. */
export function uploadsEnabled(): boolean {
  return stagingBucket() !== undefined
}

/** The public bucket behind R2_PUBLIC_URL. Holds approved, re-encoded images only. */
export function publicBucket(): string {
  const bucket = process.env.R2_BUCKET?.trim()
  if (!bucket) throw new Error('R2_BUCKET is not set')
  return bucket
}

/**
 * Public URL of a key in the public bucket.
 *
 * Fails closed like publicBucket(): with R2_PUBLIC_URL unset this used to yield a
 * relative "/p/<id>.jpg", which the web resolves against app.tinyhike.com, where
 * nginx's SPA fallback answers HTML. An approval would publish the object and
 * store that URL, and the photo would render broken with nothing in any log.
 * Throwing here stops approvePhoto before it publishes or writes anything.
 */
export function publicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_URL?.trim()
  if (!base) throw new Error('R2_PUBLIC_URL is not set')
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new Error('R2_PUBLIC_URL is not an absolute URL')
  }
  if (url.protocol !== 'https:') throw new Error('R2_PUBLIC_URL must be an https:// URL')
  return `${base.replace(/\/+$/, '')}/${key}`
}

/**
 * Presigned PUT that pins both Content-Type and Content-Length.
 *
 * Both headers go into X-Amz-SignedHeaders, so R2 refuses a PUT whose type differs
 * (no text/html served as a ".jpg") or whose body is not exactly `size` bytes (no
 * multi-GB objects behind a 10 MB check). Browsers set Content-Length from the Blob
 * themselves; the client must send the exact Content-Type it presigned.
 */
export async function presignPut(opts: {
  bucket: string
  key: string
  contentType: AllowedImageType
  size: number
  expiresIn: number
}): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: opts.bucket,
      Key: opts.key,
      ContentType: opts.contentType,
      ContentLength: opts.size,
    }),
    // The S3 presigner leaves content-type unsigned by default; naming it here is
    // what turns the declared type into a constraint.
    { expiresIn: opts.expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
  )
}

/** Presigned GET, e.g. so a moderator can view a private staging object. */
export async function presignGet(opts: { bucket: string; key: string; expiresIn: number }): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key }), {
    expiresIn: opts.expiresIn,
  })
}

export interface ObjectHead {
  contentType?: string
  contentLength?: number
}

/** HEAD an object. Resolves null when it does not exist; any other failure throws. */
export async function headObject(opts: { bucket: string; key: string }): Promise<ObjectHead | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: opts.bucket, Key: opts.key }))
    return { contentType: res.ContentType, contentLength: res.ContentLength }
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/**
 * Server-side copy into `bucket`, from the same bucket unless `sourceBucket` names
 * another one (both must be reachable through the same endpoint). Resolves false
 * when the source does not exist (nothing was uploaded); any other failure throws.
 */
export async function copyObject(opts: {
  bucket: string
  from: string
  to: string
  sourceBucket?: string
}): Promise<boolean> {
  const sourceBucket = opts.sourceBucket ?? opts.bucket
  try {
    await s3().send(
      new CopyObjectCommand({
        Bucket: opts.bucket,
        Key: opts.to,
        // CopySource is "<bucket>/<key>" and must be URL-encoded; keep the slashes.
        CopySource: `${sourceBucket}/${opts.from.split('/').map(encodeURIComponent).join('/')}`,
      }),
    )
    return true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}

/** Delete an object. Deleting a key that does not exist succeeds (S3 semantics). */
export async function deleteObject(opts: { bucket: string; key: string }): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: opts.key }))
}

/**
 * Every key under `prefix`, one page (at most 1000 keys) at a time, so a caller
 * can look each page up in the database without holding the whole listing.
 * Deleting keys from a page already yielded does not disturb the listing: the
 * continuation token marks a position after them.
 */
export async function* listObjectKeys(opts: { bucket: string; prefix: string }): AsyncGenerator<string[]> {
  let token: string | undefined
  do {
    const res = await s3().send(
      new ListObjectsV2Command({ Bucket: opts.bucket, Prefix: opts.prefix, ContinuationToken: token }),
    )
    const keys = (res.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []))
    if (keys.length > 0) yield keys
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)
}

export type ObjectBytes =
  | { status: 'ok'; bytes: Buffer }
  | { status: 'missing' }
  | { status: 'too_large' }

/**
 * Download an object into memory, refusing anything over `maxBytes`.
 *
 * The guard runs twice: on the advertised Content-Length before reading, and on
 * the running total while streaming, so a lying or absent length still can't make
 * the API buffer an unbounded body.
 */
export async function getObjectBytes(opts: { bucket: string; key: string; maxBytes: number }): Promise<ObjectBytes> {
  let res
  try {
    res = await s3().send(new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key }))
  } catch (err) {
    if (isNotFound(err)) return { status: 'missing' }
    throw err
  }

  const body: unknown = res.Body
  if (!isAsyncIterable(body)) {
    throw new Error('R2 GetObject returned no readable body')
  }

  if ((res.ContentLength ?? 0) > opts.maxBytes) {
    destroyStream(body)
    return { status: 'too_large' }
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of body) {
    total += chunk.byteLength
    if (total > opts.maxBytes) {
      destroyStream(body)
      return { status: 'too_large' }
    }
    chunks.push(Buffer.from(chunk))
  }
  return { status: 'ok', bytes: Buffer.concat(chunks) }
}

/** Upload bytes the API produced itself (never client bytes). */
export async function putObject(opts: {
  bucket: string
  key: string
  body: Buffer
  contentType: string
  cacheControl?: string
}): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: opts.bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
      CacheControl: opts.cacheControl,
    }),
  )
}

/**
 * A missing KEY: HeadObject reports it as NotFound (a HEAD has no error body),
 * Get and Copy as NoSuchKey. Matched by name rather than by the 404 status, so a
 * misconfigured bucket (NoSuchBucket, also a 404) surfaces as a server error
 * instead of being mistaken for "the client never uploaded".
 */
function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('name' in err)) return false
  return err.name === 'NotFound' || err.name === 'NoSuchKey'
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value
}

/** Stop downloading the rest of a body we decided not to read. */
function destroyStream(body: object): void {
  if ('destroy' in body && typeof body.destroy === 'function') body.destroy()
}
