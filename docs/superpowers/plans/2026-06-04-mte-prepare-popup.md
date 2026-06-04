# MTE Prepare Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une popup « Préparer MTE » dans le panneau Matching qui rassemble les infos d'un slowup (titre, date, abstracts FR/EN/DE/IT, urlLink), auto-détecte un MTE existant via son `urlLink`, persiste le mapping `refid → mteId` en `localStorage`, et pré-remplit le champ MTE ID de l'export CSV.

**Architecture :** Module pur `src/mte/` (store, resolver, sdk adapter) + popup DOM `src/ui/MtePreparePopup.ts` + extensions ciblées de `slowupClient`, `promptFinalFields`, et `MatchingSubTab`.

**Tech stack :** TypeScript strict, Vitest, i18next, Waze SDK (`SDK.MajorTrafficEvents`), `localStorage`, `GM.xmlHttpRequest`.

**Spec :** [`docs/superpowers/specs/2026-06-04-mte-prepare-popup-design.md`](../specs/2026-06-04-mte-prepare-popup-design.md)

---

## File Structure

**Created :**
- `src/mte/mteStore.ts` — persistance `localStorage` `refid → mteId`
- `src/mte/mteResolver.ts` — logique pure de matching MTE↔slowup
- `src/mte/mteSdk.ts` — adapter Waze SDK `MajorTrafficEvents`
- `src/mte/index.ts` — barrel
- `src/ui/MtePreparePopup.ts` — popup DOM
- `src/__tests__/mteStore.test.ts`
- `src/__tests__/mteResolver.test.ts`

**Modified :**
- `src/lines/types.ts` — ajout `SlowupFullDetails`
- `src/lines/slowupClient.ts` — ajout `fetchSlowupFullDetails`
- `src/__tests__/slowupClient.test.ts` — tests pour `fetchSlowupFullDetails`
- `src/ui/promptFinalFields.ts` — option `refid` + défaut depuis `mteStore`
- `src/ui/subtabs/MatchingSubTab.ts` — bouton « Préparer MTE » + passage du `refid` à `promptFinalFields`
- `locales/fr/common.json`, `locales/en/common.json` — clés i18n

---

## Conventions

- TypeScript strict, pas de `any` non typé.
- Tests via Vitest, fichiers dans `src/__tests__/<sujet>.test.ts`.
- Pas de logger custom dans les modules purs ; juste `console.warn` pour les warnings rares (`localStorage` indisponible, urlLink divergent).
- Commits petits et fréquents, message court à l'impératif (cf. `git log --oneline -10`).
- Lancer `npm test -- <fichier>` après chaque ajout/édition de tests.

---

### Task 1 : `mteStore` — persistance localStorage

**Files:**
- Create: `src/mte/mteStore.ts`
- Test: `src/__tests__/mteStore.test.ts`

- [ ] **Step 1 : Écrire les tests (TDD)**

```ts
// src/__tests__/mteStore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mteStore, MTE_STORE_KEY } from "../mte/mteStore";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mteStore", () => {
  it("returns undefined when no value is stored", () => {
    expect(mteStore.get(123)).toBeUndefined();
  });

  it("persists and retrieves a mteId for a refid", () => {
    mteStore.set(123, "987654");
    expect(mteStore.get(123)).toBe("987654");
  });

  it("survives a fresh read of localStorage (real persistence)", () => {
    mteStore.set(123, "987654");
    const raw = window.localStorage.getItem(MTE_STORE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ "123": "987654" });
  });

  it("clears a refid", () => {
    mteStore.set(123, "987654");
    mteStore.clear(123);
    expect(mteStore.get(123)).toBeUndefined();
  });

  it("treats set('') as clear", () => {
    mteStore.set(123, "987654");
    mteStore.set(123, "");
    expect(mteStore.get(123)).toBeUndefined();
  });

  it("handles multiple refids independently", () => {
    mteStore.set(1, "AAA");
    mteStore.set(2, "BBB");
    expect(mteStore.get(1)).toBe("AAA");
    expect(mteStore.get(2)).toBe("BBB");
    mteStore.clear(1);
    expect(mteStore.get(2)).toBe("BBB");
  });

  it("recovers from corrupted localStorage JSON", () => {
    window.localStorage.setItem(MTE_STORE_KEY, "not-json{");
    expect(mteStore.get(123)).toBeUndefined();
    mteStore.set(123, "X");
    expect(mteStore.get(123)).toBe("X");
  });

  it("no-ops silently when localStorage.setItem throws (quota)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => mteStore.set(123, "X")).not.toThrow();
    setItem.mockRestore();
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

```bash
npm test -- src/__tests__/mteStore.test.ts --run
```

Attendu : ÉCHEC (module `../mte/mteStore` n'existe pas).

- [ ] **Step 3 : Implémenter `mteStore`**

```ts
// src/mte/mteStore.ts
export const MTE_STORE_KEY = "wme-geojson:mte-by-refid";

