import { defineConfig } from 'vitest/config'

// Its own config, so the tests do not start the dev server's plugins (vite.config.ts).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
