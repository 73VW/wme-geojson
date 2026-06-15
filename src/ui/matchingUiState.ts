export type MatchingMode = "interactive" | "burst";

export type MatchingUiState =
  | { kind: "idle" }
  | { kind: "stepping" } // interactive step in flight
  | { kind: "waiting" } // interactive validation gate
  | { kind: "bursting" } // burst loop running
  | { kind: "pausePending" } // pause requested, current step finishing
  | { kind: "paused" } // burst suspended
  | { kind: "error"; message: string; resumeMode: MatchingMode }
  | { kind: "done"; rowsValidated: number; totalSegments: number };

export type MatchingUiEvent =
  | { type: "START_INTERACTIVE" }
  | { type: "START_BURST" }
  | { type: "STEP_STARTED" }
  | { type: "STEP_READY" }
  | { type: "STEP_FAILED"; message: string }
  | { type: "PAUSE_REQUESTED" }
  | { type: "PAUSE_REACHED" }
  | { type: "RESUME_BURST" }
  | { type: "RETRY" }
  | { type: "COMPLETED"; rowsValidated: number; totalSegments: number }
  | { type: "RESTART" }
  | { type: "CLOSE_DONE" }
  | { type: "SOURCE_CHANGED" };

/**
 * Pure transition function. Illegal (state, event) pairs return the SAME state
 * object so callers can use referential equality to detect "nothing happened".
 */
export function reduceMatchingUi(state: MatchingUiState, event: MatchingUiEvent): MatchingUiState {
  switch (event.type) {
    case "SOURCE_CHANGED":
      return { kind: "idle" };
    case "START_INTERACTIVE":
      return state.kind === "idle" ? { kind: "stepping" } : state;
    case "START_BURST":
      return state.kind === "idle" ? { kind: "bursting" } : state;
    case "STEP_STARTED":
      return state.kind === "waiting" ? { kind: "stepping" } : state;
    case "STEP_READY":
      return state.kind === "stepping" ? { kind: "waiting" } : state;
    case "STEP_FAILED":
      if (state.kind === "stepping") {
        return { kind: "error", message: event.message, resumeMode: "interactive" };
      }
      if (state.kind === "bursting" || state.kind === "pausePending") {
        return { kind: "error", message: event.message, resumeMode: "burst" };
      }
      return state;
    case "PAUSE_REQUESTED":
      return state.kind === "bursting" ? { kind: "pausePending" } : state;
    case "PAUSE_REACHED":
      return state.kind === "pausePending" ? { kind: "paused" } : state;
    case "RESUME_BURST":
      return state.kind === "paused" ? { kind: "bursting" } : state;
    case "RETRY":
      if (state.kind !== "error") return state;
      return state.resumeMode === "burst" ? { kind: "bursting" } : { kind: "stepping" };
    case "COMPLETED":
      if (state.kind === "stepping" || state.kind === "bursting" || state.kind === "pausePending") {
        return {
          kind: "done",
          rowsValidated: event.rowsValidated,
          totalSegments: event.totalSegments,
        };
      }
      return state;
    case "RESTART":
      if (
        state.kind === "idle" ||
        state.kind === "waiting" ||
        state.kind === "paused" ||
        state.kind === "done" ||
        state.kind === "error"
      ) {
        return { kind: "idle" };
      }
      return state; // race guard: never restart under a running loop/step
    case "CLOSE_DONE":
      return state.kind === "done" ? { kind: "idle" } : state;
  }
}
