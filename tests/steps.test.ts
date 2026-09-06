import { describe, expect, it } from "vitest";
import {
  ACCENT_TOKENS,
  assignGroupColors,
  filterActiveSteps,
  findLanePair,
  groupOrder,
  groupTimeRange,
  interpolateText,
  isActiveStep,
  rangesOverlap,
  timeRange,
  type TokenIngredient,
} from "../src/core/steps.js";
import type { Step } from "../src/core/schema.js";

function step(overrides: Partial<Step> & Pick<Step, "group" | "time" | "text">): Step {
  return overrides;
}

describe("groupOrder / assignGroupColors", () => {
  it("orders groups by first appearance, deduplicated", () => {
    const steps: Step[] = [
      step({ group: "Prep", time: 10, text: "a" }),
      step({ group: "Sear", time: 8, text: "b" }),
      step({ group: "Prep", time: 6, text: "c" }),
      step({ group: "Sauce", time: 4, text: "d" }),
    ];
    expect(groupOrder(steps)).toEqual(["Prep", "Sear", "Sauce"]);
  });

  it("assigns a stable, deterministic accent token per group, cycling the palette", () => {
    const steps: Step[] = [
      step({ group: "A", time: 4, text: "a" }),
      step({ group: "B", time: 3, text: "b" }),
      step({ group: "C", time: 2, text: "c" }),
      step({ group: "D", time: 1, text: "d" }),
    ];
    const colors = assignGroupColors(steps);
    expect(colors.A).toBe(ACCENT_TOKENS[0]);
    expect(colors.B).toBe(ACCENT_TOKENS[1]);
    expect(colors.C).toBe(ACCENT_TOKENS[2]);
    // Cycles back around once there are more groups than palette entries.
    expect(colors.D).toBe(ACCENT_TOKENS[0]);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const steps: Step[] = [step({ group: "Prep", time: 10, text: "a" })];
    expect(assignGroupColors(steps)).toEqual(assignGroupColors(steps));
  });
});

describe("idle filtering", () => {
  it("isActiveStep is false only for idle: true", () => {
    expect(isActiveStep({ idle: true })).toBe(false);
    expect(isActiveStep({ idle: false })).toBe(true);
    expect(isActiveStep({})).toBe(true);
  });

  it("filterActiveSteps excludes idle steps and keeps the rest", () => {
    const steps: Step[] = [
      step({ group: "Prep", time: 10, text: "a" }),
      step({ group: "Prep", time: 8, text: "b", idle: true }),
      step({ group: "Sauce", time: 2, text: "c" }),
    ];
    const active = filterActiveSteps(steps);
    expect(active.map((s) => s.text)).toEqual(["a", "c"]);
  });
});

describe("interpolateText", () => {
  const ingredients: TokenIngredient[] = [
    { name: "Salt", displayName: "Salt", quantity: 1, unit: "tsp", displayQuantity: "1", quantityFormat: "fraction" },
    { name: "Bay leaf", displayName: "Bay leaf", quantity: 1, displayQuantity: "1", quantityFormat: "fraction" },
    { name: "Ghee", displayName: "Ghee", quantity: 2, unit: "tbsp", displayQuantity: "2", quantityFormat: "fraction" },
  ];

  it("interpolates a normal token with quantity and unit", () => {
    expect(interpolateText("Add the {{Ghee}}.", ingredients)).toBe("Add the 2 tbsp.");
  });

  it("interpolates a token for an ingredient with no unit", () => {
    expect(interpolateText("Remove the {{Bay leaf}}.", ingredients)).toBe("Remove the 1.");
  });

  it("interpolates a * N multiplier token", () => {
    expect(interpolateText("Add remaining salt ({{Salt * 0.5}}).", ingredients)).toBe(
      "Add remaining salt (½ tsp).",
    );
  });

  it("is case- and whitespace-insensitive when matching ingredient names", () => {
    expect(interpolateText("{{ salt }}", ingredients)).toBe("1 tsp");
  });

  it("leaves an unmatched/dangling token exactly as written", () => {
    expect(interpolateText("Whisk in the {{Sugar}}.", ingredients)).toBe("Whisk in the {{Sugar}}.");
  });

  it("leaves an unmatched token with a multiplier exactly as written", () => {
    expect(interpolateText("Add {{Sugar * 0.5}} to taste.", ingredients)).toBe(
      "Add {{Sugar * 0.5}} to taste.",
    );
  });

  it("interpolates multiple tokens in one string", () => {
    expect(interpolateText("{{Ghee}} and {{Salt}}", ingredients)).toBe("2 tbsp and 1 tsp");
  });
});

