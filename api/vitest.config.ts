import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Rate-limit tests share process state; run files sequentially to avoid
    // cross-file interference on the in-memory limiter.
    fileParallelism: false,
    // app.ts loads the checkout's .env, and dotenv never overrides what is set:
    // pin what the tests rely on, so they pass the same in the prod and the dev
    // checkout. Production's mail mode (the log mode has its own tests in
    // auth.test.ts), and a fake Resend key: building the app creates a Resend
    // client, the dev checkout has no key, and no test should hold the real one.
    env: { EMAIL_DELIVERY: 'resend', RESEND_API_KEY: 're_test_not_a_real_key' },
  },
})
