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

export const mteStore = {
  get(refid: number): string | undefined {
    const map = readAll();
    const value = map[String(refid)];
    return value && value.length > 0 ? value : undefined;
  },

  set(refid: number, mteId: string): void {
    const trimmed = mteId.trim();
    if (trimmed.length === 0) {
      this.clear(refid);
      return;
    }
    const map = readAll();
    map[String(refid)] = trimmed;
    writeAll(map);
  },

  clear(refid: number): void {
    const map = readAll();
    delete map[String(refid)];
    writeAll(map);
  },
};
