/**
 * Kitchen mode steps view (DESIGN.md §5.7): terse `short` phrasing (falling
 * back to `text` when a step has none).
 *
 * Stage 9 adds two sub-views toggled within Kitchen mode, sharing one set of
 * per-step checkboxes:
 *   - "Checklist" — the full list, all steps visible at once. `idle` steps
 *     render as a `TimerCard` (see below) instead of a checkbox row, sharing
 *     the exact same timer machinery/markup as the one-at-a-time view. This
 *     remains the default-visible sub-view (SSR/first paint is unchanged
 *     from pre-Stage-9 behaviour).
 *   - "One at a time" — exactly one step shown, with Back/Next buttons and a
 *     "Step N of M" progress indicator.
 *
 * Both sub-views iterate `vm.steps` (the *full*, unfiltered list), not
 * `vm.activeSteps` — idle waits need to be visible (and timeable) in both,
 * and `currentIndex` indexes into `vm.steps` accordingly.
 *
 * Both sub-views are always rendered (one `hidden`, following the same
 * SSR-renders-both-toggle-visibility pattern the top-level steps-view
 * switcher uses) — `hydrate.tsx` flips which is hidden and never needs a
 * `present()` recompute to do so.
 *
 * Checkboxes carry a stable `data-key` (`step-{index}`, `index` being the
 * position in `vm.activeSteps`, which stays fixed across a `present()`
 * recompute) so client-side hydration can track/restore "checked" state
 * across a full re-render of this section. Both sub-views' checkbox for a
 * given non-idle step reuse the *same* `data-key` (via `activeIndexOf`, a
 * `vm.steps` index -> active index lookup built below — `-1` for `idle`
 * steps, which have no checkbox at all) — both are driven from the same
 * `checkedKeys.kitchen` Set in `hydrate.tsx` (the single source of truth for
 * "which steps are done"), and `currentIndex`/`submode` are supplied by
 * `hydrate.tsx` as props (rather than tracked internally) so a full
 * re-render — whether triggered by a servings/unit/substitution change or by
 * Back/Next/sub-view navigation — always reflects the live client-side state
 * rather than resetting to defaults.
 *
 * `timers` is likewise supplied by `hydrate.tsx`, keyed by `vm.steps` index:
 * this component never touches `Date.now()` or a countdown interval itself,
 * it just renders whatever remaining-time snapshot it's handed for each
 * `idle` step that has a prepared timer (absent from the map entirely means
 * no derivable duration for that step — see `TimerCard` below). Timers
 * require an explicit manual start — a `"not-started"` timer renders its
 * full duration alongside a Start button rather than counting down on its
 * own. See `hydrate.tsx`'s `prepareIdleTimers`/`toTimerState` for the actual
 * timer state machine, which tracks *every* idle step at once (not just the
 * currently-displayed one) precisely so the checklist can show them all
 * simultaneously.
 *
 * The inline `<style>` block below is this stage's *explicit, narrow*
 * exception to "no CSS yet" (that's Stage 10's job): Kitchen-mode-only
 * touch-target/type sizing, nothing about colour/palette. It's embedded here
 * (rather than linked from `Layout.tsx`, which this stage doesn't touch)
 * because this component is the one place Stage 9 is allowed to add markup;
 * `dangerouslySetInnerHTML` is used so the raw CSS (which needs literal `"`
 * in attribute selectors) isn't HTML-entity-escaped the way a plain JSX text
 * child would be. It also carries the `:fullscreen` styling for Kitchen
 * mode's full-screen toggle (see `data-kitchen-fullscreen-toggle` below) —
 * the Fullscreen API takes the target element out of normal document flow
 * into the browser's own top-layer, so it no longer inherits the page's
 * background/text colour from `theme.css` and needs those reasserted
 * explicitly for the requested element.
 */

import type { RecipeViewModel, ResolvedStep } from "../core/present.js";

export type KitchenSubmode = "checklist" | "single";

/** Ephemeral countdown snapshot for one `idle` step; a step absent from the `timers` map has no derivable duration at all. */
export interface KitchenTimerState {
  /** Index into `vm.steps` (not `vm.activeSteps`) of the step this timer belongs to. */
  stepIndex: number;
  remainingMs: number;
  durationMs: number;
  /** "not-started": prepared but awaiting a manual Start; timers never count down on their own. */
  status: "not-started" | "running" | "finished";
}

