/**
 * State machine definition for the track-walking workflow.
 *
 * Using a union type rather than an enum keeps serialisation trivial (the
 * string IS the value) and avoids the const-enum/import complications that
 * arise in bundled userscripts.
 */
export type WalkState = "idle" | "walking" | "done" | "cancelled" | "error";

/**
 * Explicit transition table.  Only listed from→to pairs are valid.
 *
 * Why an explicit table instead of a simple switch: it makes the allowed
 * paths visible at a glance and prevents silent "anything → anything"
 * mistakes when new states are added.
 */
const ALLOWED_TRANSITIONS: ReadonlyMap<WalkState, ReadonlySet<WalkState>> =
  new Map([
    ["idle", new Set<WalkState>(["walking"])],
    ["walking", new Set<WalkState>(["done", "cancelled", "error"])],
    ["done", new Set<WalkState>(["idle", "walking"])],
    ["cancelled", new Set<WalkState>(["idle", "walking"])],
    ["error", new Set<WalkState>(["idle", "walking"])],
  ]);

/**
 * Returns true only when moving `from` → `to` is a permitted transition.
 * Call this before every state change so invalid transitions blow up early.
 */
export function isTransitionAllowed(from: WalkState, to: WalkState): boolean {
  return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}
