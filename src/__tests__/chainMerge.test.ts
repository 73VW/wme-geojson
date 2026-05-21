import { describe, expect, it } from "vitest";
import type { ChainMergeInput } from "../matching/chainMerge";
import { mergeChainClosures, mergeChainGroups } from "../matching/chainMerge";

function chain(
  input: Partial<ChainMergeInput> & Pick<ChainMergeInput, "chainId">,
): ChainMergeInput {
  return {
    chainId: input.chainId,
    matchedGroups: input.matchedGroups ?? [],
    closuresBySegment: input.closuresBySegment ?? {},
  };
}

describe("mergeChainClosures", () => {
  it("dedupes identical ranges across chains", () => {
    const merged = mergeChainClosures([
      chain({
        chainId: "chain-0",
        closuresBySegment: {
          101: [{ rowIndex: 0, startISO: "2026-05-20T09:00", endISO: "2026-05-20T12:00" }],
        },
      }),
      chain({
        chainId: "chain-1",
        closuresBySegment: {
          101: [{ rowIndex: 0, startISO: "2026-05-20T09:00", endISO: "2026-05-20T12:00" }],
        },
      }),
    ]);

    expect(Object.keys(merged)).toEqual(["101"]);
    expect(merged[101]).toEqual([
      { rowIndex: 0, startISO: "2026-05-20T09:00", endISO: "2026-05-20T12:00" },
    ]);
  });

  it("keeps ranges separate when row index differs", () => {
    const merged = mergeChainClosures([
      chain({
        chainId: "chain-0",
        closuresBySegment: {
          101: [{ rowIndex: 0, startISO: "2026-05-20T09:00", endISO: "2026-05-20T12:00" }],
        },
      }),
      chain({
        chainId: "chain-1",
        closuresBySegment: {
          101: [{ rowIndex: 1, startISO: "2026-05-20T09:00", endISO: "2026-05-20T12:00" }],
        },
      }),
    ]);

    expect(merged[101]).toEqual([
      { rowIndex: 0, startISO: "2026-05-20T09:00", endISO: "2026-05-20T12:00" },
      { rowIndex: 1, startISO: "2026-05-20T09:00", endISO: "2026-05-20T12:00" },
    ]);
  });
});

describe("mergeChainGroups", () => {
  it("dedupes row+segment ownership and keeps deterministic output", () => {
    const input = [
      chain({
        chainId: "chain-1",
        matchedGroups: [
          {
            rowIndex: 0,
            segmentIds: [101, 102],
            geo: { lon: 7.2, lat: 46.2, zoom: 15 },
          },
        ],
      }),
      chain({
        chainId: "chain-0",
        matchedGroups: [
          {
            rowIndex: 0,
            segmentIds: [101, 103],
            geo: { lon: 7.1, lat: 46.1, zoom: 14 },
          },
        ],
      }),
    ];

    const merged = mergeChainGroups(input);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      rowIndex: 0,
      segmentIds: [101, 103],
      geo: { lon: 7.1, lat: 46.1, zoom: 14 },
    });
    expect(merged[1]).toEqual({
      rowIndex: 0,
      segmentIds: [102],
      geo: { lon: 7.2, lat: 46.2, zoom: 15 },
    });
  });

  it("returns identical result for permuted chain input order", () => {
    const a = chain({
      chainId: "chain-2",
      matchedGroups: [
        {
          rowIndex: 0,
          segmentIds: [201, 202],
          geo: { lon: 7.3, lat: 46.3, zoom: 16 },
        },
      ],
    });
    const b = chain({
      chainId: "chain-0",
      matchedGroups: [
        {
          rowIndex: 0,
          segmentIds: [201, 203],
          geo: { lon: 7.0, lat: 46.0, zoom: 14 },
        },
      ],
    });
    const c = chain({
      chainId: "chain-1",
      matchedGroups: [
        {
          rowIndex: 1,
          segmentIds: [301],
          geo: { lon: 8.0, lat: 47.0, zoom: 15 },
        },
      ],
    });

    const merged1 = mergeChainGroups([a, b, c]);
    const merged2 = mergeChainGroups([c, a, b]);

    expect(merged1).toEqual(merged2);
  });
});
