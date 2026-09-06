/**
 * Build smoke test: runs the actual `npm run build` (vite client build +
 * `tsx build/index.ts`'s SSR build) and asserts against the real `public/`
 * it produces.
 *
 * Deliberately NOT part of the default `npm test` suite (see
 * `vite.config.ts`'s `test.exclude` and `vitest.build.config.ts`) — this
 * test shells out to a real build process, which is real I/O rather than a
 * fast, hermetic unit test. Run it explicitly via `npm run test:build`.
 * It runs the build itself (rather than assuming one already happened)
 * so it's self-contained and can't pass by accident against a stale
 * `public/` left over from a previous manual build.
 *
 * Covers:
 *   - every expected output file exists (pages, tag pages, flags, styles,
 *     client bundles)
 *   - no internal link (`href="/...")`/`src="/...")`) in any generated HTML
 *     file points at a file that doesn't actually exist under `public/`
 */

import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseRecipeCollection, type Recipe, type RecipeSource } from "../src/core/schema.js";
import { TAXONOMY } from "../src/core/taxonomy.js";
import { loadRecipeFile } from "./helpers/loadRecipeFile.js";

const ROOT = join(import.meta.dirname, "..");
const CONTENT_DIR = join(ROOT, "content", "recipes");
const PUBLIC_DIR = join(ROOT, "public");

function loadAllRealRecipes(): Recipe[] {
  const filenames = readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .sort();
  const sources: RecipeSource[] = filenames.map((filename) => loadRecipeFile(join(CONTENT_DIR, filename)));
  const result = parseRecipeCollection(sources);
  if (!result.success) throw new Error(result.errors.join("\n"));
  return result.data;
}

/** Every root-relative HTML file under `public/`, recursively. */
function findHtmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findHtmlFiles(full));
    } else if (entry.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

/** Extract every `href="..."`/`src="..."` attribute value from raw HTML. */
function extractLinks(html: string): string[] {
  const links: string[] = [];
  const pattern = /\b(?:href|src)="([^"]*)"/g;
  for (const match of html.matchAll(pattern)) {
    links.push(match[1]);
  }
  return links;
}

/** Does a root-relative link (e.g. "/recipes/marsala/" or "/flags/it.svg") resolve to a real file under `public/`? */
function linkResolves(link: string): boolean {
  if (link === "/") return existsSync(join(PUBLIC_DIR, "index.html"));
  const withoutQueryHash = link.split(/[?#]/)[0];
  const relative = withoutQueryHash.replace(/^\/+/, "");
  if (relative.endsWith("/")) {
    return existsSync(join(PUBLIC_DIR, relative, "index.html"));
  }
  return existsSync(join(PUBLIC_DIR, relative));
}

let recipes: Recipe[];

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  recipes = loadAllRealRecipes();
}, 60_000);

describe("build smoke test — expected output files exist", () => {
  it("public/index.html", () => {
    expect(existsSync(join(PUBLIC_DIR, "index.html"))).toBe(true);
  });

  it("public/recipes/<slug>/index.html for all 3 real recipes", () => {
    for (const recipe of recipes) {
      const file = join(PUBLIC_DIR, "recipes", recipe.slug, "index.html");
      expect(existsSync(file), `expected ${file} to exist for recipe "${recipe.slug}"`).toBe(true);
    }
    expect(recipes.map((r) => r.slug).sort()).toEqual(["marsala", "mixed-dal-tadka", "skhug"]);
  });

  it("public/tags/<tag>/index.html for every tag actually in use", () => {
    const tagsInUse = new Set<string>();
    for (const recipe of recipes) for (const tag of recipe.tags) tagsInUse.add(tag);
    expect(tagsInUse.size).toBeGreaterThan(0);
    for (const tag of tagsInUse) {
      const file = join(PUBLIC_DIR, "tags", tag, "index.html");
      expect(existsSync(file), `expected ${file} to exist for tag "${tag}"`).toBe(true);
    }
  });

  it("public/flags/*.svg for every referenced flag (featured_image + tag-chip flags)", () => {
    const flags = new Set<string>();
    for (const recipe of recipes) {
      if (recipe.featured_image) flags.add(recipe.featured_image);
      for (const tag of recipe.tags) {
        const flag = TAXONOMY[tag]?.flag;
        if (flag) flags.add(flag);
      }
    }
    expect(flags.size).toBeGreaterThan(0);
    for (const flag of flags) {
      const file = join(PUBLIC_DIR, flag.replace(/^\/+/, ""));
      expect(existsSync(file), `expected ${file} to exist for referenced flag "${flag}"`).toBe(true);
    }
  });

  it("public/styles/theme.css", () => {
    expect(existsSync(join(PUBLIC_DIR, "styles", "theme.css"))).toBe(true);
  });

  it("public/client/hydrate.js", () => {
    expect(existsSync(join(PUBLIC_DIR, "client", "hydrate.js"))).toBe(true);
  });

  it("public/client/theme-toggle.js", () => {
    expect(existsSync(join(PUBLIC_DIR, "client", "theme-toggle.js"))).toBe(true);
  });
});

describe("build smoke test — no broken internal links", () => {
  it("every href=\"/...\"/src=\"/...\" in every generated HTML file resolves to a real file under public/", () => {
    const htmlFiles = findHtmlFiles(PUBLIC_DIR);
    expect(htmlFiles.length).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const file of htmlFiles) {
      const html = readFileSync(file, "utf-8");
      for (const link of extractLinks(html)) {
        if (!link.startsWith("/")) continue; // skip external/relative/anchor/mailto links
        if (!linkResolves(link)) {
          broken.push(`${file}: broken link "${link}"`);
        }
      }
    }

    expect(broken, `found broken internal links:\n${broken.join("\n")}`).toEqual([]);
  });
});
