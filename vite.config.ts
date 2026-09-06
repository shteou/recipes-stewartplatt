import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * This project's dev server serves pre-built static multi-page output out of
 * `public/` (see `build/index.ts`) rather than one SPA entry point — but
 * Vite's static-file serving for `publicDir` does NOT resolve a directory
 * request (e.g. `/recipes/marsala/`) to that directory's `index.html` on its
 * own, and its default `appType: "spa"` HTML fallback papers over that by
 * serving the *home page* for any unmatched path instead (so the recipe page
 * silently never loads). Real static hosts (Cloudflare Pages included) do
 * resolve `/recipes/marsala/` -> `public/recipes/marsala/index.html`, so this
 * plugin does the same thing here, and is mounted (via `configureServer`,
 * called synchronously rather than returning a post-hook function) ahead of
 * Vite's own middleware so it wins before any fallback runs.
 */
function publicDirIndexFallback(): Plugin {
  const publicDir = join(import.meta.dirname, "public");
  return {
    name: "public-dir-index-fallback",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const url = req.url.split("?")[0];
        // Only handle "directory-style" requests (no file extension on the
        // last path segment, e.g. "/", "/recipes/marsala/") — anything else
        // (assets, explicit *.html, /@vite/client, etc.) is Vite's job.
        if (extname(url) !== "") return next();
        const candidate = join(publicDir, url, "index.html");
        if (existsSync(candidate)) {
          res.setHeader("Content-Type", "text/html");
          res.end(readFileSync(candidate));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [publicDirIndexFallback()],
  // Belt-and-braces alongside the plugin above: disables Vite's "serve
  // /index.html for any unmatched path" SPA fallback, so a genuinely missing
  // page 404s in dev instead of silently rendering the home page.
  appType: "mpa",
  server: {
    port: 5173,
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // The build smoke test (tests/build-smoke.test.ts) runs the actual
    // `npm run build` and checks its output on disk — real I/O, not a fast
    // unit test. It has its own config (vitest.build.config.ts) and its own
    // `npm run test:build` script instead, so the default `npm test` stays
    // fast and hermetic.
    exclude: ["tests/build-smoke.test.ts", "**/node_modules/**"],
  },
});
