import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  parseRecipe,
  parseRecipeCollection,
  type RecipeSource,
} from "../src/core/schema.js";
import { loadRecipeFile } from "./helpers/loadRecipeFile.js";

const CONTENT_DIR = join(import.meta.dirname, "..", "content", "recipes");
const REAL_RECIPE_FILES = ["marsala.md", "mixed-dal-tadka.md", "skhug.md"];

/** A minimal, otherwise-valid recipe raw object, for the broken-fixture tests. */
function makeValidRawRecipe(overrides: Record<string, unknown> = {}) {
  return {
    title: "Test Recipe",
    summary: "A recipe used only for tests",
    date: "2024-01-01",
    time_minutes: 10,
    tags: ["italian"],
    servings: 2,
    ingredients: [{ name: "Flour", quantity: 100, unit: "g" }],
    steps: [{ group: "Prep", time: 10, text: "Mix the flour." }],
    ...overrides,
  };
}

describe("parseRecipe — the 3 real recipes", () => {
  for (const filename of REAL_RECIPE_FILES) {
    it(`parses ${filename} successfully`, () => {
      const { raw, sourceLabel } = loadRecipeFile(join(CONTENT_DIR, filename));
      const result = parseRecipe(raw, sourceLabel);
      if (!result.success) {
        throw new Error(
          `expected ${filename} to parse, got errors:\n${result.errors.join("\n")}`,
        );
      }
      expect(result.success).toBe(true);
      expect(result.data.title).toBeTruthy();
      expect(typeof result.data.time_minutes).toBe("number");
      expect(result.data.slug).toBeTruthy();
    });
  }

  it("derives the expected slugs from filenames", () => {
    const slugs = REAL_RECIPE_FILES.map((filename) => {
      const { raw, sourceLabel } = loadRecipeFile(join(CONTENT_DIR, filename));
      const result = parseRecipe(raw, sourceLabel);
      if (!result.success) throw new Error(result.errors.join("\n"));
      return result.data.slug;
    });
    expect(slugs).toEqual(["marsala", "mixed-dal-tadka", "skhug"]);
  });

  it("has no description field and a numeric time_minutes in the migrated content", () => {
    for (const filename of REAL_RECIPE_FILES) {
      const { raw } = loadRecipeFile(join(CONTENT_DIR, filename));
      expect(raw).not.toHaveProperty("description");
      expect(raw).toHaveProperty("time_minutes");
      expect(typeof (raw as { time_minutes: unknown }).time_minutes).toBe(
        "number",
      );
      expect(raw).not.toHaveProperty("time");
    }
  });

  it("parses all 3 real recipes together as a collection with no duplicate slugs", () => {
    const sources: RecipeSource[] = REAL_RECIPE_FILES.map((filename) =>
      loadRecipeFile(join(CONTENT_DIR, filename)),
    );
    const result = parseRecipeCollection(sources);
    if (!result.success) {
      throw new Error(
        `expected the real recipe collection to parse, got errors:\n${result.errors.join("\n")}`,
      );
    }
    expect(result.data).toHaveLength(3);
  });
});

describe("parseRecipe — valid minimal fixture sanity check", () => {
  it("accepts a minimal, well-formed recipe", () => {
    const result = parseRecipe(makeValidRawRecipe(), "sanity-check.md");
    expect(result.success).toBe(true);
  });
});

