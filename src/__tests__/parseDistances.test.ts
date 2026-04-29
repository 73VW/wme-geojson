import { describe, expect, it } from "vitest";
import { parseDistanceList } from "../utils/parseDistances";

describe("parseDistanceList", () => {
  it("parses comma-separated decimals", () => {
    expect(parseDistanceList("0.5, 1.2, 3.4")).toEqual([0.5, 1.2, 3.4]);
  });

  it("accepts mixed separators (spaces, commas, newlines)", () => {
    expect(parseDistanceList("0.5 1.2\n3.4")).toEqual([0.5, 1.2, 3.4]);
    expect(parseDistanceList("0.5;1.2\t3.4")).toEqual([0.5, 1.2, 3.4]);
  });

  it("drops empty tokens, non-numeric tokens, and duplicates while preserving order", () => {
    expect(parseDistanceList("0.5,,1.2,abc,1.2")).toEqual([0.5, 1.2]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseDistanceList("")).toEqual([]);
    expect(parseDistanceList("   \n\t  ")).toEqual([]);
  });

  it("accepts integers and bare numbers", () => {
    expect(parseDistanceList("0\n1\n2 3")).toEqual([0, 1, 2, 3]);
  });
});
