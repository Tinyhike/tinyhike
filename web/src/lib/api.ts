const BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * An HTTP error carrying the API's structured body. The API answers failures with
 * `{ error: 'Code', message: 'Human readable' }` (see the Fastify error handler in
 * api/src/app.ts), so callers can branch on `status`/`code` and still have a
 * message worth showing a user.
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

async function req<T>(path: string, init?: RequestInit, opts?: { withHeaders?: boolean }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'include', ...init })
  } catch {
    // fetch only rejects on network failure — offline, DNS, CORS, aborted connection.
    throw new ApiError(0, 'NetworkError', 'Réseau indisponible. Vérifie ta connexion.')
  }

  if (!res.ok) {
    // Prefer the API's own message; fall back to something readable if the body is
    // HTML or empty (e.g. a Cloudflare challenge page or a 502 from nginx).
    let code = 'Error'
    let message = `Erreur ${res.status}`
    try {
      const body = await res.json()
      if (body && typeof body === 'object') {
        if (typeof body.error === 'string') code = body.error
        if (typeof body.message === 'string') message = body.message
      }
    } catch {
      /* non-JSON body — keep the generic message */
    }
    throw new ApiError(res.status, code, message)
  }

  const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T)
  return (opts?.withHeaders ? { data, headers: res.headers } : data) as T
}

/** A response plus the headers the caller needs — see api.getWithHeaders. */
export interface WithHeaders<T> {
  data: T
  headers: Headers
}

export const api = {
  get: <T>(path: string) => req<T>(path),
  /**
   * Same as `get`, but keeps the response headers. `GET /api/places` reports how
   * many places the viewport actually holds via X-Total-Count / X-Result-Truncated,
   * and the map needs that to tell the user when pins are being left out.
   */
  getWithHeaders: <T>(path: string) =>
    req<unknown>(path, undefined, { withHeaders: true }) as Promise<WithHeaders<T>>,
  post: <T>(path: string, body: unknown) =>
    req<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    req<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
}
