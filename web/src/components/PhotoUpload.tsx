import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api.js'
import { errorKey, isAbortError } from '../lib/errors.js'
import { useI18n, type MessageKey } from '../lib/i18n.js'
import { placePath, signInPath } from '../lib/next-path.js'
import { markSignedOut, useMe } from '../lib/session.js'

// The picker's accept list. HEIC is left out on purpose: iOS then converts HEIC
// photos to JPEG itself before handing them over.
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']
// The API's ceiling for one upload (POST /api/photos/presign). Checked on the
// re-encoded JPEG, which in practice stays far below it.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
// Larger sources aren't even decoded: a huge PNG can take a phone's tab down.
const MAX_SOURCE_BYTES = 50 * 1024 * 1024
// Long edge of the re-encoded photo. Not optional: iOS Safari caps canvas area at
// about 16.7M pixels, so a 48 MP photo drawn at full size gives a blank canvas.
const MAX_EDGE = 2048
const JPEG_QUALITY = 0.85
// A PUT that makes no progress for this long is treated as dead. A total timeout
// alone would cut off honest uploads: 10 MB over a 0.5 Mbit/s uplink takes ~160 s.
const STALL_MS = 45_000
// Backstop for an upload that keeps trickling but never finishes.
const TOTAL_TIMEOUT_MS = 10 * 60_000

type Phase = 'idle' | 'picked' | 'preparing' | 'uploading' | 'confirming' | 'done' | 'error'
type Step = 'prepare' | 'presign' | 'upload' | 'confirm'
type FocusTarget = 'send' | 'progress' | 'done' | 'action' | 'add' | 'signin'

interface PhotosConfig {
  enabled: boolean
}

interface Presign {
  uploadUrl: string
  key: string
  expiresIn: number
}

interface Failure {
  key: MessageKey
  /** Keep the picked photo so Retry can send it again. */
  keepFile: boolean
  /** Keep the staged key so Retry only re-confirms, without uploading again. */
  keepUploadedKey: boolean
}

/**
 * Add-a-photo flow on the place sheet: pick (gallery or camera via the OS chooser)
 * → preview → re-encode on the device → presign → PUT straight to the private R2
 * staging bucket → confirm. The photo becomes public only once a moderator
 * approves it (the API re-encodes it again then).
 *
 * The PUT uses XMLHttpRequest rather than fetch because fetch still has no upload
 * progress events, and a parent on 4G uploading a photo needs to see something move.
 */
