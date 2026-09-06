---
# ─────────────────────────────────────────────────────────────────────────
# TEMPLATE RECIPE — copy this file to a new name (e.g. `my-new-dish.md`)
# and fill it in. This file itself is excluded from the build because its
# filename starts with `_` (see `build/index.ts`'s `loadAllRecipes`) — it
# will never appear on the site, so it's safe to leave in `content/recipes/`
# as a reference. Every field below is real: it's validated by `parseRecipe`
# in `src/core/schema.ts`, which is the ground truth if this comment and
# that file ever disagree.
#
# See also `AGENTS.md` for the tagging/steps conventions this template
# follows, and `content/recipes/skhug.md` for a compact real-world example
# (irregular plural serving unit, `serving_step`, all-optional steps).
# ─────────────────────────────────────────────────────────────────────────

title: "Template Recipe Title"      # required, non-empty string.
summary: "One-sentence description shown on the home page and tag pages."  # required, non-empty string.

# required. Any format `js-yaml` + `z.coerce.date()` can parse; an unquoted
# YAML date like below is simplest. Used for "newest first" ordering on the
# home page — it does not need to be the publish date, just something you're
# happy to sort by.
date: 2026-01-01

draft: false      # optional (default: unset/false). No current build behaviour reads this — kept in the
                  # schema as a marker field; treat `true` as "don't ship yet" by convention only for now.

time_minutes: 30  # required, positive integer. Total time in minutes. Replaces the old Hugo-era free-text
                  # `time: "20m"` display string — this is a plain number, no unit suffix.

# required, at least one entry. Every tag must already exist in
# `src/core/taxonomy.ts`'s TAXONOMY table, or the build fails with
# "unknown tag" — add a new tag there first if you need one that doesn't
# exist yet. See AGENTS.md: if a recipe can be made vegan (directly, or via
# a `substitutions` swap below), include "vegan" alongside "vegetarian".
tags: ["italian", "chicken", "vegan"]

# optional. Path under `assets/flags/` (served at the same path under
# `public/`), used as the recipe's featured image — typically a cuisine
# flag, e.g. "/flags/it.svg". If omitted, the page renders with no featured
# image. This is unrelated to the flags shown on tag chips (those come from
# each tag's own `TAXONOMY[tag].flag` and are copied automatically).
featured_image: "/flags/it.svg"

servings: 4        # required, positive number. The *default* serving count the page loads with;
                    # the servings widget lets a viewer scale it up/down from here.

# optional (default label when omitted: "serving"). The unit name shown
# next to the servings number, e.g. "jar", "portion", "medium" (for a count
# of something sized "medium"). Singular form only here.
serving_unit: "portion"

# optional. Only needed when the plural of `serving_unit` isn't just
# `serving_unit` + "s" — e.g. skhug's `serving_unit: jar` would naively
# pluralize to "jars" (which is actually fine), but something like
# `serving_unit: medium` would wrongly pluralize to "mediums" unless you
# want that; use this to override, e.g. skhug doesn't need it but a
# hypothetical `serving_unit: loaf` would set `serving_unit_plural: loaves`.
# See `content/recipes/skhug.md` for the real (regular-plural, so omitted
# there) case, and `src/core/quantity.ts`'s `pluralizeServingUnit` for the
# exact fallback rule.
serving_unit_plural: "portions"

# optional. The increment/decrement step size for the servings widget's
# +/- controls, e.g. 0.5 to allow half-jars. Defaults to 1 when omitted.
serving_step: 1

