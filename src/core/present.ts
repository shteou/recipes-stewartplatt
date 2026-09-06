/**
 * `present(recipe, viewState)` — the single composition point tying together
 * scale -> substitutions -> unit conversion -> step token interpolation into
 * one resolved view model. This is the seam between `core/` and a later
 * rendering stage: `view/` should need nothing beyond what `RecipeViewModel`
 * already contains, and should call this fresh on every state change (no
 * assumption this runs once).
 */

import type { Ingredient, Recipe } from "./schema.js";
import { scaleIngredients } from "./scale.js";
import { applySwaps, getActiveSwapMap } from "./substitutions.js";
import { convert, hasConvertibleUnit } from "./units.js";
import { formatDecimal, formatQuantity, pluralizeIngredientName, pluralizeServingUnit } from "./quantity.js";
import {
  assignGroupColors,
  filterActiveSteps,
  groupOrder,
  interpolateText,
  type AccentToken,
  type QuantityFormat,
  type TokenIngredient,
} from "./steps.js";

// ---------------------------------------------------------------------------
// State / view-model types
// ---------------------------------------------------------------------------

export type UnitSystem = "metric" | "imperial" | "as-written";
export type StepsViewMode = "grouped" | "timeline" | "mise" | "kitchen";

export interface ViewState {
  /** Current target servings — may be fractional (see `scale.ts`/`serving_step`). */
  servings: number;
  /** Currently-toggled-on `Substitution.label`s. */
  activeSubstitutions: Set<string> | string[];
  unitSystem: UnitSystem;
  stepsView: StepsViewMode;
}

export interface ResolvedIngredient {
  /** Display name — the substitute's name when substituted. */
  name: string;
  /** Final numeric quantity after scale -> substitution -> unit conversion. */
  quantity?: number;
  /** Final unit after conversion (or the as-scaled/as-substituted unit, unchanged, when not converted). */
  unit?: string;
  /** `quantity` formatted for display (fraction-friendly, or decimal under a metric conversion). Absent when there's no quantity. */
  displayQuantity?: string;
  note?: string;
  optional?: boolean;
  /** Whether an active substitution replaced this ingredient. */
  substituted: boolean;
  /** A single ready-to-render line: "1 ½ cup Chana dal (split, yellow)". */
  display: string;
}

export interface ResolvedStep {
  group: string;
  accent: AccentToken;
  time: number;
  /** `text` with every `{{token}}` interpolated against the final resolved ingredients. */
  text: string;
  /** `short` (if present), interpolated the same way. */
  short?: string;
  idle: boolean;
}

export interface RecipeViewModel {
  slug: string;
  title: string;
  servings: number;
  servingsDisplay: string;
  servingUnitDisplay: string;
  unitSystem: UnitSystem;
  stepsView: StepsViewMode;
  ingredients: ResolvedIngredient[];
  /** Step groups in first-appearance order — mirrors `steps`' grouping. */
  groupOrder: string[];
  steps: ResolvedStep[];
  /** `steps` with `idle` steps excluded, for a Kitchen-mode one-at-a-time flow. */
  activeSteps: ResolvedStep[];
}

// ---------------------------------------------------------------------------
// Ingredient resolution
// ---------------------------------------------------------------------------

interface ResolvedQuantity {
  quantity?: number;
  unit?: string;
  displayQuantity?: string;
  /**
   * Which formatter `displayQuantity` was built with — "decimal" only when
   * this ingredient was actually converted to metric here, "fraction" for
   * every other case (as-written, imperial, no quantity, or an unconvertible
   * unit that fell through unconverted even under a metric `unitSystem`).
   * Carried alongside `displayQuantity` so `steps.ts`'s `interpolateText` can
   * reformat a `{{Name * N}}` multiplier token using this same convention
   * instead of re-deriving it from the page's global `unitSystem` — an
   * unconvertible-unit ingredient must keep using `formatQuantity` for its
   * token too, even on a metric page, to match its own ingredients-list row.
   */
  quantityFormat: QuantityFormat;
}

/**
 * Resolve one (already scaled + substituted) ingredient's final quantity,
 * unit and display string for the given `unitSystem`.
 *
 * `unitSystem: 'as-written'`, an unconvertible unit, or no quantity at all
 * all fall through to "keep it as-is" — `convert()`/`hasConvertibleUnit()`
 * already encode the no-op cases (unknown unit, or no same-dimension
 * counterpart), so this function doesn't need to re-derive them.
 */
function resolveQuantity(ingredient: Ingredient, unitSystem: UnitSystem): ResolvedQuantity {
  if (ingredient.quantity == null) {
    return { quantity: undefined, unit: ingredient.unit, displayQuantity: undefined, quantityFormat: "fraction" };
  }

  if (unitSystem !== "as-written" && hasConvertibleUnit(ingredient.unit)) {
    const converted = convert(ingredient.quantity, ingredient.unit, unitSystem);
    if (converted) {
      const quantityFormat: QuantityFormat = unitSystem === "metric" ? "decimal" : "fraction";
      const displayQuantity =
        quantityFormat === "decimal" ? formatDecimal(converted.quantity) : formatQuantity(converted.quantity);
      return { quantity: converted.quantity, unit: converted.unit, displayQuantity, quantityFormat };
    }
  }

  return {
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    displayQuantity: formatQuantity(ingredient.quantity),
    quantityFormat: "fraction",
  };
}

