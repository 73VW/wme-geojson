import { describe, expect, it, vi } from "vitest";
import { applyClosures, type ClosureDriver } from "../controller/ClosureApplier";
import type { ClosureStop } from "../csv/planClosureStops";

const options = { description: "slowUp", isPermanent: true, trafficEventId: null };
const stop = (segmentIds: number[]): ClosureStop => ({
  geo: { lon: 6, lat: 46, zoom: 17 },
  closures: segmentIds.map((segmentId) => ({ segmentId, startMs: 1, endMs: 2 })),
});

function fakeDriver(overrides: Partial<ClosureDriver> = {}): ClosureDriver {
  return {
    setMapCenter: vi.fn(),
    waitIdle: vi.fn(async () => {}),
    getSegment: vi.fn(() => ({ isAtoB: false, isBtoA: false })),
    getTrafficEventName: vi.fn(() => "slowUp Lac"),
    hasClosure: vi.fn(() => false),
    addClosure: vi.fn(),
    ...overrides,
  };
}

describe("applyClosures", () => {
  it("centers on each stop before adding, both directions for two-way", async () => {
    const order: string[] = [];
    const driver = fakeDriver({
      setMapCenter: vi.fn(() => {
        order.push("center");
      }),
      waitIdle: vi.fn(async () => {
        order.push("idle");
      }),
      addClosure: vi.fn(() => {
        order.push("add");
      }),
    });
    const report = await applyClosures([stop([1])], options, driver);
    expect(order).toEqual(["center", "idle", "add", "add"]);
    expect(report).toEqual({ added: 2, skipped: 0, failures: [] });
    expect(driver.addClosure).toHaveBeenCalledWith({
      segmentId: 1,
      isForward: true,
      startMs: 1,
      endMs: 2,
      description: "slowUp",
      isPermanent: true,
      trafficEventId: null,
    });
  });

  it("uses the MTE name as description when an MTE is linked", async () => {
    const driver = fakeDriver();
    await applyClosures([stop([1])], { ...options, trafficEventId: "123" }, driver);
    expect(driver.getTrafficEventName).toHaveBeenCalledWith("123");
    expect(driver.addClosure).toHaveBeenCalledWith(
      expect.objectContaining({ description: "slowUp Lac", trafficEventId: "123" }),
    );
  });

  it("skips closures that already exist (safe re-run)", async () => {
    const driver = fakeDriver({ hasClosure: vi.fn((c) => c.isForward) });
    const report = await applyClosures([stop([1])], options, driver);
    expect(report).toEqual({ added: 1, skipped: 1, failures: [] });
  });

  it("records a segment missing from the data model and continues", async () => {
    const driver = fakeDriver({
      getSegment: vi.fn((id) => (id === 1 ? null : { isAtoB: true, isBtoA: false })),
    });
    const report = await applyClosures([stop([1, 2])], options, driver);
    expect(report.added).toBe(1);
    expect(report.failures).toEqual([{ segmentId: 1, reason: "segment not loaded" }]);
  });

  it("records addClosure errors and continues", async () => {
    const driver = fakeDriver({
      addClosure: vi.fn((c) => {
        if (c.segmentId === 1) throw new Error("locked");
      }),
    });
    const report = await applyClosures([stop([1, 2])], options, driver);
    expect(report.added).toBe(2);
    expect(report.failures).toEqual([
      { segmentId: 1, reason: "locked" },
      { segmentId: 1, reason: "locked" },
    ]);
  });

  it("fails the whole stop when the MTE is not loaded", async () => {
    const driver = fakeDriver({ getTrafficEventName: vi.fn(() => null) });
    const report = await applyClosures(
      [stop([1, 2])],
      { ...options, trafficEventId: "123" },
      driver,
    );
    expect(driver.addClosure).not.toHaveBeenCalled();
    expect(report.failures).toEqual([
      { segmentId: 1, reason: "MTE 123 not loaded" },
      { segmentId: 2, reason: "MTE 123 not loaded" },
    ]);
  });

  it("reports progress per stop", async () => {
    const onProgress = vi.fn();
    await applyClosures([stop([1]), stop([2])], options, fakeDriver(), onProgress);
    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});
