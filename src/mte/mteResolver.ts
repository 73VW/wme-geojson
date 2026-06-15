// src/mte/mteResolver.ts
export interface MteRef {
  id: string;
  name: string;
  urlLink: string | null;
  /** Le SDK Waze n'expose pas la géométrie d'un MTE, donc bbox est en
   * pratique toujours `null` dans le code actuel. Conservée pour
   * compatibilité future (si on la dérive autrement). */
  bbox: [number, number, number, number] | null;
  startDate: string; // ISO "YYYY-MM-DD"
  endDate: string; // ISO "YYYY-MM-DD"
}

export interface MteCandidate {
  mte: MteRef;
  /** Score d'overlap (deg²) si bbox dispo, sinon `0`. Le tri reste stable
   * et privilégie les matches géo quand on en a. */
  overlap: number;
}

export function byUrl(mtes: ReadonlyArray<MteRef>, urlLink: string): MteRef | null {
  if (!urlLink) return null;
  for (const m of mtes) {
    if (m.urlLink && m.urlLink === urlLink) return m;
  }
  return null;
}

/**
 * Pré-filtre les MTE dont le nom contient `needle` (insensible à la casse).
 * Utilisé pour proposer une liste manuelle de candidats quand l'URL match
 * échoue : par convention dans WME, les MTE de slowup contiennent « slowup »
 * dans leur nom.
 */
export function candidatesByName(mtes: ReadonlyArray<MteRef>, needle: string): MteRef[] {
  const lower = needle.trim().toLowerCase();
  if (!lower) return [];
  return mtes.filter((m) => (m.name ?? "").toLowerCase().includes(lower));
}

export function candidatesByBbox(
  mtes: ReadonlyArray<MteRef>,
  slowupBbox: [number, number, number, number],
  slowupDate: string,
): MteCandidate[] {
  const out: MteCandidate[] = [];
  for (const m of mtes) {
    if (!coversDate(m.startDate, m.endDate, slowupDate)) continue;
    // Si le MTE n'a pas de bbox (SDK), on l'inclut quand même avec
    // overlap=0 — le match repose uniquement sur la fenêtre de dates.
    const overlap = m.bbox ? bboxOverlap(slowupBbox, m.bbox) : 0;
    if (m.bbox && overlap <= 0) continue;
    out.push({ mte: m, overlap });
  }
  out.sort((a, b) => b.overlap - a.overlap);
  return out;
}

function coversDate(start: string, end: string, target: string): boolean {
  if (!start || !end) return false;
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
