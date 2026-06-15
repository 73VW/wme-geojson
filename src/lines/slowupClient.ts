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
        reject(
          new Error(
            `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s fetching slowUp details for refid ${refid}.`,
          ),
        );
      },
    });
  });
}

import type { SlowupFullDetails } from "./types";

const FULL_LANGS = ["fr", "en", "de", "it"] as const;
type FullLang = (typeof FULL_LANGS)[number];

interface RawFullItem {
  refid: unknown;
  title: unknown;
  date: unknown;
  abstract: unknown;
  urlLink: unknown;
}

function parseFullItem(
  raw: unknown,
  lang: FullLang,
): { abstract: string; urlLink: string; refid: number; title: string; date: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`slowUp full detail (${lang}) response must be a non-empty array.`);
  }
  const item = raw[0] as RawFullItem;
  const refid = typeof item.refid === "number" ? item.refid : Number(item.refid);
  if (!Number.isFinite(refid)) throw new Error(`slowUp full detail (${lang}) missing refid.`);
  if (typeof item.title !== "string" || !item.title)
    throw new Error(`slowUp full detail (${lang}) missing title.`);
  if (typeof item.date !== "string" || !item.date)
    throw new Error(`slowUp full detail (${lang}) missing date.`);
  if (typeof item.abstract !== "string")
    throw new Error(`slowUp full detail (${lang}) missing abstract.`);
  if (typeof item.urlLink !== "string" || !item.urlLink)
    throw new Error(`slowUp full detail (${lang}) missing urlLink.`);
  return {
    refid,
    title: item.title,
    date: item.date,
    abstract: item.abstract,
    urlLink: item.urlLink,
  };
}

function fetchOneLang(
  refid: number,
  lang: FullLang,
): Promise<{ abstract: string; urlLink: string; refid: number; title: string; date: string }> {
  const url = buildSlowupDetailUrl(refid, lang);
  return new Promise((resolve, reject) => {
    GM.xmlHttpRequest({
      method: "GET",
      url,
      responseType: "json",
      timeout: FETCH_TIMEOUT_MS,
      onload(response) {
        if (response.status < 200 || response.status >= 300) {
          reject(new Error(`HTTP ${response.status} fetching slowUp ${lang} for refid ${refid}.`));
          return;
        }
        try {
          resolve(parseFullItem(response.response, lang));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
      onerror(response) {
        reject(
          new Error(
            `Network error fetching slowUp ${lang} for refid ${refid}: ${response.statusText || "unknown"}.`,
          ),
        );
      },
      ontimeout() {
        reject(new Error(`Timeout fetching slowUp ${lang} for refid ${refid}.`));
      },
    });
  });
}

export async function fetchSlowupFullDetails(refid: number): Promise<SlowupFullDetails> {
  const [fr, en, de, it] = await Promise.all(FULL_LANGS.map((lang) => fetchOneLang(refid, lang)));

  const urls = [fr.urlLink, en.urlLink, de.urlLink, it.urlLink];
  if (new Set(urls).size > 1) {
    console.warn(
      `[slowupClient] urlLink diverges across langs for refid ${refid}; using FR.`,
      urls,
    );
  }

  return {
    refid: fr.refid,
    title: fr.title,
    date: fr.date,
    urlLink: fr.urlLink,
    abstracts: {
      fr: fr.abstract,
      en: en.abstract,
      de: de.abstract,
      it: it.abstract,
    },
  };
}
