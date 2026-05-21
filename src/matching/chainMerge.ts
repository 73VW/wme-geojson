import type { ClosureRowGroup, RowGeo } from "../csv/buildClosuresCsv";
import type { ClosureRange } from "../state/SessionStore";

export interface ChainMergeInput {
  chainId: string;
  matchedGroups: ClosureRowGroup[];
  closuresBySegment: Readonly<Record<number, ClosureRange[]>>;
}

function geoKey(geo: RowGeo): string {
  return `${geo.lon}|${geo.lat}|${geo.zoom}`;
}

function compareGeo(a: RowGeo, b: RowGeo): number {
  if (a.lon !== b.lon) return a.lon - b.lon;
  if (a.lat !== b.lat) return a.lat - b.lat;
  return a.zoom - b.zoom;
}

function compareClosureRange(a: ClosureRange, b: ClosureRange): number {
  if (a.startISO !== b.startISO) return a.startISO < b.startISO ? -1 : 1;
  if (a.endISO !== b.endISO) return a.endISO < b.endISO ? -1 : 1;
  return a.rowIndex - b.rowIndex;
}

/**
 * Merge per-chain closures and remove exact duplicates while preserving
 * row-level semantics.
 */
export function mergeChainClosures(
  chains: readonly ChainMergeInput[],
): Record<number, ClosureRange[]> {
  const bySegment = new Map<number, Map<string, ClosureRange>>();

  chains.forEach((chain) => {
    Object.entries(chain.closuresBySegment).forEach(([segmentIdText, ranges]) => {
      const segmentId = Number(segmentIdText);
      const existing = bySegment.get(segmentId) ?? new Map<string, ClosureRange>();

      ranges.forEach((range) => {
        const key = `${range.rowIndex}|${range.startISO}|${range.endISO}`;
        if (!existing.has(key)) {
          existing.set(key, {
            rowIndex: range.rowIndex,
            startISO: range.startISO,
            endISO: range.endISO,
          });
        }
      });

      bySegment.set(segmentId, existing);
    });
  });

  const merged: Record<number, ClosureRange[]> = {};
  Array.from(bySegment.entries())
    .sort((a, b) => a[0] - b[0])
    .forEach(([segmentId, rangesByKey]) => {
      merged[segmentId] = Array.from(rangesByKey.values()).sort(compareClosureRange);
    });

  return merged;
}

interface SegmentOwner {
  chainId: string;
  rowIndex: number;
  segmentId: number;
  geo: RowGeo;
}

function pickOwner(current: SegmentOwner | undefined, candidate: SegmentOwner): SegmentOwner {
  if (!current) return candidate;
  if (candidate.chainId !== current.chainId) {
    return candidate.chainId < current.chainId ? candidate : current;
  }
  return compareGeo(candidate.geo, current.geo) < 0 ? candidate : current;
}

/**
 * Merge per-chain groups and dedupe ownership by (rowIndex, segmentId).
 * Owner selection is deterministic and independent from chain processing order.
 */
export function mergeChainGroups(chains: readonly ChainMergeInput[]): ClosureRowGroup[] {
  const ownerByRowSegment = new Map<string, SegmentOwner>();

  chains.forEach((chain) => {
    chain.matchedGroups.forEach((group) => {
      group.segmentIds.forEach((segmentId) => {
        const owner: SegmentOwner = {
          chainId: chain.chainId,
          rowIndex: group.rowIndex,
          segmentId,
          geo: group.geo,
        };
        const key = `${group.rowIndex}:${segmentId}`;
        ownerByRowSegment.set(key, pickOwner(ownerByRowSegment.get(key), owner));
      });
    });
  });

  const grouped = new Map<string, { rowIndex: number; geo: RowGeo; segmentIds: Set<number> }>();

  ownerByRowSegment.forEach((owner) => {
    const key = `${owner.rowIndex}:${geoKey(owner.geo)}`;
    const existing = grouped.get(key) ?? {
      rowIndex: owner.rowIndex,
      geo: owner.geo,
      segmentIds: new Set<number>(),
    };
    existing.segmentIds.add(owner.segmentId);
    grouped.set(key, existing);
  });

  return Array.from(grouped.values())
    .map((group) => ({
      rowIndex: group.rowIndex,
      geo: group.geo,
      segmentIds: Array.from(group.segmentIds).sort((a, b) => a - b),
    }))
    .sort((a, b) => {
      if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
      return compareGeo(a.geo, b.geo);
    });
}
