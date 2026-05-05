// localStorage wrapper for persisting SessionState across page reloads.
// Scoped per (geojsonUrl, csvFingerprint) so switching track or CSV starts fresh.
//
// Uses globalThis.localStorage (not window.localStorage) so this module can be
// imported in Node/vitest without crashing at module-load time.

import type { SessionState } from "../state/SessionStore";

// FNV-1a 32-bit hash — no crypto deps, deterministic, collision-resistant
// enough for a localStorage key where the key space is tiny.
function fnv1a32(input: string): string {
  const FNV_PRIME = 0x01000193;
  // FNV offset basis for 32-bit
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply with wrapping (JavaScript bitwise ops are 32-bit signed int)
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Convert to unsigned 32-bit then to hex string.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const KEY_PREFIX = "wmegj:session";

function buildKey(geojsonUrl: string, csvText: string): string {
  return `${KEY_PREFIX}:${fnv1a32(geojsonUrl)}:${fnv1a32(csvText)}`;
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    // localStorage is unavailable in some sandboxed environments.
    return null;
  }
}

export function save(state: SessionState, csvText: string): void {
  const storage = getStorage();
  if (!storage || !state.geojsonUrl) {
    return;
  }

  const key = buildKey(state.geojsonUrl, csvText);
  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Quota exceeded or private-browsing restriction — silently skip.
    // Persistence is best-effort; the user can always re-import.
  }
}

export function load(geojsonUrl: string, csvText: string): SessionState | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const key = buildKey(geojsonUrl, csvText);
  const raw = storage.getItem(key);
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    // Narrow the parsed value: we trust our own serialized shape, but guard
    // against corrupt or outdated localStorage entries from older script versions.
    if (!isSessionState(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    // Corrupt JSON — discard and start fresh.
    return null;
  }
}

export function clearForCurrent(geojsonUrl: string, csvText: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const key = buildKey(geojsonUrl, csvText);
  storage.removeItem(key);
}

export function clearAll(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  // Collect matching keys first to avoid modifying the storage while iterating.
  const keysToRemove: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null && k.startsWith(KEY_PREFIX)) {
      keysToRemove.push(k);
    }
  }

  for (const k of keysToRemove) {
    storage.removeItem(k);
  }
}

// ---------------------------------------------------------------------------
// Type guard — verifies that a parsed JSON value has the SessionState shape
// ---------------------------------------------------------------------------

function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const v = value as Record<string, unknown>;

  const hasPhase = typeof v["phase"] === "string";
  const hasGeojsonUrl = v["geojsonUrl"] === null || typeof v["geojsonUrl"] === "string";
  const hasTrackLengthKm = v["trackLengthKm"] === null || typeof v["trackLengthKm"] === "number";
  const hasCsvRows = Array.isArray(v["csvRows"]);
  const hasCurrentIndex = typeof v["currentIndex"] === "number";
  const hasClosuresBySegment =
    typeof v["closuresBySegment"] === "object" && v["closuresBySegment"] !== null;

  return (
    hasPhase &&
    hasGeojsonUrl &&
    hasTrackLengthKm &&
    hasCsvRows &&
    hasCurrentIndex &&
    hasClosuresBySegment
  );
}
