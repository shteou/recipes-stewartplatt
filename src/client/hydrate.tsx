/**
 * Client-side hydration for a recipe page: wires up the servings +/-
 * buttons, unit toggle, substitution badges and steps-view switcher that
 * `Layout.tsx` renders inert at SSR time, and reapplies Kitchen/Mise
 * checked-state across re-renders.
 *
 * No-ops harmlessly on any page with no `#recipe-data` script tag (home,
 * tag pages) — those never load this script's page from `Layout.tsx` in the
 * first place, but this file is defensive regardless.
 *
 * Architecture (per the stage brief's decisions):
 *   - `ViewState` lives purely in memory (`servings`, `unitSystem`,
 *     `stepsView`, `activeSubstitutions`), reconstructed from what the SSR'd
 *     DOM actually shows rather than hardcoded defaults, and only
 *     servings/unit/substitution changes trigger a fresh `present()` call —
 *     switching steps-view tabs is pure visibility toggling.
 *   - Every state change re-renders full regions from scratch (ingredients +
 *     all 4 steps-view sections) using the *same* Preact components used for
 *     SSR (`IngredientList`, `StepsGrouped`, `StepsTimeline`, `StepsMise`,
 *     `StepsKitchen`) via `render()` — no parallel DOM-templating.
 *   - Kitchen/Mise checkbox "checked" state is independent client-only UI
 *     state (not part of `ViewState`), tracked here in two `Set<string>`s
 *     keyed by each checkbox's `data-key` and reapplied after every
 *     steps-section re-render so it survives a servings/unit/substitution
 *     change triggered elsewhere.
 *   - Focus is restored after a steps-section re-render if the previously
 *     focused element (matched by `data-key`) has a counterpart in the fresh
 *     markup — the only focusable elements inside those four sections are
 *     the Mise/Kitchen checkboxes.
 */

import { render, type ComponentChild } from "preact";
import type { Recipe } from "../core/schema.js";
import { present, type ViewState, type UnitSystem, type StepsViewMode } from "../core/present.js";
import { IngredientList } from "../view/IngredientList.js";
import { StepsGrouped } from "../view/StepsGrouped.js";
import { StepsTimeline } from "../view/StepsTimeline.js";
import { StepsMise } from "../view/StepsMise.js";
import { StepsKitchen, type KitchenSubmode, type KitchenTimerState } from "../view/StepsKitchen.js";

const STEPS_VIEW_MODES: StepsViewMode[] = ["grouped", "timeline", "mise", "kitchen"];

