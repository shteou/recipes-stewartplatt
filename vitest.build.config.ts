/**
 * Config for the build smoke test only (`npm run test:build`).
 *
 * Kept separate from `vite.config.ts` (the default `npm test` suite)
 * because this test actually shells out to `npm run build` — real
 * filesystem/process I/O, not a fast unit test — so it shouldn't run on
 * every `npm test` invocation. See `tests/build-smoke.test.ts`'s docblock.
 */

import { defineConfig } from "vite";

export default defineConfig({
  test: {
    include: ["tests/build-smoke.test.ts"],
    // The build itself (vite client build + tsx SSR build) can take a few
    // seconds on a cold cache; give it more headroom than Vitest's default
    // 5s test timeout.
    testTimeout: 60_000,
  },
});
