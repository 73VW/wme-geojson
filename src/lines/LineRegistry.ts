// Observable in-memory store of loaded lines and the current selection.
// Pure — no SDK, no DOM. Mirrors the tiny-emitter pattern used by
// WalkController and SessionStore.

import type { LineEntry } from "./types";

type Unsubscribe = () => void;

class Emitter<A extends unknown[]> {
  private readonly listeners = new Set<(...args: A) => void>();
  on(cb: (...args: A) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(...args: A): void {
    for (const cb of this.listeners) {
      try {
        cb(...args);
      } catch {
        // A subscriber must not break the store or sibling subscribers.
      }
    }
  }
}

export class LineRegistry {
  private entries: LineEntry[] = [];
  private selectedId: string | null = null;

  private readonly linesChanged = new Emitter<[]>();
  private readonly selectedChanged = new Emitter<[LineEntry | null]>();
  private readonly entryUpdated = new Emitter<[string]>();

  getAll(): readonly LineEntry[] {
    return this.entries;
  }

  getSelected(): LineEntry | null {
    if (this.selectedId === null) return null;
    return this.entries.find((e) => e.id === this.selectedId) ?? null;
  }

  /** Replace the whole list. Always clears the current selection. */
  setEntries(entries: LineEntry[]): void {
    this.entries = [...entries];
    const hadSelection = this.selectedId !== null;
    this.selectedId = null;
    this.linesChanged.emit();
    if (hadSelection) {
      this.selectedChanged.emit(null);
    }
  }

  /** Select a line by id, or pass null to clear. Unknown id throws. */
  setSelected(id: string | null): void {
    if (id !== null && !this.entries.some((e) => e.id === id)) {
      throw new Error(`[LineRegistry] setSelected: unknown line id "${id}"`);
    }
    this.selectedId = id;
    this.selectedChanged.emit(this.getSelected());
  }

  /** Shallow-merge a patch into one entry. Unknown id throws. */
  updateEntry(id: string, patch: Partial<LineEntry>): void {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) {
      throw new Error(`[LineRegistry] updateEntry: unknown line id "${id}"`);
    }
    this.entries = this.entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
    this.entryUpdated.emit(id);
    if (id === this.selectedId) {
      this.selectedChanged.emit(this.getSelected());
    }
  }

  onLinesChanged(cb: () => void): Unsubscribe {
    return this.linesChanged.on(cb);
  }
  onSelectedLineChanged(cb: (entry: LineEntry | null) => void): Unsubscribe {
    return this.selectedChanged.on(cb);
  }
  onEntryUpdated(cb: (id: string) => void): Unsubscribe {
    return this.entryUpdated.on(cb);
  }
}
