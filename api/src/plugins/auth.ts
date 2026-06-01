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

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies['session']
  if (!token) return reply.status(401).send({ error: 'Unauthorized' })
  try {
    req.session = await verifySession(token)
  } catch {
    return reply.status(401).send({ error: 'Invalid session' })
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply)
  if (req.session?.role !== 'ADMIN') {
    return reply.status(403).send({ error: 'Forbidden' })
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionPayload
  }
}
