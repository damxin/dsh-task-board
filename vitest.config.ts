import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // npm SDK packages reference sourcemaps that are not published (files
  // exclude *.map); do not attempt to load them during transform.
  server: {
    sourcemapIgnoreList: () => true,
  },
  resolve: {
    alias: {
      // The board builds its owner Peer from the Host's connection package
      // (DSH 0.2.1-rc.2 requires every in-process Remote invocation to name its
      // Peer). The real class hangs a scope under a live Host root, which a
      // capture-only test context cannot provide, so the suite resolves the
      // package onto a double that keeps the same construction contract.
      '@deepseek-ai/dsh-client-connection': fileURLToPath(new URL('./tests/host-peer-double.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.{spec,test}.{ts,tsx}'],
    pool: 'forks',
    setupFiles: ['./vitest.setup.ts'],
    // @deepseek-ai SDK packages ship browser bundles (CSS imports included);
    // keep them vite-transformed instead of node-externalized.
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
