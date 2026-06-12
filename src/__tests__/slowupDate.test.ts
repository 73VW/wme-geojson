import { describe, it, expect } from "vitest";
import { parseSlowupDateUTC } from "../lines/slowupDate";

describe("parseSlowupDateUTC", () => {
  it("returns a UTC Date for a valid YYYY-MM-DD string", () => {
    const result = parseSlowupDateUTC("2026-04-19");
    expect(result).not.toBeNull();
    expect(result!.getUTCFullYear()).toBe(2026);
    expect(result!.getUTCMonth()).toBe(3); // April is month index 3
    expect(result!.getUTCDate()).toBe(19);
  });

  it("returns null for a string that does not match YYYY-MM-DD", () => {
    expect(parseSlowupDateUTC("not-a-date")).toBeNull();
    expect(parseSlowupDateUTC("19.04.2026")).toBeNull();
    expect(parseSlowupDateUTC("2026/04/19")).toBeNull();
    expect(parseSlowupDateUTC("2026-4-19")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseSlowupDateUTC("")).toBeNull();
  });

  it("returns null for an impossible date (2026-02-30)", () => {
    expect(parseSlowupDateUTC("2026-02-30")).toBeNull();
  });

  it("returns null for another impossible date (2026-13-01)", () => {
    expect(parseSlowupDateUTC("2026-13-01")).toBeNull();
  });

  it("correctly handles a leap-year date (2024-02-29)", () => {
    const result = parseSlowupDateUTC("2024-02-29");
    expect(result).not.toBeNull();
    expect(result!.getUTCFullYear()).toBe(2024);
    expect(result!.getUTCMonth()).toBe(1);
    expect(result!.getUTCDate()).toBe(29);
  });

  it("rejects Feb 29 on a non-leap year (2026-02-29)", () => {
    expect(parseSlowupDateUTC("2026-02-29")).toBeNull();
  });
});