function formatIngredientLine(ingredient: {
  name: string;
  displayQuantity?: string;
  unit?: string;
  note?: string;
  optional?: boolean;
}): string {
  const bits: string[] = [];
  if (ingredient.displayQuantity) bits.push(ingredient.displayQuantity);
  if (ingredient.unit) bits.push(ingredient.unit);
  const amount = bits.join(" ");
  let label = amount ? `${amount} ${ingredient.name}` : ingredient.name;
  if (ingredient.note) label += ` (${ingredient.note})`;
  if (ingredient.optional) label += " (optional)";
  return label;
}

// ---------------------------------------------------------------------------
// present()
// ---------------------------------------------------------------------------

export function present(recipe: Recipe, viewState: ViewState): RecipeViewModel {
  const substitutions = recipe.substitutions ?? [];

  // scale -> substitutions
  const scaled = scaleIngredients(recipe, viewState.servings);
  const swapMap = getActiveSwapMap(substitutions, viewState.activeSubstitutions);
  const substituted = applySwaps(scaled, substitutions, viewState.activeSubstitutions);

  // unit conversion, per ingredient
  const resolvedQuantities = substituted.map((ingredient) => resolveQuantity(ingredient, viewState.unitSystem));
  const resolvedIngredients: ResolvedIngredient[] = substituted.map((ingredient, index) => {
    const wasSubstituted = swapMap.has(scaled[index].name);
    const { quantity, unit, displayQuantity } = resolvedQuantities[index];
    return {
      name: ingredient.name,
      quantity,
      unit,
      displayQuantity,
      note: ingredient.note,
      optional: ingredient.optional,
      substituted: wasSubstituted,
      display: formatIngredientLine({
        name: ingredient.name,
        displayQuantity,
        unit,
        note: ingredient.note,
        optional: ingredient.optional,
      }),
    };
  });

  // Ingredients shaped for token interpolation: final resolved quantity/unit
  // (post scale -> substitution -> unit conversion), keyed by each
  // ingredient's *original* name rather than a substitute's display name.
  // `{{Ghee}}` tokens are written against the recipe's declared ingredient
  // names (that's what `parseRecipe` validates them against), so lookup has
  // to stay keyed that way even when an active substitution renames the row
  // in the ingredients list — the token never renders the ingredient's name
  // anyway, only its quantity + unit, so this is purely a lookup key choice.
  // Using the *final* quantity/unit here (not the pre-substitution ones) is
  // what makes step tokens agree with the ingredients list under any
  // combination of servings/substitution/unit-system (the old Hugo site's
  // bugs 1, 2 and 4, per DESIGN.md) — e.g. a substitution that overrides
  // `quantity`/`unit` flows straight into the token's displayed amount.
  //
  // Also carries the *same* `displayQuantity` string (and the
  // `quantityFormat` it was built with) that `resolvedIngredients` shows in
  // the ingredients list, rather than leaving `interpolateText` to
  // independently re-derive formatting from the raw `quantity` — that
  // divergence was exactly the "ingredients list says 53.3 ml, a step token
  // for the same ingredient says 53.27 ml" bug this shape now closes.
  const tokenIngredients: TokenIngredient[] = resolvedIngredients.map((ri, index) => ({
    name: scaled[index].name,
    // The resolved/substituted display name — "Neutral oil" rather than
    // "Ghee" once a substitution is active — for a `{{Name:name}}` token.
    displayName: ri.name,
    quantity: ri.quantity,
    unit: ri.unit,
    displayQuantity: ri.displayQuantity,
    quantityFormat: resolvedQuantities[index].quantityFormat,
    // For a `{{Name:plural}}` token — same substituted name, pluralised
    // against this ingredient's own final quantity, honouring an active
    // swap's `plural` override (falling back to the base ingredient's) via
    // `substituted[index].plural`.
    pluralDisplayName: pluralizeIngredientName(ri.name, ri.quantity, substituted[index].plural),
  }));

  // step token interpolation
  const steps = recipe.steps ?? [];
  const colors = assignGroupColors(steps);
  const resolvedSteps: ResolvedStep[] = steps.map((step) => ({
    group: step.group,
    accent: colors[step.group],
    time: step.time,
    text: interpolateText(step.text, tokenIngredients),
    short: step.short ? interpolateText(step.short, tokenIngredients) : undefined,
    idle: step.idle ?? false,
  }));

  const servingUnit = recipe.serving_unit ?? "serving";

  return {
    slug: recipe.slug,
    title: recipe.title,
    servings: viewState.servings,
    servingsDisplay: formatQuantity(viewState.servings),
    servingUnitDisplay: pluralizeServingUnit(servingUnit, viewState.servings, recipe.serving_unit_plural),
    unitSystem: viewState.unitSystem,
    stepsView: viewState.stepsView,
    ingredients: resolvedIngredients,
    groupOrder: groupOrder(steps),
    steps: resolvedSteps,
    activeSteps: filterActiveSteps(resolvedSteps),
  };
}
