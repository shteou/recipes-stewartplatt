/**
 * The Grouped steps view: steps rendered under one heading per `step.group`,
 * in `RecipeViewModel.groupOrder`'s first-appearance order. This is the only
 * steps view built this stage — Timeline/Mise en place/Kitchen mode arrive in
 * a later stage.
 */

import type { RecipeViewModel, ResolvedStep } from "../core/present.js";

export interface StepsGroupedProps {
  vm: RecipeViewModel;
}

export function StepsGrouped({ vm }: StepsGroupedProps) {
  const stepsByGroup = new Map<string, ResolvedStep[]>();
  for (const step of vm.steps) {
    const bucket = stepsByGroup.get(step.group);
    if (bucket) {
      bucket.push(step);
    } else {
      stepsByGroup.set(step.group, [step]);
    }
  }

  return (
    <div class="steps-grouped">
      {vm.groupOrder.map((group) => (
        <section key={group} class="step-group" data-accent={stepsByGroup.get(group)?.[0]?.accent}>
          <h3>{group}</h3>
          <ol>
            {(stepsByGroup.get(group) ?? []).map((step, index) => (
              <li key={index} class={step.idle ? "idle" : undefined}>
                {step.text}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
