import { afterEach, describe, expect, it, vi } from "vitest";
import type { WmeSDK } from "wme-sdk-typings";
import { waitForMapIdle } from "../utils/waitForMapIdle";

describe("waitForMapIdle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a quiet window after late map-data-loaded events", async () => {
    vi.useFakeTimers();

    let mapDataLoadedHandler: (() => void) | null = null;
    const unsubscribe = vi.fn();
    const wmeSDK = {
      State: {
        isMapLoading: vi.fn(() => false),
      },
      Events: {
        on: vi.fn(({ eventHandler }: { eventHandler: () => void }) => {
          mapDataLoadedHandler = eventHandler;
          return unsubscribe;
        }),
      },
    } as unknown as WmeSDK;

    let resolved = false;
    const promise = waitForMapIdle(wmeSDK, { settleDelayMs: 100, timeoutMs: 1_000 }).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(90);
    expect(resolved).toBe(false);

    mapDataLoadedHandler?.();
    await vi.advanceTimersByTimeAsync(90);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(10);
    await promise;

    expect(resolved).toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