export default function PhotoUpload({ placeId }: { placeId: string }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { status: session } = useMe()
  // Uploads fail closed on the server when the staging bucket isn't configured; this
  // lets us hide the button instead of offering something that can only fail.
  const config = useQuery<PhotosConfig>({
    queryKey: ['photos-config'],
    queryFn: ({ signal }) => api.get('/api/photos/config', signal),
    staleTime: 5 * 60_000,
  })

  const inputRef = useRef<HTMLInputElement>(null)
  const sendRef = useRef<HTMLButtonElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const signinRef = useRef<HTMLAnchorElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const focusNext = useRef<FocusTarget | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<MessageKey | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // Set once the bytes are in staging: a failed confirm is retried with this same
  // key instead of presigning and uploading again.
  const [uploadedKey, setUploadedKey] = useState<string | null>(null)
  // Set when an upload step found the session gone, so the sign-in link that
  // replaces the flow says why it appeared.
  const [expired, setExpired] = useState(false)
  if (expired && session === 'signedIn') setExpired(false)

  // Object URLs leak memory unless revoked: this cleanup runs when the URL is
  // replaced (or cleared) and on unmount.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  // Closing the sheet (X, scrim, Escape) unmounts us: stop the upload, and with it
  // the confirm that would otherwise submit a photo the user walked away from.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Each step replaces the button that had focus, which would drop focus to <body>,
  // outside the modal sheet. Move it to whatever now stands in its place.
  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    const el =
      target === 'send'
        ? sendRef.current
        : target === 'progress'
          ? progressRef.current
          : target === 'done'
            ? doneRef.current
            : target === 'add'
              ? addRef.current
              : target === 'signin'
                ? signinRef.current
                : (actionRef.current ?? addRef.current ?? errorRef.current)
    el?.focus()
  })

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    // So that picking the same file again still fires onChange.
    e.target.value = ''
    if (!picked) return

    // A declared type outside the list (HEIC on desktop, a PDF via "all files")
    // won't decode here anyway. An empty type, which some Android file managers
    // send, still gets its chance at decoding.
    if (picked.type && !ACCEPT.includes(picked.type)) return showError('photo.badType', false, false)
    if (picked.size > MAX_SOURCE_BYTES) return showError('photo.tooBig', false, false)

    setFile(picked)
    setPreviewUrl(URL.createObjectURL(picked))
    setUploadedKey(null)
    setMessage(null)
    setPhase('picked')
    focusNext.current = 'send'
  }

  function reset(announce?: MessageKey) {
    abortRef.current?.abort()
    abortRef.current = null
    setFile(null)
    setPreviewUrl(null)
    setUploadedKey(null)
    setProgress(0)
    setMessage(null)
    setAnnouncement(announce ? t(announce) : '')
    setPhase('idle')
    focusNext.current = 'add'
  }

  function showError(key: MessageKey, keepFile: boolean, keepUploadedKey: boolean) {
    if (!keepFile) {
      setFile(null)
      setPreviewUrl(null)
    }
    if (!keepUploadedKey) setUploadedKey(null)
    setProgress(0)
    setMessage(key)
    setAnnouncement(t(key))
    setPhase('error')
    focusNext.current = 'action'
  }

  /** Start a busy phase with a fresh AbortController, cancelling any earlier one. */
  function begin(next: 'preparing' | 'confirming'): AbortSignal {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setMessage(null)
    setProgress(next === 'confirming' ? 100 : 0)
    setAnnouncement(t('photo.sending'))
    setPhase(next)
    focusNext.current = 'progress'
    return controller.signal
  }

  async function send() {
    if (!file) return
    const signal = begin('preparing')
    let step: Step = 'prepare'
    try {
      // Re-encode before anything leaves the phone: canvas output carries no EXIF,
      // so the GPS position, capture time and device model are gone, and a 6-10 MB
      // original shrinks to a few hundred KB for the 4G upload.
      const blob = await reencode(file)
      if (blob.size > MAX_UPLOAD_BYTES) throw new PhotoError('photo.tooBig')
      if (signal.aborted) return

      step = 'presign'
      // The URL is signed for this exact type and size; the PUT must match both.
      const { uploadUrl, key } = await api.post<Presign>(
        '/api/photos/presign',
        { contentType: 'image/jpeg', size: blob.size, placeId },
        signal,
      )

      step = 'upload'
      setPhase('uploading')
      await putWithProgress(uploadUrl, blob, setProgress, signal)
      setUploadedKey(key)

      step = 'confirm'
      await confirm(key, signal)
    } catch (err) {
      handleFailure(err, step, signal)
    }
  }

  async function retryConfirm() {
    if (!uploadedKey) return
    const signal = begin('confirming')
    try {
      await confirm(uploadedKey, signal)
    } catch (err) {
      handleFailure(err, 'confirm', signal)
    }
  }

  async function confirm(key: string, signal: AbortSignal) {
    // An abandoned upload must never become a Photo row. The check has to come
    // before the request: aborting a confirm already on the wire doesn't stop the
    // server from creating the row.
    if (signal.aborted) return
    setPhase('confirming')
    setProgress(100)
    await api.post('/api/photos/confirm', { key, placeId }, signal)
    if (signal.aborted) return

    // Clearing previewUrl revokes the object URL straight away (see the effect above).
    setFile(null)
    setPreviewUrl(null)
    setUploadedKey(null)
    setProgress(0)
    setMessage(null)
    setAnnouncement(t('photo.done'))
    setPhase('done')
    focusNext.current = 'done'
  }

  function handleFailure(err: unknown, step: Step, signal: AbortSignal) {
    // Cancelled on purpose (the Cancel button, or the sheet closed): nothing to report.
    if (signal.aborted || isAbortError(err)) return
    if (err instanceof ApiError && err.status === 401) {
      // The session is gone. Flipping ['me'] to signed out swaps this whole block
      // for the sign-in link, which takes the focus the flow's buttons held.
      markSignedOut(queryClient)
      reset()
      setExpired(true)
      focusNext.current = 'signin'
      return
    }
    const failure = describeFailure(err, step)
    showError(failure.key, failure.keepFile, failure.keepUploadedKey)
  }

  if (!config.data?.enabled) return null
  // No sign-in prompt until /me has answered: a signed-in parent would see it flash.
  // 'unknown' renders nothing either: the sheet shows one retry line for the photo
  // upload and the review form together.
  if (session === 'pending' || session === 'unknown') return null
  if (session === 'signedOut') {
    return (
      <div className="photo-signin">
        {expired && (
          <p className="state state--error" role="alert">
            {t('err.signedOut')}
          </p>
        )}
        <Link ref={signinRef} className="btn btn--sky signin-btn" to={signInPath(placePath(placeId))}>
          {t('photo.signIn')}
        </Link>
      </div>
    )
  }

  const busy = phase === 'preparing' || phase === 'uploading' || phase === 'confirming'
  const canRetry = phase === 'error' && (uploadedKey !== null || file !== null)
  const showAdd =
    phase === 'idle' || phase === 'done' || (phase === 'error' && !canRetry && message !== 'photo.disabled')
  const progressText =
    phase === 'preparing'
      ? t('photo.preparing')
      : phase === 'confirming'
        ? t('photo.finishing')
        : t('photo.uploading').replace('{n}', String(progress))

  return (
    <div className="photo-upload">
      {/* The OS file chooser offers both gallery and camera on mobile — no
          `capture` attribute, which would force the camera and hide the gallery. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(',')}
        onChange={pick}
        hidden
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* One live region, mounted before anything is written into it: a region that
          appears with its text already inside is often not announced. It carries
          the start, the result and errors; never the per-percent progress. */}
      <p className="sr-only" role="status">
        {announcement}
      </p>

      {phase === 'done' && (
        <p ref={doneRef} className="photo-done" tabIndex={-1}>
          ✅ {t('photo.done')}
        </p>
      )}

      {previewUrl && phase !== 'idle' && phase !== 'done' && (
        <img
          className={busy ? 'photo-preview photo-preview--busy' : 'photo-preview'}
          src={previewUrl}
          alt={t('photo.altPreview')}
        />
      )}

      {phase === 'picked' && (
        <div className="photo-actions">
          <button ref={sendRef} type="button" className="btn btn--mint" onClick={send}>
            {t('photo.send')}
          </button>
          <button type="button" className="photo-cancel" onClick={() => reset()}>
            {t('photo.cancel')}
          </button>
        </div>
      )}

      {busy && (
        <div ref={progressRef} className="photo-progress-wrap" tabIndex={-1}>
          <div
            className="photo-progress"
            role="progressbar"
            aria-label={t('photo.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-valuetext={progressText}
          >
            <div className="photo-progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <div className="photo-progress-row">
            <span className="photo-progress-label" aria-hidden="true">
              {progressText}
            </span>
            {/* No Cancel once the confirm is on its way: aborting it client-side
                wouldn't stop the server, so the button would lie. */}
            {phase !== 'confirming' && (
              <button type="button" className="photo-cancel" onClick={() => reset('photo.cancelled')}>
                {t('photo.cancel')}
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'error' && message && (
        <>
          <p ref={errorRef} className="state state--error photo-error" tabIndex={-1}>
            {t(message)}
          </p>
          {canRetry && (
            <div className="photo-actions">
              <button
                ref={actionRef}
                type="button"
                className="btn btn--mint"
                onClick={uploadedKey ? retryConfirm : send}
              >
                {t('photo.retry')}
              </button>
              <button type="button" className="photo-cancel" onClick={() => reset()}>
                {t('photo.cancel')}
              </button>
            </div>
          )}
        </>
      )}

      {showAdd && (
        <button ref={addRef} type="button" className="photo-add" onClick={() => inputRef.current?.click()}>
          {phase === 'done' ? t('photo.addAnother') : t('photo.add')}
        </button>
      )}
    </div>
  )
}

/** A problem with the photo itself rather than a request, with the message to show. */
class PhotoError extends Error {
  constructor(readonly key: MessageKey) {
    super(key)
    this.name = 'PhotoError'
  }
}

/** The direct-to-R2 PUT failed. Status 0 means no readable HTTP response. */
class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly reason: 'http' | 'network' | 'stalled' | 'timeout',
  ) {
    super(`Upload failed: ${reason}${status ? ` ${status}` : ''}`)
    this.name = 'UploadError'
  }
}

/** Which message to show, and what Retry can reuse, for a failure at `step`. */
function describeFailure(err: unknown, step: Step): Failure {
  if (err instanceof PhotoError) return { key: err.key, keepFile: false, keepUploadedKey: false }

  if (err instanceof UploadError) {
    // A fresh presign fixes all of these (including a signed URL that expired
    // during a slow start), so the photo is kept for Retry.
    const key: MessageKey =
      err.reason === 'stalled' || err.reason === 'timeout'
        ? 'photo.stalled'
        : err.reason === 'network'
          ? 'err.network'
          : 'photo.error'
    return { key, keepFile: true, keepUploadedKey: false }
  }

  if (err instanceof ApiError) {
    if (err.code === 'UploadsDisabled') return { key: 'photo.disabled', keepFile: false, keepUploadedKey: false }
    if (err.code === 'TooManyPending') return { key: 'photo.tooManyPending', keepFile: false, keepUploadedKey: false }
    // The API refused the object itself (and deleted it from staging).
    if (err.status === 413) return { key: 'photo.tooBig', keepFile: false, keepUploadedKey: false }
    if (err.status === 400) return { key: 'photo.badType', keepFile: false, keepUploadedKey: false }

    const generic = errorKey(err)
    // The bytes are already in staging: after a transient confirm failure, Retry
    // only re-confirms that key. Any other confirm answer (403, 404, 409
    // NotUploaded) needs a fresh upload.
    const transient = err.status === 0 || err.status === 429 || err.status >= 500
    return {
      key: generic === 'err.generic' ? 'photo.error' : generic,
      keepFile: true,
      keepUploadedKey: step === 'confirm' && transient,
    }
  }

  return { key: 'photo.error', keepFile: true, keepUploadedKey: false }
}

/**
 * Decode, apply the EXIF orientation, downscale to MAX_EDGE and re-encode as JPEG.
 * The canvas output carries no metadata at all. The server re-encodes again at
 * approval, because a client can always skip this step.
 */
async function reencode(file: File): Promise<Blob> {
  const image = await decode(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError('photo.error')
    // JPEG has no alpha channel: without a backdrop, transparent PNG areas turn black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image.source, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    // Release the backing store now: iOS counts canvas memory across the whole page.
    canvas.width = 0
    canvas.height = 0
    // toBlob yields null when the canvas couldn't be encoded, typically a phone
    // that ran out of canvas memory.
    if (!blob) throw new PhotoError('photo.error')
    return blob
  } finally {
    image.release()
  }
}

interface DecodedImage {
  source: CanvasImageSource
  /** Pixel size with the EXIF orientation applied. */
  width: number
  height: number
  release: () => void
}

/**
 * Decode with the EXIF orientation baked into the pixels, so portraits aren't
 * turned sideways once the EXIF is dropped. createImageBitmap with 'from-image' is
 * the direct route, but an engine from before that value was specified rejects the
 * call itself (WebIDL throws a TypeError for an unknown enum value), and Safari
 * before 15 has no createImageBitmap at all. Neither says anything about the file,
 * so any failure there falls back to an <img>, which applies the EXIF orientation
 * by default. Only a file the <img> can't decode either is a bad file.
 */
async function decode(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      /* unsupported option, or a file this decoder refuses: the <img> path decides */
    }
  }
  return decodeWithImg(file)
}