describe("interpolateText — metric-mode display-string consistency (regression: ingredients list vs step token)", () => {
  it("reuses the ingredients list's exact displayQuantity string for a plain token, not a freshly-formatted number", () => {
    // displayQuantity is deliberately "wrong" relative to formatDecimal(35.516...)
    // ("35.5") and to formatQuantity(35.516...) ("35 ½") alike — this proves
    // interpolateText is reusing the given string verbatim rather than
    // reformatting `quantity` itself, which is exactly what keeps a plain
    // token byte-identical to whatever the ingredients-list row shows.
    const ingredients: TokenIngredient[] = [
      {
        name: "Ghee",
        displayName: "Ghee",
        quantity: 35.516328125,
        unit: "ml",
        displayQuantity: "35.5-list",
        quantityFormat: "decimal",
      },
    ];
    expect(interpolateText("{{Ghee}}", ingredients)).toBe("35.5-list ml");
  });

  it("a metric-converted ingredient's plain token matches its own displayQuantity + unit exactly", () => {
    const ingredients: TokenIngredient[] = [
      {
        name: "Ghee",
        displayName: "Ghee",
        quantity: 35.516328125,
        unit: "ml",
        displayQuantity: "35.5",
        quantityFormat: "decimal",
      },
    ];
    const listText = `${ingredients[0].displayQuantity} ${ingredients[0].unit}`;
    expect(interpolateText("{{Ghee}}", ingredients)).toBe(listText);
    expect(interpolateText("{{Ghee}}", ingredients)).toBe("35.5 ml");
  });

  it("a {{Name * N}} multiplier token under metric uses decimal-style formatting, not a fraction glyph", () => {
    const ingredients: TokenIngredient[] = [
      { name: "Stock", displayName: "Stock", quantity: 71.03, unit: "ml", displayQuantity: "71", quantityFormat: "decimal" },
    ];
    // 71.03 * 0.5 = 35.515 -> decimal formatting gives "35.5"; formatQuantity's
    // fraction-glyph formatting would instead give "35 ½" (0.515 is within
    // FRACTION_TOLERANCE of ½) — the exact metric-branch bug this fix closes,
    // relocated into the multiplier path.
    expect(interpolateText("{{Stock * 0.5}}", ingredients)).toBe("35.5 ml");
    expect(interpolateText("{{Stock * 0.5}}", ingredients)).not.toContain("½");
  });

  it("a {{Name * N}} multiplier token outside metric still uses fraction-style formatting", () => {
    const ingredients: TokenIngredient[] = [
      { name: "Salt", displayName: "Salt", quantity: 1, unit: "tsp", displayQuantity: "1", quantityFormat: "fraction" },
    ];
    expect(interpolateText("{{Salt * 0.5}}", ingredients)).toBe("½ tsp");
  });
});

describe("interpolateText — {{Name:name}} token", () => {
  const defaultIngredients: TokenIngredient[] = [
    { name: "Ghee", displayName: "Ghee", quantity: 2, unit: "tbsp", displayQuantity: "2", quantityFormat: "fraction" },
  ];
  const substitutedIngredients: TokenIngredient[] = [
    {
      name: "Ghee",
      displayName: "Neutral oil",
      quantity: 2,
      unit: "tbsp",
      displayQuantity: "2",
      quantityFormat: "fraction",
    },
  ];

  it("outputs the ingredient's default displayName when no substitution is active", () => {
    expect(interpolateText("in {{Ghee:name}}", defaultIngredients)).toBe("in Ghee");
  });

  it("outputs the substituted displayName when a substitution is active", () => {
    expect(interpolateText("in {{Ghee:name}}", substitutedIngredients)).toBe("in Neutral oil");
  });

  it("renders no quantity/unit/parens for a :name token — name only", () => {
    expect(interpolateText("{{Ghee:name}}", substitutedIngredients)).toBe("Neutral oil");
  });

  it("still resolves a plain {{Ghee}} quantity token alongside a {{Ghee:name}} token in the same string", () => {
    expect(interpolateText("{{Ghee:name}} ({{Ghee}})", substitutedIngredients)).toBe("Neutral oil (2 tbsp)");
  });

  it("leaves an unmatched {{Name:name}} token exactly as written", () => {
    expect(interpolateText("{{Sugar:name}}", defaultIngredients)).toBe("{{Sugar:name}}");
  });

  it("is case- and whitespace-insensitive when matching ingredient names for a :name token", () => {
    expect(interpolateText("{{ ghee : name }}", substitutedIngredients)).toBe("Neutral oil");
  });
});

