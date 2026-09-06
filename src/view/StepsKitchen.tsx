/**
 * Kitchen mode steps view (DESIGN.md §5.7): terse `short` phrasing (falling
 * back to `text` when a step has none).
 *
 * Stage 9 adds two sub-views toggled within Kitchen mode, sharing one set of
 * per-step checkboxes:
 *   - "Checklist" — the original full list, all steps/checkboxes visible at
 *     once, `idle` steps skipped entirely (that's what `vm.activeSteps`
 *     already is — see `core/present.ts`/`core/steps.ts`). This remains the
 *     default-visible sub-view (SSR/first paint is unchanged from
 *     pre-Stage-9 behaviour).
 *   - "One at a time" — exactly one step shown, with Back/Next buttons and a
 *     "Step N of M" progress indicator. Unlike the checklist, this sub-view
 *     iterates `vm.steps` (the *full*, unfiltered list) rather than
 *     `vm.activeSteps` — a later stage adds timer cards for `idle` steps
 *     (see below), and an idle wait is exactly the thing a phone-in-the-
 *     kitchen countdown is for, so it can't stay filtered out here the way
 *     it is in the checklist. `currentIndex` therefore indexes into
 *     `vm.steps`, not `vm.activeSteps` — the checklist doesn't read
 *     `currentIndex` at all, so this doesn't disturb it.
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
 * checklist counterpart (via `activeIndexOf`, a `vm.steps` index -> active
 * index lookup built below — `-1` for `idle` steps, which have no checklist
 * counterpart at all) — both are driven from the same `checkedKeys.kitchen`
 * Set in `hydrate.tsx` (the single source of truth for "which steps are
 * done"), and `currentIndex`/`submode` are supplied by `hydrate.tsx` as props
 * (rather than tracked internally) so a full re-render — whether triggered by
 * a servings/unit/substitution change or by Back/Next/sub-view navigation —
 * always reflects the live client-side state rather than resetting to
 * defaults.
 *
 * `timer` is likewise supplied by `hydrate.tsx`: this component never touches
 * `Date.now()` or a countdown interval itself, it just renders whatever
 * remaining-time snapshot it's handed for the currently-displayed `idle`
 * step (or nothing, if that step has no active timer / isn't idle). See
 * `hydrate.tsx`'s `syncKitchenTimerForCurrentStep`/`currentTimerProp` for the
 * actual timer state machine.
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

/** Ephemeral countdown snapshot for the idle step currently shown by the one-at-a-time sub-view; `null`/absent when that step has no running timer. */
export interface KitchenTimerState {
  /** Index into `vm.steps` (not `vm.activeSteps`) of the step this timer belongs to. */
  stepIndex: number;
  remainingMs: number;
  durationMs: number;
  finished: boolean;
}

export interface StepsKitchenProps {
  vm: RecipeViewModel;
  /** Which step (an index into `vm.steps`) the "one at a time" sub-view shows. Ignored by the checklist sub-view. Defaults to the first step, matching pre-hydration SSR. */
  currentIndex?: number;
  /** Which sub-view is visible. Defaults to "checklist", matching pre-Stage-9 behaviour. */
  submode?: KitchenSubmode;
  /** Countdown snapshot for the current step, when it's `idle` and a timer is running/finished for it. */
  timer?: KitchenTimerState | null;
}

/** `90000` -> `"1:30"`. Never negative (callers already clamp). */
function formatTimer(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
.steps-kitchen-timer-display {
  font-size: 2.5rem;
  font-weight: bold;
  font-variant-numeric: tabular-nums;
  margin: 0.5rem 0;
}
.steps-kitchen-timer-status {
  font-size: 1.1rem;
  margin: 0 0 0.5rem;
}
.steps-kitchen-timer-card button {
  font-size: 0.95rem;
  padding: 0.4rem 0.85rem;
  min-height: 2rem;
}
`;

export function StepsKitchen({ vm, currentIndex = 0, submode = "checklist", timer = null }: StepsKitchenProps) {
  const activeSteps = vm.activeSteps;
  const steps = vm.steps;
  const clampedIndex = steps.length === 0 ? 0 : Math.min(Math.max(currentIndex, 0), steps.length - 1);
  const currentStep = steps[clampedIndex];

  // vm.steps index -> vm.activeSteps index, so the one-at-a-time view's
  // checkbox for a non-idle step shares its `data-key` with the checklist's
  // (idle steps have no checklist counterpart, hence `-1`).
  let activeCounter = -1;
  const activeIndexOf = steps.map((step) => (step.idle ? -1 : ++activeCounter));

  const currentTimer = timer && timer.stepIndex === clampedIndex ? timer : null;

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
        {activeSteps.map((step, index) => (
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
            {currentStep.idle ? (
              <div key={clampedIndex} data-accent={currentStep.accent} class="steps-kitchen-timer-card">
                <p class="steps-kitchen-timer-status">{currentStep.short ?? currentStep.text}</p>
                {currentTimer ? (
                  <>
                    <p class="steps-kitchen-timer-display" aria-live="polite">
                      {currentTimer.finished ? "Time's up!" : formatTimer(currentTimer.remainingMs)}
                    </p>
                    <button type="button" data-kitchen-timer-restart={clampedIndex}>
                      Restart timer
                    </button>
                  </>
                ) : (
                  <p class="steps-kitchen-timer-status">
                    No timer available for this wait — carry on when ready.
                  </p>
                )}
              </div>
            ) : (
              <div key={clampedIndex} data-accent={currentStep.accent}>
                <label>
                  <input type="checkbox" data-key={`step-${activeIndexOf[clampedIndex]}`} />
                  {currentStep.short ?? currentStep.text}
                </label>
              </div>
            )}
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
