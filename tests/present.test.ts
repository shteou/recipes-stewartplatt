import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseRecipe } from "../src/core/schema.js";
import { present, type ViewState } from "../src/core/present.js";
import { loadRecipeFile } from "./helpers/loadRecipeFile.js";
import type { Recipe } from "../src/core/schema.js";

const CONTENT_DIR = join(import.meta.dirname, "..", "content", "recipes");
const REAL_RECIPE_FILES = ["marsala.md", "mixed-dal-tadka.md", "skhug.md"];

function loadReal(filename: string): Recipe {
  const { raw, sourceLabel } = loadRecipeFile(join(CONTENT_DIR, filename));
  const result = parseRecipe(raw, sourceLabel);
  if (!result.success) throw new Error(result.errors.join("\n"));
  return result.data;
}

const baseViewState = (recipe: Recipe): ViewState => ({
  servings: recipe.servings,
  activeSubstitutions: [],
  unitSystem: "as-written",
  stepsView: "grouped",
});

describe("present — round-trips every real recipe without throwing", () => {
  const nonDefaultStates: Record<string, ViewState> = {
    "marsala.md": {
      servings: 8, // double the base 4
      activeSubstitutions: [],
      unitSystem: "metric",
      stepsView: "timeline",
    },
    "mixed-dal-tadka.md": {
      servings: 6,
      activeSubstitutions: ["Make this vegan"],
      unitSystem: "imperial",
      stepsView: "kitchen",
    },
    "skhug.md": {
      servings: 2.5,
      activeSubstitutions: [],
      unitSystem: "metric",
      stepsView: "mise",
    },
  };

  for (const filename of REAL_RECIPE_FILES) {
    it(`presents ${filename} with a non-default ViewState`, () => {
      const recipe = loadReal(filename);
      expect(() => present(recipe, nonDefaultStates[filename])).not.toThrow();
      const vm = present(recipe, nonDefaultStates[filename]);
      expect(vm.ingredients.length).toBe(recipe.ingredients.length);
      expect(vm.slug).toBe(recipe.slug);
    });
  }
});

describe("present — mixed-dal-tadka with the vegan substitution active", () => {
  it("resolves Ghee to Neutral oil in the ingredients list and marks it substituted", () => {
    const recipe = loadReal("mixed-dal-tadka.md");
    const vm = present(recipe, {
      ...baseViewState(recipe),
      activeSubstitutions: ["Make this vegan"],
    });

    const oil = vm.ingredients.find((i) => i.name === "Neutral oil");
    expect(oil).toBeDefined();
    expect(oil?.substituted).toBe(true);
    expect(vm.ingredients.some((i) => i.name === "Ghee")).toBe(false);
  });

  it("resolves the {{Ghee}} token's quantity the same way regardless of substitution, and {{Ghee:name}} updates to the substituted display name", () => {
    const recipe = loadReal("mixed-dal-tadka.md");
    const withSub = present(recipe, {
      ...baseViewState(recipe),
      activeSubstitutions: ["Make this vegan"],
    });
    const withoutSub = present(recipe, baseViewState(recipe));

    const tadkaStepWith = withSub.steps.find((s) => s.short?.includes("Bloom cumin"));
    const tadkaStepWithout = withoutSub.steps.find((s) => s.short?.includes("Bloom cumin"));
    expect(tadkaStepWith?.short).toBeDefined();
    // The quantity token resolves to the same quantity either way (no
    // quantity/unit override in this recipe's swap) — it must not become a
    // dangling/unresolved `{{Ghee}}` just because the ingredient row's
    // display name changed to "Neutral oil".
    expect(tadkaStepWith?.short).toContain("2 tbsp");
    expect(tadkaStepWith?.short).not.toContain("{{");
    // The {{Ghee:name}} token, however, *does* correctly change: "Neutral
    // oil" when substituted, "Ghee" when not — this is the fix for the bug
    // where the literal word "ghee" stayed hardcoded in prose regardless of
    // an active substitution.
    expect(tadkaStepWith?.short).toContain("Neutral oil");
    expect(tadkaStepWith?.short).not.toContain("Ghee");
    expect(tadkaStepWithout?.short).toContain("Ghee");
    expect(tadkaStepWithout?.short).not.toContain("Neutral oil");
  });

  it("leaves Ghee in the ingredients list when the substitution is inactive", () => {
    const recipe = loadReal("mixed-dal-tadka.md");
    const vm = present(recipe, baseViewState(recipe));
    expect(vm.ingredients.some((i) => i.name === "Ghee")).toBe(true);
    expect(vm.ingredients.find((i) => i.name === "Ghee")?.substituted).toBe(false);
  });
});

