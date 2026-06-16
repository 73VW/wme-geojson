// localStorage wrapper for persisting the last uploaded file across page reloads.
//
// Uses globalThis.localStorage (not window.localStorage) so this module can be
// imported in Node/vitest without crashing at module-load time.

const STORAGE_KEY = "wmegj:uploaded-file";

export interface StoredFile {
  name: string;
  content: string;
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Persist uploaded file content. Silently skips on quota error. */
export function saveUploadedFile(name: string, content: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ name, content }));
  } catch {
    // Quota exceeded or private-browsing restriction — silently skip.
    // Persistence is best-effort; the user can always re-upload.
  }
}

/** Return stored file or null if none. */
export function loadUploadedFile(): StoredFile | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)["name"] !== "string" ||
      typeof (parsed as Record<string, unknown>)["content"] !== "string"
    ) {
      return null;
    }
    return parsed as StoredFile;
  } catch {
    // Corrupt JSON — discard and start fresh.
    return null;
  }
}

/** Remove stored file. */
export function clearUploadedFile(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Silently skip.
  }
}