function readAll(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(MTE_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(MTE_STORE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("[mteStore] localStorage.setItem failed:", err);
  }
}

export const mteStore = {
  get(refid: number): string | undefined {
    const map = readAll();
    const value = map[String(refid)];
    return value && value.length > 0 ? value : undefined;
  },

  set(refid: number, mteId: string): void {
    const trimmed = mteId.trim();
    if (trimmed.length === 0) {
      this.clear(refid);
      return;
    }
    const map = readAll();
    map[String(refid)] = trimmed;
    writeAll(map);
  },

  clear(refid: number): void {
    const map = readAll();
    delete map[String(refid)];
    writeAll(map);
  },
};
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

```bash
npm test -- src/__tests__/mteStore.test.ts --run
```

Attendu : tous verts.

- [ ] **Step 5 : Commit**

```bash
git add src/mte/mteStore.ts src/__tests__/mteStore.test.ts
git commit -m "feat(mte): persistent refid→mteId store backed by localStorage"
```

---

### Task 2 : `mteResolver` — logique pure de matching

**Files:**
- Create: `src/mte/mteResolver.ts`
- Test: `src/__tests__/mteResolver.test.ts`

- [ ] **Step 1 : Écrire les tests**

```ts
// src/__tests__/mteResolver.test.ts
import { describe, expect, it } from "vitest";
import { byUrl, candidatesByBbox, type MteRef } from "../mte/mteResolver";

function mte(overrides: Partial<MteRef>): MteRef {
  return {
    id: "1",
    name: "MTE",
    urlLink: null,
    bbox: [0, 0, 10, 10],
    startDate: "2026-06-20",
    endDate: "2026-06-22",
    ...overrides,
  };
}

describe("byUrl", () => {
  it("returns the first MTE whose urlLink matches", () => {
    const list = [mte({ id: "1", urlLink: "https://a" }), mte({ id: "2", urlLink: "https://b" })];
    expect(byUrl(list, "https://b")?.id).toBe("2");
  });

  it("returns null when no MTE has the URL", () => {
    expect(byUrl([mte({ urlLink: "https://a" })], "https://b")).toBeNull();
  });

  it("ignores MTEs whose urlLink is null", () => {
    expect(byUrl([mte({ urlLink: null })], "https://a")).toBeNull();
  });

  it("requires exact equality (no fuzzy match)", () => {
    expect(byUrl([mte({ urlLink: "https://a/" })], "https://a")).toBeNull();
  });
});

describe("candidatesByBbox", () => {
  const slowupBbox: [number, number, number, number] = [4, 46, 8, 48];
  const slowupDate = "2026-06-21";

  it("returns MTEs whose bbox overlaps and dates cover the slowup date", () => {
    const list = [
      mte({ id: "in", bbox: [5, 47, 7, 47.5], startDate: "2026-06-20", endDate: "2026-06-22" }),
      mte({ id: "outside-bbox", bbox: [20, 20, 21, 21] }),
      mte({ id: "outside-date", bbox: [5, 47, 7, 47.5], startDate: "2026-07-01", endDate: "2026-07-02" }),
    ];
    const result = candidatesByBbox(list, slowupBbox, slowupDate);
    expect(result.map((c) => c.mte.id)).toEqual(["in"]);
  });

  it("sorts by overlap descending", () => {
    const list = [
      mte({ id: "small", bbox: [7.9, 47.9, 8, 48] }),
      mte({ id: "large", bbox: [4, 46, 8, 48] }),
    ];
    const result = candidatesByBbox(list, slowupBbox, slowupDate);
    expect(result.map((c) => c.mte.id)).toEqual(["large", "small"]);
    expect(result[0].overlap).toBeGreaterThan(result[1].overlap);
  });

  it("returns [] when no MTE matches", () => {
    expect(candidatesByBbox([], slowupBbox, slowupDate)).toEqual([]);
  });

  it("treats tangent bboxes as non-overlapping", () => {
    const list = [mte({ bbox: [8, 48, 10, 50] })];
    expect(candidatesByBbox(list, slowupBbox, slowupDate)).toEqual([]);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

```bash
npm test -- src/__tests__/mteResolver.test.ts --run
```

Attendu : ÉCHEC (module absent).

- [ ] **Step 3 : Implémenter `mteResolver`**

```ts
// src/mte/mteResolver.ts
export interface MteRef {
  id: string;
  name: string;
  urlLink: string | null;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  startDate: string; // ISO "YYYY-MM-DD"
  endDate: string;   // ISO "YYYY-MM-DD"
}

export interface MteCandidate {
  mte: MteRef;
  overlap: number; // surface d'intersection en degrés² (0 = aucune)
}

export function byUrl(mtes: ReadonlyArray<MteRef>, urlLink: string): MteRef | null {
  if (!urlLink) return null;
  for (const m of mtes) {
    if (m.urlLink && m.urlLink === urlLink) return m;
  }
  return null;
}

export function candidatesByBbox(
  mtes: ReadonlyArray<MteRef>,
  slowupBbox: [number, number, number, number],
  slowupDate: string,
): MteCandidate[] {
  const out: MteCandidate[] = [];
  for (const m of mtes) {
    if (!coversDate(m.startDate, m.endDate, slowupDate)) continue;
    const overlap = bboxOverlap(slowupBbox, m.bbox);
    if (overlap <= 0) continue;
    out.push({ mte: m, overlap });
  }
  out.sort((a, b) => b.overlap - a.overlap);
  return out;
}

function coversDate(start: string, end: string, target: string): boolean {
  return start <= target && target <= end;
}

function bboxOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const dx = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const dy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (dx <= 0 || dy <= 0) return 0;
  return dx * dy;
}
```

- [ ] **Step 4 : Lancer les tests**

```bash
npm test -- src/__tests__/mteResolver.test.ts --run
```

Attendu : tous verts.

- [ ] **Step 5 : Commit**

```bash
git add src/mte/mteResolver.ts src/__tests__/mteResolver.test.ts
git commit -m "feat(mte): pure resolver for URL match and bbox+date candidates"
```

---

### Task 3 : `SlowupFullDetails` + `fetchSlowupFullDetails`

**Files:**
- Modify: `src/lines/types.ts` (ajout type, après l'existant `SlowupDetails`)
- Modify: `src/lines/slowupClient.ts` (ajout `parseSlowupFullDetailsItem` + `fetchSlowupFullDetails`)
- Modify: `src/__tests__/slowupClient.test.ts` (tests pour la nouvelle API)

- [ ] **Step 1 : Étendre les types**

Ajouter dans `src/lines/types.ts` juste après l'interface `SlowupDetails` (vers ligne 18) :

```ts
/**
 * Full slowUp event detail used by the "Prepare MTE" popup. Includes the
 * per-language abstract and the urlLink the user pastes into the MTE form.
 * Fetched lazily on popup open — NOT cached on the LineEntry.
 */
