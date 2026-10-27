import { describe, it, expect, vi, afterEach } from 'vitest'

// index.ts only builds the app and listens: a stub app records where it would bind.
const { listen } = vi.hoisted(() => ({ listen: vi.fn() }))
vi.mock('../src/app.js', () => ({ buildApp: async () => ({ listen }) }))

async function listenOptions(): Promise<unknown> {
  vi.resetModules()
  listen.mockClear()
  await import('../src/index.js')
  return listen.mock.calls[0]?.[0]
}

describe('index.ts: where the API listens', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to 127.0.0.1:3000, so only nginx on the same machine reaches it', async () => {
    vi.stubEnv('HOST', undefined)
    vi.stubEnv('PORT', undefined)
    expect(await listenOptions()).toEqual({ host: '127.0.0.1', port: 3000 })
  })

  it('falls back to 127.0.0.1 on an empty HOST=, which would bind every interface', async () => {
    vi.stubEnv('HOST', '')
    vi.stubEnv('PORT', undefined)
    expect(await listenOptions()).toEqual({ host: '127.0.0.1', port: 3000 })
  })

  it('takes HOST and PORT from the environment (the dev checkout, a container)', async () => {
    vi.stubEnv('HOST', '0.0.0.0')
    vi.stubEnv('PORT', '3100')
    expect(await listenOptions()).toEqual({ host: '0.0.0.0', port: 3100 })
  })
})
