// Pure texts and flags of the matching panel, from the run state, the review
// state and the Source. Kept out of MatchingSubTab so they are testable.

import { i18next } from "../../locales/i18n";
import type { ReviewState } from "../controller/StepReview";
import { neighbour, type StepRef } from "../domain/steps";
import type { Source } from "../domain/types";
import { statusKeyFor, type MatchingUiState, type PanelStatusKey } from "./matchingUiState";
import type { StepNavState } from "./views/StepNavView";

type RunKind = MatchingUiState["kind"];

export function instructionKey(input: {
  run: RunKind;
  review: ReviewState | null;
  hasValidated: boolean;
  complete: boolean;
}): string {
  if (input.review) {
    return input.review.dirty
      ? "panel.matching.instructions.reviewDirty"
      : "panel.matching.instructions.review";
  }
  switch (input.run) {
    case "idle":
      if (input.complete) return "panel.matching.instructions.done";
      return input.hasValidated
        ? "panel.matching.instructions.idleBrowse"
        : "panel.matching.instructions.idle";
    case "waiting":
      return "panel.matching.validateOrCorrect";
    case "done":
      return "panel.matching.instructions.done";
    case "bursting":
    case "pausePending":
      return "panel.matching.burstRunning";
    case "paused":
      return "panel.matching.instructions.paused";
    case "stepping":
      return "panel.matching.matchingInProgress";
    case "error":
      return "panel.matching.instructions.error";
  }
}

/** A fully matched line reads "done" while nothing runs, instead of "ready". */
export function panelStatusKey(run: RunKind, complete: boolean): PanelStatusKey {
  if (complete && (run === "idle" || run === "done")) return "done";
  return statusKeyFor({ kind: run } as MatchingUiState);
}

export function navEnabled(
  run: RunKind,
  review: ReviewState | null,
  rematchRunning: boolean,
): boolean {
  const running = run === "stepping" || run === "bursting" || run === "pausePending";
  return !running && !review?.busy && !rematchRunning;
}

/**
 * Where ‹ / › leads: a neighbour step, "exit" (› past the last step closes the
 * review when there is no frontier to go back to), or nowhere.
 */
export function navTarget(
  steps: StepRef[],
  current: StepRef | null,
  direction: -1 | 1,
  exitAtEnd: boolean,
): StepRef | "exit" | null {
  const target = neighbour(steps, current, direction);
  if (target) return target;
  return direction === 1 && exitAtEnd && current !== null ? "exit" : null;
}

export function stepNavState(
  source: Source,
  current: StepRef | null,
  steps: StepRef[],
  enabled: boolean,
  exitAtEnd: boolean,
  pendingCount: number | null = null,
): StepNavState {
  const canPrev = enabled && navTarget(steps, current, -1, exitAtEnd) !== null;
  const canNext = enabled && navTarget(steps, current, 1, exitAtEnd) !== null;
  const line = current ? source.lines[current.lineIndex] : undefined;
  const sub = current ? line?.subLines[current.subLineIndex] : undefined;
  if (!current || !line || !sub) {
    const validated = steps.filter(
      (s) => source.lines[s.lineIndex]?.subLines[s.subLineIndex]?.validated,
    ).length;
    return {
      label: i18next.t("panel.matching.nav.summary", { count: validated }),
      caption: "",
      validated: false,
      canPrev,
      canNext,
    };
  }
  // The sub-line total is only known once the line is fully cut.
  const subTotal = line.pendingTail.length === 0 ? line.subLines.length : null;
  const label = i18next.t(
    subTotal === null ? "panel.matching.nav.label" : "panel.matching.nav.labelOf",
    {
      line: current.lineIndex + 1,
      lines: source.lines.length,
      sub: current.subLineIndex + 1,
      subs: subTotal ?? 0,
    },
  );
  const window = `${sub.kmA.toFixed(2)} → ${sub.kmB.toFixed(2)} km`;
  const caption = sub.validated
    ? `${window} · ${i18next.t("panel.matching.nav.segments", { count: sub.segmentIds.length })}`
    : pendingCount !== null
      ? `${window} · ${i18next.t("panel.matching.nav.found", { count: pendingCount })}`
      : `${window} · ${i18next.t("panel.matching.nav.toValidate")}`;
  return { label, caption, validated: sub.validated, canPrev, canNext };
}