describe("present — a substitution that overrides quantity/unit propagates into step tokens", () => {
  function makeSyntheticRecipe(): Recipe {
    const raw = {
      title: "Synthetic Test Recipe",
      summary: "Only used to exercise quantity/unit-overriding substitutions",
      date: "2024-01-01",
      time_minutes: 10,
      tags: ["italian"],
      servings: 2,
      ingredients: [{ name: "Ghee", quantity: 2, unit: "tbsp" }],
      substitutions: [
        {
          label: "Make it oily",
          swaps: [{ ingredient: "Ghee", name: "Oil", quantity: 30, unit: "ml" }],
        },
      ],
      steps: [
        {
          group: "Cook",
          time: 5,
          text: "Heat the {{Ghee}} in a pan.",
        },
      ],
    };
    const result = parseRecipe(raw, "synthetic.md");
    if (!result.success) throw new Error(result.errors.join("\n"));
    return result.data;
  }

  it("uses the override quantity/unit in the token once the substitution is active", () => {
    const recipe = makeSyntheticRecipe();
    const vm = present(recipe, {
      servings: 2,
      activeSubstitutions: ["Make it oily"],
      unitSystem: "as-written",
      stepsView: "grouped",
    });
    expect(vm.steps[0].text).toContain("30 ml");
    expect(vm.steps[0].text).not.toContain("2 tbsp");
  });

  it("uses the original quantity/unit in the token when the substitution is inactive", () => {
    const recipe = makeSyntheticRecipe();
    const vm = present(recipe, {
      servings: 2,
      activeSubstitutions: [],
      unitSystem: "as-written",
      stepsView: "grouped",
    });
    expect(vm.steps[0].text).toContain("2 tbsp");
  });
});

describe("present — skhug at a fractional serving count", () => {
  it("scales the jar count and pluralizes serving_unit correctly at 2.5", () => {
    const recipe = loadReal("skhug.md");
    const vm = present(recipe, { ...baseViewState(recipe), servings: 2.5 });

    expect(vm.servingsDisplay).toBe("2 ½");
    expect(vm.servingUnitDisplay).toBe("jars");

    const chillis = vm.ingredients.find((i) => i.name === "Mild-medium fruity chillis");
    expect(chillis?.quantity).toBeCloseTo(300 * 2.5, 5);
  });

  it("keeps the singular serving_unit at the base 1 serving", () => {
    const recipe = loadReal("skhug.md");
    const vm = present(recipe, baseViewState(recipe));
    expect(vm.servingUnitDisplay).toBe("jar");
  });

  it("interpolates step tokens against the scaled quantities", () => {
    const recipe = loadReal("skhug.md");
    const vm = present(recipe, { ...baseViewState(recipe), servings: 2 });
    const cuminStep = vm.steps.find((s) => s.short?.includes("cumin") && s.group === "Blend");
    // Cumin is 2 tsp at base servings of 1; at servings 2, factor is 2 -> 4 tsp.
    expect(cuminStep?.short).toContain("4 tsp");
  });
});

