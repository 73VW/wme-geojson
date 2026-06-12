import type { Source, SubLine } from "../domain/types";
import type { SourcePersistence } from "../domain/SourcePersistence";

type Listener = () => void;

export class SourceStore {
  private source: Source | null = null;
  private listeners: Set<Listener> = new Set();

  getSource(): Source | null {
    return this.source;
  }

  hydrate(source: Source): void {
    this.source = source;
    this.emit();
  }

  /** Append a SubLine; replace the line's pendingTail head with the remainder (or remove it if null). */
  addSubLine(
    lineIndex: number,
    sub: SubLine,
    remainder: { kmA: number; kmB: number } | null,
  ): void {
    this.mutate((src) => {
      const line = src.lines[lineIndex];
      line.subLines.push(sub);
      line.pendingTail.shift();
      if (remainder !== null) line.pendingTail.unshift(remainder);
      src.cursor = { lineIndex, subLineIndex: sub.index };
    });
  }

  validateSubLine(lineIndex: number, subLineIndex: number, segmentIds: number[]): void {
    this.mutate((src) => {
      const sub = src.lines[lineIndex].subLines[subLineIndex];
      sub.segmentIds = segmentIds.slice();
      sub.validated = true;
    });
  }

  rewindCursor(lineIndex: number, subLineIndex: number): void {
    this.mutate((src) => {
      src.cursor = { lineIndex, subLineIndex };
    });
  }

  /** Clear the pendingTail for a line (used when the sub-line cap is hit). */
  clearPendingTail(lineIndex: number): void {
    this.mutate((src) => {
      src.lines[lineIndex].pendingTail = [];
    });
  }

  /** Drop the sub-line at (lineIndex, subLineIndex) and any later ones in that line; merge its range back into pendingTail head. */
  rerunSubLine(lineIndex: number, subLineIndex: number): void {
    this.mutate((src) => {
      const line = src.lines[lineIndex];
      const dropped = line.subLines.slice(subLineIndex);
      line.subLines = line.subLines.slice(0, subLineIndex);
      if (dropped.length > 0) {
        const merged = {
          kmA: dropped[0].kmA,
          kmB: dropped[dropped.length - 1].kmB,
        };
        if (line.pendingTail.length > 0 && Math.abs(line.pendingTail[0].kmA - merged.kmB) < 1e-9) {
          line.pendingTail[0] = { kmA: merged.kmA, kmB: line.pendingTail[0].kmB };
        } else {
          line.pendingTail.unshift(merged);
        }
      }
      src.cursor =
        subLineIndex > 0
          ? { lineIndex, subLineIndex: subLineIndex - 1 }
          : lineIndex > 0
            ? {
                lineIndex: lineIndex - 1,
                subLineIndex: src.lines[lineIndex - 1].subLines.length - 1,
              }
            : null;
    });
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* don't crash siblings */
      }
    }
  }

  private mutate(fn: (src: Source) => void): void {
    if (!this.source) throw new Error("SourceStore: not hydrated");
    const next: Source = {
      ...this.source,
      lines: this.source.lines.map((l) => ({
        ...l,
        subLines: l.subLines.map((s) => ({ ...s, segmentIds: s.segmentIds.slice() })),
        pendingTail: l.pendingTail.slice(),
      })),
      cursor: this.source.cursor ? { ...this.source.cursor } : null,
    };
    fn(next);
    this.source = next;
    this.emit();
  }
}

export function attachPersistence(store: SourceStore, persistence: SourcePersistence): () => void {
  return store.onChange(() => {
    const src = store.getSource();
    if (src) persistence.save(src);
  });
}
