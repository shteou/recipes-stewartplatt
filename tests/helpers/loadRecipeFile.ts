/**
 * Test-only helper: split a `content/recipes/*.md` file into its YAML
 * frontmatter and markdown body, and parse the frontmatter with js-yaml.
 *
 * This is deliberately minimal test-fixture-loading plumbing, not part of
 * the `src/core` schema/validation surface (which stays dependency-light
 * per DESIGN.md's "core targets zero deps" ethos) — the real content-loading
 * module (`src/content/load.ts`) is a later build stage.
 */

import { readFileSync } from "node:fs";
import { load } from "js-yaml";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface LoadedRecipeFile {
  raw: unknown;
  sourceLabel: string;
}

export function loadRecipeFile(filePath: string): LoadedRecipeFile {
  const text = readFileSync(filePath, "utf-8");
  const match = FRONTMATTER_PATTERN.exec(text);
  if (!match) {
    throw new Error(`${filePath}: no YAML frontmatter block found`);
  }
  const [, frontmatterText, bodyText] = match;
  const frontmatter = load(frontmatterText);
  if (typeof frontmatter !== "object" || frontmatter === null) {
    throw new Error(`${filePath}: frontmatter did not parse to an object`);
  }
  return {
    raw: { ...frontmatter, body: bodyText.trim() },
    sourceLabel: filePath,
  };
}
