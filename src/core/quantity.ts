/**
 * Fraction-friendly quantity formatting and serving-unit pluralisation.
 *
 * Ported (with the exact tolerance and fraction table) from the old Hugo
 * theme's `recipe-format.js` (see `tools/recipe-book-history.bundle`,
 * `themes/recipes/static/js/recipe-format.js`) — verified against that source
 * rather than assumed from DESIGN.md's mention of "a value like 0.02".
 */

/**
 * How close a quantity's fractional part must be to one of `FRACTIONS`
 * (or to a whole number) before we render it as that fraction / round it.
 * Matches the old JS's `TOLERANCE` constant exactly.
 */
const FRACTION_TOLERANCE = 0.02;

/** Ordered low-to-high; the first close-enough match wins. */
const FRACTIONS: ReadonlyArray<readonly [value: number, glyph: string]> = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/**
 * Format a (typically already-scaled) quantity for display, preferring a
 * vulgar fraction glyph (e.g. "1 ½") when the value is within
 * `FRACTION_TOLERANCE` of one of the `FRACTIONS` table's values, falling back
 * to a whole number when it's within tolerance of one, and otherwise a clean
 * 2-decimal-place number.
 */
export function formatQuantity(value: number): string {
  const whole = Math.floor(value);
  const frac = value - whole;

  for (const [fractionValue, glyph] of FRACTIONS) {
    if (Math.abs(frac - fractionValue) < FRACTION_TOLERANCE) {
      return whole > 0 ? `${whole} ${glyph}` : glyph;
    }
  }
  if (Math.abs(frac) < FRACTION_TOLERANCE || Math.abs(frac - 1) < FRACTION_TOLERANCE) {
    return String(Math.round(value));
  }
  return String(Math.round(value * 100) / 100);
}

/**
 * Format a quantity as a plain decimal (no fraction glyphs) — used for the
 * metric side of unit conversion, where decimals read more naturally than
 * vulgar fractions (e.g. "1.5 l" rather than "1 ½ l").
 */
export function formatDecimal(value: number): string {
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return String(Math.round(value * 10) / 10);
  return String(Math.round(value * 100) / 100);
}

/**
 * Shared count/override/naive-plural decision behind `pluralizeServingUnit`
 * and `pluralizeIngredientName`.
 *
 * - Counts within `FRACTION_TOLERANCE` of 1 (including fractional servings
 *   that round to "1", e.g. a `serving_step` of 0.5 landing on 1) keep the
 *   singular form.
 * - Otherwise, `override` wins if provided.
 * - Otherwise, naive "+s" (skipped if the word already ends in "s").
 */
function pluralize(word: string, count: number, override?: string): string {
  if (Math.abs(count - 1) < FRACTION_TOLERANCE) return word;
  if (override) return override;
  return word.endsWith("s") ? word : `${word}s`;
}

/** Pluralise a `serving_unit` for the given count; see `pluralize`. */
export function pluralizeServingUnit(
  unit: string,
  count: number,
  override?: string,
): string {
  return pluralize(unit, count, override);
}

/**
 * Pluralise an ingredient's name for a `{{Name:plural}}` step token, using
 * the ingredient's final (scaled/substituted) `quantity` — e.g. "Bay leaf"
 * stays singular at `quantity: 1` but becomes "Bay leaves" once scaling
 * pushes it past 1, given `override: "Bay leaves"` (`Ingredient.plural` /
 * `Swap.plural`; naive "+s" would wrongly give "Bay leafs").
 *
 * An ingredient with no `quantity` at all (a "to taste" entry) has no count
 * to pluralise against, so it's always returned unchanged.
 */
export function pluralizeIngredientName(
  name: string,
  quantity: number | undefined,
  override?: string,
): string {
  if (quantity == null) return name;
  return pluralize(name, quantity, override);
}
