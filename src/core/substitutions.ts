/**
 * Substitution swaps — pure computation from the base ingredient list, the
 * recipe's declared substitutions, and which labels are currently "active".
 *
 * No capture/revert/undo state (unlike the old Hugo-era `substitutions.js`,
 * which stashed originals in `data-orig-*` DOM attributes so it could revert
 * them — see `tools/recipe-book-history.bundle`). Every call here is a fresh
 * computation from `ingredients`, because a later stage re-renders from
 * scratch on every state change; "reverting" a swap is just calling this
 * again with a smaller `activeLabels` set.
 */

import type { Ingredient, Substitution, Swap } from "./schema.js";

function toActiveSet(activeLabels: Set<string> | string[]): Set<string> {
  return activeLabels instanceof Set ? activeLabels : new Set(activeLabels);
}

/**
 * Build a map of `Ingredient.name -> Swap` for every swap whose parent
 * substitution's `label` is in `activeLabels`. Exposed separately from
 * `applySwaps` so callers (e.g. `present.ts`) can also ask "was this
 * ingredient substituted?" without re-deriving the same lookup.
 *
 * If two *active* substitutions both swap the same ingredient, the later
 * substitution in `substitutions` wins (last-write, matching array order).
 */
export function getActiveSwapMap(
  substitutions: Substitution[] = [],
  activeLabels: Set<string> | string[] = [],
): Map<string, Swap> {
  const active = toActiveSet(activeLabels);
  const map = new Map<string, Swap>();
  for (const substitution of substitutions) {
    if (!active.has(substitution.label)) continue;
    for (const swap of substitution.swaps) {
      map.set(swap.ingredient, swap);
    }
  }
  return map;
}

/**
 * Return a new ingredient list with every ingredient referenced by an active
 * swap replaced by its substitute. The substitute's `name` always replaces
 * the display name; `quantity`/`unit`/`note`/`plural` fall back to the
 * original ingredient's values when the swap doesn't specify its own (e.g.
 * `mixed-dal-tadka`'s "Make this vegan" swap only specifies `name` + `note`,
 * so the replacement keeps Ghee's original quantity/unit).
 *
 * Pure: never mutates `ingredients`, and calling this again from the same
 * base `ingredients` with the same `substitutions`/`activeLabels` always
 * produces an equivalent result (asserted in tests as the "idempotence"
 * DESIGN.md's test plan asks for, since there's no mutable state to make
 * genuine idempotence — apply-twice-equals-apply-once — a meaningful check).
 */
export function applySwaps(
  ingredients: Ingredient[],
  substitutions: Substitution[] = [],
  activeLabels: Set<string> | string[] = [],
): Ingredient[] {
  const swapMap = getActiveSwapMap(substitutions, activeLabels);
  return ingredients.map((ingredient) => {
    const swap = swapMap.get(ingredient.name);
    if (!swap) return { ...ingredient };
    return {
      name: swap.name,
      quantity: swap.quantity ?? ingredient.quantity,
      unit: swap.unit ?? ingredient.unit,
      note: swap.note ?? ingredient.note,
      optional: ingredient.optional,
      plural: swap.plural ?? ingredient.plural,
    };
  });
}