describe("timeRange", () => {
  it("returns [time, time] for a step with a normal numeric time", () => {
    expect(timeRange(step({ group: "Prep", time: 10, text: "a" }))).toEqual([10, 10]);
  });

  it("returns null for a step with a non-numeric time (defensive, schema normally forbids this)", () => {
    const malformed = { group: "Prep", time: "soon" as unknown as number, text: "a" } as Step;
    expect(timeRange(malformed)).toBeNull();
  });

  it("returns null for a step with NaN time", () => {
    expect(timeRange(step({ group: "Prep", time: Number.NaN, text: "a" }))).toBeNull();
  });
});

describe("groupTimeRange", () => {
  it("spans the min and max time across a group's steps", () => {
    const steps: Step[] = [
      step({ group: "Sauce", time: 97, text: "a" }),
      step({ group: "Sauce", time: 94, text: "b" }),
      step({ group: "Sauce", time: 89, text: "c" }),
    ];
    expect(groupTimeRange(steps, "Sauce")).toEqual([89, 97]);
  });

  it("returns null for a group with no steps having meaningful time", () => {
    const steps: Step[] = [step({ group: "Prep", time: Number.NaN, text: "a" })];
    expect(groupTimeRange(steps, "Prep")).toBeNull();
  });

  it("still computes a range for a group whose steps are all idle", () => {
    const steps: Step[] = [
      step({ group: "Simmer", time: 20, text: "a", idle: true }),
      step({ group: "Simmer", time: 15, text: "b", idle: true }),
    ];
    expect(groupTimeRange(steps, "Simmer")).toEqual([15, 20]);
  });
});

describe("rangesOverlap", () => {
  it("is true for overlapping ranges", () => {
    expect(rangesOverlap([10, 20], [15, 25])).toBe(true);
    expect(rangesOverlap([10, 20], [20, 30])).toBe(true); // touching at an endpoint counts
  });

  it("is false for non-overlapping ranges", () => {
    expect(rangesOverlap([10, 20], [21, 30])).toBe(false);
  });
});

describe("findLanePair", () => {
  it("finds the first overlapping pair of groups, in first-appearance order", () => {
    // Group A: [90, 100], Group B: [95, 105] -> overlap.
    const steps: Step[] = [
      step({ group: "A", time: 100, text: "a1" }),
      step({ group: "A", time: 90, text: "a2" }),
      step({ group: "B", time: 105, text: "b1" }),
      step({ group: "B", time: 95, text: "b2" }),
    ];
    expect(findLanePair(steps)).toEqual(["A", "B"]);
  });

  it("returns null when no two groups' time ranges overlap", () => {
    const steps: Step[] = [
      step({ group: "Prep", time: 120, text: "a" }),
      step({ group: "Prep", time: 110, text: "b" }),
      step({ group: "Sear", time: 100, text: "c" }),
      step({ group: "Sear", time: 90, text: "d" }),
    ];
    expect(findLanePair(steps)).toBeNull();
  });

  it("returns null when steps have no meaningful time at all", () => {
    const steps: Step[] = [
      { group: "A", time: Number.NaN, text: "a" } as Step,
      { group: "B", time: Number.NaN, text: "b" } as Step,
    ];
    expect(findLanePair(steps)).toBeNull();
  });

  it("returns null for a single group (nothing to pair with)", () => {
    const steps: Step[] = [
      step({ group: "Only", time: 10, text: "a" }),
      step({ group: "Only", time: 5, text: "b" }),
    ];
    expect(findLanePair(steps)).toBeNull();
  });
});
