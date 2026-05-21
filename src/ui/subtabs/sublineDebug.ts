import type { PipelineStepEvent } from "../../controller/MatchingPipeline";

export type SubLineStatus = "processing" | "matched" | "waiting";

export interface SubLineState {
  index: number;
  total: number;
  kmA?: number;
  kmB?: number;
  status: SubLineStatus;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function subLineStateFromStep(event: PipelineStepEvent): SubLineState | null {
  if (
    event.key !== "processingLeaf" &&
    event.key !== "leafMatched" &&
    event.key !== "waitingLeafValidation"
  ) {
    return null;
  }

  const values = event.values ?? {};
  const index = asNumber(values["index"]);
  const total = asNumber(values["total"]);
  if (index === null || total === null) {
    return null;
  }

  const status: SubLineStatus =
    event.key === "processingLeaf"
      ? "processing"
      : event.key === "leafMatched"
        ? "matched"
        : "waiting";

  const kmA = asNumber(values["kmA"]);
  const kmB = asNumber(values["kmB"]);

  return {
    index,
    total,
    kmA: kmA ?? undefined,
    kmB: kmB ?? undefined,
    status,
  };
}

export function mergeSubLineState(
  current: readonly SubLineState[],
  incoming: SubLineState,
): SubLineState[] {
  const existing = current.find((line) => line.index === incoming.index);
  const merged: SubLineState = existing
    ? {
        ...existing,
        ...incoming,
        kmA: incoming.kmA ?? existing.kmA,
        kmB: incoming.kmB ?? existing.kmB,
      }
    : incoming;

  const next = existing
    ? current.map((line) => (line.index === incoming.index ? merged : line))
    : [...current, merged];

  return [...next].sort((a, b) => a.index - b.index);
}

export function formatSubLineLabel(line: SubLineState): string {
  const { kmA, kmB } = line;
  if (typeof kmA !== "number" || typeof kmB !== "number") {
    return `${line.index}/${line.total}`;
  }

  return `${line.index}/${line.total} - ${kmA.toFixed(2)} -> ${kmB.toFixed(2)} km`;
}
