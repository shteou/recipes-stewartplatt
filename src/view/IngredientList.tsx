/**
 * Renders `RecipeViewModel.ingredients` as a semantic list. Each ingredient's
 * `.display` string is already fully assembled by `present()` (quantity +
 * unit + name + note/optional annotation) — this component just lays it out,
 * it doesn't reassemble any of those pieces itself.
 */

import type { ResolvedIngredient } from "../core/present.js";

export interface IngredientListProps {
  ingredients: ResolvedIngredient[];
}

export function IngredientList({ ingredients }: IngredientListProps) {
  return (
    <ul class="ingredient-list">
      {ingredients.map((ingredient) => (
        <li key={ingredient.name} class={ingredient.substituted ? "substituted" : undefined}>
          {ingredient.display}
        </li>
      ))}
    </ul>
  );
}
