/**
 * Dimension-scoped unit conversion: volume<->volume or weight<->weight,
 * never weight<->volume (that needs a per-ingredient density table, which
 * this app deliberately never has — see DESIGN.md §5.4 / Open Question 6).
 *
 * "Imperial" here means **UK imperial**, not US customary — an explicit,
 * flagged decision (the old Hugo-era `unit-convert.js`, preserved in
 * `tools/recipe-book-history.bundle`, actually used US customary constants,
 * e.g. `cup: 236.588 toBase`, a US cup; that was never correct for a UK
 * kitchen and is *not* ported here). All imperial volume constants below are
 * derived fresh from the legal UK definition of the imperial gallon
 * (4.54609 L exactly):
 *
 *   1 UK gallon = 4546.09 mL           (exact, by definition)
 *   1 UK pint   = gallon / 8           = 568.26125 mL   (= 20 UK fl oz)
 *   1 UK fl oz  = pint / 20            = 28.4130625 mL
 *   1 UK tbsp   = 5/8 fl oz            = 17.7581640625 mL  (traditional UK tablespoon)
 *   1 UK tsp    = tbsp / 3             = 5.919388020833 mL
 *   1 UK "cup"  = pint / 2 (10 fl oz)  = 284.130625 mL
 *                 (there is no official UK imperial cup; "half a pint" is the
 *                 standard old imperial-conversion-chart convention, and is
 *                 what's used here)
 *
 * Imperial *weight* units (oz, lb) are identical between US and UK
 * (avoirdupois) so those constants are unaffected by the US/UK distinction.
 */

export type UnitSystem = "metric" | "imperial";
export type Dimension = "volume" | "weight";

interface UnitDef {
  dimension: Dimension;
  system: UnitSystem;
  /** Multiplier to the dimension's base unit: mL for volume, g for weight. */
  toBase: number;
}

const UNITS: Record<string, UnitDef> = {
  // volume — imperial (UK)
  tsp: { dimension: "volume", system: "imperial", toBase: 5.919388020833 },
  tbsp: { dimension: "volume", system: "imperial", toBase: 17.7581640625 },
  floz: { dimension: "volume", system: "imperial", toBase: 28.4130625 },
  cup: { dimension: "volume", system: "imperial", toBase: 284.130625 },
  pint: { dimension: "volume", system: "imperial", toBase: 568.26125 },
  qt: { dimension: "volume", system: "imperial", toBase: 1136.5225 },

  // volume — metric
  ml: { dimension: "volume", system: "metric", toBase: 1 },
  l: { dimension: "volume", system: "metric", toBase: 1000 },

  // weight — imperial (avoirdupois; same in US and UK)
  oz: { dimension: "weight", system: "imperial", toBase: 28.3495 },
  lb: { dimension: "weight", system: "imperial", toBase: 453.592 },

  // weight — metric
  g: { dimension: "weight", system: "metric", toBase: 1 },
  kg: { dimension: "weight", system: "metric", toBase: 1000 },
};

const ALIASES: Record<string, string> = {
  "fl oz": "floz",
  "fl. oz": "floz",
};

function unitKey(rawUnit: string | undefined): string | null {
  const normalized = (rawUnit ?? "").trim().toLowerCase();
  const aliased = ALIASES[normalized] ?? normalized;
  return Object.prototype.hasOwnProperty.call(UNITS, aliased) ? aliased : null;
}

/**
 * Is `unit` one this module knows how to convert at all (i.e. it has a
 * same-dimension counterpart in the other system)? Every entry in `UNITS` is
 * part of a dimension that has both a metric and an imperial member, so this
 * is simply "is it in the table" — free-text units like "medium" or
 * "handful", or ingredients given with no unit at all, are never convertible,
 * which is the desired no-op behaviour.
 */
export function hasConvertibleUnit(unit: string | undefined): boolean {
  return unitKey(unit) !== null;
}

export interface PickedUnit {
  unit: string;
  quantity: number;
}

/**
 * Choose the most sensible imperial unit + quantity for a base-unit amount
 * (mL for volume, g for weight).
 *
 * Thresholds (derived fresh from the UK constants above, in the same spirit
 * as the old JS's "prefer cups above 0.2 cup, tbsp above 1 tbsp, lb above
 * 0.5 lb" heuristic mentioned in DESIGN.md, but re-verified against the UK
 * unit sizes rather than the old US ones):
 *   - weight: >= 0.5 lb (>= 226.796 g) -> lb, else oz
 *   - volume: >= 0.2 cup (>= 56.826125 mL) -> cup,
 *             else >= 1 tbsp (>= 17.7581640625 mL) -> tbsp,
 *             else tsp
 */
export function pickImperial(dimension: Dimension, base: number): PickedUnit {
  if (dimension === "weight") {
    const lb = base / UNITS.lb.toBase;
    if (lb >= 0.5) return { unit: "lb", quantity: lb };
    return { unit: "oz", quantity: base / UNITS.oz.toBase };
  }
  const cups = base / UNITS.cup.toBase;
  if (cups >= 0.2) return { unit: "cup", quantity: cups };
  const tbsp = base / UNITS.tbsp.toBase;
  if (tbsp >= 1) return { unit: "tbsp", quantity: tbsp };
  return { unit: "tsp", quantity: base / UNITS.tsp.toBase };
}

/**
 * Choose the most sensible metric unit + quantity for a base-unit amount.
 * Thresholds: >= 1000 (g or mL) -> kg / l, else stay in g / ml. This avoids
 * both "0.001 kg" (renders as "1 g") and "1500 g" (renders as "1.5 kg").
 */
export function pickMetric(dimension: Dimension, base: number): PickedUnit {
  if (dimension === "weight") {
    if (base >= 1000) return { unit: "kg", quantity: base / 1000 };
    return { unit: "g", quantity: base };
  }
  if (base >= 1000) return { unit: "l", quantity: base / 1000 };
  return { unit: "ml", quantity: base };
}

export interface ConvertedQuantity {
  quantity: number;
  unit: string;
}

/**
 * Convert `quantity fromUnit` into the given `toSystem`, dimension-scoped
 * (volume only converts to/from volume, weight only to/from weight).
 *
 * Returns `null` (a no-op) when there's no sensible same-dimension target:
 * `fromUnit` isn't in the table at all, or it's already in `toSystem`.
 */
export function convert(
  quantity: number,
  fromUnit: string | undefined,
  toSystem: UnitSystem,
): ConvertedQuantity | null {
  const key = unitKey(fromUnit);
  if (!key) return null;
  const meta = UNITS[key];
  if (meta.system === toSystem) return null;

  const base = quantity * meta.toBase;
  const picked =
    toSystem === "metric" ? pickMetric(meta.dimension, base) : pickImperial(meta.dimension, base);
  return { quantity: picked.quantity, unit: picked.unit };
}