describe("present — unit conversion flows through to the ingredient list", () => {
  it("converts a metric-unit ingredient to imperial when requested", () => {
    const recipe = loadReal("skhug.md");
    const vm = present(recipe, { ...baseViewState(recipe), unitSystem: "imperial" });
    const chillis = vm.ingredients.find((i) => i.name === "Mild-medium fruity chillis");
    // 300 g -> imperial: 300 >= 226.796 g (0.5 lb) so this should pick lb.
    expect(chillis?.unit).toBe("lb");
  });

  it("leaves an unconvertible-unit ingredient (no unit) as-is under any unit system", () => {
    const recipe = loadReal("skhug.md");
    const vm = present(recipe, { ...baseViewState(recipe), unitSystem: "metric" });
    const garlic = vm.ingredients.find((i) => i.name === "Garlic cloves");
    expect(garlic?.unit).toBeUndefined();
    expect(garlic?.quantity).toBe(9);
  });

  it("keeps the as-written unit when unitSystem is 'as-written'", () => {
    const recipe = loadReal("skhug.md");
    const vm = present(recipe, { ...baseViewState(recipe), unitSystem: "as-written" });
    const chillis = vm.ingredients.find((i) => i.name === "Mild-medium fruity chillis");
    expect(chillis?.unit).toBe("g");
    expect(chillis?.quantity).toBe(300);
  });
});

describe("present — metric mode: ingredients list and step tokens agree exactly (regression)", () => {
  it("mixed-dal-tadka's Ghee shows the byte-identical quantity+unit text in the ingredients list and in its step token", () => {
    const recipe = loadReal("mixed-dal-tadka.md");
    const vm = present(recipe, { ...baseViewState(recipe), unitSystem: "metric" });

    const ghee = vm.ingredients.find((i) => i.name === "Ghee");
    expect(ghee).toBeDefined();
    expect(ghee?.unit).toBe("ml");
    // Metric conversion of 2 tbsp lands on a value ("35.5") that
    // formatQuantity's fraction-glyph logic would render as "35 ½" instead —
    // exactly the divergence this fix closes.
    const listQuantityUnit = `${ghee?.displayQuantity} ${ghee?.unit}`;

    const tadkaStep = vm.steps.find((s) => s.short?.includes("Bloom cumin"));
    expect(tadkaStep?.short).toBeDefined();
    expect(tadkaStep?.short).toContain(listQuantityUnit);
    // Assert the actual convention too, not just "they match each other" —
    // guards against both sides silently agreeing on the wrong (fraction)
    // convention.
    expect(listQuantityUnit).not.toMatch(/[¼½¾⅓⅔⅛⅜⅝⅞]/);
  });

  it("a {{Name * 0.5}} multiplier token under metric uses decimal-style formatting, matching the ingredients-list convention", () => {
    const recipe = loadReal("mixed-dal-tadka.md");
    const vm = present(recipe, { ...baseViewState(recipe), unitSystem: "metric" });

    const salt = vm.ingredients.find((i) => i.name === "Salt");
    expect(salt).toBeDefined();
    expect(salt?.displayQuantity).not.toMatch(/[¼½¾⅓⅔⅛⅜⅝⅞]/);

    const saltStep = vm.steps.find((s) => s.short?.includes("remaining salt"));
    expect(saltStep?.short).toBeDefined();
    // The multiplied ("Salt * 0.5") token must not fall back to a fraction
    // glyph just because it went through a different (multiplier) code path.
    expect(saltStep?.short).not.toMatch(/[¼½¾⅓⅔⅛⅜⅝⅞]/);
  });
});

describe("present — group ordering and accents", () => {
  it("orders marsala's groups by first appearance and assigns a stable accent", () => {
    const recipe = loadReal("marsala.md");
    const vm = present(recipe, baseViewState(recipe));
    expect(vm.groupOrder).toEqual(["Prep", "Sear", "Sauce"]);
    expect(vm.steps[0].accent).toBeDefined();
  });

  it("excludes idle steps from activeSteps but keeps them in steps", () => {
    const recipe = loadReal("marsala.md");
    const vm = present(recipe, baseViewState(recipe));
    expect(vm.steps.some((s) => s.idle)).toBe(true);
    expect(vm.activeSteps.some((s) => s.idle)).toBe(false);
    expect(vm.activeSteps.length).toBeLessThan(vm.steps.length);
  });
});
