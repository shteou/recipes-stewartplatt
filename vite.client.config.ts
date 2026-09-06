/**
 * Production build config for the browser-loadable client bundle
 * (`src/client/hydrate.ts` -> `public/client/hydrate.js`).
 *
 * Deliberately separate from `vite.config.ts` (which only configures the dev
 * server + esbuild/jsx + Vitest): the Node-side SSR build (`build/index.ts`,
 * run via `tsx`, unbundled) writes pages directly under `public/` via
 * `writeFileSync`, and Vite's `build.emptyOutDir` default would wipe whatever
 * else lives in its configured `outDir` on every run. Scoping `outDir` to
 * `public/client` (rather than `public` itself) keeps this build's cleanup
 * from touching the SSR build's output, in either run order.
 */

import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // Vite's default `publicDir` ("public/", copied verbatim into `outDir` on
  // every build) would otherwise dump the *entire* SSR-built `public/` tree
  // (including whatever `build/index.ts` last wrote there) into
  // `public/client` alongside `hydrate.js` — this build has no static
  // assets of its own to copy, so disable that behaviour outright.
  publicDir: false,
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  build: {
    outDir: "public/client",
    emptyOutDir: true,
    // Emits public/client/.vite/manifest.json mapping each entry to its
    // actual hashed output filename — read by build/assets.ts so
    // SiteChrome.tsx/Layout.tsx never hardcode a stale asset URL. See
    // build/assets.ts's docstring for why this file's filenames must be
    // content-hashed at all (cache-busting on every deploy).
    manifest: true,
    rollupOptions: {
      input: {
        hydrate: resolve(import.meta.dirname, "src/client/hydrate.tsx"),
        "theme-toggle": resolve(import.meta.dirname, "src/client/theme-toggle.ts"),
      },
      output: {
        entryFileNames: "[name]-[hash].js",
        format: "es",
      },
    },
  },
});
