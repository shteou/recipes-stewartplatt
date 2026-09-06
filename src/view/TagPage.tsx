/**
 * A single tag page: every recipe carrying `tag`, linking to its recipe page.
 * Generated once per tag that has >=1 recipe (DESIGN.md §5.2) —
 * `build/index.ts` decides which tags qualify; this component just renders
 * whatever list it's given.
 */

import type { Recipe } from "../core/schema.js";
import type { TaxonomyEntry } from "../core/taxonomy.js";
import { HeadAssets, SiteBar, ThemeToggleScript } from "./SiteChrome.js";

export interface TagPageProps {
  tag: string;
  entry: TaxonomyEntry;
  recipes: Recipe[];
}

export function TagPage({ tag, entry, recipes }: TagPageProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{entry.label} recipes</title>
        <HeadAssets />
      </head>
      <body>
        <SiteBar />
        <main class="page">
          <h1>{entry.label}</h1>
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
