import { describe, expect, it } from "vitest";
import {
  reduceMatchingUi,
  type MatchingUiState,
  controlsFor,
  statusKeyFor,
} from "../ui/matchingUiState";

const idle: MatchingUiState = { kind: "idle" };
const stepping: MatchingUiState = { kind: "stepping" };
const waiting: MatchingUiState = { kind: "waiting" };
const bursting: MatchingUiState = { kind: "bursting" };
const pausePending: MatchingUiState = { kind: "pausePending" };
const paused: MatchingUiState = { kind: "paused" };
const errInteractive: MatchingUiState = {
  kind: "error",
  message: "boom",
  resumeMode: "interactive",
};
const errBurst: MatchingUiState = { kind: "error", message: "boom", resumeMode: "burst" };
const done: MatchingUiState = { kind: "done", rowsValidated: 3, totalSegments: 42 };

describe("reduceMatchingUi — interactive flow", () => {
  it("starts interactive from idle", () => {
    expect(reduceMatchingUi(idle, { type: "START_INTERACTIVE" })).toEqual(stepping);
  });
  it("ignores START_INTERACTIVE outside idle", () => {
    expect(reduceMatchingUi(bursting, { type: "START_INTERACTIVE" })).toBe(bursting);
  });
  it("stepping reaches the validation gate on STEP_READY", () => {
    expect(reduceMatchingUi(stepping, { type: "STEP_READY" })).toEqual(waiting);
  });
  it("STEP_READY is a no-op while bursting (burst has no gate)", () => {
    expect(reduceMatchingUi(bursting, { type: "STEP_READY" })).toBe(bursting);
  });
  it("waiting goes back to stepping on STEP_STARTED", () => {
    expect(reduceMatchingUi(waiting, { type: "STEP_STARTED" })).toEqual(stepping);
  });
});

describe("reduceMatchingUi — burst flow", () => {
  it("starts burst from idle", () => {
    expect(reduceMatchingUi(idle, { type: "START_BURST" })).toEqual(bursting);
  });
  it("pause request moves bursting to pausePending", () => {
    expect(reduceMatchingUi(bursting, { type: "PAUSE_REQUESTED" })).toEqual(pausePending);
  });
  it("PAUSE_REQUESTED is a no-op outside bursting", () => {
    expect(reduceMatchingUi(waiting, { type: "PAUSE_REQUESTED" })).toBe(waiting);
  });
  it("pause is reached only from pausePending", () => {
    expect(reduceMatchingUi(pausePending, { type: "PAUSE_REACHED" })).toEqual(paused);
    expect(reduceMatchingUi(bursting, { type: "PAUSE_REACHED" })).toBe(bursting);
  });
  it("resume returns paused to bursting", () => {
    expect(reduceMatchingUi(paused, { type: "RESUME_BURST" })).toEqual(bursting);
  });
});

describe("reduceMatchingUi — error and retry", () => {
  it("a failed interactive step lands in error with resumeMode interactive", () => {
    expect(reduceMatchingUi(stepping, { type: "STEP_FAILED", message: "boom" })).toEqual(
      errInteractive,
    );
  });
  it("a failed burst step lands in error with resumeMode burst (also from pausePending)", () => {
    expect(reduceMatchingUi(bursting, { type: "STEP_FAILED", message: "boom" })).toEqual(errBurst);
    expect(reduceMatchingUi(pausePending, { type: "STEP_FAILED", message: "boom" })).toEqual(
      errBurst,
    );
  });
  it("retry resumes in the mode that failed", () => {
    expect(reduceMatchingUi(errInteractive, { type: "RETRY" })).toEqual(stepping);
    expect(reduceMatchingUi(errBurst, { type: "RETRY" })).toEqual(bursting);
  });
  it("RETRY is a no-op outside error", () => {
    expect(reduceMatchingUi(waiting, { type: "RETRY" })).toBe(waiting);
  });
});

