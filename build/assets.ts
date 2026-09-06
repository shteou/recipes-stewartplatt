/**
 * Resolves content-hashed asset URLs for the SSR build, so a deploy where
 * `hydrate.tsx`/`theme-toggle.ts`/`theme.css` actually changed always ships a
 * *new* URL for the changed file — the fix for a real class of bug reports
 * that turned out to be a stale browser/CDN cache still serving the previous
 * deploy's JS/CSS under the old fixed filename, indistinguishable from a
 * genuine regression.
 *
 * `/client/*` filenames are hashed by Vite itself (`vite.client.config.ts`'s
 * `[name]-[hash].js` + `manifest: true`) — this module just reads the
 * manifest that build produces. `theme.css` isn't part of that Vite build
 * (it's a plain copy, see `build/index.ts`'s `copyStyles`), so it's hashed
 * here instead, from its own content.
 *
 * Node-only (`node:fs`/`node:crypto`) — safe to import from `SiteChrome.tsx`/
 * `Layout.tsx` because neither is ever bundled into the browser-loadable
 * client: `src/client/hydrate.tsx` (the one thing `vite.client.config.ts`
 * actually compiles) never imports either of them. Both are invoked only
 * here, in the Node-side SSR build (`build/index.ts`, run via `tsx`).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLIENT_MANIFEST_PATH = join(ROOT, "public", "client", ".vite", "manifest.json");
const THEME_CSS_PATH = join(ROOT, "src", "styles", "theme.css");

interface ViteManifestEntry {
  file: string;
}
type ViteManifest = Record<string, ViteManifestEntry>;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let manifestCache: ViteManifest | null = null;

function loadManifest(): ViteManifest {
  if (manifestCache) return manifestCache;
  let raw: string;
  try {
    raw = readFileSync(CLIENT_MANIFEST_PATH, "utf-8");
  } catch {
    return fail(
      `build failed — client asset manifest not found at ${CLIENT_MANIFEST_PATH}. ` +
        `Run "vite build --config vite.client.config.ts" before build/index.ts (this is what "npm run build" does).`,
    );
  }
  manifestCache = JSON.parse(raw) as ViteManifest;
  return manifestCache;
}

function resolveClientEntry(entryKey: string): string {
  const entry = loadManifest()[entryKey];
  if (!entry) {
    return fail(`build failed — client asset manifest has no entry "${entryKey}" (looked in ${CLIENT_MANIFEST_PATH})`);
  }
  return `/client/${entry.file}`;
}

/** Root-relative, content-hashed path to the compiled `hydrate.tsx` bundle. */
export function hydrateScriptPath(): string {
  return resolveClientEntry("src/client/hydrate.tsx");
}

/** Root-relative, content-hashed path to the compiled `theme-toggle.ts` bundle. */
export function themeToggleScriptPath(): string {
  return resolveClientEntry("src/client/theme-toggle.ts");
}

let themeStylesheetPathCache: string | null = null;

/**
 * Root-relative, content-hashed path theme.css should be written to/served
 * from — e.g. `/styles/theme.3f9a1c2b.css`. `build/index.ts`'s `copyStyles`
 * uses this same function to know what filename to copy *to*, so this is the
 * single source of truth for that filename on both the write and read side.
 */
export function themeStylesheetPath(): string {
  if (themeStylesheetPathCache) return themeStylesheetPathCache;
  const contents = readFileSync(THEME_CSS_PATH);
  const hash = createHash("sha256").update(contents).digest("hex").slice(0, 8);
  themeStylesheetPathCache = `/styles/theme.${hash}.css`;
  return themeStylesheetPathCache;
}
