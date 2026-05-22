import type { NormalizedTrack } from "../geojson/types";
import { listTrackChains, mergeTrackChainsByEndpoints } from "../matching/chainTracks";
import { bboxOfMultiLineString } from "../matching/trackPortions";
import type { Line, Source } from "./types";

const SLOWUP_MERGE_MAX_GAP_KM = 0.05;

export interface BuildSlowupSourceInput {
  sourceId: string;
  track: NormalizedTrack;
}

export function buildSlowupSource(input: BuildSlowupSourceInput): Source {
  const rawChains = listTrackChains(input.track);
  const mergedChains = mergeTrackChainsByEndpoints(rawChains, SLOWUP_MERGE_MAX_GAP_KM);

  const lines: Line[] = mergedChains.map((chain, idx) => {
    const lengthKm = chain.lengthKm;
    const box = bboxOfMultiLineString(chain.geometry);
    if (!box) {
      throw new Error(`buildSlowupSource: chain ${idx} has empty bbox`);
    }
    const bbox: [number, number, number, number] = [box[0], box[1], box[2], box[3]];
    return {
      index: idx,
      bbox,
      geometry: chain.geometry,
      lengthKm,
      subLines: [],
      pendingTail: [{ kmA: 0, kmB: lengthKm }],
    };
  });

  return {
    schemaVersion: 1,
    sourceId: input.sourceId,
    kind: "slowup",
    hasCsv: false,
    lines,
    cursor: null,
  };
}
