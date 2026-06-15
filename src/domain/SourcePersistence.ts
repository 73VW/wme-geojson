import type { Source } from "./types";

const KEY_PREFIX = "wme-geojson:source:";
const DEFAULT_DEBOUNCE_MS = 200;

export interface SourcePersistenceOptions {
  debounceMs?: number;
}

export class SourcePersistence {
  private readonly debounceMs: number;
  private pending: Map<string, Source> = new Map();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SourcePersistenceOptions = {}) {
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  load(sourceId: string): Source | null {
    const raw = localStorage.getItem(KEY_PREFIX + sourceId);
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<Source>;
      if (parsed.schemaVersion !== 1) {
        localStorage.removeItem(KEY_PREFIX + sourceId);
        return null;
      }
      return parsed as Source;
    } catch {
      localStorage.removeItem(KEY_PREFIX + sourceId);
      return null;
    }
  }

  save(source: Source): void {
    this.pending.set(source.sourceId, source);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const [id, src] of this.pending) {
      localStorage.setItem(KEY_PREFIX + id, JSON.stringify(src));
    }
    this.pending.clear();
  }

  clear(sourceId: string): void {
    this.pending.delete(sourceId);
    localStorage.removeItem(KEY_PREFIX + sourceId);
  }
}
