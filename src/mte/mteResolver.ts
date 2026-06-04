// src/mte/mteResolver.ts
export interface MteRef {
  id: string;
  name: string;
  urlLink: string | null;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  startDate: string; // ISO "YYYY-MM-DD"
  endDate: string;   // ISO "YYYY-MM-DD"
}

export interface MteCandidate {
  mte: MteRef;
  overlap: number; // surface d'intersection en degrés² (0 = aucune)
}

export function byUrl(mtes: ReadonlyArray<MteRef>, urlLink: string): MteRef | null {
  if (!urlLink) return null;
  for (const m of mtes) {
    if (m.urlLink && m.urlLink === urlLink) return m;
  }
  return null;
}

export function candidatesByBbox(
  mtes: ReadonlyArray<MteRef>,
  slowupBbox: [number, number, number, number],
  slowupDate: string,
): MteCandidate[] {
  const out: MteCandidate[] = [];
  for (const m of mtes) {
    if (!coversDate(m.startDate, m.endDate, slowupDate)) continue;
    const overlap = bboxOverlap(slowupBbox, m.bbox);
    if (overlap <= 0) continue;
    out.push({ mte: m, overlap });
  }
  out.sort((a, b) => b.overlap - a.overlap);
  return out;
}

function coversDate(start: string, end: string, target: string): boolean {
  return start <= target && target <= end;
}

function bboxOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const dx = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const dy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (dx <= 0 || dy <= 0) return 0;
  return dx * dy;
}