describe("parseRecipe — rejects broken input", () => {
  it("rejects a tag that is not in the taxonomy table", () => {
    const raw = makeValidRawRecipe({ tags: ["klingon"] });
    const result = parseRecipe(raw, "unknown-tag.md");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => /unknown tag "klingon"/.test(e))).toBe(
      true,
    );
  });

  it("rejects a substitution swap that references a nonexistent ingredient", () => {
    const raw = makeValidRawRecipe({
      substitutions: [
        {
          label: "Make it gluten-free",
          swaps: [{ ingredient: "Sugar", name: "Honey" }],
        },
      ],
    });
    const result = parseRecipe(raw, "dangling-substitution.md");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.errors.some((e) =>
        /references unknown ingredient "Sugar"/.test(e),
      ),
    ).toBe(true);
  });

  it("rejects a {{token}} in a step that references a nonexistent ingredient", () => {
    const raw = makeValidRawRecipe({
      steps: [
        {
          group: "Prep",
          time: 10,
          text: "Whisk in the {{Sugar}} until dissolved.",
        },
      ],
    });
    const result = parseRecipe(raw, "dangling-token.md");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.errors.some((e) =>
        /unknown ingredient "Sugar" via \{\{Sugar\}\} token/.test(e),
      ),
    ).toBe(true);
  });

  it("accepts a {{Name:name}} token that references a real ingredient", () => {
    const raw = makeValidRawRecipe({
      steps: [
        {
          group: "Prep",
          time: 10,
          text: "Mix in the {{Flour:name}} ({{Flour}}).",
        },
      ],
    });
    const result = parseRecipe(raw, "name-token.md");
    expect(result.success).toBe(true);
  });

  it("rejects a {{Name:name}} token that references a nonexistent ingredient", () => {
    const raw = makeValidRawRecipe({
      steps: [
        {
          group: "Prep",
          time: 10,
          text: "Mix in the {{Unknown:name}}.",
        },
      ],
    });
    const result = parseRecipe(raw, "dangling-name-token.md");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.errors.some((e) => /unknown ingredient "Unknown"/.test(e)),
    ).toBe(true);
  });

  it("accepts a {{Name:plural}} token that references a real ingredient", () => {
    const raw = makeValidRawRecipe({
      steps: [
        {
          group: "Prep",
          time: 10,
          text: "Mix in the {{Flour:plural}} ({{Flour}}).",
        },
      ],
    });
    const result = parseRecipe(raw, "plural-token.md");
    expect(result.success).toBe(true);
  });

  it("rejects a {{Name:plural}} token that references a nonexistent ingredient", () => {
    const raw = makeValidRawRecipe({
      steps: [
        {
          group: "Prep",
          time: 10,
          text: "Mix in the {{Unknown:plural}}.",
        },
      ],
    });
    const result = parseRecipe(raw, "dangling-plural-token.md");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.errors.some((e) => /unknown ingredient "Unknown"/.test(e)),
    ).toBe(true);
  });

  it("rejects a {{token}} with a multiplier that references a nonexistent ingredient", () => {
    const raw = makeValidRawRecipe({
      steps: [
        {
          group: "Prep",
          time: 10,
          text: "Add {{Sugar * 0.5}} to taste.",
        },
      ],
    });
    const result = parseRecipe(raw, "dangling-token-multiplier.md");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.errors.some((e) => /unknown ingredient "Sugar"/.test(e)),
    ).toBe(true);
  });

  it("rejects a missing required field (title)", () => {
    const raw = makeValidRawRecipe();
    delete (raw as Record<string, unknown>).title;
    const result = parseRecipe(raw, "missing-title.md");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => /title/.test(e))).toBe(true);
  });

  it("rejects a mistyped required field (servings as a string)", () => {
    const raw = makeValidRawRecipe({ servings: "two" });
    const result = parseRecipe(raw, "mistyped-servings.md");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => /servings/.test(e))).toBe(true);
  });
});

describe("parseRecipeCollection — duplicate slugs", () => {
  it("rejects two recipes that resolve to the same slug", () => {
    const sources: RecipeSource[] = [
      { raw: makeValidRawRecipe({ title: "First Version" }), sourceLabel: "duplicate.md" },
      { raw: makeValidRawRecipe({ title: "Second Version" }), sourceLabel: "duplicate.md" },
    ];
    const result = parseRecipeCollection(sources);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.errors.some((e) => /duplicate slug "duplicate"/.test(e)),
    ).toBe(true);
  });

  it("accepts recipes with distinct slugs", () => {
    const sources: RecipeSource[] = [
      { raw: makeValidRawRecipe({ title: "One" }), sourceLabel: "one.md" },
      { raw: makeValidRawRecipe({ title: "Two" }), sourceLabel: "two.md" },
    ];
    const result = parseRecipeCollection(sources);
    expect(result.success).toBe(true);
  });
});
