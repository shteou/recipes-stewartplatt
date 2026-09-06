import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseRecipe } from "../src/core/schema.js";
import { applySwaps, getActiveSwapMap } from "../src/core/substitutions.js";
import { loadRecipeFile } from "./helpers/loadRecipeFile.js";
import type { Ingredient, Substitution } from "../src/core/schema.js";

const CONTENT_DIR = join(import.meta.dirname, "..", "content", "recipes");

function loadDalTadka() {
  const { raw, sourceLabel } = loadRecipeFile(join(CONTENT_DIR, "mixed-dal-tadka.md"));
  const result = parseRecipe(raw, sourceLabel);
  if (!result.success) throw new Error(result.errors.join("\n"));
  return result.data;
}

const INGREDIENTS: Ingredient[] = [
  { name: "Ghee", quantity: 2, unit: "tbsp" },
  { name: "Flour", quantity: 100, unit: "g" },
];

const SUBSTITUTIONS: Substitution[] = [
  {
    label: "Make this vegan",
    swaps: [{ ingredient: "Ghee", name: "Neutral oil", note: "or vegan butter" }],
  },
];

describe("applySwaps — inactive substitutions", () => {
  it("returns the base ingredients unchanged when no labels are active", () => {
    const result = applySwaps(INGREDIENTS, SUBSTITUTIONS, []);
    expect(result).toEqual(INGREDIENTS);
  });

  it("returns new objects, not references to the originals (pure)", () => {
    const result = applySwaps(INGREDIENTS, SUBSTITUTIONS, []);
    expect(result[0]).not.toBe(INGREDIENTS[0]);
    expect(result[0]).toEqual(INGREDIENTS[0]);
  });
});

describe("applySwaps — active substitutions", () => {
  it("replaces the referenced ingredient's name and carries the note forward", () => {
    const result = applySwaps(INGREDIENTS, SUBSTITUTIONS, ["Make this vegan"]);
    const ghee = result.find((i) => i.name === "Ghee" || i.name === "Neutral oil");
    expect(ghee?.name).toBe("Neutral oil");
    expect(ghee?.note).toBe("or vegan butter");
  });

  it("falls back to the original quantity/unit when the swap doesn't specify its own", () => {
    const result = applySwaps(INGREDIENTS, SUBSTITUTIONS, new Set(["Make this vegan"]));
    const oil = result.find((i) => i.name === "Neutral oil");
    expect(oil?.quantity).toBe(2);
    expect(oil?.unit).toBe("tbsp");
  });

  it("leaves unrelated ingredients untouched", () => {
    const result = applySwaps(INGREDIENTS, SUBSTITUTIONS, ["Make this vegan"]);
    const flour = result.find((i) => i.name === "Flour");
    expect(flour).toEqual({ name: "Flour", quantity: 100, unit: "g" });
  });

  it("accepts activeLabels as either a Set or a string[] with identical results", () => {
    const asArray = applySwaps(INGREDIENTS, SUBSTITUTIONS, ["Make this vegan"]);
    const asSet = applySwaps(INGREDIENTS, SUBSTITUTIONS, new Set(["Make this vegan"]));
    expect(asArray).toEqual(asSet);
  });
});

describe("applySwaps — purity / reproducibility", () => {
  it("produces an identical result every time it's called fresh from the same base state", () => {
    const first = applySwaps(INGREDIENTS, SUBSTITUTIONS, ["Make this vegan"]);
    const second = applySwaps(INGREDIENTS, SUBSTITUTIONS, ["Make this vegan"]);
    expect(second).toEqual(first);
    // And re-deriving with an empty set from the same base ingredients
    // reproduces the un-substituted state exactly — there's no leftover
    // state from the earlier "active" call to revert.
    const reverted = applySwaps(INGREDIENTS, SUBSTITUTIONS, []);
    expect(reverted).toEqual(INGREDIENTS);
  });

  it("never mutates the base ingredients array across repeated calls", () => {
    const before = JSON.parse(JSON.stringify(INGREDIENTS));
    applySwaps(INGREDIENTS, SUBSTITUTIONS, ["Make this vegan"]);
    applySwaps(INGREDIENTS, SUBSTITUTIONS, ["Make this vegan"]);
    expect(INGREDIENTS).toEqual(before);
  });
});

describe("getActiveSwapMap", () => {
  it("only includes swaps from active substitutions", () => {
    const map = getActiveSwapMap(SUBSTITUTIONS, []);
    expect(map.size).toBe(0);
  });

  it("includes swaps from active substitutions, keyed by original ingredient name", () => {
    const map = getActiveSwapMap(SUBSTITUTIONS, ["Make this vegan"]);
    expect(map.get("Ghee")?.name).toBe("Neutral oil");
  });
});

describe("applySwaps — real recipe (mixed-dal-tadka)", () => {
  it("swaps Ghee for Neutral oil when the vegan substitution is active", () => {
    const recipe = loadDalTadka();
    const result = applySwaps(recipe.ingredients, recipe.substitutions ?? [], ["Make this vegan"]);
    expect(result.some((i) => i.name === "Ghee")).toBe(false);
    expect(result.some((i) => i.name === "Neutral oil")).toBe(true);
  });

  it("keeps Ghee when the substitution is not active", () => {
    const recipe = loadDalTadka();
    const result = applySwaps(recipe.ingredients, recipe.substitutions ?? [], []);
    expect(result.some((i) => i.name === "Ghee")).toBe(true);
  });
});
