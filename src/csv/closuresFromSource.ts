import type { MapAnchor, Source } from "../domain/types";

export interface ClosureWindow {
  startISO: string;
  endISO: string;
  geo: MapAnchor;
}
export interface ClosuresBySegment {
  segmentId: number;
  windows: ClosureWindow[];
}
export interface GlobalClosureGroup {
  segmentIds: number[];
  geo: MapAnchor;
}
export type ClosuresFromSource =
  | { mode: "global-times"; groups: GlobalClosureGroup[] }
  | { mode: "per-line-times"; bySegment: ClosuresBySegment[] };

function mergeWindows(input: ClosureWindow[]): ClosureWindow[] {
  if (input.length === 0) return [];
  const sorted = input.slice().sort((a, b) => a.startISO.localeCompare(b.startISO));
  const out: ClosureWindow[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].startISO <= last.endISO) {
      if (sorted[i].endISO > last.endISO) last.endISO = sorted[i].endISO;
    } else {
      out.push({ ...sorted[i] });
    }
  }
  return out;
}

export function closuresFromSource(source: Source): ClosuresFromSource {
  if (!source.hasCsv) {
    const groups: GlobalClosureGroup[] = [];
    for (const line of source.lines) {
      for (const sub of line.subLines) {
        if (!sub.validated) continue;
        groups.push({ segmentIds: sub.segmentIds.slice(), geo: sub.view });
      }
    }
    return { mode: "global-times", groups };
  }

  const windowsBySegment = new Map<number, ClosureWindow[]>();
  for (const line of source.lines) {
    if (!line.startISO || !line.endISO) continue;
    for (const sub of line.subLines) {
      if (!sub.validated) continue;
      for (const segId of sub.segmentIds) {
        const arr = windowsBySegment.get(segId) ?? [];
        arr.push({ startISO: line.startISO, endISO: line.endISO, geo: sub.view });
        windowsBySegment.set(segId, arr);
      }
    }
  }
  const bySegment: ClosuresBySegment[] = Array.from(windowsBySegment.entries())
    .map(([segmentId, windows]) => ({ segmentId, windows: mergeWindows(windows) }))
    .sort((a, b) => a.segmentId - b.segmentId);
  return { mode: "per-line-times", bySegment };
}