function init(): void {
  const dataScript = document.getElementById("recipe-data");
  if (!dataScript?.textContent) return; // not a recipe page (or malformed) — nothing to hydrate

  let recipe: Recipe;
  try {
    recipe = JSON.parse(dataScript.textContent) as Recipe;
  } catch {
    return; // malformed embedded data — fail harmlessly, leave the static markup as-is
  }

  const servingsSection = document.querySelector<HTMLElement>(".servings-widget");
  const unitToggleSection = document.querySelector<HTMLElement>(".unit-toggle");
  const substitutionsSection = document.querySelector<HTMLElement>(".substitutions");
  const ingredientsMount = document.getElementById("ingredients-list");
  const switcherNav = document.querySelector<HTMLElement>(".steps-view-switcher");

  const stepsSections: Record<StepsViewMode, HTMLElement | null> = {
    grouped: document.getElementById("steps-grouped"),
    timeline: document.getElementById("steps-timeline"),
    mise: document.getElementById("steps-mise"),
    kitchen: document.getElementById("steps-kitchen"),
  };

  if (!servingsSection || !ingredientsMount || !switcherNav) return; // markup doesn't match the expected contract — bail defensively

  // -------------------------------------------------------------------
  // Reconstruct initial ViewState from the SSR'd DOM
  // -------------------------------------------------------------------

  const initialUnitSystem: UnitSystem = (() => {
    const active = unitToggleSection?.querySelector<HTMLButtonElement>('[data-active="true"]');
    const system = active?.dataset.unitSystem;
    return system === "metric" || system === "imperial" || system === "as-written" ? system : "as-written";
  })();

  const initialStepsView: StepsViewMode = (() => {
    for (const mode of STEPS_VIEW_MODES) {
      const section = stepsSections[mode];
      if (section && !section.hasAttribute("hidden")) return mode;
    }
    return "grouped";
  })();

  const activeSubstitutions = new Set<string>();
  substitutionsSection?.querySelectorAll<HTMLButtonElement>('[aria-pressed="true"]').forEach((btn) => {
    if (btn.dataset.substitution) activeSubstitutions.add(btn.dataset.substitution);
  });

  // The servings widget's base is `recipe.servings` (what `build/index.ts`
  // used for the SSR default view state) rather than trying to re-parse the
  // fraction-glyph-formatted `.servings-value` text back into a number.
  const viewState: ViewState = {
    servings: recipe.servings,
    activeSubstitutions,
    unitSystem: initialUnitSystem,
    stepsView: initialStepsView,
  };

  // -------------------------------------------------------------------
  // URL query-string override — `servings`/`units`/`sub` only (`stepsView`
  // is explicitly not part of the URL scheme). Applied to the DOM-derived
  // `viewState` above before anything reads it, so the first render already
  // reflects the URL rather than flashing the SSR default first.
  //
  // Encoding (must stay symmetric with `syncUrl` below):
  //   - `servings`: a finite positive number, e.g. `?servings=8`.
  //   - `units`: exactly one of `metric`/`imperial`/`as-written`.
  //   - `sub`: comma-separated substitution labels, e.g.
  //     `?sub=Make+this+vegan,also+this`. Labels are joined/split on a raw
  //     (unescaped) comma — `URLSearchParams` itself takes care of
  //     percent-/`+`-encoding the rest of each label (spaces etc., and even
  //     a literal comma *inside* a label, since it round-trips through
  //     `%2C`) when the query string is built and parsed, so there's no
  //     manual `encodeURIComponent`/`decodeURIComponent` here — doing that
  //     on top of `URLSearchParams` would double-encode. Only labels that
  //     match a real `recipe.substitutions[].label` are honoured; anything
  //     else is silently dropped rather than erroring.
  // -------------------------------------------------------------------

  const validSubstitutionLabels = new Set((recipe.substitutions ?? []).map((s) => s.label));

  // -------------------------------------------------------------------
  // localStorage override — restores servings/units/steps-view/
  // substitutions/checklist-progress from the last visit to this recipe,
  // scoped by `recipe.slug` (stable across paths, unlike `location.pathname`)
  // so different recipes never clobber each other's saved state.
  //
  // Applied before the URL override below, so an explicit URL query param
  // (e.g. a shared link with `?servings=8`) always wins over a previously
  // saved choice — the URL is the more explicit, intentional signal.
  //
  // Every localStorage access is wrapped in try/catch: private browsing,
  // disabled storage, or quota errors must never break the page, exactly
  // like the JSON.parse guard above and the wake-lock handling below.
  // -------------------------------------------------------------------

  const STORAGE_KEY = `recipe-view-state:${recipe.slug}`;

  interface StoredViewState {
    servings?: number;
    unitSystem?: UnitSystem;
    stepsView?: StepsViewMode;
    activeSubstitutions?: string[];
    checkedKeys?: { mise?: string[]; kitchen?: string[] };
    kitchenSubmode?: KitchenSubmode;
    kitchenStepIndex?: number;
  }

  function loadStoredState(): StoredViewState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredViewState) : null;
    } catch {
      return null;
    }
  }

  function clearStoredState(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore — nothing to clear if storage isn't available
    }
  }

  const stored = loadStoredState();
  if (stored) {
    if (typeof stored.servings === "number" && Number.isFinite(stored.servings) && stored.servings > 0) {
      viewState.servings = stored.servings;
    }
    if (stored.unitSystem === "metric" || stored.unitSystem === "imperial" || stored.unitSystem === "as-written") {
      viewState.unitSystem = stored.unitSystem;
    }
    if (stored.stepsView && STEPS_VIEW_MODES.includes(stored.stepsView)) {
      viewState.stepsView = stored.stepsView;
    }
    if (Array.isArray(stored.activeSubstitutions)) {
      activeSubstitutions.clear();
      for (const label of stored.activeSubstitutions) {
        if (validSubstitutionLabels.has(label)) activeSubstitutions.add(label);
      }
    }
  }

  {
    const params = new URLSearchParams(location.search);

    const servingsParam = params.get("servings");
    if (servingsParam !== null) {
      const parsed = Number.parseFloat(servingsParam);
      if (Number.isFinite(parsed) && parsed > 0) viewState.servings = parsed;
    }

    const unitsParam = params.get("units");
    if (unitsParam === "metric" || unitsParam === "imperial" || unitsParam === "as-written") {
      viewState.unitSystem = unitsParam;
    }

    const subParam = params.get("sub");
    if (subParam !== null) {
      const labels = subParam.split(",").filter((label) => validSubstitutionLabels.has(label));
      if (labels.length > 0 || subParam === "") {
        activeSubstitutions.clear();
        for (const label of labels) activeSubstitutions.add(label);
      }
    }
  }

  // Reflect the (possibly URL-overridden) initial state on the unit-toggle
  // buttons and substitution badges before the first `recompute()` — so a
  // page loaded with e.g. `?units=metric` doesn't show metric-converted
  // ingredients alongside an "as-written" toggle still marked active.
  unitToggleSection?.querySelectorAll<HTMLButtonElement>("[data-unit-system]").forEach((btn) => {
    const isActive = btn.dataset.unitSystem === viewState.unitSystem;
    btn.setAttribute("aria-pressed", String(isActive));
    if (isActive) btn.setAttribute("data-active", "true");
    else btn.removeAttribute("data-active");
  });
  substitutionsSection?.querySelectorAll<HTMLButtonElement>(".substitution-badge").forEach((btn) => {
    const isActive = !!btn.dataset.substitution && activeSubstitutions.has(btn.dataset.substitution);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  // Same idea for the steps-view switcher: before this stage, `viewState`
  // could only diverge from the SSR-derived default ("grouped" visible) via
  // user interaction, so the click handler was the only place `hidden` got
  // toggled. Now a restored `stepsView` (from localStorage) can disagree
  // with the DOM on first paint, so it needs the same explicit sync here.
  for (const mode of STEPS_VIEW_MODES) {
    const section = stepsSections[mode];
    if (section) section.hidden = mode !== viewState.stepsView;
  }
  switcherNav.querySelectorAll<HTMLButtonElement>("[data-view-target]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.viewTarget === viewState.stepsView));
  });
  // A restored "kitchen" stepsView should hold the wake lock immediately,
  // same as if the user had just clicked into it — `acquireWakeLock` is
  // declared below but hoisted (function declaration), so this call is safe.
  if (viewState.stepsView === "kitchen") void acquireWakeLock();

  // -------------------------------------------------------------------
  // Sync ViewState -> URL, mirroring the parsing above. Called after every
  // change to servings/unitSystem/activeSubstitutions. Uses replaceState
  // (never pushState) so clicking controls doesn't pollute back-history.
  // Only the `servings`/`units`/`sub` keys are touched — any other query
  // params a future stage might add are left alone.
  // -------------------------------------------------------------------

  function syncUrl(): void {
    const params = new URLSearchParams(location.search);

    if (viewState.servings === recipe.servings) params.delete("servings");
    else params.set("servings", String(viewState.servings));

    if (viewState.unitSystem === "as-written") params.delete("units");
    else params.set("units", viewState.unitSystem);

    const subs = [...activeSubstitutions];
    if (subs.length === 0) params.delete("sub");
    else params.set("sub", subs.join(","));

    const query = params.toString();
    const newUrl = location.pathname + (query ? `?${query}` : "") + location.hash;
    history.replaceState(null, "", newUrl);
  }

  // -------------------------------------------------------------------
  // Checked-state tracking (Kitchen mode / Mise checklist) — independent of
  // ViewState/present(), never wiped by a re-render triggered elsewhere.
  // -------------------------------------------------------------------

  const checkedKeys = {
    mise: new Set<string>(),
    kitchen: new Set<string>(),
  };
  for (const key of stored?.checkedKeys?.mise ?? []) checkedKeys.mise.add(key);
  for (const key of stored?.checkedKeys?.kitchen ?? []) checkedKeys.kitchen.add(key);

  // Persists the full restorable state (servings/units/steps-view/
  // substitutions/checklist progress/kitchen sub-view+step position) to
  // localStorage — called after every change to any of those, mirroring
  // `syncUrl`'s "call after every change" convention. Also wrapped
  // defensively; see the loadStoredState comment.
  //
  // Deliberately excludes the timer's own running state (`kitchenTimer`) —
  // timers require an explicit manual start (see below), so restoring one
  // as already-running after a reload would contradict that; the user just
  // presses Start again for the same idle step.
  function persistState(): void {
    try {
      const data: StoredViewState = {
        servings: viewState.servings,
        unitSystem: viewState.unitSystem,
        stepsView: viewState.stepsView,
        activeSubstitutions: [...activeSubstitutions],
        checkedKeys: {
          mise: [...checkedKeys.mise],
          kitchen: [...checkedKeys.kitchen],
        },
        kitchenSubmode,
        kitchenStepIndex,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore — private browsing, disabled storage, quota, etc.
    }
  }

  // Tracks which checkbox DOM nodes already have a `change` listener attached
  // — needed because Kitchen mode can now have *two* live checkboxes sharing
  // one `data-key` (the checklist row and, when it's the current step, the
  // one-at-a-time view), and because Preact's diffing can reuse an existing
  // checkbox element across a `bindChecklist` re-run (e.g. re-rendering the
  // Kitchen section just to flip sub-view/step, with the underlying steps
  // unchanged) — without this guard, re-running `bindChecklist` on a reused
  // element would stack a duplicate listener on it every time.
  const boundBoxes = new WeakSet<HTMLInputElement>();

  function bindChecklist(kind: "mise" | "kitchen"): void {
    const container = stepsSections[kind];
    if (!container) return;
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-key]');
    boxes.forEach((box) => {
      const key = box.dataset.key ?? "";
      box.checked = checkedKeys[kind].has(key);
      if (boundBoxes.has(box)) return;
      boundBoxes.add(box);
      box.addEventListener("change", () => {
        if (box.checked) checkedKeys[kind].add(key);
        else checkedKeys[kind].delete(key);
        persistState();
        // Kitchen mode only: a checklist row and the one-at-a-time view can
        // both display the same step (same `data-key`) at once — keep the
        // other instance's visual checked-state in sync immediately, rather
        // than waiting for its next re-render, so switching sub-views never
        // shows stale state.
        if (kind === "kitchen") {
          container.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][data-key="${CSS.escape(key)}"]`).forEach((twin) => {
            twin.checked = box.checked;
          });
        }
      });
    });
  }

  // -------------------------------------------------------------------
  // Kitchen mode sub-view state (checklist vs. one-at-a-time) — like
  // `checkedKeys`, this is client-only UI state independent of `ViewState`:
  // switching sub-view or stepping through the one-at-a-time view never
  // triggers a `present()` recompute, just a re-render of the Kitchen
  // section's own markup fed by `lastVm` (see `renderKitchenSection` below).
  //
  // `kitchenStepIndex` indexes into `vm.steps` (the full, unfiltered list —
  // see `StepsKitchen.tsx`'s docstring), not `vm.activeSteps`.
  //
  // Both are restored from localStorage (via `persistState`/`stored` above)
  // so returning to a recipe resumes exactly where Kitchen mode was left —
  // clamped against the recipe's own step count in case content changed
  // since the value was saved. The timer's *running* state is deliberately
  // NOT restored (see `persistState`'s comment): a restored idle step always
  // starts back in its not-yet-started state, requiring a fresh manual
  // Start.
  // -------------------------------------------------------------------

  let kitchenSubmode: KitchenSubmode =
    stored?.kitchenSubmode === "single" || stored?.kitchenSubmode === "checklist" ? stored.kitchenSubmode : "checklist";
  let kitchenStepIndex = 0;
  if (stored && typeof stored.kitchenStepIndex === "number" && Number.isInteger(stored.kitchenStepIndex)) {
    const maxIndex = Math.max(0, (recipe.steps?.length ?? 1) - 1);
    kitchenStepIndex = Math.min(Math.max(stored.kitchenStepIndex, 0), maxIndex);
  }
  let lastVm: ReturnType<typeof present> | null = null;

  // -------------------------------------------------------------------
  // Kitchen mode: idle-step countdown timer.
  //
  // `Step.time` is "minutes remaining until done, counting down to 0" (see
  // `core/schema.ts`), not a per-step duration — so an idle step's own wait
  // duration is derived as the delta between it and the *previous* full
  // step's `time` (idle steps occupy real time on the countdown just like
  // active ones, so `vm.steps`, not `vm.activeSteps`, is the right list to
  // walk). There's no previous step to diff against when `stepIndex === 0`
  // (an idle step can't meaningfully be the very first step in a recipe
  // written this way, but nothing stops content from doing it) — that case
  // has no derivable duration, and `StepsKitchen` renders a no-timer message
  // instead of guessing.
  //
  // Uses a wall-clock `startedAt` timestamp + fixed `durationMs`, with
  // remaining time always recomputed from `Date.now()` (never a
  // decrementing tick counter), so an interval throttled or entirely paused
  // by a backgrounded tab still reports the correct remaining time the
  // moment it's checked again — exactly the same reasoning as this file's
  // wake-lock handling below.
  //
  // Timers require an explicit manual start: arriving at an idle step (via
  // Back/Next, a sub-view switch, or a restored `kitchenStepIndex`/
  // `kitchenSubmode`) only ever prepares a *not-started* timer entry
  // (`startedAt: null`) showing its full duration — it never starts
  // counting down on its own. Ticking begins only from the
  // `data-kitchen-timer-start` click handler below.
  // -------------------------------------------------------------------

  interface KitchenTimer {
    stepIndex: number;
    /** `null` until the user explicitly presses Start. */
    startedAt: number | null;
    durationMs: number;
    finished: boolean;
  }

  let kitchenTimer: KitchenTimer | null = null;
  let kitchenTimerIntervalId: number | null = null;

  /** The idle wait duration (minutes) for `vm.steps[stepIndex]`, or 0 when it can't be derived (see above). */
  function idleDurationMinutes(vm: ReturnType<typeof present>, stepIndex: number): number {
    if (stepIndex <= 0) return 0;
    const previous = vm.steps[stepIndex - 1]?.time;
    const current = vm.steps[stepIndex]?.time;
    if (typeof previous !== "number" || typeof current !== "number") return 0;
    return Math.max(0, previous - current);
  }

  function playTimerAlert(): void {
    // Web Audio API beep — wrapped defensively: autoplay/audio policy can
    // reject this outright in some browsers/contexts, and that must never
    // surface as an error.
    try {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.6);
        oscillator.addEventListener("ended", () => void ctx.close().catch(() => {}));
      }
    } catch {
      // no Web Audio support, or blocked — silently skip the beep
    }
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Timer done", { body: "Your recipe's waiting step is finished." });
      }
    } catch {
      // Notification unsupported/blocked — silently skip
    }
    try {
      navigator.vibrate?.(200);
    } catch {
      // no vibration support — silently skip
    }
  }

  function stopKitchenTimerTicking(): void {
    if (kitchenTimerIntervalId !== null) {
      window.clearInterval(kitchenTimerIntervalId);
      kitchenTimerIntervalId = null;
    }
  }

  function startKitchenTimerTicking(): void {
    if (kitchenTimerIntervalId !== null) return;
    kitchenTimerIntervalId = window.setInterval(() => {
      if (!kitchenTimer || kitchenTimer.startedAt === null) {
        stopKitchenTimerTicking();
        return;
      }
      const remaining = kitchenTimer.durationMs - (Date.now() - kitchenTimer.startedAt);
      if (remaining <= 0 && !kitchenTimer.finished) {
        kitchenTimer.finished = true;
        playTimerAlert();
        stopKitchenTimerTicking(); // remaining stays clamped at 0 from here — nothing left to tick
      }
      renderKitchenSection();
    }, 500);
  }

  // Builds the `timer` prop for whichever step `kitchenStepIndex` currently
  // points at — `null` unless that exact step has a prepared timer entry
  // (started, running, or finished).
  function currentTimerProp(): KitchenTimerState | null {
    if (!kitchenTimer || kitchenTimer.stepIndex !== kitchenStepIndex) return null;
    if (kitchenTimer.startedAt === null) {
      return {
        stepIndex: kitchenTimer.stepIndex,
        remainingMs: kitchenTimer.durationMs,
        durationMs: kitchenTimer.durationMs,
        status: "not-started",
      };
    }
    const remainingMs = Math.max(0, kitchenTimer.durationMs - (Date.now() - kitchenTimer.startedAt));
    const finished = kitchenTimer.finished || remainingMs <= 0;
    return {
      stepIndex: kitchenTimer.stepIndex,
      remainingMs,
      durationMs: kitchenTimer.durationMs,
      status: finished ? "finished" : "running",
    };
  }

  // Requests notification permission tied to a genuine user gesture (a
  // Start/Restart click) — browsers require this for the prompt to appear
  // at all — and only asks once (`"default"` means "never asked").
  function requestNotificationPermissionIfUnasked(): void {
    try {
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => {});
      }
    } catch {
      // Notification API unsupported — silently skip
    }
  }

  // Prepares (without starting) a timer entry for the currently-displayed
  // step if it's `idle` and has a derivable duration, and resumes ticking if
  // the current step already has an already-*started*, unfinished timer
  // (e.g. the user navigated away mid-countdown and came back). Never starts
  // a fresh timer counting down on its own — that only happens from the
  // explicit `data-kitchen-timer-start` click handler below. Called after
  // every Back/Next/sub-view-switch interaction, and once on initial load if
  // a restored `kitchenStepIndex`/`kitchenSubmode` lands on an idle step.
  function syncKitchenTimerForCurrentStep(): void {
    if (!lastVm) return;
    const step = lastVm.steps[kitchenStepIndex];
    if (!step?.idle) {
      stopKitchenTimerTicking();
      return;
    }
    if (!kitchenTimer || kitchenTimer.stepIndex !== kitchenStepIndex) {
      stopKitchenTimerTicking(); // nothing to tick for a fresh, not-yet-started timer
      const durationMinutes = idleDurationMinutes(lastVm, kitchenStepIndex);
      kitchenTimer =
        durationMinutes > 0
          ? { stepIndex: kitchenStepIndex, startedAt: null, durationMs: durationMinutes * 60_000, finished: false }
          : null;
      return;
    }
    if (kitchenTimer.startedAt !== null && !kitchenTimer.finished) startKitchenTimerTicking();
  }

  // -------------------------------------------------------------------
  // Rendering — reuse the exact SSR components via Preact's render().
  //
  // The very first `render()` call into a container establishes Preact's
  // ownership of it (tracked per-container below); subsequent calls diff
  // against Preact's own previous tree. Since the container's existing
  // children on that first call are static SSR markup Preact didn't create,
  // clear them first — otherwise `render()` would insert alongside rather
  // than replace them.
  // -------------------------------------------------------------------

  const mounted = new WeakSet<HTMLElement>();

  function mount(container: HTMLElement, vnode: ComponentChild): void {
    if (!mounted.has(container)) {
      container.replaceChildren();
      mounted.add(container);
    }
    render(vnode, container);
  }

  function renderIngredients(vm: ReturnType<typeof present>): void {
    mount(ingredientsMount!, <IngredientList ingredients={vm.ingredients} />);
  }

  function renderStepsSections(vm: ReturnType<typeof present>): void {
    // Capture focus if it's currently on one of the checklist checkboxes
    // inside a steps section, so it can be restored after the re-render.
    const active = document.activeElement as HTMLElement | null;
    let refocus: { containerId: string; key: string } | null = null;
    if (active instanceof HTMLInputElement && active.dataset.key) {
      for (const section of Object.values(stepsSections)) {
        if (section?.contains(active)) {
          refocus = { containerId: section.id, key: active.dataset.key };
          break;
        }
      }
    }

    if (stepsSections.grouped) mount(stepsSections.grouped, <StepsGrouped vm={vm} />);
    if (stepsSections.timeline) mount(stepsSections.timeline, <StepsTimeline vm={vm} />);
    if (stepsSections.mise) mount(stepsSections.mise, <StepsMise vm={vm} />);
    if (stepsSections.kitchen) {
      mount(
        stepsSections.kitchen,
        <StepsKitchen vm={vm} currentIndex={kitchenStepIndex} submode={kitchenSubmode} timer={currentTimerProp()} />,
      );
    }

    bindChecklist("mise");
    bindChecklist("kitchen");

    if (refocus) {
      const container = document.getElementById(refocus.containerId);
      const target = container?.querySelector<HTMLElement>(`[data-key="${CSS.escape(refocus.key)}"]`);
      target?.focus();
    }
  }

  // Re-renders only the Kitchen section from the last-computed view model —
  // used by sub-view/step navigation, which never changes servings/units/
  // substitutions and so has no reason to re-run `present()`. Kept separate
  // from `renderStepsSections` (which re-renders *all four* steps sections
  // and is reserved for actual `ViewState` changes).
  function renderKitchenSection(): void {
    if (!stepsSections.kitchen || !lastVm) return;
    mount(
      stepsSections.kitchen,
      <StepsKitchen vm={lastVm} currentIndex={kitchenStepIndex} submode={kitchenSubmode} timer={currentTimerProp()} />,
    );
    bindChecklist("kitchen");
  }

  function recompute(): ReturnType<typeof present> {
    const vm = present(recipe, viewState);
    lastVm = vm;
    renderIngredients(vm);
    renderStepsSections(vm);
    return vm;
  }

  // -------------------------------------------------------------------
  // Servings +/-
  // -------------------------------------------------------------------

  const step = Number(servingsSection.dataset.step) || 1;
  const servingsValueEl = servingsSection.querySelector<HTMLElement>(".servings-value");
  const decreaseBtn = servingsSection.querySelector<HTMLButtonElement>('[aria-label="Decrease servings"]');
  const increaseBtn = servingsSection.querySelector<HTMLButtonElement>('[aria-label="Increase servings"]');

  function changeServings(delta: number): void {
    const next = viewState.servings + delta;
    // Never let servings drop to/below zero (or below one step's worth) —
    // scale.ts divides by recipe.servings, so a non-positive target would
    // produce a degenerate (zero/negative) scale factor.
    viewState.servings = next < step ? step : next;
    const vm = recompute();
    if (servingsValueEl) servingsValueEl.textContent = `${vm.servingsDisplay} ${vm.servingUnitDisplay}`;
    syncUrl();
    persistState();
  }

  decreaseBtn?.addEventListener("click", () => changeServings(-step));
  increaseBtn?.addEventListener("click", () => changeServings(step));

  // -------------------------------------------------------------------
  // Unit toggle
  // -------------------------------------------------------------------

  const unitButtons = unitToggleSection
    ? [...unitToggleSection.querySelectorAll<HTMLButtonElement>("[data-unit-system]")]
    : [];
  for (const btn of unitButtons) {
    btn.addEventListener("click", () => {
      const system = btn.dataset.unitSystem;
      if (system !== "metric" && system !== "imperial" && system !== "as-written") return;
      viewState.unitSystem = system;
      for (const b of unitButtons) {
        const isActive = b === btn;
        b.setAttribute("aria-pressed", String(isActive));
        if (isActive) b.setAttribute("data-active", "true");
        else b.removeAttribute("data-active");
      }
      recompute();
      syncUrl();
      persistState();
    });
  }

  // -------------------------------------------------------------------
  // Substitution badges
  // -------------------------------------------------------------------

  substitutionsSection?.querySelectorAll<HTMLButtonElement>(".substitution-badge").forEach((btn) => {
    btn.addEventListener("click", () => {
      const label = btn.dataset.substitution;
      if (!label) return;
      const nowActive = !activeSubstitutions.has(label);
      if (nowActive) activeSubstitutions.add(label);
      else activeSubstitutions.delete(label);
      btn.setAttribute("aria-pressed", String(nowActive));
      recompute();
      syncUrl();
      persistState();
    });
  });

  // -------------------------------------------------------------------
  // Screen wake lock — held only while the user is actually looking at
  // Kitchen mode. Feature-detected (`'wakeLock' in navigator`); every
  // failure path (unsupported, permission denied, whatever) silently no-ops
  // rather than surfacing anything to the user, per the stage brief.
  //
  // The browser itself releases a wake lock when the tab is hidden (spec
  // behaviour, not something to fight) — `visibilitychange` re-acquires on
  // return to a visible tab, but only if the user is still in Kitchen mode
  // at that point (they may have switched away while the tab was hidden).
  // -------------------------------------------------------------------

  let wakeLock: WakeLockSentinel | null = null;

  async function acquireWakeLock(): Promise<void> {
    if (!("wakeLock" in navigator)) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLock = sentinel;
      sentinel.addEventListener("release", () => {
        if (wakeLock === sentinel) wakeLock = null;
      });
    } catch {
      wakeLock = null; // e.g. permission denied, no supporting hardware, tab not visible — never throw
    }
  }

  function releaseWakeLock(): void {
    const sentinel = wakeLock;
    wakeLock = null;
    void sentinel?.release().catch(() => {});
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && viewState.stepsView === "kitchen" && !wakeLock) {
      void acquireWakeLock();
    }
  });

  // -------------------------------------------------------------------
  // Steps-view switcher — pure visibility toggle, no present() recompute.
  // -------------------------------------------------------------------

  const switcherButtons = [...switcherNav.querySelectorAll<HTMLButtonElement>("[data-view-target]")];
  for (const btn of switcherButtons) {
    btn.addEventListener("click", () => {
      const target = btn.dataset.viewTarget;
      if (!target || !STEPS_VIEW_MODES.includes(target as StepsViewMode)) return;
      const previousView = viewState.stepsView;
      viewState.stepsView = target as StepsViewMode;
      for (const mode of STEPS_VIEW_MODES) {
        const section = stepsSections[mode];
        if (section) section.hidden = mode !== target;
      }
      for (const b of switcherButtons) {
        b.setAttribute("aria-pressed", String(b === btn));
      }

      if (target === "kitchen" && previousView !== "kitchen") {
        void acquireWakeLock();
        syncKitchenTimerForCurrentStep();
      } else if (target !== "kitchen" && previousView === "kitchen") {
        releaseWakeLock();
        stopKitchenTimerTicking(); // timer state itself is kept — resumes correctly if the user switches back
      }

      persistState();
    });
  }

  // -------------------------------------------------------------------
  // Reset page — clears this recipe's saved state and reloads to defaults.
  // A real navigation (rather than resetting every piece of in-memory state
  // by hand) is the simplest way to guarantee a truly clean slate; dropping
  // the query string too (via `location.pathname` rather than `location.href`)
  // ensures a URL override (e.g. `?servings=8`) can't immediately re-apply
  // itself after the reset.
  // -------------------------------------------------------------------

  const resetButton = document.querySelector<HTMLButtonElement>("[data-reset-page]");
  resetButton?.addEventListener("click", () => {
    clearStoredState();
    location.href = location.pathname;
  });

  // -------------------------------------------------------------------
  // Kitchen mode: checklist vs. one-at-a-time sub-view switcher, and
  // one-at-a-time Back/Next navigation. Both live *inside* `#steps-kitchen`,
  // so they're re-rendered by Preact on every `renderStepsSections`/
  // `renderKitchenSection` call — a single delegated listener on the
  // never-replaced `#steps-kitchen` container itself (rather than binding to
  // the inner buttons directly, which would need re-binding — and risk
  // duplicate listeners — after every such re-render) sidesteps that
  // entirely.
  // -------------------------------------------------------------------

  stepsSections.kitchen?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    const submodeBtn = target.closest<HTMLButtonElement>("[data-kitchen-submode-target]");
    if (submodeBtn) {
      const mode = submodeBtn.dataset.kitchenSubmodeTarget;
      if (mode === "checklist" || mode === "single") {
        kitchenSubmode = mode;
        if (mode === "single") syncKitchenTimerForCurrentStep();
        else stopKitchenTimerTicking(); // checklist view can't display idle steps/timers at all
        renderKitchenSection();
        persistState();
      }
      return;
    }

    const startBtn = target.closest<HTMLButtonElement>("[data-kitchen-timer-start]");
    if (startBtn) {
      if (kitchenTimer && kitchenTimer.stepIndex === kitchenStepIndex && kitchenTimer.startedAt === null) {
        kitchenTimer.startedAt = Date.now();
        requestNotificationPermissionIfUnasked();
        startKitchenTimerTicking();
      }
      renderKitchenSection();
      return;
    }

    const restartBtn = target.closest<HTMLButtonElement>("[data-kitchen-timer-restart]");
    if (restartBtn) {
      if (kitchenTimer && kitchenTimer.stepIndex === kitchenStepIndex) {
        kitchenTimer.startedAt = Date.now();
        kitchenTimer.finished = false;
        requestNotificationPermissionIfUnasked();
        startKitchenTimerTicking();
      }
      renderKitchenSection();
      return;
    }

    const navBtn = target.closest<HTMLButtonElement>("[data-kitchen-step-nav]");
    if (navBtn && !navBtn.disabled) {
      const stepCount = lastVm?.steps.length ?? 0;
      if (navBtn.dataset.kitchenStepNav === "next" && kitchenStepIndex < stepCount - 1) kitchenStepIndex++;
      else if (navBtn.dataset.kitchenStepNav === "back" && kitchenStepIndex > 0) kitchenStepIndex--;
      syncKitchenTimerForCurrentStep();
      renderKitchenSection();
      persistState();
    }
  });

  // -------------------------------------------------------------------
  // Take over the ingredients/steps regions from Preact immediately, so
  // later re-renders diff against Preact's own previous tree rather than
  // fighting with the static SSR markup. Content-wise this is a no-op when
  // there's no URL override — the reconstructed `viewState` matches what
  // `build/index.ts` used to produce the SSR'd markup — but it establishes
  // ownership up front and wires the initial checklist listeners via the
  // same `bindChecklist` path subsequent re-renders use. When a `servings`
  // override *was* applied above, the `.servings-value` text (only ever
  // otherwise updated by `changeServings`) needs correcting too, so it
  // doesn't keep showing the SSR default number while the ingredients below
  // it already reflect the URL-overridden serving count.
  // -------------------------------------------------------------------

  const initialVm = recompute();
  if (servingsValueEl) {
    servingsValueEl.textContent = `${initialVm.servingsDisplay} ${initialVm.servingUnitDisplay}`;
  }
  // A restored "single" kitchen sub-mode landing on an idle step needs its
  // (not-started) timer entry prepared and the section re-rendered to show
  // it — `recompute()` above already ran `renderStepsSections` once before
  // `kitchenTimer` existed, so the first paint needs this follow-up.
  if (kitchenSubmode === "single") {
    syncKitchenTimerForCurrentStep();
    renderKitchenSection();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
