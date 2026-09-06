/**
 * Snapshot regression net for every view component and page shell.
 *
 * One representative snapshot per component/view, rendered via
 * `preact-render-to-string` (the same rendering path `build/index.ts` uses)
 * against a real `present()`-produced view model / real recipe data — no
 * synthetic fixtures here, per this stage's brief ("real content is more
 * valuable here"). These are plain `toMatchSnapshot()` checks: they catch
 * "the markup changed" but intentionally don't assert *why* it's correct —
 * see `tests/cross-feature.test.ts` for the explicit correctness assertions
 * that are the actual regression lock for the 4 old Hugo-era bugs.
 *
 * `mixed-dal-tadka` is used as the representative fixture for the
 * per-component snapshots (IngredientList / StepsGrouped / StepsTimeline /
 * StepsMise / StepsKitchen, and the RecipePage shell): it's the richest of
 * the 3 real recipes (substitutions, idle steps, multiple step groups,
 * a featured image), so its snapshot is the most likely to catch an
 * accidental regression in any of those features' markup.
 */

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { render } from "preact-render-to-string";
import { parseRecipe, type Recipe } from "../src/core/schema.js";
import { present, type ViewState } from "../src/core/present.js";
import { loadRecipeFile } from "./helpers/loadRecipeFile.js";
import { IngredientList } from "../src/view/IngredientList.js";
import { StepsGrouped } from "../src/view/StepsGrouped.js";
import { StepsTimeline } from "../src/view/StepsTimeline.js";
import { StepsMise } from "../src/view/StepsMise.js";
import { StepsKitchen } from "../src/view/StepsKitchen.js";
import { RecipePage } from "../src/view/Layout.js";
import { HomePage } from "../src/view/HomePage.js";
import { TagPage } from "../src/view/TagPage.js";
import { TAXONOMY } from "../src/core/taxonomy.js";

const CONTENT_DIR = join(import.meta.dirname, "..", "content", "recipes");

function loadReal(filename: string): Recipe {
  const { raw, sourceLabel } = loadRecipeFile(join(CONTENT_DIR, filename));
  const result = parseRecipe(raw, sourceLabel);
  if (!result.success) throw new Error(result.errors.join("\n"));
  return result.data;
}

/** Mirrors `build/index.ts`'s default per-recipe `ViewState` exactly. */
function defaultViewState(recipe: Recipe): ViewState {
  return {
    servings: recipe.servings,
    activeSubstitutions: [],
    unitSystem: "as-written",
    stepsView: "grouped",
  };
}

const marsala = loadReal("marsala.md");
const dal = loadReal("mixed-dal-tadka.md");
const skhug = loadReal("skhug.md");

const dalVm = present(dal, defaultViewState(dal));

describe("view component snapshots (mixed-dal-tadka, default view state)", () => {
  it("IngredientList", () => {
    const html = render(IngredientList({ ingredients: dalVm.ingredients }));
    expect(html).toMatchSnapshot();
  });

  it("StepsGrouped", () => {
    const html = render(StepsGrouped({ vm: dalVm }));
    expect(html).toMatchSnapshot();
  });

  it("StepsTimeline", () => {
    const html = render(StepsTimeline({ vm: dalVm }));
    expect(html).toMatchSnapshot();
  });

  it("StepsMise", () => {
    const html = render(StepsMise({ vm: dalVm }));
    expect(html).toMatchSnapshot();
  });

  it("StepsKitchen — checklist sub-view", () => {
    const html = render(StepsKitchen({ vm: dalVm, submode: "checklist" }));
    expect(html).toMatchSnapshot();
  });

  it("StepsKitchen — single (\"one at a time\") sub-view", () => {
    const html = render(StepsKitchen({ vm: dalVm, submode: "single", currentIndex: 0 }));
    expect(html).toMatchSnapshot();
  });
});

describe("page shell snapshots", () => {
  it("RecipePage (mixed-dal-tadka)", () => {
    const html = render(RecipePage({ vm: dalVm, recipe: dal, featuredImageSrc: dal.featured_image }));
    expect(html).toMatchSnapshot();
  });

  it("HomePage (all 3 real recipes, newest-first)", () => {
    const sorted = [marsala, dal, skhug].sort((a, b) => b.date.getTime() - a.date.getTime());
    const html = render(HomePage({ recipes: sorted }));
    expect(html).toMatchSnapshot();
  });

  it("TagPage (\"vegetarian\" — matches both mixed-dal-tadka and skhug)", () => {
    const tag = "vegetarian";
    const recipes = [dal, skhug].sort((a, b) => b.date.getTime() - a.date.getTime());
    const html = render(TagPage({ tag, entry: TAXONOMY[tag], recipes }));
    expect(html).toMatchSnapshot();
  });

  it("RecipePage renders a non-empty recipe.body as HTML (not literal markdown)", () => {
    const html = render(RecipePage({ vm: dalVm, recipe: dal, featuredImageSrc: dal.featured_image }));
    const notesMatch = html.match(/<section aria-label="Notes" class="recipe-notes">([\s\S]*?)<\/section>/);
    expect(notesMatch).not.toBeNull();
    const notesHtml = notesMatch![1];
    expect(notesHtml).toContain("<h2>Serving suggestions</h2>");
    expect(notesHtml).not.toContain("##");
  });

  it("RecipePage omits the Notes section entirely when recipe.body is empty", () => {
    const bodyless: Recipe = { ...dal, body: "" };
    const html = render(RecipePage({ vm: dalVm, recipe: bodyless, featuredImageSrc: bodyless.featured_image }));
    expect(html).not.toContain('aria-label="Notes"');
  });
});
