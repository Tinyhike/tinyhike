import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Rate-limit tests share process state; run files sequentially to avoid
    // cross-file interference on the in-memory limiter.
    fileParallelism: false,
  },
})