export interface SlowupFullDetails {
  refid: number;
  title: string;
  date: string;          // "YYYY-MM-DD"
  urlLink: string;
  abstracts: {
    fr: string;
    en: string;
    de: string;
    it: string;
  };
}
```

- [ ] **Step 2 : Écrire les tests pour `fetchSlowupFullDetails`**

Ajouter dans `src/__tests__/slowupClient.test.ts` (à la fin) :

```ts
import { fetchSlowupFullDetails } from "../lines/slowupClient";

describe("fetchSlowupFullDetails", () => {
  function stubAllLangs(byLang: Record<string, { abstract: string; urlLink: string }>) {
    return mockXmlHttpRequest((options) => {
      const match = options.url.match(/\?lang=(\w\w)$/);
      const lang = match ? match[1] : "fr";
      const payload = byLang[lang];
      options.onload({
        status: 200,
        response: [
          {
            refid: 19,
            title: "Hochrhein",
            date: "2026-06-21",
            abstract: payload.abstract,
            urlLink: payload.urlLink,
          },
        ],
      });
    });
  }

  it("fetches the 4 langs in parallel and returns aggregated details", async () => {
    stubAllLangs({
      fr: { abstract: "FR", urlLink: "https://a" },
      en: { abstract: "EN", urlLink: "https://a" },
      de: { abstract: "DE", urlLink: "https://a" },
      it: { abstract: "IT", urlLink: "https://a" },
    });

    const result = await fetchSlowupFullDetails(19);
    expect(result).toEqual({
      refid: 19,
      title: "Hochrhein",
      date: "2026-06-21",
      urlLink: "https://a",
      abstracts: { fr: "FR", en: "EN", de: "DE", it: "IT" },
    });
  });

  it("warns and uses FR when urlLinks diverge", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubAllLangs({
      fr: { abstract: "FR", urlLink: "https://fr-url" },
      en: { abstract: "EN", urlLink: "https://other" },
      de: { abstract: "DE", urlLink: "https://other" },
      it: { abstract: "IT", urlLink: "https://other" },
    });

    const result = await fetchSlowupFullDetails(19);
    expect(result.urlLink).toBe("https://fr-url");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects when any lang fetch fails", async () => {
    mockXmlHttpRequest((options) => {
      if (options.url.includes("lang=de")) {
        options.onerror({ statusText: "boom" });
        return;
      }
      options.onload({
        status: 200,
        response: [{ refid: 19, title: "T", date: "2026-06-21", abstract: "x", urlLink: "https://a" }],
      });
    });

    await expect(fetchSlowupFullDetails(19)).rejects.toThrow();
  });
});
```

- [ ] **Step 3 : Lancer, vérifier l'échec**

```bash
npm test -- src/__tests__/slowupClient.test.ts --run
```

Attendu : ÉCHEC (import `fetchSlowupFullDetails` introuvable).

- [ ] **Step 4 : Implémenter `fetchSlowupFullDetails`**

Ajouter à la fin de `src/lines/slowupClient.ts` :

```ts
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

function parseFullItem(raw: unknown, lang: FullLang): { abstract: string; urlLink: string; refid: number; title: string; date: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`slowUp full detail (${lang}) response must be a non-empty array.`);
  }
  const item = raw[0] as RawFullItem;
  const refid = typeof item.refid === "number" ? item.refid : Number(item.refid);
  if (!Number.isFinite(refid)) throw new Error(`slowUp full detail (${lang}) missing refid.`);
  if (typeof item.title !== "string" || !item.title) throw new Error(`slowUp full detail (${lang}) missing title.`);
  if (typeof item.date !== "string" || !item.date) throw new Error(`slowUp full detail (${lang}) missing date.`);
  if (typeof item.abstract !== "string") throw new Error(`slowUp full detail (${lang}) missing abstract.`);
  if (typeof item.urlLink !== "string" || !item.urlLink) throw new Error(`slowUp full detail (${lang}) missing urlLink.`);
  return { refid, title: item.title, date: item.date, abstract: item.abstract, urlLink: item.urlLink };
}

