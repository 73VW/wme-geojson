import { beforeEach, describe, expect, it, vi } from "vitest";
import { LineRegistry } from "../lines/LineRegistry";
import { LinesSubTab } from "../ui/subtabs/LinesSubTab";
import type { LineEntry, SlowupDetails } from "../lines/types";

const mocked = vi.hoisted(() => ({
  linesListInstances: [] as Array<{
    root: HTMLElement;
    setEntries: ReturnType<typeof vi.fn>;
    setUrl: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    clearError: ReturnType<typeof vi.fn>;
  }>,
  fetchSlowupDetails: vi.fn(),
  computeDisplayName: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  i18next: { language: "fr-CH" },
}));

vi.mock("../ui/views/LinesListView", () => ({
  LinesListView: vi.fn().mockImplementation(() => {
    const instance = {
      root: {} as HTMLElement,
      setEntries: vi.fn(),
      setUrl: vi.fn(),
      showError: vi.fn(),
      clearError: vi.fn(),
    };
    mocked.linesListInstances.push(instance);
    return instance;
  }),
}));

vi.mock("../lines/slowupClient", () => ({
  fetchSlowupDetails: mocked.fetchSlowupDetails,
}));

vi.mock("../lines/displayName", () => ({
  computeDisplayName: mocked.computeDisplayName,
}));

vi.mock("../../locales/i18n", () => ({
  i18next: mocked.i18next,
}));

vi.mock("../utils/logger", () => ({
  logger: {
    warn: mocked.loggerWarn,
    error: mocked.loggerError,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeEntry(id: string, slowupNumber?: number): LineEntry {
  return {
    id,
    track: {
      trackId: id,
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [6.14, 46.2],
            [6.15, 46.2],
          ],
        ],
      },
      rawProperties: { name: `Line ${id}` },
    },
    lengthKm: 10,
    displayName: `Line ${id}`,
    color: "#123456",
    slowupNumber,
    slowupFetchStatus: "idle",
    mode: "synthetic",
    matchPhase: "idle",
  };
}

function makeSlowupEntry(id: string, date: string): LineEntry {
  return {
    ...makeEntry(id, Number.parseInt(id.replace(/^.*-/, ""), 10)),
    slowupDetails: {
      refid: Number.parseInt(id.replace(/^.*-/, ""), 10),
      title: `slowUp ${id}`,
      date,
    },
    slowupFetchStatus: "ok",
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function latestView() {
  const view = mocked.linesListInstances[mocked.linesListInstances.length - 1];
  expect(view).toBeDefined();
  return view!;
}

describe("LinesSubTab", () => {
  beforeEach(() => {
    mocked.linesListInstances.length = 0;
    mocked.fetchSlowupDetails.mockReset();
    mocked.computeDisplayName.mockReset();
    mocked.loggerWarn.mockReset();
    mocked.loggerError.mockReset();
    mocked.i18next.language = "fr-CH";
    mocked.computeDisplayName.mockImplementation(({ slowupDetails, lengthKm }) => {
      if (slowupDetails) {
        return `${slowupDetails.title} — ${slowupDetails.date}`;
      }
      return `Fallback ${lengthKm.toFixed(1)}`;
    });
  });

  it("fetches slowUp details with the two-letter language and rerenders loading then success", async () => {
    const deferred = createDeferred<SlowupDetails>();
    mocked.fetchSlowupDetails.mockReturnValueOnce(deferred.promise);

    const registry = new LineRegistry();
    const subTab = new LinesSubTab({
      registry,
      loadFn: vi.fn(),
      loadFileFn: vi.fn(),
      onLineSelected: vi.fn(),
      onCenterAll: vi.fn(),
      onCenterLine: vi.fn(),
    });
    const view = latestView();

    registry.setEntries([makeEntry("line-19", 19)]);

    expect(mocked.fetchSlowupDetails).toHaveBeenCalledWith(19, "fr");
    expect(view.setEntries).toHaveBeenCalledTimes(3);
    expect(view.setEntries.mock.calls[0]?.[0]).toEqual([]);
    expect(view.setEntries.mock.calls[1]?.[0]?.[0]).toEqual(
      expect.objectContaining({ id: "line-19", slowupFetchStatus: "idle" }),
    );
    expect(view.setEntries.mock.calls[2]?.[0]?.[0]).toEqual(
      expect.objectContaining({ id: "line-19", slowupFetchStatus: "loading" }),
    );
    expect(registry.getEntryById("line-19")).toEqual(
      expect.objectContaining({ slowupFetchStatus: "loading" }),
    );

    const details: SlowupDetails = {
      refid: 19,
      title: "slowUp Ticino",
      date: "2026-04-19",
    };
    deferred.resolve(details);
    await flushPromises();

    expect(mocked.computeDisplayName).toHaveBeenCalledWith(
      expect.objectContaining({
        lengthKm: 10,
        properties: { name: "Line line-19" },
        slowupDetails: details,
      }),
    );
    expect(registry.getEntryById("line-19")).toEqual(
      expect.objectContaining({
        slowupFetchStatus: "ok",
        slowupDetails: details,
        displayName: "slowUp Ticino — 2026-04-19",
      }),
    );
    expect(view.setEntries).toHaveBeenCalledTimes(4);
    expect(view.setEntries.mock.calls[3]?.[0]?.[0]).toEqual(
      expect.objectContaining({
        id: "line-19",
        slowupFetchStatus: "ok",
        slowupDetails: details,
        displayName: "slowUp Ticino — 2026-04-19",
      }),
    );

    subTab.dispose();
  });

  it("marks the entry as error and rerenders when the slowUp fetch rejects", async () => {
    mocked.i18next.language = "en-US";
    mocked.fetchSlowupDetails.mockRejectedValueOnce(new Error("boom"));

    const registry = new LineRegistry();
    const subTab = new LinesSubTab({
      registry,
      loadFn: vi.fn(),
      loadFileFn: vi.fn(),
      onLineSelected: vi.fn(),
      onCenterAll: vi.fn(),
      onCenterLine: vi.fn(),
    });
    const view = latestView();

    registry.setEntries([makeEntry("line-7", 7)]);
    await flushPromises();

    expect(mocked.fetchSlowupDetails).toHaveBeenCalledWith(7, "en");
    expect(registry.getEntryById("line-7")).toEqual(
      expect.objectContaining({ slowupFetchStatus: "error" }),
    );
    expect(view.setEntries).toHaveBeenCalledTimes(4);
    expect(view.setEntries.mock.calls[3]?.[0]?.[0]).toEqual(
      expect.objectContaining({ id: "line-7", slowupFetchStatus: "error" }),
    );
    expect(mocked.loggerWarn).toHaveBeenCalled();

    subTab.dispose();
  });

  it("sorts slowUp lines by ascending date while keeping other entries stable", () => {
    const registry = new LineRegistry();
    const subTab = new LinesSubTab({
      registry,
      loadFn: vi.fn(),
      loadFileFn: vi.fn(),
      onLineSelected: vi.fn(),
      onCenterAll: vi.fn(),
      onCenterLine: vi.fn(),
    });
    const view = latestView();

    registry.setEntries([
      makeEntry("regular"),
      makeSlowupEntry("slowup-5", "2026-05-10"),
      makeSlowupEntry("slowup-invalid", "not-a-date"),
      makeSlowupEntry("slowup-4", "2026-04-10"),
    ]);

    expect(view.setEntries.mock.calls[1]?.[0].map((entry: LineEntry) => entry.id)).toEqual([
      "regular",
      "slowup-4",
      "slowup-invalid",
      "slowup-5",
    ]);

    subTab.dispose();
  });
});
