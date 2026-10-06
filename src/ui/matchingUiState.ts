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
      // waiting: the frontier re-match failed; Retry re-runs the same frontier.
      if (state.kind === "stepping" || state.kind === "waiting") {
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

export interface ButtonView {
  visible: boolean;
  /** Only meaningful when visible is true. */
  enabled: boolean;
}

export interface MatchingControlsView {
  start: ButtonView;
  startBurst: ButtonView;
  validate: ButtonView;
  skip: ButtonView;
  rematch: ButtonView;
  /** Put the detected segments back into the selection (e.g. after a stray click). */
  reselect: ButtonView;
  pause: ButtonView;
  resume: ButtonView;
  retry: ButtonView;
  doneClose: ButtonView;
  restart: ButtonView;
}

const HIDDEN: ButtonView = { visible: false, enabled: false };
const SHOWN: ButtonView = { visible: true, enabled: true };
const SHOWN_DISABLED: ButtonView = { visible: true, enabled: false };

const ALL_HIDDEN: MatchingControlsView = {
  start: HIDDEN,
  startBurst: HIDDEN,
  validate: HIDDEN,
  skip: HIDDEN,
  rematch: HIDDEN,
  reselect: HIDDEN,
  pause: HIDDEN,
  resume: HIDDEN,
  retry: HIDDEN,
  doneClose: HIDDEN,
  restart: HIDDEN,
};

/** One row per state — the whole "which button when" question, in one place. */
export function controlsFor(state: MatchingUiState, hasSource: boolean): MatchingControlsView {
  switch (state.kind) {
    case "idle":
      if (!hasSource) return ALL_HIDDEN;
      // Restart is shown in idle because it re-hydrates the source from scratch —
      // useful after a partial session or a source change.
      return { ...ALL_HIDDEN, start: SHOWN, startBurst: SHOWN, restart: SHOWN };
    case "stepping":
      return {
        ...ALL_HIDDEN,
        validate: SHOWN_DISABLED,
        skip: SHOWN_DISABLED,
        rematch: SHOWN_DISABLED,
        reselect: SHOWN_DISABLED,
        restart: SHOWN_DISABLED,
      };
    case "waiting":
      return {
        ...ALL_HIDDEN,
        validate: SHOWN,
        skip: SHOWN,
        rematch: SHOWN,
        reselect: SHOWN,
        restart: SHOWN,
      };
    case "bursting":
      return { ...ALL_HIDDEN, pause: SHOWN, restart: SHOWN_DISABLED };
    case "pausePending":
      return { ...ALL_HIDDEN, pause: SHOWN_DISABLED, restart: SHOWN_DISABLED };
    case "paused":
      return { ...ALL_HIDDEN, resume: SHOWN, restart: SHOWN };
    case "error":
      return { ...ALL_HIDDEN, retry: SHOWN, restart: SHOWN };
    case "done":
      return { ...ALL_HIDDEN, doneClose: SHOWN };
  }
}

export type PanelStatusKey = "ready" | "running" | "waiting" | "paused" | "error" | "done";

export function statusKeyFor(state: MatchingUiState): PanelStatusKey {
  switch (state.kind) {
    case "idle":
      return "ready";
    case "stepping":
    case "bursting":
      return "running";
    case "waiting":
      return "waiting";
    case "pausePending":
    case "paused":
      return "paused";
    case "error":
      return "error";
    case "done":
      return "done";
  }
}
