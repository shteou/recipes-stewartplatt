import { describe, expect, it } from "vitest";
import { convert, hasConvertibleUnit, pickImperial, pickMetric } from "../src/core/units.js";

describe("hasConvertibleUnit", () => {
  it("is true for known metric and imperial (UK) units", () => {
    expect(hasConvertibleUnit("g")).toBe(true);
    expect(hasConvertibleUnit("kg")).toBe(true);
    expect(hasConvertibleUnit("ml")).toBe(true);
    expect(hasConvertibleUnit("tsp")).toBe(true);
    expect(hasConvertibleUnit("tbsp")).toBe(true);
    expect(hasConvertibleUnit("cup")).toBe(true);
  });

  it("is false for free-text units and no unit at all", () => {
    expect(hasConvertibleUnit("medium")).toBe(false);
    expect(hasConvertibleUnit("handful")).toBe(false);
    expect(hasConvertibleUnit(undefined)).toBe(false);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    expect(hasConvertibleUnit(" G ")).toBe(true);
    expect(hasConvertibleUnit("TBSP")).toBe(true);
  });
});

describe("convert — no-op cases", () => {
  it("returns null for an unknown unit", () => {
    expect(convert(9, "cloves", "metric")).toBeNull();
  });

  it("returns null when already in the target system", () => {
    expect(convert(100, "g", "metric")).toBeNull();
    expect(convert(2, "tbsp", "imperial")).toBeNull();
  });
});

describe("convert — weight, dimension-scoped", () => {
  it("converts grams to imperial (oz/lb)", () => {
    const result = convert(150, "g", "imperial");
    expect(result).not.toBeNull();
    // 150 g < 226.796 g (0.5 lb), so this should pick oz.
    expect(result?.unit).toBe("oz");
  });

  it("converts a larger metric weight to lb once over the 0.5 lb threshold", () => {
    const result = convert(1000, "g", "imperial");
    expect(result?.unit).toBe("lb");
    expect(result?.quantity).toBeCloseTo(1000 / 453.592, 5);
  });

  it("converts oz to grams", () => {
    const result = convert(4, "oz", "metric");
    expect(result?.unit).toBe("g");
    expect(result?.quantity).toBeCloseTo(4 * 28.3495, 5);
  });

  it("converts a large weight in oz to kg", () => {
    const result = convert(40, "oz", "metric");
    expect(result?.unit).toBe("kg");
    expect(result?.quantity).toBeCloseTo((40 * 28.3495) / 1000, 5);
  });

  it("never converts weight to a volume unit", () => {
    // lb -> imperial is a no-op (already imperial); the point of this test
    // is simply that no weight conversion ever returns a volume unit.
    const result = convert(2, "lb", "metric");
    expect(["g", "kg"]).toContain(result?.unit);
  });
});

describe("convert — volume, dimension-scoped", () => {
  it("converts ml to imperial", () => {
    const result = convert(500, "ml", "imperial");
    expect(result).not.toBeNull();
    expect(["tsp", "tbsp", "cup"]).toContain(result?.unit);
  });

  it("converts imperial tsp/tbsp/cup to metric ml/l", () => {
    expect(convert(2, "tsp", "metric")?.unit).toBe("ml");
    // 4 cups ~= 1136.5 mL, over the 1000 mL / 1 l threshold.
    expect(convert(4, "cup", "metric")?.unit).toBe("l");
  });

  it("never converts volume to a weight unit", () => {
    const result = convert(500, "ml", "imperial");
    expect(["tsp", "tbsp", "cup", "pint", "qt"]).toContain(result?.unit);
  });
});

describe("pickImperial — boundary values", () => {
  // Weight boundary: 0.5 lb == 226.796 g.
  it("picks oz just below the 0.5 lb boundary", () => {
    const result = pickImperial("weight", 226.796 - 1);
    expect(result.unit).toBe("oz");
  });

  it("picks lb at exactly the 0.5 lb boundary", () => {
    const result = pickImperial("weight", 226.796);
    expect(result.unit).toBe("lb");
    expect(result.quantity).toBeCloseTo(0.5, 3);
  });

  it("picks lb just above the 0.5 lb boundary", () => {
    const result = pickImperial("weight", 226.796 + 1);
    expect(result.unit).toBe("lb");
  });

  // Volume boundary: 0.2 cup == 56.826125 mL.
  it("picks tbsp just below the 0.2 cup boundary", () => {
    const result = pickImperial("volume", 56.826125 - 0.5);
    expect(result.unit).toBe("tbsp");
  });

  it("picks cup at (to within floating-point tolerance) the 0.2 cup boundary", () => {
    // 56.826125 mL is exactly 0.2 cup in real terms, but floating-point
    // division of these two literals lands a hair under 0.2, so nudge by a
    // negligible epsilon to land the test on the >= side of the boundary
    // rather than asserting exact float equality.
    const result = pickImperial("volume", 56.826125 + 1e-6);
    expect(result.unit).toBe("cup");
    expect(result.quantity).toBeCloseTo(0.2, 3);
  });

  it("picks cup just above the 0.2 cup boundary", () => {
    const result = pickImperial("volume", 56.826125 + 0.5);
    expect(result.unit).toBe("cup");
  });

  // Volume boundary: 1 tbsp == 17.7581640625 mL.
  it("picks tsp just below the 1 tbsp boundary", () => {
    const result = pickImperial("volume", 17.7581640625 - 0.5);
    expect(result.unit).toBe("tsp");
  });

  it("picks tbsp at exactly the 1 tbsp boundary", () => {
    const result = pickImperial("volume", 17.7581640625);
    expect(result.unit).toBe("tbsp");
    expect(result.quantity).toBeCloseTo(1, 3);
  });

  it("picks tbsp just above the 1 tbsp boundary", () => {
    const result = pickImperial("volume", 17.7581640625 + 0.5);
    expect(result.unit).toBe("tbsp");
  });
});

describe("pickMetric — boundary values", () => {
  it("picks g just below the 1000 g / 1 kg boundary", () => {
    expect(pickMetric("weight", 999).unit).toBe("g");
  });

  it("picks kg at exactly the 1000 g boundary", () => {
    const result = pickMetric("weight", 1000);
    expect(result.unit).toBe("kg");
    expect(result.quantity).toBe(1);
  });

  it("picks ml just below the 1000 ml / 1 l boundary", () => {
    expect(pickMetric("volume", 999).unit).toBe("ml");
  });

  it("picks l at exactly the 1000 ml boundary", () => {
    const result = pickMetric("volume", 1000);
    expect(result.unit).toBe("l");
    expect(result.quantity).toBe(1);
  });

  it("does not render an awkward sub-1-unit amount (e.g. 1 g rather than 0.001 kg)", () => {
    const result = pickMetric("weight", 1);
    expect(result.unit).toBe("g");
    expect(result.quantity).toBe(1);
  });
});
