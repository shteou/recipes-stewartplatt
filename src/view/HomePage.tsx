/**
 * The home page: a plain list of every recipe, newest-first by `date` (per
 * IMPLEMENTATION.md's decision — no tag-cloud widget, no client-side
 * filtering here). `recipes` is expected pre-sorted by the caller
 * (`build/index.ts`) — this component just lays it out.
 */

import type { Recipe } from "../core/schema.js";
import { HeadAssets, SiteBar, ThemeToggleScript } from "./SiteChrome.js";

export interface HomePageProps {
  recipes: Recipe[];
}

export function HomePage({ recipes }: HomePageProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Recipes</title>
        <HeadAssets />
      </head>
      <body>
        <SiteBar />
        <main class="page">
          <h1>Recipes</h1>
          <ul class="recipe-list">
            {recipes.map((recipe) => (
              <li key={recipe.slug}>
                <a href={`/recipes/${recipe.slug}/`}>{recipe.title}</a>
              </li>
            ))}
          </ul>
        </main>
        <ThemeToggleScript />
      </body>
    </html>
  );
}
