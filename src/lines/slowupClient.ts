import type { SlowupDetails } from "./types";

const FETCH_TIMEOUT_MS = 15_000;

export function buildSlowupDetailUrl(refid: number, lang: string): string {
  return `https://schweizmobil.ch/api/4/feature/slowup/refid/${refid}?lang=${lang}`;
}

export function parseSlowupDetails(raw: unknown): SlowupDetails {
  if (!Array.isArray(raw)) {
    throw new Error("slowUp detail response must be an array.");
  }

  if (raw.length === 0) {
    throw new Error("slowUp detail response must not be empty.");
  }

  const firstItem = raw[0];
  if (!firstItem || typeof firstItem !== "object") {
    throw new Error("slowUp detail response item must be an object.");
  }

  const detail = firstItem as Record<string, unknown>;
  const refid = detail["refid"];
  const title = detail["title"];
  const date = detail["date"];

  if (typeof title !== "string" || title.length === 0) {
    throw new Error("slowUp detail response is missing title.");
  }

  if (typeof date !== "string" || date.length === 0) {
    throw new Error("slowUp detail response is missing date.");
  }

  const parsedRefid =
    typeof refid === "number" ? refid : typeof refid === "string" ? Number(refid) : Number.NaN;

  if (!Number.isFinite(parsedRefid)) {
    throw new Error("slowUp detail response is missing refid.");
  }

  return {
    refid: parsedRefid,
    title,
    date,
  };
}

export function fetchSlowupDetails(refid: number, lang: string): Promise<SlowupDetails> {
  const url = buildSlowupDetailUrl(refid, lang);

  return new Promise((resolve, reject) => {
    GM.xmlHttpRequest({
      method: "GET",
      url,
      responseType: "json",
      timeout: FETCH_TIMEOUT_MS,
      onload(response) {
        const isSuccess = response.status >= 200 && response.status < 300;
        if (!isSuccess) {
          reject(new Error(`HTTP ${response.status} fetching slowUp details for refid ${refid}.`));
          return;
        }

        try {
          resolve(parseSlowupDetails(response.response));
        } catch (error) {
          reject(
            error instanceof Error
              ? error
              : new Error(`Malformed slowUp detail response for refid ${refid}.`),
          );
        }
      },
      onerror(response) {
        reject(
          new Error(
            `Network error fetching slowUp details for refid ${refid}: ${response.statusText || "unknown error"}.`,
          ),
        );
      },
      ontimeout() {
        reject(new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s fetching slowUp details for refid ${refid}.`));
      },
    });
  });
}