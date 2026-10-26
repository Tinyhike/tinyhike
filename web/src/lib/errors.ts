import { ApiError } from './api.js'
import type { MessageKey } from './i18n.js'

/** The generic failure messages every component can fall back on. */
export type ErrorKey = Extract<MessageKey, 'err.network' | 'err.tooMany' | 'err.signedOut' | 'err.generic'>

/**
 * Which localized message to show for a failed API call.
 *
 * User-facing text never comes from `err.message`: that is the server's English, or
 * api.ts's developer fallback, whatever the UI locale. Status is what we branch on,
 * not the body's `error` code — a rate-limit 429 carries no useful code.
 *
 * A component with a more specific message (auth.tooMany, photo.error…) maps the
 * result onward; anything unrecognised lands on `err.generic`.
 */
export function errorKey(err: unknown): ErrorKey {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'err.network'
    if (err.status === 429) return 'err.tooMany'
    if (err.status === 401) return 'err.signedOut'
  }
  return 'err.generic'
}

/** True for the rejection of a fetch or XHR the caller aborted on purpose. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/**
 * A TanStack `retry` policy: up to `max` retries for failures that may pass
 * (offline, 5xx, 408, 429), none for a definitive answer. Asking again after a 404
 * gets the same 404, only after 1 + 2 + 4 s of backoff, so a "place not found"
 * would sit behind a skeleton for seven seconds.
 */
export function retryTransient(max: number): (failureCount: number, err: unknown) => boolean {
  return (failureCount, err) => failureCount < max && !isDefinitive(err)
}

function isDefinitive(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429
}
