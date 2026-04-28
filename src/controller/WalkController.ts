import { logger } from "../utils/logger";
import { type WalkState, isTransitionAllowed } from "./walkStates";

/**
 * Stub walk controller for Palier 2.
 *
 * Real walking logic (fetch segments, grid traversal, matching) arrives in
 * Palier 3.  This stub exists so the UI wiring and state-change subscription
 * contract can be validated now, without any WME side-effects.
 *
 * Stub behaviour choice: start() transitions idle → walking, then immediately
 * walking → done via a synchronous call.  Rationale: a synchronous transition
 * makes the badge flicker observable in the console without needing a timer
 * and without leaving the controller in a permanent "walking" state that would
 * hide button re-enabling.  A comment in start() documents this.
 */
export class WalkController {
  state: WalkState = "idle";

  // Subscribers receive every state change.  Stored as a Map keyed by a
  // monotonic id so unsubscribe is O(1) and idempotent (deleting a missing key
  // is a no-op).
  private readonly subscribers = new Map<number, (s: WalkState) => void>();
  private nextSubscriberId = 0;

  /**
   * Transition to a new state and notify all subscribers.
   * Throws if the transition is not permitted by the state machine — loud
   * failures here prevent silent state corruption.
   */
  private transition(to: WalkState): void {
    const from = this.state;

    if (!isTransitionAllowed(from, to)) {
      throw new Error(
        `[WME-geojson] WalkController: invalid transition ${from} → ${to}`,
      );
    }

    this.state = to;
    logger.info(`WalkController: state ${from} → ${to}`);

    for (const cb of this.subscribers.values()) {
      cb(this.state);
    }
  }

  /**
   * Stub: transitions idle → walking, then immediately walking → done.
   * In Palier 3 this will kick off the actual grid walk asynchronously;
   * the synchronous double-transition here is intentional for Palier 2 only
   * so the UI badge change is observable from the console without async delay.
   */
  start(): void {
    logger.info("WalkController.start (stub)");
    this.transition("walking");
    // Immediately resolve to done so the controller doesn't stay stuck in
    // "walking" with no real work happening.
    this.transition("done");
  }

  stop(): void {
    logger.info("WalkController.stop (stub)");
    this.transition("cancelled");
  }

  /**
   * Subscribe to state changes.  Returns an unsubscribe function that is
   * idempotent — safe to call multiple times.
   */
  onStateChange(cb: (s: WalkState) => void): () => void {
    const id = this.nextSubscriberId++;
    this.subscribers.set(id, cb);

    return () => {
      this.subscribers.delete(id);
    };
  }
}
