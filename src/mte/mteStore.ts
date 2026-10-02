export const MTE_STORE_KEY = "wme-geojson:mte-by-refid";

function readAll(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(MTE_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(MTE_STORE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("[mteStore] localStorage.setItem failed:", err);
  }
}

// Clé : refid pour un slowup, id de la ligne (string) pour une autre fermeture.
export type MteKey = number | string;

export const mteStore = {
  get(key: MteKey): string | undefined {
    const map = readAll();
    const value = map[String(key)];
    return value && value.length > 0 ? value : undefined;
  },

  set(key: MteKey, mteId: string): void {
    const trimmed = mteId.trim();
    if (trimmed.length === 0) {
      this.clear(key);
      return;
    }
    const map = readAll();
    map[String(key)] = trimmed;
    writeAll(map);
  },

  clear(key: MteKey): void {
    const map = readAll();
    delete map[String(key)];
    writeAll(map);
  },
};
