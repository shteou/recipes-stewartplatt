/**
 * Kitchen mode steps view (DESIGN.md §5.7): terse `short` phrasing (falling
 * back to `text` when a step has none), `idle` steps skipped entirely (that's
 * what `vm.activeSteps` already is — see `core/present.ts`/`core/steps.ts`).
 *
 * Stage 9 adds two sub-views toggled within Kitchen mode, sharing one set of
 * per-step checkboxes:
 *   - "Checklist" — the original full list, all steps/checkboxes visible at
 *     once. This remains the default-visible sub-view (SSR/first paint is
 *     unchanged from pre-Stage-9 behaviour).
 *   - "One at a time" — exactly one step shown, with Back/Next buttons and a
 *     "Step N of M" progress indicator.
 *
 * Both sub-views are always rendered (one `hidden`, following the same
 * SSR-renders-both-toggle-visibility pattern the top-level steps-view
 * switcher uses) — `hydrate.tsx` flips which is hidden and never needs a
 * `present()` recompute to do so.
 *
 * Checkboxes carry a stable `data-key` (`step-{index}`, `index` being the
 * position in `vm.activeSteps`, which stays fixed across a `present()`
 * recompute) so client-side hydration can track/restore "checked" state
 * across a full re-render of this section. The one-at-a-time sub-view's
 * checkbox for the current step reuses the *same* `data-key` as its
 * checklist counterpart — both are driven from the same `checkedKeys.kitchen`
 * Set in `hydrate.tsx` (the single source of truth for "which steps are
 * done"), and `currentIndex`/`submode` are supplied by `hydrate.tsx` as props
 * (rather than tracked internally) so a full re-render — whether triggered by
 * a servings/unit/substitution change or by Back/Next/sub-view navigation —
 * always reflects the live client-side state rather than resetting to
 * defaults.
 *
 * The inline `<style>` block below is this stage's *explicit, narrow*
 * exception to "no CSS yet" (that's Stage 10's job): Kitchen-mode-only
 * touch-target/type sizing, nothing about colour/palette. It's embedded here
 * (rather than linked from `Layout.tsx`, which this stage doesn't touch)
 * because this component is the one place Stage 9 is allowed to add markup;
 * `dangerouslySetInnerHTML` is used so the raw CSS (which needs literal `"`
 * in attribute selectors) isn't HTML-entity-escaped the way a plain JSX text
 * child would be.
 */

import type { RecipeViewModel } from "../core/present.js";

export type KitchenSubmode = "checklist" | "single";

export interface StepsKitchenProps {
  vm: RecipeViewModel;
  /** Which step the "one at a time" sub-view shows. Ignored by the checklist sub-view. Defaults to the first step, matching pre-hydration SSR. */
  currentIndex?: number;
  /** Which sub-view is visible. Defaults to "checklist", matching pre-Stage-9 behaviour. */
  submode?: KitchenSubmode;
}

const KITCHEN_MODE_STYLES = `
.steps-kitchen-checklist,
.steps-kitchen-single {
  font-size: 1.35rem;
  line-height: 1.5;
  margin-top: 1rem;
}
.steps-kitchen-checklist label,
.steps-kitchen-single label {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.6rem 0.25rem;
}
.steps-kitchen-checklist input[type="checkbox"],
.steps-kitchen-single input[type="checkbox"] {
  width: 1.05rem;
  height: 1.05rem;
  accent-color: var(--color-accent);
  flex-shrink: 0;
}
.kitchen-submode-switcher {
  margin: 0 0 1rem;
}
.kitchen-submode-switcher button,
.steps-kitchen-nav button {
  font-size: 0.95rem;
  padding: 0.4rem 0.85rem;
  min-height: 2rem;
}
.steps-kitchen-progress {
  font-size: 1.15rem;
  font-weight: bold;
}
`;

export function StepsKitchen({ vm, currentIndex = 0, submode = "checklist" }: StepsKitchenProps) {
  const steps = vm.activeSteps;
  const clampedIndex = steps.length === 0 ? 0 : Math.min(Math.max(currentIndex, 0), steps.length - 1);
  const currentStep = steps[clampedIndex];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KITCHEN_MODE_STYLES }} />

      <nav aria-label="Kitchen mode sub-view switcher" class="kitchen-submode-switcher">
        <button type="button" data-kitchen-submode-target="checklist" aria-pressed={submode === "checklist"}>
          Checklist
        </button>
        <button type="button" data-kitchen-submode-target="single" aria-pressed={submode === "single"}>
          One at a time
        </button>
      </nav>

      <ol class="steps-kitchen-checklist" data-kitchen-submode="checklist" hidden={submode !== "checklist"}>
        {steps.map((step, index) => (
          <li key={index} data-accent={step.accent}>
            <label>
              <input type="checkbox" data-key={`step-${index}`} />
              {step.short ?? step.text}
            </label>
          </li>
        ))}
      </ol>

      <div class="steps-kitchen-single" data-kitchen-submode="single" hidden={submode !== "single"}>
        {currentStep ? (
          <>
            <p class="steps-kitchen-progress">
              Step {clampedIndex + 1} of {steps.length}
            </p>
            <div key={clampedIndex} data-accent={currentStep.accent}>
              <label>
                <input type="checkbox" data-key={`step-${clampedIndex}`} />
                {currentStep.short ?? currentStep.text}
              </label>
            </div>
            <div class="steps-kitchen-nav">
              <button type="button" data-kitchen-step-nav="back" disabled={clampedIndex === 0}>
                Back
              </button>
              <button type="button" data-kitchen-step-nav="next" disabled={clampedIndex === steps.length - 1}>
                Next
              </button>
            </div>
          </>
        ) : (
          <p>No steps.</p>
        )}
      </div>
    </>
  );
}