function fetchOneLang(refid: number, lang: FullLang): Promise<{ abstract: string; urlLink: string; refid: number; title: string; date: string }> {
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
        reject(new Error(`Network error fetching slowUp ${lang} for refid ${refid}: ${response.statusText || "unknown"}.`));
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
    console.warn(`[slowupClient] urlLink diverges across langs for refid ${refid}; using FR.`, urls);
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
```

- [ ] **Step 5 : Lancer les tests**

```bash
npm test -- src/__tests__/slowupClient.test.ts --run
```

Attendu : tous verts (existants + nouveaux).

- [ ] **Step 6 : Commit**

```bash
git add src/lines/types.ts src/lines/slowupClient.ts src/__tests__/slowupClient.test.ts
git commit -m "feat(slowup): fetch 4-lang abstracts + urlLink for MTE popup"
```

---

### Task 4 : `mteSdk` — adapter Waze SDK

**Files:**
- Create: `src/mte/mteSdk.ts`

> Pas de tests automatisés : couplé au runtime Waze, smoke testé en navigateur. Cohérent avec `src/utils/queryParams.ts` et autres adapters SDK du projet.

- [ ] **Step 1 : Vérifier la forme exacte du retour SDK**

Ouvrir le dernier WME en dev, dans la console du navigateur :

```js
wmeSDK.MajorTrafficEvents.getMajorTrafficEvents()
```

Noter : nom du champ ID (`id`), du champ URL (`url` vs `urlLink` vs `link`), forme du polygon/bbox, et le format des dates. **Si la forme diffère du squelette ci-dessous, ajuster le mapping dans `mteSdk.ts` avant de commit.**

- [ ] **Step 2 : Implémenter l'adapter**

```ts
// src/mte/mteSdk.ts
import type { WmeSDK } from "wme-sdk-typings";
import type { MteRef } from "./mteResolver";

export interface MteSdk {
  listMtes(): MteRef[];
}

export function createMteSdk(sdk: WmeSDK): MteSdk {
  return {
    listMtes(): MteRef[] {
      try {
        const raw = sdk.MajorTrafficEvents?.getMajorTrafficEvents?.() ?? [];
        return raw.map(normalize).filter((m): m is MteRef => m !== null);
      } catch (err) {
        console.warn("[mteSdk] listMtes failed:", err);
        return [];
      }
    },
  };
}

// Forme attendue (à ajuster Step 1 si le SDK diffère) :
//   { id, name, url, geometry: { coordinates: [[[lon,lat], ...]] }, startDate, endDate }
interface RawMte {
  id: number | string;
  name?: string;
  url?: string | null;
  urlLink?: string | null;
  geometry?: { coordinates?: number[][][] };
  startDate?: string;
  endDate?: string;
}

function normalize(raw: unknown): MteRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawMte;
  if (r.id === undefined || r.id === null) return null;

  const bbox = bboxFromGeometry(r.geometry);
  if (!bbox) return null;

  return {
    id: String(r.id),
    name: typeof r.name === "string" ? r.name : "",
    urlLink: typeof r.urlLink === "string" ? r.urlLink : typeof r.url === "string" ? r.url : null,
    bbox,
    startDate: typeof r.startDate === "string" ? r.startDate.slice(0, 10) : "",
    endDate: typeof r.endDate === "string" ? r.endDate.slice(0, 10) : "",
  };
}

function bboxFromGeometry(geom: RawMte["geometry"]): [number, number, number, number] | null {
  const ring = geom?.coordinates?.[0];
  if (!ring || ring.length === 0) return null;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const pt of ring) {
    const [lon, lat] = pt;
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}
```

- [ ] **Step 3 : Smoke check de compile**

```bash
npx tsc --noEmit -p tsconfig.json
```

Attendu : 0 erreur. Si erreurs de typage SDK, ajuster les types dans `RawMte`/`createMteSdk`.

- [ ] **Step 4 : Créer le barrel**

```ts
// src/mte/index.ts
export { mteStore } from "./mteStore";
export { byUrl, candidatesByBbox } from "./mteResolver";
export type { MteRef, MteCandidate } from "./mteResolver";
export { createMteSdk } from "./mteSdk";
export type { MteSdk } from "./mteSdk";
```

- [ ] **Step 5 : Commit**

```bash
git add src/mte/mteSdk.ts src/mte/index.ts
git commit -m "feat(mte): SDK adapter for MajorTrafficEvents (normalized MteRef list)"
```

---

### Task 5 : `promptFinalFields` — option `refid` + défaut `mteStore`

**Files:**
- Modify: `src/ui/promptFinalFields.ts` (signature + ligne 82)

> Pas de nouveau test : `promptFinalFields` n'a pas de tests existants (DOM `<dialog>`). On rajoutera seulement un test ciblé sur le défaut dans un fichier dédié.

- [ ] **Step 1 : Écrire un test minimal pour le défaut depuis le store**

Créer `src/__tests__/promptFinalFieldsDefault.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resolveDefaultMteId } from "../ui/promptFinalFields";
import { mteStore } from "../mte/mteStore";

