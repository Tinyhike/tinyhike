const BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * An HTTP error carrying the API's structured body. The API answers failures with
 * `{ error: 'Code', message: 'Human readable' }` (see the Fastify error handler in
 * api/src/app.ts), so callers branch on `status` and `code`.
 *
 * `message` is developer text for logs and the odd secondary detail line, in
 * English whatever the UI locale. Text shown to a user comes from an i18n key
 * picked by `errorKey()` in lib/errors.ts.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function req<T>(path: string, init?: RequestInit, opts?: { full?: boolean }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'include', ...init })
  } catch (err) {
    // A caller that aborted on purpose gets the AbortError back untouched, so it
    // can tell "I cancelled" apart from "the network failed".
    if (init?.signal?.aborted) throw err
    // Otherwise fetch only rejects on network failure: offline, DNS, CORS, a dropped connection.
    throw new ApiError(0, 'NetworkError', 'Network request failed')
  }

  if (!res.ok) {
    // Prefer the API's own code and message; keep a neutral fallback when the body
    // is HTML or empty (a Cloudflare challenge page, a 502 from nginx).
    let code = 'Error'
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && typeof body === 'object') {
        if (typeof body.error === 'string') code = body.error
        if (typeof body.message === 'string') message = body.message
      }
    } catch {
      /* non-JSON body: keep the fallback */
    }
    throw new ApiError(res.status, code, message)
  }

  const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T)
  return (opts?.full ? { data, status: res.status, headers: res.headers } : data) as T
}

/** A body plus the status and headers — see api.getWithHeaders and api.postWithStatus. */
export interface FullResponse<T> {
  data: T
  status: number
  headers: Headers
}

function jsonInit(method: 'POST' | 'PATCH', body: unknown, signal?: AbortSignal): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => req<T>(path, { signal }),
  /**
   * Same as `get`, but keeps the response headers. `GET /api/places` reports how
   * many places the viewport actually holds via X-Total-Count / X-Result-Truncated,
   * and the map needs that to tell the user when pins are being left out.
   */
  getWithHeaders: <T>(path: string) => req<unknown>(path, undefined, { full: true }) as Promise<FullResponse<T>>,
  post: <T>(path: string, body: unknown, signal?: AbortSignal) => req<T>(path, jsonInit('POST', body, signal)),
  /**
   * Same as `post`, but keeps the status. POST /api/places/:id/reviews answers 200
   * when it replaced the caller's review and 201 when it created one, and only the
   * server knows which: the client's idea of "has a review" can be stale or missing.
   */
  postWithStatus: <T>(path: string, body: unknown, signal?: AbortSignal) =>
    req<unknown>(path, jsonInit('POST', body, signal), { full: true }) as Promise<FullResponse<T>>,
  patch: <T>(path: string, body: unknown) => req<T>(path, jsonInit('PATCH', body)),
}
