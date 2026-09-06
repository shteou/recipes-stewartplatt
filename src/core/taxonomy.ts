/**
 * Tag taxonomy — the single source of truth for which tags are "known".
 *
 * Every tag used in `content/recipes/*.md` frontmatter must appear here.
 * `parseRecipe` (see `./schema.ts`) rejects any tag not present in this
 * table, which catches typos (e.g. `vegitarian`) at validation time instead
 * of letting them render silently.
 *
 * `facet` groups tags for display (e.g. a tag cloud grouped by facet rather
 * than one undifferentiated row). `flag` is the path to a cuisine's flag
 * icon under `assets/flags/`, used as the default `featured_image` for
 * recipes of that cuisine.
 */

export type Facet = "cuisine" | "diet" | "type" | "ingredient";

export interface TaxonomyEntry {
  facet: Facet;
  label: string;
  flag?: string;
}

/**
 * Every tag actually present across the 3 current recipes
 * (marsala, mixed-dal-tadka, skhug), plus their facet/label/flag.
 */
export const TAXONOMY: Record<string, TaxonomyEntry> = {
  // cuisine
  yemeni: { facet: "cuisine", label: "Yemeni", flag: "/flags/ye.svg" },
  israeli: { facet: "cuisine", label: "Israeli", flag: "/flags/il.svg" },
  italian: { facet: "cuisine", label: "Italian", flag: "/flags/it.svg" },
  indian: { facet: "cuisine", label: "Indian", flag: "/flags/in.svg" },

  // diet
  vegetarian: { facet: "diet", label: "Vegetarian" },
  vegan: { facet: "diet", label: "Vegan" },

  // dish type
  condiment: { facet: "type", label: "Condiment" },

  // main ingredient
  chicken: { facet: "ingredient", label: "Chicken" },
  lentils: { facet: "ingredient", label: "Lentils" },
};

export function isKnownTag(tag: string): boolean {
  return Object.prototype.hasOwnProperty.call(TAXONOMY, tag);
}
