import { describe, it, expect } from "vitest";
import { resolveValidationIds } from "../ui/subtabs/MatchingSubTab";

describe("resolveValidationIds", () => {
  it("returns undefined when selection is empty — pipeline falls back to pendingMatched", () => {
    expect(resolveValidationIds([])).toBeUndefined();
  });

  it("returns the ids array when selection is non-empty — overrides pendingMatched", () => {
    expect(resolveValidationIds([42, 99])).toEqual([42, 99]);
  });

  it("returns undefined for a single empty array — edge case", () => {
    expect(resolveValidationIds([])).toBeUndefined();
  });
});