async function decodeWithImg(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  try {
    // Engines without HTMLImageElement.decode() (before Safari 11.1) get the load
    // events instead, wired before src is set so neither can be missed.
    const loaded =
      typeof img.decode === 'function'
        ? null
        : new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error('Image failed to load'))
          })
    img.src = url
    await (loaded ?? img.decode())
  } catch {
    /* judged by the size below */
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url)
    throw new PhotoError('photo.badType')
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    // The object URL backs the <img>: it can go once the canvas has drawn it.
    release: () => URL.revokeObjectURL(url),
  }
}

/**
 * PUT straight to R2 with upload progress. Every way the request can end settles
 * the promise: an aborted or timed-out XHR fires onabort/ontimeout, not onerror,
 * and without those handlers the promise would hang forever.
 */
function putWithProgress(
  url: string,
  blob: Blob,
  onProgress: (pct: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const xhr = new XMLHttpRequest()
    let stalled = false
    let watchdog = 0
    // Re-armed on every progress event, and left running after the last byte is
    // sent: a response that never arrives is a stall too, so only onload ends it.
    const arm = () => {
      window.clearTimeout(watchdog)
      watchdog = window.setTimeout(() => {
        stalled = true
        xhr.abort()
      }, STALL_MS)
    }
    const onAbortSignal = () => xhr.abort()
    const settle = () => {
      window.clearTimeout(watchdog)
      signal.removeEventListener('abort', onAbortSignal)
    }

    xhr.open('PUT', url)
    xhr.timeout = TOTAL_TIMEOUT_MS
    // Must match what the URL was signed for, or R2 rejects the signature. The
    // browser sets Content-Length from the blob, which is the size we declared.
    xhr.setRequestHeader('Content-Type', 'image/jpeg')
    xhr.upload.onprogress = (e) => {
      arm()
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.upload.onload = arm
    xhr.onload = () => {
      settle()
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new UploadError(xhr.status, 'http'))
    }
    // Also what an R2 error response without CORS headers looks like: no readable status.
    xhr.onerror = () => {
      settle()
      reject(new UploadError(0, 'network'))
    }
    xhr.ontimeout = () => {
      settle()
      reject(new UploadError(0, 'timeout'))
    }
    xhr.onabort = () => {
      settle()
      reject(stalled ? new UploadError(0, 'stalled') : new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbortSignal, { once: true })
    arm()
    xhr.send(blob)
  })
}
