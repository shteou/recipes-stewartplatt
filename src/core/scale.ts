/**
 * Servings scaling: multiply every ingredient quantity by
 * `targetServings / recipe.servings`. Unit is left untouched — unit
 * conversion is a separate, composable concern (`units.ts`).
 *
 * Supports fractional targets (e.g. `skhug`'s `serving_step: 0.5`, scaling
 * from a base of 1 serving up to 2.5) — this module doesn't enforce step
 * granularity itself, that's a later stepper-widget concern; any finite
 * numeric target is accepted as-is.
 */

import type { Ingredient, Recipe } from "./schema.js";

/** `targetServings / recipe.servings` — the multiplier applied to every ingredient quantity. */
export function scaleFactor(recipe: Recipe, targetServings: number): number {
  return targetServings / recipe.servings;
}

/**
 * Scale `recipe.ingredients` to `targetServings`. Ingredients with no
 * `quantity` (e.g. "Extra Virgin Olive Oil", "Salt & Pepper") are returned
 * unchanged — there's nothing to scale.
 */
export function scaleIngredients(recipe: Recipe, targetServings: number): Ingredient[] {
  const factor = scaleFactor(recipe, targetServings);
  return recipe.ingredients.map((ingredient) =>
    ingredient.quantity == null
      ? { ...ingredient }
      : { ...ingredient, quantity: ingredient.quantity * factor },
  );
}