export interface StepsKitchenProps {
  vm: RecipeViewModel;
  /** Which step (an index into `vm.steps`) the "one at a time" sub-view shows. Ignored by the checklist sub-view. Defaults to the first step, matching pre-hydration SSR. */
  currentIndex?: number;
  /** Which sub-view is visible. Defaults to "checklist", matching pre-Stage-9 behaviour. */
  submode?: KitchenSubmode;
  /** Every `idle` step's timer, keyed by its `vm.steps` index. A step with no entry has no derivable duration. */
  timers?: Map<number, KitchenTimerState>;
  /** Whether `#steps-kitchen` is currently the browser's fullscreen element. */
  isFullscreen?: boolean;
  /**
   * Whether the Fullscreen API is actually usable here — `false` (the SSR
   * default) hides the toggle entirely rather than showing a button that
   * silently does nothing. Notably `false` on iOS Safari, which doesn't
   * support fullscreening an arbitrary element — exactly the "phone in the
   * kitchen" device this feature targets, so hiding it matters more than it
   * might elsewhere. `hydrate.tsx` sets this from `document.fullscreenEnabled`.
   */
  fullscreenSupported?: boolean;
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
.kitchen-toolbar {
  margin: 0 0 1rem;
}
.kitchen-submode-switcher button,
.steps-kitchen-nav button,
.steps-kitchen-fullscreen-toggle button {
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
#steps-kitchen:fullscreen {
  background: var(--color-ground);
  color: var(--color-text);
  overflow-y: auto;
  padding: 1.5rem;
  box-sizing: border-box;
}
`;

/** Shared idle-step rendering for both sub-views: a step's terse text plus its timer (or a "no timer" fallback), driven entirely by the `timer` snapshot handed down from `hydrate.tsx`. */
function TimerCard({ step, timer }: { step: ResolvedStep; timer: KitchenTimerState | null }) {
  return (
    <div data-accent={step.accent} class="steps-kitchen-timer-card">
      <p class="steps-kitchen-timer-status">{step.short ?? step.text}</p>
      {timer ? (
        <>
          <p class="steps-kitchen-timer-display" aria-live="polite">
            {timer.status === "finished" ? "Time's up!" : formatTimer(timer.remainingMs)}
          </p>
          {timer.status === "not-started" ? (
            <button type="button" data-kitchen-timer-start={timer.stepIndex}>
              Start timer
            </button>
          ) : (
            <button type="button" data-kitchen-timer-restart={timer.stepIndex}>
              Restart timer
            </button>
          )}
        </>
      ) : (
        <p class="steps-kitchen-timer-status">No timer available for this wait — carry on when ready.</p>
      )}
    </div>
  );
}

export function StepsKitchen({
  vm,
  currentIndex = 0,
  submode = "checklist",
  timers = new Map(),
  isFullscreen = false,
  fullscreenSupported = false,
}: StepsKitchenProps) {
  const steps = vm.steps;
  const clampedIndex = steps.length === 0 ? 0 : Math.min(Math.max(currentIndex, 0), steps.length - 1);
  const currentStep = steps[clampedIndex];

  // vm.steps index -> vm.activeSteps index, so both sub-views' checkbox for
  // a non-idle step share the same `data-key` (idle steps have no checkbox
  // at all, hence `-1`).
  let activeCounter = -1;
  const activeIndexOf = steps.map((step) => (step.idle ? -1 : ++activeCounter));

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KITCHEN_MODE_STYLES }} />

      <div class="kitchen-toolbar">
        <nav aria-label="Kitchen mode sub-view switcher" class="kitchen-submode-switcher">
          <button type="button" data-kitchen-submode-target="checklist" aria-pressed={submode === "checklist"}>
            Checklist
          </button>
          <button type="button" data-kitchen-submode-target="single" aria-pressed={submode === "single"}>
            One at a time
          </button>
        </nav>

        {fullscreenSupported && (
          <nav aria-label="Kitchen mode full-screen toggle" class="steps-kitchen-fullscreen-toggle">
            <button type="button" data-kitchen-fullscreen-toggle aria-pressed={isFullscreen}>
              {isFullscreen ? "Exit full screen" : "Full screen"}
            </button>
          </nav>
        )}
      </div>

      <ol class="steps-kitchen-checklist" data-kitchen-submode="checklist" hidden={submode !== "checklist"}>
        {steps.map((step, index) =>
          step.idle ? (
            <li key={index}>
              <TimerCard step={step} timer={timers.get(index) ?? null} />
            </li>
          ) : (
            <li key={index} data-accent={step.accent}>
              <label>
                <input type="checkbox" data-key={`step-${activeIndexOf[index]}`} />
                {step.short ?? step.text}
              </label>
            </li>
          ),
        )}
      </ol>

      <div class="steps-kitchen-single" data-kitchen-submode="single" hidden={submode !== "single"}>
        {currentStep ? (
          <>
            <p class="steps-kitchen-progress">
              Step {clampedIndex + 1} of {steps.length}
            </p>
            {currentStep.idle ? (
              <TimerCard key={clampedIndex} step={currentStep} timer={timers.get(clampedIndex) ?? null} />
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
