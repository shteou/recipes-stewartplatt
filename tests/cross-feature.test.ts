/**
 * Cross-feature regression lock for the 4 real, live bugs the old Hugo-era
 * site had (see the stage brief / top of DESIGN.md's bug table) — each
 * caused by "the DOM is the state" architecture, each fixed *by construction*
 * by this rebuild's `present()`-based single-composition-point architecture.
 * This file exists so none of the 4 can silently regress:
 *
 *   1. Unit conversion not applying to `{{Ingredient}}` tokens in Kitchen mode.
 *   2. Substitutions not propagating into step tokens.
 *   3. `{{...}}` tokens rendering literally (unresolved) in Grouped/Timeline/Mise.
 *   4. Mise-en-place and Kitchen ignoring servings scaling + substitutions.
 *
 * These are explicit `expect(...).toBe(...)`/`toContain`/`not.toContain`
 * assertions, not snapshots — a snapshot would silently "bless" a regression
 * as the new normal; these assertions are the actual lock.
 */

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { render } from "preact-render-to-string";
import { parseRecipe, type Recipe } from "../src/core/schema.js";
import { present, type ViewState } from "../src/core/present.js";
import { loadRecipeFile } from "./helpers/loadRecipeFile.js";
import { scaleFactor } from "../src/core/scale.js";
import { convert } from "../src/core/units.js";
import { formatDecimal, formatQuantity } from "../src/core/quantity.js";
import { IngredientList } from "../src/view/IngredientList.js";
import { StepsGrouped } from "../src/view/StepsGrouped.js";
import { StepsTimeline } from "../src/view/StepsTimeline.js";
import { StepsMise } from "../src/view/StepsMise.js";
import { StepsKitchen } from "../src/view/StepsKitchen.js";

const CONTENT_DIR = join(import.meta.dirname, "..", "content", "recipes");

function loadReal(filename: string): Recipe {
  const { raw, sourceLabel } = loadRecipeFile(join(CONTENT_DIR, filename));
  const result = parseRecipe(raw, sourceLabel);
  if (!result.success) throw new Error(result.errors.join("\n"));
  return result.data;
}

/** A literal, unresolved `{{...}}` token — must never survive into rendered HTML. */
const UNRESOLVED_TOKEN = /\{\{[^}]*\}\}/;

// ---------------------------------------------------------------------------
// mixed-dal-tadka: vegan substitution + metric units + 8 servings, all at once
// ---------------------------------------------------------------------------

