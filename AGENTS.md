# AGENTS

Start here for a new recipe: copy `content/recipes/_template.md` — it has
every schema field commented inline with what it does and whether it's
required. This file covers conventions that are easy to get wrong even with
the template in hand.

## Recipe tagging

- If a recipe can be made vegan (whether directly, or via a listed `substitutions` swap), include `"vegan"` in its `tags`, alongside `"vegetarian"` where applicable.
- This is a flat tag only — there is no separate derived "vegan (with substitution)" label anywhere in the taxonomy or view layer. A recipe tagged `"vegan"` on the strength of a substitution renders identically (chip-wise) to one that's vegan outright; the substitution toggle itself (rendered from `substitutions:`, see `src/view/Layout.tsx`) is what communicates "vegan once you flip this switch" at render time. Confirmed against `src/core/present.ts` and `src/view/*.tsx`: neither derives or special-cases a vegan-via-substitution state.

## Schema notes

- `time_minutes` (a plain positive integer, minutes) is the schema's time field — not the old Hugo-era free-text `time` display string like `"20m"`/`"2h"`. There's no separate display-string field; format it at render time if a different display is ever needed.
- `serving_unit_plural` is an optional override for irregular plurals of `serving_unit` (e.g. a `serving_unit: loaf` would need `serving_unit_plural: loaves`). Most recipes don't need it — `content/recipes/skhug.md` uses `serving_unit: jar` and omits `serving_unit_plural` because "jars" is already the regular plural; see `src/core/quantity.ts`'s `pluralizeServingUnit` for the exact fallback rule.

## Recipe steps

- Prefer a `steps:` frontmatter array over writing a manual "## Directions" list in the markdown body — it renders as a switcher with four views (Grouped / Timeline / Mise en place / Kitchen mode) instead of a single numbered list. **Recipes without `steps:` do not fall back to any markdown-parsed directions section** — the Steps section just renders empty (checked against `build/index.ts`/`src/view/Layout.tsx`: there is no `## Directions` heading-detection anywhere). The markdown body (`recipe.body`) is instead rendered generically as a "Notes" section regardless of what headings it contains — see `content/recipes/skhug.md`'s `## Serving suggestions` body for an example of that generic rendering, not a directions fallback.
- Each entry needs only `text` (the full instruction). Optional fields add power to specific views and can be added incrementally:
  - `group` — a stage label (e.g. `Lentils`, `Tadka`). Powers the Grouped view's headings.
  - `time` — minutes remaining until done (counts down to `0`). Powers the Timeline view. If two groups' `time` ranges overlap, Timeline renders them as side-by-side concurrent lanes that converge; give every step a `time` for this to activate cleanly, otherwise it degrades to a single ordered column.
  - `short` — terse phrasing for Kitchen mode. Falls back to `text` if omitted.
  - `idle: true` — marks a passive/waiting step (e.g. "simmer, no action needed"). Rendered muted in Timeline and skipped entirely in Kitchen mode.
- Inside `short` (or `text`), reference an ingredient's amount with `{{Ingredient Name}}` — it renders as that ingredient's quantity + unit and rescales with the servings stepper. Use `{{Ingredient Name * 0.5}}` for a fraction of the listed amount (e.g. a step that only uses half the salt). The name must match an entry in `ingredients:` exactly (case-insensitive). Example: `short: "Rinse chana ({{Chana dal}}) + mung ({{Mung dal}}) dal"`.
- Mise en place reuses the page's existing ingredients list as the prep panel, so it needs no extra data — its "Method" panel is just every step's `text` in order.
