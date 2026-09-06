/**
 * Step-list helpers: group ordering/colour, `{{token}}` interpolation,
 * Timeline-view lane detection, and `idle`-filtering.
 *
 * Ported in spirit (not verbatim — the old version was DOM-string-building,
 * this is plain data) from the old Hugo-era `steps-view.js`, preserved in
 * `tools/recipe-book-history.bundle`.
 */

import type { Step } from "./schema.js";
import { formatDecimal, formatQuantity } from "./quantity.js";

// ---------------------------------------------------------------------------
// Group ordering & colour assignment
// ---------------------------------------------------------------------------

/** A small, fixed palette; actual CSS colours are a later styling stage's job. */
export const ACCENT_TOKENS = ["accent-1", "accent-2", "accent-3"] as const;
export type AccentToken = (typeof ACCENT_TOKENS)[number];

/** Group names in first-appearance order (deduplicated). */
export function groupOrder(steps: Step[]): string[] {
  const order: string[] = [];
  for (const step of steps) {
    if (!order.includes(step.group)) order.push(step.group);
  }
  return order;
}

/**
 * Stable, deterministic group -> accent-token mapping: groups are assigned
 * palette entries in first-appearance order, cycling once there are more
 * groups than palette entries.
 */
export function assignGroupColors(steps: Step[]): Record<string, AccentToken> {
  const colors: Record<string, AccentToken> = {};
  groupOrder(steps).forEach((group, index) => {
    colors[group] = ACCENT_TOKENS[index % ACCENT_TOKENS.length];
  });
  return colors;
}

// ---------------------------------------------------------------------------
// idle filtering
// ---------------------------------------------------------------------------

/** True for any non-`idle` step — i.e. one that belongs in an "active" flow (Kitchen mode). */
export function isActiveStep(step: { idle?: boolean }): boolean {
  return !step.idle;
}

/** Exclude `idle: true` steps, e.g. for a Kitchen-mode one-at-a-time view. */
export function filterActiveSteps<T extends { idle?: boolean }>(steps: T[]): T[] {
  return steps.filter(isActiveStep);
}

// ---------------------------------------------------------------------------
// {{token}} interpolation
// ---------------------------------------------------------------------------

/**
 * Matches `{{Ingredient Name}}`, `{{Ingredient Name * 0.5}}`-style multiplier
 * tokens, and `{{Ingredient Name:name}}`/`{{Ingredient Name:plural}}`-style
 * reference tokens. Capture groups: 1 = the ingredient name, 2 = the
 * multiplier (if present), 3 = `"name"` or `"plural"` (if a `:name`/`:plural`
 * suffix is present). The multiplier and `:name`/`:plural` forms are mutually
 * exclusive.
 */
const TOKEN_PATTERN = /\{\{\s*([^{}*:]+?)\s*(?:\*\s*([0-9.]+)|:\s*(name|plural))?\s*\}\}/g;

/**
 * Which of `quantity.ts`'s two formatters an ingredient's quantity should use
 * — "decimal" (`formatDecimal`) when `present.ts`'s `resolveQuantity` actually
 * converted this ingredient to metric, "fraction" (`formatQuantity`)
 * otherwise (as-written, imperial, or an unconvertible unit that fell through
 * unconverted even under a metric `unitSystem`). Threaded through per
 * ingredient — rather than derived from the page's global `unitSystem` — so a
 * `{{Name * N}}` multiplier token, which must reformat a freshly-multiplied
 * number rather than reuse `displayQuantity`, still lands on exactly the
 * convention `present()` chose for that ingredient's own ingredients-list row.
 */
export type QuantityFormat = "decimal" | "fraction";

