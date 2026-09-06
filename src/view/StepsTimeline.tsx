/**
 * The Timeline steps view: every step laid out as a single, flat,
 * chronologically-ordered list against `time` (minutes remaining, counting
 * down to 0) — no lanes/columns. The site owner found the earlier
 * multi-lane (side-by-side concurrent groups) layout confusing; this
 * renders one column, sorted so the highest `time` (furthest from done)
 * comes first, with a stable tie-break on original array order so two steps
 * sharing a `time` value keep their authored relative order.
 *
 * This deliberately does NOT use `core/steps.ts`'s lane-detection helpers
 * (`findLanePair`/`groupTimeRange`/`rangesOverlap`) — those remain in place,
 * still tested, for any future consumer; this view just no longer needs
 * them. `vm.steps` is used directly rather than `vm.groupOrder`, since
 * there's no per-group bucketing left to do.
 *
 * Each row reads as one continuous line (`T−Nm · Group · step text`) rather
 * than three stacked block-level lines, for information density. Colour
 * (the existing `data-accent`/`--accent-color` custom-property system —
 * the same one `.step-group`/`.mise-method li[data-accent]` use) is the
 * primary visual grouping signal now that there's no spatial column to
 * lean on: a coloured left border plus a coloured group label per row.
 */

import type { RecipeViewModel, ResolvedStep } from "../core/present.js";

export interface StepsTimelineProps {
  vm: RecipeViewModel;
}

/**
 * `vm.steps` sorted by `time` descending (highest minutes-remaining first —
 * the first real-world step), stably — a plain `.sort()` with a comparator
 * that never returns 0 for equal times would still be stable per the spec
 * (Array.prototype.sort has been a stable sort since ES2019), but the
 * comparator here is explicit about breaking ties by original index so that
 * guarantee doesn't have to be taken on faith by a future reader.
 */
function chronological(steps: ResolvedStep[]): ResolvedStep[] {
  return steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => b.step.time - a.step.time || a.index - b.index)
    .map(({ step }) => step);
}

export function StepsTimeline({ vm }: StepsTimelineProps) {
  const ordered = chronological(vm.steps);

  return (
    <div class="steps-timeline">
      <ol>
        {ordered.map((step, index) => (
          <li key={index} class={step.idle ? "idle" : undefined} data-accent={step.accent}>
            <span class="timeline-marker">T−{step.time}m</span>
            <span class="timeline-group">{step.group}</span>
            <span class="timeline-text">{step.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