beforeEach(() => {
  window.localStorage.clear();
});

describe("resolveDefaultMteId", () => {
  it("uses explicit default when provided", () => {
    mteStore.set(19, "FROM_STORE");
    expect(resolveDefaultMteId("EXPLICIT", 19)).toBe("EXPLICIT");
  });

  it("falls back to mteStore when no explicit default and refid is known", () => {
    mteStore.set(19, "FROM_STORE");
    expect(resolveDefaultMteId(undefined, 19)).toBe("FROM_STORE");
  });

  it("returns empty string when nothing matches", () => {
    expect(resolveDefaultMteId(undefined, 19)).toBe("");
  });

  it("returns empty string when refid is undefined", () => {
    mteStore.set(19, "FROM_STORE");
    expect(resolveDefaultMteId(undefined, undefined)).toBe("");
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

```bash
npm test -- src/__tests__/promptFinalFieldsDefault.test.ts --run
```

Attendu : ÉCHEC (`resolveDefaultMteId` n'existe pas).

- [ ] **Step 3 : Modifier `promptFinalFields.ts`**

En haut du fichier, ajouter l'import et le helper exporté juste avant `promptFinalFields` :

```ts
import { mteStore } from "../mte/mteStore";

export function resolveDefaultMteId(explicit: string | undefined, refid: number | undefined): string {
  if (explicit !== undefined) return explicit;
  if (refid !== undefined) return mteStore.get(refid) ?? "";
  return "";
}

export interface PromptFinalFieldsOptions {
  defaults?: Partial<FinalFields>;
  refid?: number;
}
```

Modifier la signature de la fonction :

```ts
export async function promptFinalFields(
  options: PromptFinalFieldsOptions = {},
): Promise<FinalFields | null> {
  const { defaults, refid } = options;
  // ...
```

Remplacer ligne 82 :

```ts
mteIdInput.value = resolveDefaultMteId(defaults?.mteId, refid);
```

- [ ] **Step 4 : Adapter les appelants existants**

Chercher tous les appels :

```bash
grep -rn "promptFinalFields(" src --include='*.ts'
```

Pour chaque appel, remplacer `promptFinalFields(x)` par `promptFinalFields({ defaults: x })`. Dans `MatchingSubTab.ts` les sites `downloadClosuresGlobalTimes` et `downloadClosuresPerLine` (`const fields = await promptFinalFields();` → on les complète Task 7 avec le refid).

- [ ] **Step 5 : Lancer tests**

```bash
npm test -- src/__tests__/promptFinalFieldsDefault.test.ts --run
npm test -- --run
```

Attendu : tous verts.

- [ ] **Step 6 : Commit**

```bash
git add src/ui/promptFinalFields.ts src/__tests__/promptFinalFieldsDefault.test.ts src/ui/subtabs/MatchingSubTab.ts
git commit -m "feat(ui): promptFinalFields accepts refid, defaults MTE ID from store"
```

---

### Task 6 : `MtePreparePopup` — popup DOM

**Files:**
- Create: `src/ui/MtePreparePopup.ts`

> Pas de tests automatisés (DOM popup, cohérent avec `promptFinalFields`/`promptClosureWindow`). Smoke testé en navigateur Task 8.

- [ ] **Step 1 : Squelette de la popup**

```ts
// src/ui/MtePreparePopup.ts
import i18next from "i18next";
import { fetchSlowupFullDetails } from "../lines/slowupClient";
import type { SlowupFullDetails } from "../lines/types";
import { byUrl, candidatesByBbox, mteStore, type MteCandidate, type MteRef, type MteSdk } from "../mte";

export interface MtePreparePopupDeps {
  refid: number;
  slowupBbox: [number, number, number, number];
  mteSdk: MteSdk;
}

let openInstance: HTMLDialogElement | null = null;

export async function openMtePreparePopup(deps: MtePreparePopupDeps): Promise<void> {
  if (openInstance) {
    openInstance.close();
    openInstance.remove();
    openInstance = null;
  }

  const dialog = document.createElement("dialog");
  dialog.style.cssText = "border:none;border-radius:8px;padding:24px 28px;max-width:560px;width:92vw;box-shadow:0 6px 32px rgba(0,0,0,.25);";
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  openInstance = dialog;

  function close() {
    dialog.close();
    dialog.remove();
    if (openInstance === dialog) openInstance = null;
  }

  const title = document.createElement("h3");
  title.style.cssText = "margin:0 0 12px 0;font-size:16px;font-weight:700;";
  title.textContent = i18next.t("panel.mtePopup.loading");
  dialog.appendChild(title);

  const body = document.createElement("div");
  body.style.cssText = "display:flex;flex-direction:column;gap:12px;";
  dialog.appendChild(body);

  const closeBtn = document.createElement("button");
  closeBtn.textContent = i18next.t("panel.mtePopup.close");
  closeBtn.style.cssText = "margin-top:12px;padding:6px 14px;cursor:pointer;align-self:flex-end;";
  closeBtn.addEventListener("click", close);
  dialog.appendChild(closeBtn);

  document.body.appendChild(dialog);
  dialog.showModal();

  // Lazy fetch
  let details: SlowupFullDetails;
  try {
    details = await fetchSlowupFullDetails(deps.refid);
  } catch (err) {
    title.textContent = i18next.t("panel.mtePopup.error");
    body.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  renderContent(title, body, details, deps);
}

function renderContent(
  title: HTMLElement,
  body: HTMLElement,
  details: SlowupFullDetails,
  deps: MtePreparePopupDeps,
): void {
  title.textContent = `SlowUP ${details.title}`;
  body.innerHTML = "";

  body.appendChild(copyRow(i18next.t("panel.mtePopup.titleLabel"), `SlowUP ${details.title}`));
  body.appendChild(copyRow(i18next.t("panel.mtePopup.dateLabel"), details.date));
  body.appendChild(copyRow(i18next.t("panel.mtePopup.urlLabel"), details.urlLink));

  body.appendChild(divider());

  for (const lang of ["fr", "en", "de", "it"] as const) {
    body.appendChild(abstractBlock(lang.toUpperCase(), details.abstracts[lang]));
  }

  body.appendChild(divider());

  // MTE ID section
  const mteSection = document.createElement("div");
  mteSection.style.cssText = "display:flex;flex-direction:column;gap:6px;";

  const mteLabel = document.createElement("label");
  mteLabel.textContent = i18next.t("panel.mtePopup.mteIdLabel");
  mteLabel.style.cssText = "font-size:13px;font-weight:600;";
  mteSection.appendChild(mteLabel);

  const inputRow = document.createElement("div");
  inputRow.style.cssText = "display:flex;gap:8px;align-items:center;";
  const mteInput = document.createElement("input");
  mteInput.type = "text";
  mteInput.style.cssText = "flex:1;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px;";
  const badge = document.createElement("span");
  badge.style.cssText = "font-size:12px;color:#555;";
  const refreshBtn = document.createElement("button");
  refreshBtn.textContent = i18next.t("panel.mtePopup.refresh");
  refreshBtn.style.cssText = "padding:6px 12px;cursor:pointer;";
  inputRow.appendChild(mteInput);
  inputRow.appendChild(refreshBtn);
  mteSection.appendChild(inputRow);
  mteSection.appendChild(badge);

  const candidatesContainer = document.createElement("div");
  candidatesContainer.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  mteSection.appendChild(candidatesContainer);

  body.appendChild(mteSection);

  function runResolution(): void {
    const mtes = deps.mteSdk.listMtes();
    const stored = mteStore.get(deps.refid);
    const auto = byUrl(mtes, details.urlLink);
    candidatesContainer.innerHTML = "";

    if (stored) {
      mteInput.value = stored;
      badge.textContent = i18next.t("panel.mtePopup.badgeStored");
    } else if (auto) {
      mteInput.value = auto.id;
      mteStore.set(deps.refid, auto.id);
      badge.textContent = i18next.t("panel.mtePopup.badgeAutoUrl");
    } else {
      mteInput.value = "";
      badge.textContent = i18next.t("panel.mtePopup.badgeNone");
      const candidates = candidatesByBbox(mtes, deps.slowupBbox, details.date);
      if (candidates.length === 0) {
        const empty = document.createElement("p");
        empty.style.cssText = "margin:6px 0 0 0;font-size:12px;color:#888;";
        empty.textContent = i18next.t("panel.mtePopup.noCandidates");
        candidatesContainer.appendChild(empty);
      } else {
        const header = document.createElement("p");
        header.style.cssText = "margin:6px 0 0 0;font-size:12px;font-weight:600;";
        header.textContent = i18next.t("panel.mtePopup.candidatesHeader");
        candidatesContainer.appendChild(header);
        for (const c of candidates) {
          candidatesContainer.appendChild(candidateRow(c, () => {
            mteInput.value = c.mte.id;
            mteStore.set(deps.refid, c.mte.id);
            badge.textContent = i18next.t("panel.mtePopup.badgeManual");
          }));
        }
      }
    }
  }

  mteInput.addEventListener("input", () => {
    mteStore.set(deps.refid, mteInput.value);
    badge.textContent = i18next.t("panel.mtePopup.badgeManual");
  });

  refreshBtn.addEventListener("click", runResolution);

  runResolution();
}

function copyRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;align-items:center;";
  const lab = document.createElement("span");
  lab.textContent = `${label} :`;
  lab.style.cssText = "font-size:13px;font-weight:600;min-width:60px;";
  const val = document.createElement("span");
  val.textContent = value;
  val.style.cssText = "flex:1;font-size:13px;word-break:break-all;";
  const btn = copyButton(value);
  row.appendChild(lab);
  row.appendChild(val);
  row.appendChild(btn);
  return row;
}

function abstractBlock(langLabel: string, text: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
  const label = document.createElement("span");
  label.textContent = `Abstract ${langLabel}`;
  label.style.cssText = "font-size:13px;font-weight:600;";
  header.appendChild(label);
  header.appendChild(copyButton(text));
  const box = document.createElement("textarea");
  box.value = text;
  box.readOnly = true;
  box.style.cssText = "width:100%;min-height:60px;font-size:12px;padding:6px;border:1px solid #ddd;border-radius:4px;resize:vertical;font-family:inherit;";
  wrap.appendChild(header);
  wrap.appendChild(box);
  return wrap;
}

function copyButton(value: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = i18next.t("panel.mtePopup.copy");
  btn.style.cssText = "padding:4px 8px;font-size:12px;cursor:pointer;";
  btn.addEventListener("click", () => {
    void navigator.clipboard.writeText(value);
  });
  return btn;
}

function divider(): HTMLElement {
  const hr = document.createElement("hr");
  hr.style.cssText = "border:none;border-top:1px solid #eee;margin:4px 0;";
  return hr;
}

function candidateRow(c: MteCandidate, onPick: () => void): HTMLElement {
  const row = document.createElement("button");
  row.type = "button";
  row.style.cssText = "text-align:left;padding:6px 8px;border:1px solid #ddd;border-radius:4px;background:#fafafa;cursor:pointer;font-size:12px;";
  row.textContent = `[#${c.mte.id}] ${c.mte.name || "(sans nom)"} — overlap ${c.overlap.toFixed(4)}°²`;
  row.addEventListener("click", onPick);
  return row;
}
```

- [ ] **Step 2 : Compile check**

```bash
npx tsc --noEmit -p tsconfig.json
```

Attendu : 0 erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/ui/MtePreparePopup.ts
git commit -m "feat(ui): MtePreparePopup with lazy 4-lang fetch and MTE auto-detect"
```

---

### Task 7 : `MatchingSubTab` button + i18n keys

**Files:**
- Modify: `locales/fr/common.json`
- Modify: `locales/en/common.json`
- Modify: `src/ui/subtabs/MatchingSubTab.ts`

- [ ] **Step 1 : Ajouter les clés i18n FR**

Dans `locales/fr/common.json`, sous `panel.matching`, ajouter :

```json
"prepareMteBtn": "Préparer MTE",
"prepareMteDisabled": "Détails du slowup non chargés",
```

Et ajouter un nouveau bloc top-level sous `panel` :

```json
"mtePopup": {
  "loading": "Chargement…",
  "error": "Erreur",
  "close": "Fermer",
  "copy": "Copier",
  "refresh": "Rafraîchir",
  "titleLabel": "Titre",
  "dateLabel": "Date",
  "urlLabel": "URL",
  "mteIdLabel": "MTE ID",
  "badgeStored": "depuis localStorage",
  "badgeAutoUrl": "auto-détecté (URL)",
  "badgeManual": "override manuel",
  "badgeNone": "aucun MTE lié",
  "candidatesHeader": "Candidats (sans URL match) :",
  "noCandidates": "Aucun MTE candidat à proximité."
}
```

- [ ] **Step 2 : Miroiter en `locales/en/common.json`**

```json
"prepareMteBtn": "Prepare MTE",
"prepareMteDisabled": "SlowUp details not loaded",
```

```json
"mtePopup": {
  "loading": "Loading…",
  "error": "Error",
  "close": "Close",
  "copy": "Copy",
  "refresh": "Refresh",
  "titleLabel": "Title",
  "dateLabel": "Date",
  "urlLabel": "URL",
  "mteIdLabel": "MTE ID",
  "badgeStored": "from localStorage",
  "badgeAutoUrl": "auto-detected (URL)",
  "badgeManual": "manual override",
  "badgeNone": "no linked MTE",
  "candidatesHeader": "Candidates (no URL match):",
  "noCandidates": "No MTE candidate nearby."
}
```

- [ ] **Step 3 : Bouton dans `MatchingSubTab`**

Repérer dans `src/ui/subtabs/MatchingSubTab.ts` la zone où sont créés les boutons d'export CSV (proche de `downloadClosures` / `downloadClosuresGlobalTimes`, autour des lignes 1820-1900). Ajouter un bouton frère `prepareMteBtn`.

Patron à coller à côté du bouton CSV existant (adapter au DOM helper local du fichier) :

```ts
const prepareMteBtn = document.createElement("button");
prepareMteBtn.type = "button";
prepareMteBtn.textContent = i18next.t("panel.matching.prepareMteBtn");
prepareMteBtn.style.cssText = "/* aligner sur les autres boutons */";
prepareMteBtn.addEventListener("click", () => void this.openMtePopup());
// l'ajouter au même conteneur que le bouton CSV
```

Ajouter la méthode privée à la classe :

```ts
private async openMtePopup(): Promise<void> {
  const entry = this.registry.getSelected();
  const refid = entry?.slowupDetails?.refid;
  if (!entry || !refid) return;

  const { openMtePreparePopup } = await import("../MtePreparePopup");
  const { createMteSdk } = await import("../../mte");

  const bbox = computeBbox(entry.track); // utilitaire existant ou turf.bbox

  await openMtePreparePopup({
    refid,
    slowupBbox: bbox,
    mteSdk: createMteSdk(this.sdk),
  });
}
```

> Si `this.sdk` n'est pas exposé sur `MatchingSubTab`, le récupérer via le constructeur (chercher comment les autres adapters SDK sont injectés : `grep "wmeSDK\|WmeSDK" src/ui/subtabs/MatchingSubTab.ts`). En dernier recours, l'injecter via `MatchPanel` qui le possède déjà.

> Pour la bbox : `turf.bbox(entry.track.feature)` retourne `[minLon, minLat, maxLon, maxLat]`. Si turf est déjà importé dans le fichier (`grep -n 'from "@turf'`) le réutiliser ; sinon `import { bbox } from "@turf/turf";` (ou la variante déjà utilisée ailleurs dans le repo).

Méthode de gating (enabled/disabled) — à appeler depuis le hook qui réagit au changement de slowup sélectionné (cf. `onSelectedLineChanged` ligne ~216) :

```ts
private updatePrepareMteBtn(entry: LineEntry | null): void {
  if (!this.prepareMteBtn) return;
  const refid = entry?.slowupDetails?.refid;
  this.prepareMteBtn.disabled = !refid;
  this.prepareMteBtn.title = refid ? "" : i18next.t("panel.matching.prepareMteDisabled");
}
```

Passer `refid` à `promptFinalFields` (les deux appels) :

```ts
const fields = await promptFinalFields({
  refid: this.registry.getSelected()?.slowupDetails?.refid,
});
```

- [ ] **Step 4 : Compile**

```bash
npx tsc --noEmit -p tsconfig.json
```

Attendu : 0 erreur. Si la bbox util choisie n'a pas le bon retour, l'adapter localement (ex : `[bb[0], bb[1], bb[2], bb[3]]`).

- [ ] **Step 5 : Tests**

```bash
npm test -- --run
```

Attendu : tous verts.

- [ ] **Step 6 : Commit**

```bash
git add locales/ src/ui/subtabs/MatchingSubTab.ts
git commit -m "feat(matching): Prepare MTE button opens popup, passes refid to export"
```

---

### Task 8 : Build + smoke navigateur + commit final

- [ ] **Step 1 : Build complet**

```bash
npm run compile
```

Attendu : succès, `.out/main.user.js` mis à jour.

- [ ] **Step 2 : Smoke test manuel dans WME**

Recharger le userscript dans WME, puis :

1. Charger une URL de slowup connue (avec `slowupDetails.refid`).
2. Sélectionner une ligne → onglet **Matching**.
3. Vérifier que le bouton **« Préparer MTE »** est activé.
4. Cliquer → popup s'ouvre, les 4 abstracts apparaissent après quelques ms.
5. Vérifier les boutons **Copier** (titre, date, URL, chaque abstract) — la presse-papier reçoit la bonne valeur.
6. Vérifier que :
   - Si aucun MTE n'a l'URL : badge « aucun MTE lié », candidats listés (ou « Aucun MTE candidat »).
   - Si un MTE a la même URL : champ pré-rempli, badge « auto-détecté (URL) ».
7. Cliquer **Rafraîchir** après création manuelle d'un MTE dans WME → l'ID se remplit.
8. Saisir un ID manuel → fermer popup → recharger la page → rouvrir popup → l'ID est toujours là (persistance localStorage).
9. Lancer un export CSV → le champ MTE ID est pré-rempli avec la valeur du store.

- [ ] **Step 3 : Désactiver le bouton si pas de slowup sélectionné**

Vérifier que sélectionner une ligne sans `slowupDetails.refid` (cas geojson legacy non-SchweizMobil) → bouton `disabled` avec tooltip.

- [ ] **Step 4 : Tests + compile finaux**

```bash
npm test -- --run && npm run compile
```

Attendu : verts + build OK.

- [ ] **Step 5 : Vérifier l'état git**

```bash
git status
git log --oneline -10
```

Attendu : working tree propre (hors fichiers non liés au feature), commits clairs depuis Task 1.

---

## Self-review (gaps spec ↔ plan)

- Décision « URL d'abord puis manuel via liste » → couverte par Task 2 (resolver) + Task 6 (popup).
- Auto-détection + override manuel → couverte par Task 6 (logique `runResolution` + handler `input`).
- Persistance localStorage par refid → Task 1 + Task 6 (set on input) + Task 5 (read in promptFinalFields).
- 4 abstracts empilés FR/EN/DE/IT → Task 6 (`abstractBlock`).
- Bouton dans le panneau Matching, désactivé si pas de slowup → Task 7.
- `SlowUP <title>` affiché en haut + copier → Task 6 (`title.textContent` + `copyRow` title).
- 1 MTE par slowup → architecture (`mteStore` keyed by `refid`).
- Edge case `localStorage` indisponible → Task 1 Step 1 (test) + Task 1 Step 3 (try/catch dans `writeAll`).
- Edge case urlLink divergent → Task 3 (warn + FR fait foi).
- Edge case `SDK.MajorTrafficEvents` indisponible → Task 4 (try/catch → `[]`).
- Hors-scope (création SDK, multi-MTE, gestion globale du store) → respecté, aucune tâche.