/**
 * An ingredient as shaped for `{{token}}` lookup: the final resolved
 * quantity/unit (post scale -> substitution -> unit conversion) plus the
 * exact pre-formatted `displayQuantity` string `present()`'s `resolveQuantity`
 * computed for this same ingredient's ingredients-list row, and the
 * `quantityFormat` that string was built with.
 *
 * An un-multiplied `{{token}}` reuses `displayQuantity` verbatim — this is
 * what guarantees the token and the ingredients-list entry render
 * byte-identical quantity+unit text for the same ingredient. Only a
 * `{{Name * N}}` multiplier token needs to reformat from `quantity`, since
 * multiplying changes the underlying number; it does so via `quantityFormat`
 * rather than re-deciding "metric -> decimal, else -> fraction" independently.
 */
export interface TokenIngredient {
  name: string;
  /**
   * The ingredient's current display name — the substituted ingredient's
   * name when an active substitution replaced it, same as what the
   * ingredients list shows for this ingredient's row. Looked up the same way
   * as `name` (case-insensitive, against the token's written name) regardless
   * of which token variant matched; only a `{{Name:name}}` token actually
   * renders it.
   */
  displayName: string;
  quantity?: number;
  unit?: string;
  displayQuantity?: string;
  quantityFormat: QuantityFormat;
  /**
   * `displayName` pluralised for this ingredient's final resolved `quantity`
   * (`quantity.ts`'s `pluralizeIngredientName`, respecting `Ingredient.plural`
   * / `Swap.plural`) — what a `{{Name:plural}}` token renders. Optional
   * because callers that never use `:plural` tokens (e.g. existing tests)
   * have no reason to compute it; `interpolateText` falls back to
   * `displayName` when absent.
   */
  pluralDisplayName?: string;
}

function findIngredient(ingredients: TokenIngredient[], name: string): TokenIngredient | undefined {
  const key = name.trim().toLowerCase();
  return ingredients.find((ingredient) => ingredient.name.trim().toLowerCase() === key);
}

/** Format `value` using whichever formatter `format` names. */
function formatByConvention(value: number, format: QuantityFormat): string {
  return format === "decimal" ? formatDecimal(value) : formatQuantity(value);
}

/**
 * Replace every `{{token}}` in `text` with the matching ingredient's current
 * formatted quantity + unit, taken from `ingredients` — expected to already
 * be scaled, substituted, and (if applicable) unit-converted, i.e. the final
 * resolved values `present()` would otherwise show in the ingredients list.
 * A plain `{{Name}}` token reuses that ingredient's `displayQuantity` string
 * exactly as-is, so it always matches the ingredients-list row character for
 * character. A `{{Name * 0.5}}`-style token multiplies that ingredient's raw
 * `quantity` by the literal factor first — which necessarily means
 * reformatting rather than reusing `displayQuantity` — but still picks the
 * formatter via `quantityFormat`, the same "decimal for a metric-converted
 * ingredient, fraction otherwise" convention `present()` used to build
 * `displayQuantity` in the first place.
 *
 * A token whose name doesn't resolve to any ingredient in `ingredients` is
 * left exactly as written (braces included) rather than throwing — e.g.
 * `{{Sugar}}` stays `{{Sugar}}` in the output — so a caller/renderer can
 * still spot it visually. `schema.ts`'s `parseRecipe` independently rejects
 * this case at content-validation time; this is `steps.ts`'s own defensive
 * behaviour as a separate consumer of the same ingredient list.
 *
 * A `{{Name:name}}` token is a third, distinct form: it outputs the matched
 * ingredient's `displayName` verbatim — no quantity, no unit, no parens —
 * rather than its quantity. This is what lets prose reference an
 * ingredient's *current* (possibly-substituted) name, e.g. `{{Ghee:name}}`
 * renders "Neutral oil" once the "Make this vegan" substitution swaps it in,
 * instead of the literal word "ghee" staying hardcoded in the surrounding
 * text regardless of which ingredient is actually in play.
 *
 * A `{{Name:plural}}` token is the same, but outputs `pluralDisplayName`
 * (falling back to `displayName` if absent) — the ingredient's name
 * pluralised for its own final resolved quantity, e.g. `{{Bay leaf:plural}}`
 * renders "Bay leaf" at a single leaf but "Bay leaves" once scaling the
 * recipe pushes that ingredient's quantity above 1. This is deliberately a
 * separate, opt-in token rather than `:name` itself always pluralising,
 * since not every ingredient name is a count noun — "Salt" or "Neutral oil"
 * should never pluralise just because their `quantity` isn't 1.
 */
