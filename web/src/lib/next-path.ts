/**
 * Where to land after signing in.
 *
 * The rule is an allowlist of in-app paths, identical to the server's in
 * api/src/routes/auth.ts (POST /magic and GET /verify re-check it). A loose
 * "starts with /" test is not enough: PUBLIC_BASE_URL + '@evil.com' is an open
 * redirect, and '//evil.com' is one wherever the path is used on its own, as in a
 * <Link to> or a navigate().
 */
const NEXT_PATH = /^\/(places\/[a-z0-9]{1,40}|profile|lists)?$/

/** `value` when it is an allowed return path, otherwise null. */
export function safeNext(value: string | null | undefined): string | null {
  return value && NEXT_PATH.test(value) ? value : null
}

/** The sign-in page, carrying `next` so the magic link brings the user back there. */
export function signInPath(next: string): string {
  const safe = safeNext(next)
  return safe ? `/auth?next=${encodeURIComponent(safe)}` : '/auth'
}

export function placePath(placeId: string): string {
  return `/places/${placeId}`
}