describe("reduceMatchingUi — completion, restart, source change", () => {
  it("COMPLETED carries the summary from stepping, bursting and pausePending", () => {
    const ev = { type: "COMPLETED", rowsValidated: 3, totalSegments: 42 } as const;
    expect(reduceMatchingUi(stepping, ev)).toEqual(done);
    expect(reduceMatchingUi(bursting, ev)).toEqual(done);
    expect(reduceMatchingUi(pausePending, ev)).toEqual(done);
  });
  it("CLOSE_DONE returns done to idle", () => {
    expect(reduceMatchingUi(done, { type: "CLOSE_DONE" })).toEqual(idle);
  });
  it("RESTART works from idle, waiting, paused, done and error", () => {
    for (const s of [idle, waiting, paused, done, errBurst]) {
      expect(reduceMatchingUi(s, { type: "RESTART" })).toEqual(idle);
    }
  });
  it("RESTART is IGNORED while stepping, bursting or pausePending (race guard)", () => {
    for (const s of [stepping, bursting, pausePending]) {
      expect(reduceMatchingUi(s, { type: "RESTART" })).toBe(s);
    }
  });
  it("SOURCE_CHANGED forces idle from any state", () => {
    for (const s of [idle, stepping, waiting, bursting, pausePending, paused, errBurst, done]) {
      expect(reduceMatchingUi(s, { type: "SOURCE_CHANGED" })).toEqual(idle);
    }
  });
});

describe("controlsFor", () => {
  it("idle with a source shows Start, Start burst and Restart only", () => {
    const c = controlsFor({ kind: "idle" }, true);
    expect(c.start).toEqual({ visible: true, enabled: true });
    expect(c.startBurst).toEqual({ visible: true, enabled: true });
    expect(c.restart).toEqual({ visible: true, enabled: true });
    expect(c.validate.visible).toBe(false);
    expect(c.pause.visible).toBe(false);
    expect(c.doneClose.visible).toBe(false);
  });
  it("idle without a source hides everything", () => {
    const c = controlsFor({ kind: "idle" }, false);
    for (const v of Object.values(c)) expect(v.visible).toBe(false);
  });
  it("waiting enables the per-sub-line controls", () => {
    const c = controlsFor({ kind: "waiting" }, true);
    for (const key of ["validate", "skip", "back", "reselect", "rerun"] as const) {
      expect(c[key]).toEqual({ visible: true, enabled: true });
    }
    expect(c.start.visible).toBe(false);
    expect(c.restart).toEqual({ visible: true, enabled: true });
  });
  it("stepping shows the per-sub-line controls disabled", () => {
    const c = controlsFor({ kind: "stepping" }, true);
    for (const key of ["validate", "skip", "back", "reselect", "rerun"] as const) {
      expect(c[key]).toEqual({ visible: true, enabled: false });
    }
  });
  it("bursting shows an enabled Pause; pausePending shows it DISABLED (feedback gap fix)", () => {
    expect(controlsFor({ kind: "bursting" }, true).pause).toEqual({
      visible: true,
      enabled: true,
    });
    expect(controlsFor({ kind: "pausePending" }, true).pause).toEqual({
      visible: true,
      enabled: false,
    });
    expect(controlsFor({ kind: "pausePending" }, true).resume.visible).toBe(false);
  });
  it("paused shows Resume and Restart", () => {
    const c = controlsFor({ kind: "paused" }, true);
    expect(c.resume).toEqual({ visible: true, enabled: true });
    expect(c.restart).toEqual({ visible: true, enabled: true });
    expect(c.pause.visible).toBe(false);
  });
  it("error shows Retry and Restart", () => {
    const c = controlsFor({ kind: "error", message: "x", resumeMode: "burst" }, true);
    expect(c.retry).toEqual({ visible: true, enabled: true });
    expect(c.restart).toEqual({ visible: true, enabled: true });
  });
  it("done shows only Close", () => {
    const c = controlsFor({ kind: "done", rowsValidated: 1, totalSegments: 2 }, true);
    expect(c.doneClose).toEqual({ visible: true, enabled: true });
    expect(c.restart.visible).toBe(false);
  });
  it("restart is visible but disabled while a loop or step runs (race guard echo)", () => {
    for (const kind of ["stepping", "bursting", "pausePending"] as const) {
      expect(controlsFor({ kind }, true).restart).toEqual({ visible: true, enabled: false });
    }
  });
});

describe("statusKeyFor", () => {
  it("maps every state to a panelStatus i18n key", () => {
    expect(statusKeyFor(idle)).toBe("ready");
    expect(statusKeyFor(stepping)).toBe("running");
    expect(statusKeyFor(bursting)).toBe("running");
    expect(statusKeyFor(waiting)).toBe("waiting");
    expect(statusKeyFor(pausePending)).toBe("paused");
    expect(statusKeyFor(paused)).toBe("paused");
    expect(statusKeyFor(errBurst)).toBe("error");
    expect(statusKeyFor(done)).toBe("done");
  });
});
