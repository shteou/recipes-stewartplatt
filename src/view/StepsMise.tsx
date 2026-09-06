/**
 * The Mise en place steps view (DESIGN.md §5.7): "a checkbox prep list (the
 * ingredients) plus the full method in order" — a prep checklist over
 * `vm.ingredients` (reusing each ingredient's already-resolved `.display`
 * string, per §5.6's note that Mise should reuse the real ingredients-list
 * data rather than re-deriving its own formatting), followed by every step
 * in original sequence (including `idle` ones — this is the *full* method,
 * unlike Kitchen mode which skips them).
 *
 * Checkboxes carry a stable `data-key` (position in `vm.ingredients`, which
 * stays fixed in length/order across a `present()` recompute — only a given
 * index's content changes under substitution/servings/unit changes) so
 * client-side hydration can track/restore "checked" state across a full
 * re-render of this section without it belonging to `ViewState` itself.
 *
 * Prep and Method are each wrapped in `.mise-section`, a card treatment
 * (tinted background, rounded corners, coloured left border) matching
 * `StepsGrouped.tsx`'s `.step-group` visual language, so Mise reads as
 * "boxed sections" like Grouped does — this is purely presentational; it
 * does not sub-group Method's steps by `step.group` (that stays Grouped's
 * job), Method is still one sequential list including idle steps.
 */

import type { RecipeViewModel } from "../core/present.js";

export interface StepsMiseProps {
  vm: RecipeViewModel;
}

export function StepsMise({ vm }: StepsMiseProps) {
  return (
    <div class="steps-mise">
      <section class="mise-section" aria-label="Prep checklist">
        <h4>Prep</h4>
        <ul class="mise-ingredients">
          {vm.ingredients.map((ingredient, index) => (
            <li key={ingredient.name} class={ingredient.substituted ? "substituted" : undefined}>
              <label>
                <input type="checkbox" data-key={`ingredient-${index}`} />
                {ingredient.display}
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section class="mise-section" aria-label="Method">
        <h4>Method</h4>
        <ol class="mise-method">
          {vm.steps.map((step, index) => (
            <li key={index} class={step.idle ? "idle" : undefined} data-accent={step.accent}>
              {step.text}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
