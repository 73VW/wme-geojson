import { describe, expect, it } from "vitest";
import { buildEntriesFromData } from "../lines/featureCollectionLoader";
import { listTrackChains, mergeTrackChainsByEndpoints } from "../matching/chainTracks";
import slowupsData from "./fixtures/slowups.json";

const SLOWUP_MERGE_MAX_GAP_KM = 20;
const SLOWUP_STRICT_MERGE_MAX_GAP_KM = 0.05;

describe("slowups.json chain merge", () => {
  it("merges every slowup track into a single chain", () => {
    const entries = buildEntriesFromData(slowupsData, "https://example.com/slowups.json").filter(
      (entry) => entry.slowupNumber !== undefined,
    );

    expect(entries.length).toBeGreaterThan(0);

    const notMerged = entries
      .map((entry) => {
        const raw = listTrackChains(entry.track);
        const merged = mergeTrackChainsByEndpoints(raw, SLOWUP_MERGE_MAX_GAP_KM);
        return {
          slowupNumber: entry.slowupNumber,
          raw: raw.length,
          merged: merged.length,
        };
      })
      .filter((item) => item.merged !== 1);

    expect(notMerged).toEqual([]);
  });

  it("keeps slowup 4 as two merged chains with a strict 50m endpoint gap", () => {
    const slowup4 = buildEntriesFromData(slowupsData, "https://example.com/slowups.json").find(
      (entry) => entry.slowupNumber === 4,
    );

    expect(slowup4).toBeDefined();

    const raw = listTrackChains(slowup4!.track);
    const merged = mergeTrackChainsByEndpoints(raw, SLOWUP_STRICT_MERGE_MAX_GAP_KM);

    expect(raw).toHaveLength(7);
    expect(merged).toHaveLength(2);
  });
});