# required, at least one entry. Each ingredient's `name` is also the lookup
# key used by `{{tokens}}` in `steps[].text`/`steps[].short` below, and by
# `substitutions[].swaps[].ingredient` — keep names stable once you've
# referenced them, and match case doesn't matter for token lookups but keep
# it consistent for your own sanity.
ingredients:
  - name: Chicken breasts    # required, non-empty string.
    quantity: 4              # optional number. Omit entirely for a "to taste"/no-amount ingredient.
    unit: piece              # optional string. Any free-text unit; only a known convertible unit
                              # (see `src/core/units.ts`) responds to the metric/imperial toggle.
    note: "or thighs"         # optional string, rendered in parentheses after the ingredient, e.g. "4 piece Chicken breasts (or thighs)".
    # optional: true         # optional boolean. Marks this ingredient as skippable; rendered with
                              # an "(optional)" suffix. (Left commented here as an example of an
                              # ingredient line with NO optional field, which is the common case.)
  - name: Olive oil
    quantity: 2
    unit: tbsp
  - name: Salt & pepper       # an ingredient with no quantity/unit at all — "to taste" style, valid as-is.

# optional. One or more named substitution "toggles" a viewer can switch on
# in the ingredients list; each swaps out one or more ingredients for a
# replacement, live, without touching servings/units logic. Omit this whole
# key if the recipe has no viable substitution.
substitutions:
  - label: "Make this vegan"          # required, non-empty string — the text on the toggle button.
    swaps:                            # required, at least one entry.
      - ingredient: Chicken breasts   # required — must exactly match an `ingredients[].name` above,
                                      # or the build fails with "references unknown ingredient".
        name: Firm tofu               # required — the replacement ingredient's display name.
        quantity: 400                 # optional — replacement quantity; omit to keep the original quantity.
        unit: g                       # optional — replacement unit; omit to keep the original unit.
        note: "pressed and cubed"     # optional — replacement note; omit to keep the original note (if any).

# optional. Omit entirely for a very simple recipe — the page still renders
# an (empty) Steps section either way; there is no markdown fallback (see
# AGENTS.md). Prefer `steps:` over writing a manual "## Directions" list in
# the body, since only `steps:` powers the Grouped/Timeline/Mise en
# place/Kitchen mode switcher.
steps:
  - group: Prep                       # required, non-empty string. Stage label — powers the Grouped view's headings
                                       # and the Timeline view's lane grouping.
    time: 30                          # required number. Minutes remaining until the dish is done, counting DOWN
                                       # to 0 across the whole recipe (not minutes this step takes). Give every
                                       # step a `time` for the Timeline view's concurrent-lane rendering to kick in.
    text: "Salt and pepper the {{Chicken breasts}}, then set aside."   # required, non-empty string. The
                                       # full instruction. May reference an ingredient's resolved amount with
                                       # `{{Ingredient Name}}` (must match an `ingredients[].name` above exactly,
                                       # case-insensitive), or a fraction of it with `{{Ingredient Name * 0.5}}`
                                       # — e.g. a step that only uses half the salt. These interpolate live
                                       # against the current servings/unit-system/substitution state.
    short: "Season chicken ({{Chicken breasts}})"   # optional string. Terse phrasing shown in Kitchen mode;
                                       # falls back to `text` when omitted. Supports the same `{{tokens}}`.
    # idle: true                      # optional boolean. Marks a passive/waiting step (e.g. "simmer, no
                                       # action needed") — rendered muted in Timeline and skipped entirely in
                                       # Kitchen mode. (Left commented here; see below for a step that sets it.)
  - group: Cook
    time: 15
    text: "Heat the {{Olive oil}} in a pan over medium heat and sear the chicken until golden."
    short: "Sear chicken in {{Olive oil}}"
  - group: Cook
    time: 5
    idle: true
    text: "Cover and simmer gently — no action needed."
---

<!--
  Everything below the closing `---` is the recipe's markdown BODY. It's
  optional (defaults to an empty string when omitted) and is rendered
  generically as a "Notes" section on the page (via `marked`) — there is
  no special parsing for any particular heading like the old Hugo site's
  "## Directions"; write whatever prose fits, or omit the body entirely.
-->

## Notes

Placeholder prose — a good spot for serving suggestions, make-ahead notes,
or storage tips that don't fit neatly into `ingredients`/`steps`. See
`content/recipes/marsala.md` or `content/recipes/mixed-dal-tadka.md` for
real "## Serving suggestions" examples.
