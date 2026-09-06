/**
 * Recipe content model: TypeScript types + zod schemas, and `parseRecipe` /
 * `parseRecipeCollection`, the validation entry points for recipe content.
 *
 * Shape is derived from the actual frontmatter in use across
 * `content/recipes/{marsala,mixed-dal-tadka,skhug}.md`, with the tidy-ups
 * decided in IMPLEMENTATION.md §"Content & schema":
 *   - `description` is dropped (it only ever duplicated `title`).
 *   - `time` (a display string like "20m"/"2h") is replaced by
 *     `time_minutes: number`.
 *   - `serving_unit_plural` is added as an optional override for irregular
 *     plurals of `serving_unit` (e.g. "medium" -> "mediums").
 */

import { z } from "zod";
import { TAXONOMY } from "./taxonomy.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const IngredientSchema = z.object({
  /** Also the lookup key for `{{tokens}}` in steps and for substitution swaps. */
  name: z.string().min(1),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  note: z.string().optional(),
  optional: z.boolean().optional(),
  /**
   * Irregular plural override for a `{{Name:plural}}` step token (e.g. "Bay
   * leaf" -> `plural: "Bay leaves"`), mirroring `serving_unit_plural`. Only
   * needed when naive "+s" (`quantity.ts`'s `pluralizeIngredientName`) is
   * wrong; a regular plural like "Garlic clove" -> "Garlic cloves" doesn't
   * need it.
   */
  plural: z.string().optional(),
});

const SwapSchema = z.object({
  /** Must reference an `Ingredient.name` in the same recipe. */
  ingredient: z.string().min(1),
  /** Replacement ingredient name. */
  name: z.string().min(1),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  note: z.string().optional(),
  /** Irregular plural override for the replacement `name`; see `Ingredient.plural`. */
  plural: z.string().optional(),
});

const SubstitutionSchema = z.object({
  /** e.g. "Make this vegan" */
  label: z.string().min(1),
  swaps: z.array(SwapSchema).min(1),
});

const StepSchema = z.object({
  /** Stage label, powers the Grouped view. */
  group: z.string().min(1),
  /** Minutes remaining until done, counting down to 0. */
  time: z.number(),
  /** Full instruction; may contain `{{tokens}}`. */
  text: z.string().min(1),
  /** Terse phrasing for Kitchen mode; falls back to `text` when absent. */
  short: z.string().optional(),
  /** Passive/waiting step: muted in Timeline, skipped in Kitchen mode. */
  idle: z.boolean().optional(),
});

/**
 * Frontmatter + body, before the cross-referential checks `parseRecipe`
 * additionally performs (known tags, dangling substitution/token
 * references). `body` is the recipe's markdown body (prose after the
 * frontmatter block) and is passed through unvalidated.
 */
const RecipeInputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  date: z.coerce.date(),
  draft: z.boolean().optional(),
  time_minutes: z.number().int().positive(),
  tags: z.array(z.string().min(1)).min(1),
  featured_image: z.string().optional(),
  servings: z.number().positive(),
  serving_unit: z.string().optional(),
  serving_unit_plural: z.string().optional(),
  serving_step: z.number().positive().optional(),
  ingredients: z.array(IngredientSchema).min(1),
  substitutions: z.array(SubstitutionSchema).optional(),
  steps: z.array(StepSchema).optional(),
  body: z.string().optional().default(""),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Ingredient = z.infer<typeof IngredientSchema>;
export type Swap = z.infer<typeof SwapSchema>;
export type Substitution = z.infer<typeof SubstitutionSchema>;
export type Step = z.infer<typeof StepSchema>;
export type RecipeInput = z.infer<typeof RecipeInputSchema>;

/** A fully validated recipe: `RecipeInput` plus its derived `slug`. */
export type Recipe = RecipeInput & { slug: string };

export type ParseResult =
  | { success: true; data: Recipe }
  | { success: false; errors: string[] };

export type ParseCollectionResult =
  | { success: true; data: Recipe[] }
  | { success: false; errors: string[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derive a recipe's slug. Prefers the filename in `sourceLabel` (e.g.
 * "marsala.md", "content/recipes/marsala.md", or plain "marsala") over the
 * title, since the frontmatter has no explicit `slug` field today.
 */
function deriveSlug(sourceLabel: string | undefined, title: string): string {
  if (sourceLabel) {
    const basename = sourceLabel.split(/[\\/]/).pop() ?? sourceLabel;
    const withoutExt = basename.replace(/\.[^.]+$/, "");
    const slug = slugify(withoutExt);
    if (slug) return slug;
  }
  return slugify(title);
}

/**
 * Matches `{{Ingredient Name}}`, `{{Ingredient Name * 0.5}}`, and
 * `{{Ingredient Name:name}}`/`{{Ingredient Name:plural}}` style tokens
 * generically — the whole inside-braces content is captured, and
 * `extractTokenIngredientNames` below is what strips the `* <multiplier>`/
 * `:name`/`:plural` suffix to recover the bare ingredient name to validate.
 */
const TOKEN_PATTERN = /\{\{([^}]+)\}\}/g;

function extractTokenIngredientNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const raw = match[1].trim();
    // Strip a trailing `* <multiplier>` (e.g. "Salt * 0.5") or `:name`/
    // `:plural` suffix (e.g. "Ghee:name", "Bay leaf:plural"), whichever comes
    // first — a token only ever has one of the three, never more.
    const starIndex = raw.indexOf("*");
    const colonIndex = raw.indexOf(":");
    const candidates = [starIndex, colonIndex].filter((i) => i !== -1);
    const cutIndex = candidates.length > 0 ? Math.min(...candidates) : -1;
    const ingredientName = (cutIndex === -1 ? raw : raw.slice(0, cutIndex)).trim();
    names.push(ingredientName);
  }
  return names;
}

// ---------------------------------------------------------------------------
// parseRecipe
// ---------------------------------------------------------------------------

/**
 * Validate a single recipe's parsed frontmatter + body.
 *
 * `sourceLabel` (typically the source filename, e.g. "marsala.md") is used
 * both to prefix error messages and to derive `slug`. Never throws; bad
 * input produces `{ success: false, errors }` with human-readable messages.
 *
 * Beyond shape/type checking, this additionally validates:
 *   - every tag is known (present in `TAXONOMY`)
 *   - every `substitutions[].swaps[].ingredient` matches a real ingredient
 *   - every `{{token}}` in step `text`/`short` resolves to a real ingredient
 *
 * Duplicate-slug checking is a collection-level concern — see
 * `parseRecipeCollection`.
 */
export function parseRecipe(raw: unknown, sourceLabel?: string): ParseResult {
  const label = sourceLabel ?? "recipe";
  const shapeResult = RecipeInputSchema.safeParse(raw);

  if (!shapeResult.success) {
    const errors = shapeResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${label}: ${path}: ${issue.message}`;
    });
    return { success: false, errors };
  }

  const data = shapeResult.data;
  const errors: string[] = [];

  for (const tag of data.tags) {
    if (!Object.prototype.hasOwnProperty.call(TAXONOMY, tag)) {
      errors.push(
        `${label}: unknown tag "${tag}" — not present in the taxonomy table (src/core/taxonomy.ts)`,
      );
    }
  }

  const ingredientNames = new Set(data.ingredients.map((i) => i.name));

  for (const substitution of data.substitutions ?? []) {
    for (const swap of substitution.swaps) {
      if (!ingredientNames.has(swap.ingredient)) {
        errors.push(
          `${label}: substitution "${substitution.label}" references unknown ingredient "${swap.ingredient}"`,
        );
      }
    }
  }

  for (const step of data.steps ?? []) {
    const texts = [step.text, step.short].filter(
      (v): v is string => typeof v === "string",
    );
    for (const text of texts) {
      for (const ingredientName of extractTokenIngredientNames(text)) {
        if (!ingredientNames.has(ingredientName)) {
          errors.push(
            `${label}: step in group "${step.group}" references unknown ingredient "${ingredientName}" via {{${ingredientName}}} token`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const slug = deriveSlug(sourceLabel, data.title);
  return { success: true, data: { ...data, slug } };
}

// ---------------------------------------------------------------------------
// parseRecipeCollection
// ---------------------------------------------------------------------------

export interface RecipeSource {
  raw: unknown;
  sourceLabel?: string;
}

/**
 * Validate a whole collection of recipes, additionally checking that no two
 * recipes share a slug. Every individual `parseRecipe` error is included in
 * the result; a duplicate slug is reported even when every individual
 * recipe otherwise parses successfully.
 */
export function parseRecipeCollection(
  sources: RecipeSource[],
): ParseCollectionResult {
  const errors: string[] = [];
  const recipes: Recipe[] = [];

  for (const source of sources) {
    const result = parseRecipe(source.raw, source.sourceLabel);
    if (result.success) {
      recipes.push(result.data);
    } else {
      errors.push(...result.errors);
    }
  }

  const slugCounts = new Map<string, number>();
  for (const recipe of recipes) {
    slugCounts.set(recipe.slug, (slugCounts.get(recipe.slug) ?? 0) + 1);
  }
  for (const [slug, count] of slugCounts) {
    if (count > 1) {
      errors.push(`duplicate slug "${slug}" is used by ${count} recipes`);
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }
  return { success: true, data: recipes };
}
