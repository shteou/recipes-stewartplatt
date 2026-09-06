import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseRecipe } from "../src/core/schema.js";
import { scaleFactor, scaleIngredients } from "../src/core/scale.js";
import { loadRecipeFile } from "./helpers/loadRecipeFile.js";

const CONTENT_DIR = join(import.meta.dirname, "..", "content", "recipes");

function loadReal(filename: string) {
  const { raw, sourceLabel } = loadRecipeFile(join(CONTENT_DIR, filename));
  const result = parseRecipe(raw, sourceLabel);
  if (!result.success) throw new Error(result.errors.join("\n"));
  return result.data;
}

describe("scaleFactor", () => {
  it("is 1 when target equals base servings", () => {
    const marsala = loadReal("marsala.md");
    expect(scaleFactor(marsala, marsala.servings)).toBe(1);
  });

  it("halves quantities at half the base servings", () => {
    const marsala = loadReal("marsala.md");
    expect(scaleFactor(marsala, marsala.servings / 2)).toBe(0.5);
  });
});

describe("scaleIngredients", () => {
  it("multiplies every quantity by the factor, leaving unit unchanged", () => {
    const marsala = loadReal("marsala.md");
    const scaled = scaleIngredients(marsala, marsala.servings * 2);
    const wine = scaled.find((i) => i.name === "Marsala Wine");
    expect(wine?.quantity).toBe(8);
    expect(wine?.unit).toBe("oz");
  });

  it("leaves ingredients with no quantity untouched", () => {
    const skhug = loadReal("skhug.md");
    const scaled = scaleIngredients(skhug, 3);
    const oil = scaled.find((i) => i.name === "Extra Virgin Olive Oil");
    expect(oil?.quantity).toBeUndefined();
  });

  it("scales skhug (base 1, serving_step 0.5) to a fractional target of 2.5", () => {
    const skhug = loadReal("skhug.md");
    expect(skhug.servings).toBe(1);
    expect(skhug.serving_step).toBe(0.5);

    const factor = scaleFactor(skhug, 2.5);
    expect(factor).toBe(2.5);

    const scaled = scaleIngredients(skhug, 2.5);
    const chillis = scaled.find((i) => i.name === "Mild-medium fruity chillis");
    expect(chillis?.quantity).toBeCloseTo(300 * 2.5, 5);

    const garlic = scaled.find((i) => i.name === "Garlic cloves");
    expect(garlic?.quantity).toBeCloseTo(9 * 2.5, 5);
  });

  it("does not mutate the original recipe's ingredients", () => {
    const marsala = loadReal("marsala.md");
    const before = marsala.ingredients.map((i) => i.quantity);
    scaleIngredients(marsala, marsala.servings * 3);
    const after = marsala.ingredients.map((i) => i.quantity);
    expect(after).toEqual(before);
  });
});
