import { describe, expect, it } from "vitest";
import { formatDecimal, formatQuantity, pluralizeIngredientName, pluralizeServingUnit } from "../src/core/quantity.js";

describe("formatQuantity", () => {
  it("renders whole numbers plainly", () => {
    expect(formatQuantity(4)).toBe("4");
    expect(formatQuantity(0)).toBe("0");
  });

  it("renders a bare fraction with no leading whole number", () => {
    expect(formatQuantity(0.5)).toBe("½");
    expect(formatQuantity(0.25)).toBe("¼");
  });

  it("renders a whole number plus a fraction glyph", () => {
    expect(formatQuantity(1.5)).toBe("1 ½");
    expect(formatQuantity(2.25)).toBe("2 ¼");
    expect(formatQuantity(1 + 1 / 3)).toBe("1 ⅓");
  });

  it("snaps to the nearest fraction within tolerance (0.02)", () => {
    // 0.5 + 0.015 is within the 0.02 tolerance of ½.
    expect(formatQuantity(1.515)).toBe("1 ½");
  });

  it("does not snap to a fraction just outside tolerance", () => {
    // 0.5 + 0.03 is outside the 0.02 tolerance of ½; falls through to decimal.
    expect(formatQuantity(1.53)).toBe("1.53");
  });

  it("rounds a near-whole value up rather than showing a tiny fraction", () => {
    expect(formatQuantity(1.99)).toBe("2");
    expect(formatQuantity(2.005)).toBe("2");
  });

  it("falls back to a clean decimal when nothing fractional matches", () => {
    expect(formatQuantity(1.7)).toBe("1.7");
    expect(formatQuantity(1.19)).toBe("1.19");
  });
});

describe("formatDecimal", () => {
  it("keeps 2 decimal places below 10", () => {
    expect(formatDecimal(1.2345)).toBe("1.23");
  });

  it("keeps 1 decimal place from 10 up to 100", () => {
    expect(formatDecimal(12.345)).toBe("12.3");
  });

  it("rounds to a whole number at 100 and above", () => {
    expect(formatDecimal(123.45)).toBe("123");
  });
});

describe("pluralizeServingUnit", () => {
  it("keeps the singular form at count 1", () => {
    expect(pluralizeServingUnit("jar", 1)).toBe("jar");
  });

  it("keeps the singular form for a count within tolerance of 1", () => {
    expect(pluralizeServingUnit("jar", 1.01)).toBe("jar");
  });

  it("naively appends 's' by default", () => {
    expect(pluralizeServingUnit("jar", 2)).toBe("jars");
    expect(pluralizeServingUnit("jar", 0.5)).toBe("jars");
  });

  it("does not double an 's' already present", () => {
    expect(pluralizeServingUnit("mediums", 3)).toBe("mediums");
  });

  it("uses the override plural when the count is not 1", () => {
    expect(pluralizeServingUnit("medium", 2, "mediums")).toBe("mediums");
  });

  it("ignores the override when the count is 1", () => {
    expect(pluralizeServingUnit("medium", 1, "mediums")).toBe("medium");
  });
});

describe("pluralizeIngredientName", () => {
  it("keeps the singular form at quantity 1", () => {
    expect(pluralizeIngredientName("Bay leaf", 1, "Bay leaves")).toBe("Bay leaf");
  });

  it("keeps the singular form for a quantity within tolerance of 1", () => {
    expect(pluralizeIngredientName("Bay leaf", 1.01, "Bay leaves")).toBe("Bay leaf");
  });

  it("uses the override plural when quantity is not 1", () => {
    expect(pluralizeIngredientName("Bay leaf", 2, "Bay leaves")).toBe("Bay leaves");
    expect(pluralizeIngredientName("Bay leaf", 0.5, "Bay leaves")).toBe("Bay leaves");
  });

  it("naively appends 's' when there's no override", () => {
    expect(pluralizeIngredientName("Garlic clove", 3)).toBe("Garlic cloves");
  });

  it("does not double an 's' already present", () => {
    expect(pluralizeIngredientName("Curry leaves", 8)).toBe("Curry leaves");
  });

  it("returns the name unchanged when there's no quantity to pluralise against", () => {
    expect(pluralizeIngredientName("Salt & pepper", undefined)).toBe("Salt & pepper");
  });
});
