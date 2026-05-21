import { describe, expect, it } from "vitest";
import type { NormalizedTrack } from "../geojson/types";
import { listTrackChains, mergeTrackChainsByEndpoints } from "../matching/chainTracks";

function buildTrack(coordinates: number[][][]): NormalizedTrack {
  return {
    trackId: "slowup-19",
    geometry: {
      type: "MultiLineString",
      coordinates,
    },
  };
}

describe("listTrackChains", () => {
  it("returns one chain per sub-line in original order", () => {
    const track = buildTrack([
      [
        [7.0, 46.0],
        [7.01, 46.0],
      ],
      [
        [8.0, 46.0],
        [8.01, 46.0],
      ],
      [
        [9.0, 46.0],
        [9.01, 46.0],
      ],
    ]);

    const chains = listTrackChains(track);

    expect(chains).toHaveLength(3);
    expect(chains.map((chain) => chain.id)).toEqual(["chain-0", "chain-1", "chain-2"]);
    expect(chains.map((chain) => chain.index)).toEqual([0, 1, 2]);
    expect(chains[0].geometry.coordinates).toEqual([
      [
        [7.0, 46.0],
        [7.01, 46.0],
      ],
    ]);
    expect(chains[2].geometry.coordinates).toEqual([
      [
        [9.0, 46.0],
        [9.01, 46.0],
      ],
    ]);
  });

  it("ignores degenerate sub-lines with fewer than 2 coordinates", () => {
    const track = buildTrack([
      [
        [7.0, 46.0],
        [7.01, 46.0],
      ],
      [[8.0, 46.0]],
      [],
      [
        [9.0, 46.0],
        [9.01, 46.0],
      ],
    ]);

    const chains = listTrackChains(track);

    expect(chains).toHaveLength(2);
    expect(chains.map((chain) => chain.id)).toEqual(["chain-0", "chain-1"]);
    expect(chains[1].geometry.coordinates).toEqual([
      [
        [9.0, 46.0],
        [9.01, 46.0],
      ],
    ]);
  });

  it("computes a positive length for each valid chain", () => {
    const track = buildTrack([
      [
        [7.0, 46.0],
        [7.02, 46.0],
      ],
      [
        [8.0, 46.0],
        [8.02, 46.0],
      ],
    ]);

    const chains = listTrackChains(track);

    expect(chains).toHaveLength(2);
    expect(chains[0].lengthKm).toBeGreaterThan(0);
    expect(chains[1].lengthKm).toBeGreaterThan(0);
  });
});

describe("mergeTrackChainsByEndpoints", () => {
  it("merges two chains that share an endpoint", () => {
    const chains = listTrackChains(
      buildTrack([
        [
          [7.0, 46.0],
          [7.01, 46.0],
        ],
        [
          [7.01, 46.0],
          [7.02, 46.0],
        ],
      ]),
    );

    const merged = mergeTrackChainsByEndpoints(chains);

    expect(merged).toHaveLength(1);
    expect(merged[0].geometry.coordinates[0]).toEqual([
      [7.0, 46.0],
      [7.01, 46.0],
      [7.02, 46.0],
    ]);
  });

  it("keeps separate chains when endpoint gap is too large", () => {
    const chains = listTrackChains(
      buildTrack([
        [
          [7.0, 46.0],
          [7.01, 46.0],
        ],
        [
          [8.0, 46.0],
          [8.01, 46.0],
        ],
      ]),
    );

    const merged = mergeTrackChainsByEndpoints(chains, 0.01);
    expect(merged).toHaveLength(2);
  });

  it("keeps isolated pieces separate but still merges other connectable pieces", () => {
    const chains = listTrackChains(
      buildTrack([
        [
          [9.0, 46.0],
          [9.01, 46.0],
        ],
        [
          [7.0, 46.0],
          [7.01, 46.0],
        ],
        [
          [7.01, 46.0],
          [7.02, 46.0],
        ],
      ]),
    );

    const merged = mergeTrackChainsByEndpoints(chains, 0.05);

    expect(merged).toHaveLength(2);
    expect(merged[0].geometry.coordinates[0]).toEqual([
      [9.0, 46.0],
      [9.01, 46.0],
    ]);
    expect(merged[1].geometry.coordinates[0]).toEqual([
      [7.0, 46.0],
      [7.01, 46.0],
      [7.02, 46.0],
    ]);
  });
});
