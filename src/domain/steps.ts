// The sub-lines the operator can step through in the matching panel: the
// validated ones, in matching order, then (optionally) the frontier — the
// first sub-line still waiting for validation. Never beyond the frontier:
// later sub-lines don't exist yet (they are cut lazily).

import type { Source } from "./types";

export interface StepRef {
  lineIndex: number;
  subLineIndex: number;
}

export function frontierStep(source: Source | null): StepRef | null {
  if (!source) return null;
  for (const line of source.lines) {
    const unvalidated = line.subLines.findIndex((subLine) => !subLine.validated);
    if (unvalidated !== -1) return { lineIndex: line.index, subLineIndex: unvalidated };
    if (line.pendingTail.length > 0) return null;
  }
  return null;
}

export function navigableSteps(source: Source | null, includeFrontier: boolean): StepRef[] {
  if (!source) return [];
  const steps: StepRef[] = [];
  for (const line of source.lines) {
    for (const subLine of line.subLines) {
      if (!subLine.validated) {
        if (includeFrontier) steps.push({ lineIndex: line.index, subLineIndex: subLine.index });
        return steps;
      }
      steps.push({ lineIndex: line.index, subLineIndex: subLine.index });
    }
    if (line.pendingTail.length > 0) return steps;
  }
  return steps;
}

export function sameStep(a: StepRef | null, b: StepRef | null): boolean {
  if (!a || !b) return false;
  return a.lineIndex === b.lineIndex && a.subLineIndex === b.subLineIndex;
}

export function neighbour(
  steps: StepRef[],
  current: StepRef | null,
  direction: -1 | 1,
): StepRef | null {
  if (current === null) return direction === -1 ? (steps[steps.length - 1] ?? null) : null;
  const index = steps.findIndex((step) => sameStep(step, current));
  if (index === -1) return null;
  return steps[index + direction] ?? null;
}

export function sameIds(a: readonly number[], b: readonly number[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}
