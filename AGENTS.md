# AGENTS

## Recipe tagging

- If a recipe can be made vegan (whether directly, or via a listed `substitutions` swap), include `"vegan"` in its `tags`, alongside `"vegetarian"` where applicable.

## Recipe steps

- Prefer a `steps:` frontmatter array over a markdown `## Directions` list — it renders as a switcher with four views (Grouped / Timeline / Mise en place / Kitchen mode) instead of a single numbered list. Recipes without `steps:` keep rendering their markdown `## Directions` section as before.
- Each entry needs only `text` (the full instruction). Optional fields add power to specific views and can be added incrementally:
  - `group` — a stage label (e.g. `Lentils`, `Tadka`). Powers the Grouped view's headings.
  - `time` — minutes remaining until done (counts down to `0`). Powers the Timeline view. If two groups' `time` ranges overlap, Timeline renders them as side-by-side concurrent lanes that converge; give every step a `time` for this to activate cleanly, otherwise it degrades to a single ordered column.
  - `short` — terse phrasing for Kitchen mode. Falls back to `text` if omitted.
  - `idle: true` — marks a passive/waiting step (e.g. "simmer, no action needed"). Rendered muted in Timeline and skipped entirely in Kitchen mode.
- Inside `short` (or `text`), reference an ingredient's amount with `{{Ingredient Name}}` — it renders as that ingredient's quantity + unit and rescales with the servings stepper. Use `{{Ingredient Name * 0.5}}` for a fraction of the listed amount (e.g. a step that only uses half the salt). The name must match an entry in `ingredients:` exactly (case-insensitive). Example: `short: "Rinse chana ({{Chana dal}}) + mung ({{Mung dal}}) dal"`.
- Mise en place reuses the page's existing ingredients list as the prep panel, so it needs no extra data — its "Method" panel is just every step's `text` in order.
