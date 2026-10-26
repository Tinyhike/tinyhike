import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify'
import { jwtVerify, SignJWT } from 'jose'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!)
const ALG = 'HS256'

export interface SessionPayload {
  sub: string // userId
  role: string
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setExpirationTime('30d')
    .sign(SECRET)
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, SECRET)
  return { sub: payload.sub!, role: payload['role'] as string }
}

/**
 * The `__Host-` prefix makes browsers refuse this cookie unless it is Secure,
 * Path=/ and carries no Domain — so no sibling subdomain (photos.tinyhike.com
 * serves user content) can plant or shadow a session for app.tinyhike.com.
 * A plain `session` name could be overridden by a `Domain=tinyhike.com` cookie
 * set from any subdomain, silently logging the victim into another account.
 */
export const SESSION_COOKIE = '__Host-session'

/** Attributes for setting AND clearing: a `__Host-` clear without Secure + Path=/ is ignored. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE]
  if (!token) return reply.status(401).send({ error: 'Unauthorized', message: 'Sign in required' })
  try {
    req.session = await verifySession(token)
  } catch {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired session' })
  }
}

/**
 * Attach the session when a valid cookie is present, and carry on anonymously
 * otherwise. Never replies: an expired 30-day cookie must not turn an endpoint
 * that needs no account (tag votes, place detail) into a 401.
 */
export async function optionalAuth(req: FastifyRequest) {
  const token = req.cookies[SESSION_COOKIE]
  if (!token) return
  try {
    req.session = await verifySession(token)
  } catch {
    /* stale or tampered cookie: treat the caller as anonymous */
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply)
  // requireAuth may already have answered 401; sending a 403 on top would throw.
  if (reply.sent) return reply
  if (req.session?.role !== 'ADMIN') {
    return reply.status(403).send({ error: 'Forbidden', message: 'Admins only' })
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionPayload
  }
}
