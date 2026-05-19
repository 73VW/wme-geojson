import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSlowupDetailUrl,
  fetchSlowupDetails,
  parseSlowupDetails,
} from "../lines/slowupClient";

type XmlHttpRequestOptions = {
  method: string;
  url: string;
  responseType: string;
  timeout: number;
  onload: (response: { status: number; response: unknown }) => void;
  onerror: (response: { statusText?: string }) => void;
  ontimeout: () => void;
};

function mockXmlHttpRequest(
  implementation: (options: XmlHttpRequestOptions) => void,
): ReturnType<typeof vi.fn> {
  const xmlHttpRequest = vi.fn(implementation);

  vi.stubGlobal("GM", {
    xmlHttpRequest,
  });

  return xmlHttpRequest;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildSlowupDetailUrl", () => {
  it("builds the refid + lang URL", () => {
    expect(buildSlowupDetailUrl(19, "en")).toBe(
      "https://schweizmobil.ch/api/4/feature/slowup/refid/19?lang=en",
    );
  });

  it("uses the given two-letter language code", () => {
    expect(buildSlowupDetailUrl(7, "fr")).toContain("?lang=fr");
  });
});

describe("parseSlowupDetails", () => {
  it("extracts refid, title and date from the API array response", () => {
    const raw = [
      { id: 19, refid: 19, title: "Ticino", date: "2026-04-19", abstract: "...", photo: "..." },
    ];

    expect(parseSlowupDetails(raw)).toEqual({ refid: 19, title: "Ticino", date: "2026-04-19" });
  });

  it("throws on an empty array", () => {
    expect(() => parseSlowupDetails([])).toThrow();
  });

  it("throws when the response is not an array", () => {
    expect(() => parseSlowupDetails({ refid: 19 })).toThrow();
  });

  it("throws when title or date is missing", () => {
    expect(() => parseSlowupDetails([{ refid: 19, title: "Ticino" }])).toThrow();
    expect(() => parseSlowupDetails([{ refid: 19, date: "2026-04-19" }])).toThrow();
  });
});

describe("fetchSlowupDetails", () => {
  it("resolves on a 2xx JSON payload", async () => {
    const xmlHttpRequest = mockXmlHttpRequest((options) => {
      options.onload({
        status: 200,
        response: [{ refid: 19, title: "Ticino", date: "2026-04-19" }],
      });
    });

    await expect(fetchSlowupDetails(19, "fr")).resolves.toEqual({
      refid: 19,
      title: "Ticino",
      date: "2026-04-19",
    });

    expect(xmlHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: buildSlowupDetailUrl(19, "fr"),
        responseType: "json",
        timeout: 15_000,
      }),
    );
  });

  it("rejects on a non-2xx HTTP status", async () => {
    mockXmlHttpRequest((options) => {
      options.onload({
        status: 503,
        response: [{ refid: 19, title: "Ticino", date: "2026-04-19" }],
      });
    });

    await expect(fetchSlowupDetails(19, "en")).rejects.toThrow(
      "HTTP 503 fetching slowUp details for refid 19.",
    );
  });

  it("rejects when the JSON payload is malformed", async () => {
    mockXmlHttpRequest((options) => {
      options.onload({
        status: 200,
        response: { refid: 19 },
      });
    });

    await expect(fetchSlowupDetails(19, "en")).rejects.toThrow(
      "slowUp detail response must be an array.",
    );
  });

  it("rejects on a network error", async () => {
    mockXmlHttpRequest((options) => {
      options.onerror({
        statusText: "connection reset",
      });
    });

    await expect(fetchSlowupDetails(19, "en")).rejects.toThrow(
      "Network error fetching slowUp details for refid 19: connection reset.",
    );
  });

  it("rejects when the request times out", async () => {
    mockXmlHttpRequest((options) => {
      options.ontimeout();
    });

    await expect(fetchSlowupDetails(19, "en")).rejects.toThrow(
      "Request timed out after 15s fetching slowUp details for refid 19.",
    );
  });
});