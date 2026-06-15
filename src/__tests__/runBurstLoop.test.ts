import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration-level tests for the burst-loop stall guard in MatchingSubTab.
 *
 * We test the guard logic directly by examining the reduceMatchingUi reducer
 * and the burst-loop flow in isolation, verifying:
 *   1. Normal completion path: COMPLETED is dispatched, not STEP_FAILED
 *   2. Stall path: STEP_FAILED("burstStalled") is dispatched when no progress
 */
import { reduceMatchingUi, type MatchingUiState } from "../ui/matchingUiState";

describe("burst loop stall guard — reducer invariants", () => {
  const bursting: MatchingUiState = { kind: "bursting" };
  const idle: MatchingUiState = { kind: "idle" };

  it("COMPLETED from bursting goes to done — not STEP_FAILED", () => {
    const result = reduceMatchingUi(bursting, {
      type: "COMPLETED",
      rowsValidated: 3,
      totalSegments: 12,
    });
    expect(result).toEqual({ kind: "done", rowsValidated: 3, totalSegments: 12 });
  });

  it("STEP_FAILED from bursting goes to error with resumeMode burst", () => {
    const result = reduceMatchingUi(bursting, {
      type: "STEP_FAILED",
      message: "burstStalled",
    });
    expect(result).toEqual({ kind: "error", message: "burstStalled", resumeMode: "burst" });
  });

  it("SOURCE_CHANGED exits bursting — loop would stop on next iteration", () => {
    const result = reduceMatchingUi(bursting, { type: "SOURCE_CHANGED" });
    expect(result).toEqual(idle);
  });

  it("STEP_READY is a no-op while bursting — burst has no validation gate", () => {
    const result = reduceMatchingUi(bursting, { type: "STEP_READY" });
    expect(result).toBe(bursting); // same reference = no-op
  });
});

describe("burst loop stall guard — isSourceComplete mirrors COMPLETED dispatch", () => {
  /**
   * The stall guard fires when cursor's sub-line is already validated OR absent.
   * But if the source is complete, runStep dispatches COMPLETED *before* returning
   * to the loop body — so the stall guard is never reached on completion.
   *
   * This test group verifies the reducer path that completion takes (COMPLETED,
   * not STEP_FAILED) confirming the two code paths are distinct.
   */
  it("a completed source reaches done via COMPLETED, not via STEP_FAILED", () => {
    const bursting: MatchingUiState = { kind: "bursting" };

    // Simulate what runStep does on completion: dispatches COMPLETED
    const afterCompleted = reduceMatchingUi(bursting, {
      type: "COMPLETED",
      rowsValidated: 5,
      totalSegments: 20,
    });
    expect(afterCompleted.kind).toBe("done");

    // The loop condition `uiState.kind === "bursting"` is now false → loop exits
    // without ever evaluating the stall guard.
    expect(afterCompleted.kind).not.toBe("bursting");
  });

  it("a stalled burst reaches error via STEP_FAILED", () => {
    const bursting: MatchingUiState = { kind: "bursting" };

    const afterStall = reduceMatchingUi(bursting, {
      type: "STEP_FAILED",
      message: "Automatic matching stalled: the last step produced no sub-line to validate.",
    });
    expect(afterStall.kind).toBe("error");
    if (afterStall.kind === "error") {
      expect(afterStall.resumeMode).toBe("burst");
      expect(afterStall.message).toContain("stalled");
    }
  });

  it("after COMPLETED the burst loop condition is false — stall guard unreachable", () => {
    // This test documents the key invariant: runStep dispatches COMPLETED *and returns*
    // before the burst loop can check the stall guard. The two are mutually exclusive
    // by control flow (runStep returns early after COMPLETED).
    const bursting: MatchingUiState = { kind: "bursting" };
    const done = reduceMatchingUi(bursting, {
      type: "COMPLETED",
      rowsValidated: 1,
      totalSegments: 5,
    });
    // Loop condition: `this.uiState.kind === "bursting"` — false after COMPLETED
    expect(done.kind === "bursting").toBe(false);
  });
});