describe("cross-feature regression: mixed-dal-tadka, vegan sub + metric + 8 servings", () => {
  const dal = loadReal("mixed-dal-tadka.md");

  const defaultState: ViewState = {
    servings: dal.servings,
    activeSubstitutions: [],
    unitSystem: "as-written",
    stepsView: "grouped",
  };
  const crossFeatureState: ViewState = {
    servings: 8,
    activeSubstitutions: ["Make this vegan"],
    unitSystem: "metric",
    stepsView: "grouped",
  };

  const vmDefault = present(dal, defaultState);
  const vm = present(dal, crossFeatureState);

  // The Ghee ingredient row, post-substitution (renamed to "Neutral oil"),
  // post-8-servings-scaling, post-metric-conversion.
  const oil = vm.ingredients.find((i) => i.name === "Neutral oil");

  // Independently-derived expectation: raw base Ghee quantity (2 tbsp at 4
  // base servings) scaled to 8 servings, then converted to metric — computed
  // straight from `scale.ts`/`units.ts`/`quantity.ts`, *not* read back off
  // `present()`'s own output, so this can't tautologically pass just because
  // `present()` and this test happen to share a bug.
  const rawGhee = dal.ingredients.find((i) => i.name === "Ghee")!;
  const factor = scaleFactor(dal, 8);
  const scaledQuantity = rawGhee.quantity! * factor;
  const converted = convert(scaledQuantity, rawGhee.unit, "metric");
  if (!converted) throw new Error("expected Ghee's tbsp unit to be convertible to metric");
  const expectedDisplay = formatDecimal(converted.quantity);
  const expectedSubstring = `${expectedDisplay} ${converted.unit}`;

  it("sanity: the substitution actually fired and the ingredient list agrees with the independently-derived formula", () => {
    expect(oil).toBeDefined();
    expect(oil?.substituted).toBe(true);
    expect(vm.ingredients.some((i) => i.name === "Ghee")).toBe(false);
    expect(oil?.unit).toBe(converted.unit);
    expect(oil?.displayQuantity).toBe(expectedDisplay);
  });

  it("(bugs 1+2) the ingredient list and every steps-view's interpolated {{Ghee}} token show the exact same quantity+unit substring, and the substituted display name propagates into prose", () => {
    // Every steps view now references {{Ghee}} in this recipe — Kitchen's
    // `short` (as before), and Grouped/Timeline/Mise's `text` too, since the
    // Tadka step's `text` field was given matching {{Ghee}}/{{Ghee:name}}
    // tokens alongside `short`'s.
    const gheeStepIndex = vm.activeSteps.findIndex((s) => s.short?.includes("Bloom cumin"));
    expect(gheeStepIndex).toBeGreaterThanOrEqual(0);

    const groupedHtml = render(StepsGrouped({ vm }));
    const timelineHtml = render(StepsTimeline({ vm }));
    const miseHtml = render(StepsMise({ vm }));
    const checklistHtml = render(StepsKitchen({ vm, submode: "checklist" }));
    const singleHtml = render(StepsKitchen({ vm, submode: "single", currentIndex: gheeStepIndex }));
    const allViews = [groupedHtml, timelineHtml, miseHtml, checklistHtml, singleHtml];

    for (const html of allViews) {
      expect(html).toContain(expectedSubstring);
    }
    // And it must match the ingredients-list row byte-for-byte, not just
    // independently happen to be numerically close.
    expect(checklistHtml).toContain(`${oil?.displayQuantity} ${oil?.unit}`);

    // (Task 5 fix) the substituted ingredient's *live* name now correctly
    // propagates into the surrounding prose in every view that renders this
    // step, via the {{Ghee:name}} token — "Neutral oil" appears, and the
    // literal word "ghee"/"Ghee" does not (these renders are of the bare
    // components, not the full page, so there's no #recipe-data JSON payload
    // here to carve out an exception for).
    for (const html of allViews) {
      expect(html).toContain("Neutral oil");
      expect(html).not.toMatch(/ghee/i);
    }
  });

  it("(bug 3) no steps-view ever renders a literal unresolved {{...}} token — default state", () => {
    expect(render(StepsGrouped({ vm: vmDefault }))).not.toMatch(UNRESOLVED_TOKEN);
    expect(render(StepsTimeline({ vm: vmDefault }))).not.toMatch(UNRESOLVED_TOKEN);
    expect(render(StepsMise({ vm: vmDefault }))).not.toMatch(UNRESOLVED_TOKEN);
    expect(render(StepsKitchen({ vm: vmDefault, submode: "checklist" }))).not.toMatch(UNRESOLVED_TOKEN);
    expect(render(StepsKitchen({ vm: vmDefault, submode: "single" }))).not.toMatch(UNRESOLVED_TOKEN);
  });

  it("(bug 3) no steps-view ever renders a literal unresolved {{...}} token — vegan/metric/8-servings state", () => {
    expect(render(StepsGrouped({ vm }))).not.toMatch(UNRESOLVED_TOKEN);
    expect(render(StepsTimeline({ vm }))).not.toMatch(UNRESOLVED_TOKEN);
    expect(render(StepsMise({ vm }))).not.toMatch(UNRESOLVED_TOKEN);
    expect(render(StepsKitchen({ vm, submode: "checklist" }))).not.toMatch(UNRESOLVED_TOKEN);
    expect(render(StepsKitchen({ vm, submode: "single" }))).not.toMatch(UNRESOLVED_TOKEN);
  });

  it("(bug 4) Mise's prep checklist reflects the scaled+substituted+converted quantity, not the recipe's base/default value", () => {
    const miseHtml = render(StepsMise({ vm }));
    const miseHtmlDefault = render(StepsMise({ vm: vmDefault }));

    // The formula-derived value (independent of present()'s own computation) shows up.
    expect(miseHtml).toContain(expectedSubstring);
    // The substituted ingredient's name shows up too (bug 2's exact locus) —
    // rendered as a full ingredient-list-style line, not merely present().
    expect(miseHtml).toContain(`${expectedSubstring} Neutral oil`);

    // And the base/default rendering must show the base value + name, not
    // the scaled one — proving these two states genuinely differ (bug 4
    // wasn't "always shows some hardcoded scaled value").
    const gheeDefault = vmDefault.ingredients.find((i) => i.name === "Ghee");
    expect(gheeDefault?.substituted).toBe(false);
    const defaultGheeSubstring = `${gheeDefault?.displayQuantity} ${gheeDefault?.unit} Ghee`;
    expect(miseHtmlDefault).toContain(defaultGheeSubstring);
    expect(miseHtmlDefault).not.toContain(expectedSubstring);
    expect(miseHtml).not.toContain(defaultGheeSubstring);
  });

  it("(bug 4) Kitchen mode's step list reflects the scaled+substituted+converted quantity, not the recipe's base/default value", () => {
    const gheeStepIndex = vm.activeSteps.findIndex((s) => s.short?.includes("Bloom cumin"));
    const kitchenHtml = render(StepsKitchen({ vm, submode: "checklist" }));
    const kitchenHtmlDefault = render(StepsKitchen({ vm: vmDefault, submode: "checklist" }));

    expect(kitchenHtml).toContain(expectedSubstring);

    const gheeDefault = vmDefault.ingredients.find((i) => i.name === "Ghee");
    const defaultSubstring = `${gheeDefault?.displayQuantity} ${gheeDefault?.unit}`;
    expect(kitchenHtmlDefault).toContain(defaultSubstring);
    expect(kitchenHtml).not.toContain(defaultSubstring);
    expect(gheeStepIndex).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Synthetic fixture: a token embedded directly in a step's `text` field
// (not just `short`) — none of the 3 real recipes' `text` fields contain a
// `{{token}}` at all (only `short` does), so this is the only way to
// exercise bug 3's *exact* original locus ("Grouped/Timeline/Mise only ever
// printed raw `text`") against Grouped/Timeline/Mise specifically, combined
// with a substitution + non-default servings + metric conversion all firing
// at once.
// ---------------------------------------------------------------------------

describe("cross-feature regression: synthetic recipe, token in step.text + substitution + scaling + metric", () => {
  function makeRecipe(): Recipe {
    const raw = {
      title: "Cross-Feature Synthetic Recipe",
      summary: "Only used to exercise a {{token}} inside step.text across every steps view",
      date: "2024-01-01",
      time_minutes: 10,
      tags: ["italian"],
      servings: 2,
      ingredients: [
        { name: "Stock", quantity: 4, unit: "tbsp" },
        { name: "Butter", quantity: 2, unit: "tbsp" },
      ],
      substitutions: [
        {
          label: "Make it vegan",
          swaps: [{ ingredient: "Butter", name: "Margarine", note: "vegan" }],
        },
      ],
      steps: [
        {
          group: "Cook",
          time: 5,
          text: "Add the {{Stock}} and {{Butter}} to the pan.",
          short: "Combine {{Stock}} + {{Butter}}",
        },
      ],
    };
    const result = parseRecipe(raw, "synthetic-cross-feature.md");
    if (!result.success) throw new Error(result.errors.join("\n"));
    return result.data;
  }

  const recipe = makeRecipe();
  const defaultState: ViewState = {
    servings: recipe.servings,
    activeSubstitutions: [],
    unitSystem: "as-written",
    stepsView: "grouped",
  };
  const crossFeatureState: ViewState = {
    servings: 6, // factor of 3 over the base 2
    activeSubstitutions: ["Make it vegan"],
    unitSystem: "metric",
    stepsView: "grouped",
  };

  const vmDefault = present(recipe, defaultState);
  const vm = present(recipe, crossFeatureState);

  // Independently-derived expectations (scale.ts + units.ts + quantity.ts),
  // not read back off present()'s own output.
  const factor = scaleFactor(recipe, 6);
  const stockConverted = convert(4 * factor, "tbsp", "metric")!;
  const butterConverted = convert(2 * factor, "tbsp", "metric")!;
  const stockSubstring = `${formatDecimal(stockConverted.quantity)} ${stockConverted.unit}`;
  const butterSubstring = `${formatDecimal(butterConverted.quantity)} ${butterConverted.unit}`;

  it("sanity: present() itself agrees with the independently-derived formula", () => {
    const stock = vm.ingredients.find((i) => i.name === "Stock");
    const margarine = vm.ingredients.find((i) => i.name === "Margarine");
    expect(margarine).toBeDefined();
    expect(margarine?.substituted).toBe(true);
    expect(`${stock?.displayQuantity} ${stock?.unit}`).toBe(stockSubstring);
    expect(`${margarine?.displayQuantity} ${margarine?.unit}`).toBe(butterSubstring);
  });

  it("(bugs 1+2+3) Grouped, Timeline and Mise all interpolate the step.text token — scaled, substituted, converted, no literal braces", () => {
    const groupedHtml = render(StepsGrouped({ vm }));
    const timelineHtml = render(StepsTimeline({ vm }));
    const miseHtml = render(StepsMise({ vm }));

    for (const html of [groupedHtml, timelineHtml, miseHtml]) {
      expect(html).not.toMatch(UNRESOLVED_TOKEN);
      expect(html).toContain(stockSubstring);
      expect(html).toContain(butterSubstring);
    }
  });

  it("(bugs 1+2+3) Kitchen mode (both sub-views) interpolates the step.short token the same way", () => {
    const checklistHtml = render(StepsKitchen({ vm, submode: "checklist" }));
    const singleHtml = render(StepsKitchen({ vm, submode: "single", currentIndex: 0 }));

    for (const html of [checklistHtml, singleHtml]) {
      expect(html).not.toMatch(UNRESOLVED_TOKEN);
      expect(html).toContain(stockSubstring);
      expect(html).toContain(butterSubstring);
    }
  });

  it("the default (base servings, no substitution, as-written) state renders different values with no leaked tokens either", () => {
    const groupedHtml = render(StepsGrouped({ vm: vmDefault }));
    expect(groupedHtml).not.toMatch(UNRESOLVED_TOKEN);
    expect(groupedHtml).toContain("4 tbsp");
    expect(groupedHtml).toContain("2 tbsp");
    // Proves the cross-feature state isn't coincidentally rendering the same text.
    expect(groupedHtml).not.toContain(stockSubstring);
    expect(groupedHtml).not.toContain(butterSubstring);
  });

  it("formatQuantity is imported and used correctly for the default (as-written) case — no accidental decimal formatting", () => {
    const stockDefault = vmDefault.ingredients.find((i) => i.name === "Stock");
    expect(stockDefault?.displayQuantity).toBe(formatQuantity(4));
  });
});
