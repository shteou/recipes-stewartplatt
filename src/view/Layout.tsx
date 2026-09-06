/**
 * The HTML document shell for a single recipe page: `<html>`/`<head>`/`<body>`
 * plus the featured-image flag, tag chips, servings widget, unit toggle,
 * substitution badges, ingredients list, and all four steps views. Plain
 * semantic HTML — no styling stage yet (Stage 10), and every control here is
 * inert (no client-side script): a later stage wires up real behaviour.
 */

import { marked } from "marked";
import type { Recipe } from "../core/schema.js";
import type { RecipeViewModel, UnitSystem } from "../core/present.js";
import { TAXONOMY } from "../core/taxonomy.js";
import { hasConvertibleUnit } from "../core/units.js";
import { IngredientList } from "./IngredientList.js";
import { StepsGrouped } from "./StepsGrouped.js";
import { StepsTimeline } from "./StepsTimeline.js";
import { StepsMise } from "./StepsMise.js";
import { StepsKitchen } from "./StepsKitchen.js";
import { HeadAssets, SiteBar, ThemeToggleScript } from "./SiteChrome.js";

export interface RecipePageProps {
  vm: RecipeViewModel;
  /** The source recipe — carries fields `present()` doesn't surface on the view model (tags, substitutions, serving_step, ...). */
  recipe: Recipe;
  /** Root-relative path to the featured-image flag SVG, e.g. "/flags/it.svg". */
  featuredImageSrc?: string;
}

const UNIT_SYSTEMS: UnitSystem[] = ["as-written", "metric", "imperial"];

/**
 * Serialize `recipe` for embedding inside a `<script type="application/json">`
 * tag: `hydrate.ts` reads this back via `JSON.parse` to re-run `present()`
 * client-side. Escaping "<" prevents a stray "</script" inside recipe text
 * (a note, a title, ...) from prematurely closing the tag.
 */
function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function RecipePage({ vm, recipe, featuredImageSrc }: RecipePageProps) {
  const substitutions = recipe.substitutions ?? [];
  const showUnitToggle = recipe.ingredients.some((ingredient) => hasConvertibleUnit(ingredient.unit));
  const hasBody = recipe.body.trim().length > 0;
  const bodyHtml = hasBody ? marked.parse(recipe.body, { async: false }) : "";

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{vm.title}</title>
        <HeadAssets />
      </head>
      <body>
        <SiteBar />
        <main class="page">
        <header>
          {featuredImageSrc && <img class="flag-badge" src={featuredImageSrc} alt="" width="48" height="48" />}
          <h1>{vm.title}</h1>
          <p>
            Serves {vm.servingsDisplay} {vm.servingUnitDisplay}
          </p>
          <ul class="tags">
            {recipe.tags.map((tag) => {
              const entry = TAXONOMY[tag];
              return (
                <li key={tag}>
                  <a href={`/tags/${tag}/`}>
                    {entry?.flag && <img class="flag-icon" src={entry.flag} alt="" width="16" height="16" />}
                    {entry?.label ?? tag}
                  </a>
                </li>
              );
            })}
          </ul>
        </header>

        <section aria-label="Servings" class="servings-widget" data-step={recipe.serving_step ?? 1}>
          <button type="button" aria-label="Decrease servings">
            −
          </button>
          <span class="servings-value">
            {vm.servingsDisplay} {vm.servingUnitDisplay}
          </span>
          <button type="button" aria-label="Increase servings">
            +
          </button>
        </section>

        {showUnitToggle && (
          <section aria-label="Units" class="unit-toggle" role="group">
            {UNIT_SYSTEMS.map((system) => (
              <button
                key={system}
                type="button"
                data-unit-system={system}
                aria-pressed={vm.unitSystem === system}
                data-active={vm.unitSystem === system ? "true" : undefined}
              >
                {system}
              </button>
            ))}
          </section>
        )}

        {substitutions.length > 0 && (
          <section aria-label="Substitutions" class="substitutions">
            <h2>Substitutions</h2>
            {substitutions.map((substitution) => (
              <button
                key={substitution.label}
                type="button"
                class="substitution-badge"
                aria-pressed="false"
                data-substitution={substitution.label}
              >
                {substitution.label}
              </button>
            ))}
          </section>
        )}

        <section aria-label="Ingredients">
          <h2>Ingredients</h2>
          <div id="ingredients-list">
            <IngredientList ingredients={vm.ingredients} />
          </div>
        </section>

        <section aria-label="Steps">
          <h2>Steps</h2>
          <nav aria-label="Steps view switcher" class="steps-view-switcher">
            <button type="button" data-view-target="grouped" aria-pressed="true">
              Grouped
            </button>
            <button type="button" data-view-target="timeline" aria-pressed="false">
              Timeline
            </button>
            <button type="button" data-view-target="mise" aria-pressed="false">
              Mise en place
            </button>
            <button type="button" data-view-target="kitchen" aria-pressed="false">
              Kitchen mode
            </button>
          </nav>
          <section id="steps-grouped" data-view="grouped">
            <StepsGrouped vm={vm} />
          </section>
          <section id="steps-timeline" data-view="timeline" hidden>
            <StepsTimeline vm={vm} />
          </section>
          <section id="steps-mise" data-view="mise" hidden>
            <StepsMise vm={vm} />
          </section>
          <section id="steps-kitchen" data-view="kitchen" hidden>
            <StepsKitchen vm={vm} />
          </section>
        </section>

        {hasBody && (
          <section aria-label="Notes" class="recipe-notes" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        )}
        </main>

        <script
          type="application/json"
          id="recipe-data"
          dangerouslySetInnerHTML={{ __html: embedJson(recipe) }}
        />
        <script type="module" src="/client/hydrate.js"></script>
        <ThemeToggleScript />
      </body>
    </html>
  );
}
