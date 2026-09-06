/**
 * SSR build script: content/recipes/*.md -> parseRecipeCollection() ->
 * present() (one per recipe) -> preact-render-to-string -> public/.
 *
 * Generates the full Stage 6 page set:
 *   - public/recipes/<slug>/index.html — one per recipe, all four steps
 *     views rendered (Grouped visible, the rest `hidden`), substitution
 *     badges / unit toggle / servings widget markup, tag chips.
 *   - public/index.html — every recipe, newest-first by `date`.
 *   - public/tags/<tag>/index.html — one per tag actually used by >=1 recipe.
 *   - public/flags/*.svg — every referenced `featured_image`, deduped.
 *
 * Frontmatter/body splitting here is intentionally minimal (mirrors
 * `tests/helpers/loadRecipeFile.ts`) since the real content-loading module
 * (`src/content/load.ts`) is a later build stage.
 */

import { mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { load } from "js-yaml";
import { render } from "preact-render-to-string";
import { parseRecipeCollection, type Recipe, type RecipeSource } from "../src/core/schema.js";
import { present, type ViewState } from "../src/core/present.js";
import { TAXONOMY } from "../src/core/taxonomy.js";
import { RecipePage } from "../src/view/Layout.js";
import { HomePage } from "../src/view/HomePage.js";
import { TagPage } from "../src/view/TagPage.js";
import { themeStylesheetPath } from "./assets.js";

const ROOT = join(import.meta.dirname, "..");
const CONTENT_DIR = join(ROOT, "content", "recipes");
const ASSETS_DIR = join(ROOT, "assets");
const STYLES_DIR = join(ROOT, "src", "styles");
const PUBLIC_DIR = join(ROOT, "public");
const HEADERS_SRC_FILE = join(ROOT, "build", "_headers");

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function loadRecipeFile(filePath: string): { raw: unknown; sourceLabel: string } {
  const text = readFileSync(filePath, "utf-8");
  const match = FRONTMATTER_PATTERN.exec(text);
  if (!match) {
    throw new Error(`${filePath}: no YAML frontmatter block found`);
  }
  const [, frontmatterText, bodyText] = match;
  const frontmatter = load(frontmatterText);
  if (typeof frontmatter !== "object" || frontmatter === null) {
    throw new Error(`${filePath}: frontmatter did not parse to an object`);
  }
  return { raw: { ...frontmatter, body: bodyText.trim() }, sourceLabel: filePath };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function writeHtml(outFile: string, html: string): void {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `<!DOCTYPE html>\n${html}\n`, "utf-8");
  console.log(`wrote ${outFile}`);
}

// ---------------------------------------------------------------------------
// Load + validate every recipe
// ---------------------------------------------------------------------------

function loadAllRecipes(): Recipe[] {
  const filenames = readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .sort();

  if (filenames.length === 0) {
    fail(`build failed — no recipe files found under ${CONTENT_DIR}`);
  }

  const sources: RecipeSource[] = filenames.map((filename) => loadRecipeFile(join(CONTENT_DIR, filename)));

  const result = parseRecipeCollection(sources);
  if (!result.success) {
    fail(`build failed — recipe validation errors:\n${result.errors.join("\n")}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Copy theme.css into public/styles/ under its content-hashed name (see
 * `assets.ts`'s `themeStylesheetPath`), so every generated page's
 * `<link rel="stylesheet">` (rendered via that same function in
 * `SiteChrome.tsx`) resolves to the file this actually writes. Only
 * `theme.css` exists today — if a second stylesheet is ever added, this (and
 * `themeStylesheetPath`) need generalizing beyond a single hardcoded file.
 */
function copyStyles(): void {
  const destDir = join(PUBLIC_DIR, "styles");
  mkdirSync(destDir, { recursive: true });
  const srcFile = join(STYLES_DIR, "theme.css");
  const hashedFilename = themeStylesheetPath().replace(/^\/styles\//, "");
  const destFile = join(destDir, hashedFilename);
  copyFileSync(srcFile, destFile);
  console.log(`copied ${srcFile} -> ${destFile}`);
}

/**
 * Copy the static Cache-Control rules (build/_headers) into public/_headers
 * — Cloudflare Pages reads a `_headers` file at the root of the deployed
 * output directory verbatim. Kept as a source file under `build/` (rather
 * than written by hand into `public/`, which is entirely gitignored/
 * regenerated) so it's version-controlled like everything else this build
 * copies in.
 */
function copyHeaders(): void {
  const destFile = join(PUBLIC_DIR, "_headers");
  copyFileSync(HEADERS_SRC_FILE, destFile);
  console.log(`copied ${HEADERS_SRC_FILE} -> ${destFile}`);
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const copiedFlags = new Set<string>();

/** Copy a recipe's `featured_image` flag SVG into `public/`, deduping across recipes that share one. */
function copyFlag(featuredImage: string | undefined): void {
  if (!featuredImage || copiedFlags.has(featuredImage)) return;
  const relativeSrc = featuredImage.replace(/^\/+/, "");
  const srcFile = join(ASSETS_DIR, relativeSrc);
  const destFile = join(PUBLIC_DIR, relativeSrc);
  mkdirSync(dirname(destFile), { recursive: true });
  copyFileSync(srcFile, destFile);
  copiedFlags.add(featuredImage);
  console.log(`copied ${srcFile} -> ${destFile}`);
}

// ---------------------------------------------------------------------------
// Page builders
// ---------------------------------------------------------------------------

function buildRecipePage(recipe: Recipe): void {
  const viewState: ViewState = {
    servings: recipe.servings,
    activeSubstitutions: [],
    unitSystem: "as-written",
    stepsView: "grouped",
  };
  const vm = present(recipe, viewState);

  const html = render(RecipePage({ vm, recipe, featuredImageSrc: recipe.featured_image }));
  writeHtml(join(PUBLIC_DIR, "recipes", recipe.slug, "index.html"), html);

  // Copy every flag this page's markup can reference: the featured-image
  // flag, plus every tag chip's flag (Layout.tsx renders `TAXONOMY[tag].flag`
  // for each of the recipe's tags, which needn't be the same flag as
  // `featured_image` — e.g. skhug is featured under Yemeni but also tagged
  // Israeli).
  copyFlag(recipe.featured_image);
  for (const tag of recipe.tags) {
    copyFlag(TAXONOMY[tag]?.flag);
  }
}

function byDateDescending(a: Recipe, b: Recipe): number {
  return b.date.getTime() - a.date.getTime();
}

function buildHomePage(recipes: Recipe[]): void {
  const sorted = [...recipes].sort(byDateDescending);
  const html = render(HomePage({ recipes: sorted }));
  writeHtml(join(PUBLIC_DIR, "index.html"), html);
}

function buildTagPages(recipes: Recipe[]): void {
  const recipesByTag = new Map<string, Recipe[]>();
  for (const recipe of recipes) {
    for (const tag of recipe.tags) {
      const bucket = recipesByTag.get(tag);
      if (bucket) {
        bucket.push(recipe);
      } else {
        recipesByTag.set(tag, [recipe]);
      }
    }
  }

  for (const [tag, taggedRecipes] of recipesByTag) {
    const entry = TAXONOMY[tag];
    if (!entry) {
      // parseRecipe already rejects unknown tags, so this would mean the
      // taxonomy table changed out from under an already-validated recipe.
      fail(`build failed — tag "${tag}" is used by a recipe but missing from TAXONOMY`);
    }
    const sorted = [...taggedRecipes].sort(byDateDescending);
    const html = render(TagPage({ tag, entry, recipes: sorted }));
    writeHtml(join(PUBLIC_DIR, "tags", tag, "index.html"), html);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

copyStyles();
copyHeaders();
const recipes = loadAllRecipes();
for (const recipe of recipes) buildRecipePage(recipe);
buildHomePage(recipes);
buildTagPages(recipes);