export function interpolateText(text: string, ingredients: TokenIngredient[]): string {
  return text.replace(
    TOKEN_PATTERN,
    (match, rawName: string, rawMultiplier: string | undefined, suffix: string | undefined) => {
      const ingredient = findIngredient(ingredients, rawName);
      if (!ingredient) return match;

      if (suffix === "name") return ingredient.displayName;
      if (suffix === "plural") return ingredient.pluralDisplayName ?? ingredient.displayName;

      if (ingredient.quantity == null) return ingredient.unit ?? "";

      const unitSuffix = ingredient.unit ? ` ${ingredient.unit}` : "";

      if (rawMultiplier === undefined) {
        const display = ingredient.displayQuantity ?? formatByConvention(ingredient.quantity, ingredient.quantityFormat);
        return display + unitSuffix;
      }

      const multiplier = Number.parseFloat(rawMultiplier);
      const scaled = ingredient.quantity * multiplier;
      return formatByConvention(scaled, ingredient.quantityFormat) + unitSuffix;
    },
  );
}

// ---------------------------------------------------------------------------
// Timeline lane detection
// ---------------------------------------------------------------------------

/** An inclusive `[start, end]` span on the countdown timeline, in the same minutes-remaining unit as `Step.time`. */
export type TimeRange = readonly [start: number, end: number];

/**
 * A single step's time range. Since `Step.time` is one countdown value (not
 * a start/end pair), this is just `[time, time]` — a single instant. Ranges
 * become meaningful for lane detection once combined across a group's steps
 * via `groupTimeRange`.
 *
 * Returns `null` for a step with no meaningful time (defensive: `time` is
 * required by the schema, but this function doesn't trust that at runtime —
 * e.g. a non-number or `NaN` value).
 */
export function timeRange(step: Step): TimeRange | null {
  if (typeof step.time !== "number" || Number.isNaN(step.time)) return null;
  return [step.time, step.time];
}

/**
 * The time range spanned by all of `group`'s steps: the min and max `time`
 * across every step in that group with a meaningful `timeRange`. Steps with
 * no meaningful time are simply skipped (a group with *no* steps having a
 * meaningful time returns `null`). Note this does not exclude `idle` steps —
 * an idle step still occupies real time on the timeline, so an all-`idle`
 * group still gets a valid range.
 */
export function groupTimeRange(steps: Step[], group: string): TimeRange | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const step of steps) {
    if (step.group !== group) continue;
    const range = timeRange(step);
    if (!range) continue;
    if (min === null || range[0] < min) min = range[0];
    if (max === null || range[1] > max) max = range[1];
  }
  if (min === null || max === null) return null;
  return [min, max];
}

/** Do two inclusive time ranges overlap (share at least one instant)? */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/**
 * Find the first pair of groups (in first-appearance order) whose time
 * ranges overlap, for laying them out as two concurrent Timeline lanes.
 * Returns `[groupA, groupB]` ordered by first appearance, or `null` if no
 * two groups overlap (including when there's only one group, or none of the
 * steps have meaningful time).
 */
export function findLanePair(steps: Step[]): [string, string] | null {
  const order = groupOrder(steps);
  const ranges = new Map<string, TimeRange>();
  for (const group of order) {
    const range = groupTimeRange(steps, group);
    if (range) ranges.set(group, range);
  }

  const named = [...ranges.keys()];
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const a = named[i];
      const b = named[j];
      // biome-ignore lint: ranges.get is guaranteed defined for keys of `ranges`
      if (rangesOverlap(ranges.get(a)!, ranges.get(b)!)) {
        return order.indexOf(a) < order.indexOf(b) ? [a, b] : [b, a];
      }
    }
  }
  return null;
}
