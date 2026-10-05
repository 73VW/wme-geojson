// src/mte/mteFormFiller.ts
//
// Le SDK ne sait pas créer de MTE : on pilote le formulaire « Créer un
// événement » de WME via le DOM, puis on écoute l'event SDK de changement
// d'ID pour récupérer l'ID définitif quand l'utilisateur enregistre.
//
// ponytail: sélecteurs DOM WME hors SDK, cassent à une refonte du panneau ;
// fillMteForm lève alors une erreur et l'appelant retombe sur le popup.

import i18next from "i18next";
import type { MultiPolygon, Polygon } from "geojson";
import type { MajorTrafficEventCategory, WmeSDK } from "wme-sdk-typings";
import type { SlowupFullDetails } from "../lines/types";
import type { ManualMteInfo } from "../ui/promptMteInfo";

export type MteLang = "en" | "fr" | "de" | "it";

export interface MteText {
  name: string;
  description: string;
}

export interface MteFormData {
  category: MajorTrafficEventCategory;
  lockLevel: LockLevel;
  polygon: Polygon | MultiPolygon | null;
  /** "YYYY-MM-DDTHH:mm" */
  start: string;
  /** "YYYY-MM-DDTHH:mm" */
  end: string;
  /** Champ principal (English dans WME). */
  text: MteText;
  /** WME n'accepte qu'une seule traduction. */
  translation?: MteText & { lang: MteLang };
  url: string;
}

// Les sous-titres des champs traduits sont les noms natifs des langues,
// identiques quelle que soit la langue de l'interface WME.
const LANG_LABEL: Record<MteLang, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
};

/** Longueur max du nom d'un MTE (maxlength du champ WME). */
export const MTE_NAME_MAX = 25;

export type LockLevel = 1 | 2 | 3 | 4;

export interface MteEventOptions {
  category: MajorTrafficEventCategory;
  lockLevel: LockLevel;
}

export const DEFAULT_MTE_OPTIONS: MteEventOptions = { category: "SPORTING_EVENT", lockLevel: 1 };

/** Categories offered by WME's MTE form (PARTNER_USER_COMMS is not). */
export function categoryOptions(): { value: MajorTrafficEventCategory; label: string }[] {
  return [
    { value: "CONCERT", label: i18next.t("panel.mteInfo.categories.concert") },
    { value: "CONSTRUCTION", label: i18next.t("panel.mteInfo.categories.construction") },
    { value: "CRISIS", label: i18next.t("panel.mteInfo.categories.crisis") },
    { value: "DEMONSTRATION", label: i18next.t("panel.mteInfo.categories.demonstration") },
    { value: "DRIVING_ADVISORY", label: i18next.t("panel.mteInfo.categories.drivingAdvisory") },
    { value: "HOLIDAY/FESTIVAL", label: i18next.t("panel.mteInfo.categories.holidayFestival") },
    { value: "OTHER", label: i18next.t("panel.mteInfo.categories.other") },
    { value: "PARADE", label: i18next.t("panel.mteInfo.categories.parade") },
    { value: "SPORTING_EVENT", label: i18next.t("panel.mteInfo.categories.sportingEvent") },
    { value: "SUMMIT", label: i18next.t("panel.mteInfo.categories.summit") },
    {
      value: "UNPLANNED_DISRUPTION",
      label: i18next.t("panel.mteInfo.categories.unplannedDisruption"),
    },
  ];
}

/** WME ranks are 0-based: rank 0 may lock at level 1 only. */
export function lockLevelOptions(userRank: number): { value: LockLevel; disabled: boolean }[] {
  return ([1, 2, 3, 4] as const).map((value) => ({ value, disabled: value > userRank + 1 }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(find: () => T | null | undefined, what: string, ms = 5000): Promise<T> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = find();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`[mteForm] introuvable : ${what}`);
}

/** Saisie + blur : WME ne pousse la valeur dans son modèle qu'au blur. */
async function commit(wz: Element | null, value: string): Promise<void> {
  const el = wz?.shadowRoot?.querySelector("input, textarea");
  if (!el) throw new Error("[mteForm] champ sans input");
  (el as HTMLElement).focus();
  // Setter natif : contourne le value tracker de React, sinon l'input est ignoré.
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  (el as HTMLElement).blur();
  await sleep(150);
}

/** "YYYY-MM-DDTHH:mm" → ["DD/MM/YYYY", "HH:mm"] (format des pickers WME). */
export function toEditorDateTime(value: string): [string, string] {
  const [date, time = ""] = value.split("T");
  const [y, m, d] = date.split("-");
  return [`${d}/${m}/${y}`, time.slice(0, 5)];
}

function shadowDeep(root: ParentNode): Element[] {
  const out: Element[] = [];
  for (const e of root.querySelectorAll("*")) {
    out.push(e);
    if (e.shadowRoot) out.push(...shadowDeep(e.shadowRoot));
  }
  return out;
}

// WME re-rend le formulaire à chaque étape : on relit toujours le DOM
// plutôt que de garder des références périmées.
const inForm = (sel: string) => document.querySelector<HTMLElement>(`.mte-edit-view ${sel}`);
const AREA = "[class*=addAreaContainer]";

/** Choisit la langue de traduction (menu « Traduction ») et renvoie ses champs nom/description. */
async function translationFields(lang: MteLang): Promise<[Element, Element]> {
  const label = LANG_LABEL[lang];
  const item = shadowDeep(inForm("wz-menu-chip")?.shadowRoot ?? document).find(
    (e) => e.tagName === "WZ-MENU-ITEM" && e.textContent?.trim() === label,
  ) as HTMLElement | undefined;
  if (!item) throw new Error(`[mteForm] langue indisponible : ${label}`);
  item.click();
  return waitFor(() => {
    const name = inForm(`wz-text-input[maxlength][subtitle="${label}"]`);
    const desc = inForm(`wz-textarea[subtitle="${label}"]`);
    return name && desc ? ([name, desc] as [Element, Element]) : null;
  }, `champs ${label}`);
}

/**
 * Ouvre le formulaire de création de MTE, le remplit et renvoie l'ID
 * (négatif) du brouillon. L'utilisateur vérifie puis enregistre lui-même.
 * La page doit avoir le focus (clic utilisateur) : WME valide les champs au blur.
 */
export async function fillMteForm(sdk: WmeSDK, data: MteFormData): Promise<number | string> {
  const mtes = sdk.DataModel.MajorTrafficEvents;
  const before = new Set(mtes.getAll().map((m) => m.id));

  document
    .querySelector('wz-navigation-item[data-for="mtes"]')
    ?.shadowRoot?.querySelector("button")
    ?.click();
  const add = await waitFor(
    () => document.querySelector<HTMLElement>("#sidepanel-mtes wz-button.add-mte"),
    "bouton Créer un événement",
  );
  add.click();
  const draftId = await waitFor(
    () => mtes.getAll().find((m) => !before.has(m.id))?.id,
    "brouillon MTE",
  );

  // Polygone d'abord : sa création re-rend le formulaire et vide les autres champs.
  if (data.polygon) {
    // Le formulaire fraîchement monté ignore les premiers clics : on reclique
    // « Zone précise » jusqu'à voir apparaître ses deux boutons.
    const enterCoords = await waitFor(() => {
      const btn = document.querySelectorAll<HTMLElement>(
        `.mte-edit-view ${AREA} wz-button[color="text"]`,
      )[1]; // « Saisir des coordonnées »
      if (!btn) inForm(`${AREA} wz-radio-button`)?.click(); // « Zone précise »
      return btn;
    }, "Saisir des coordonnées");
    enterCoords.click();
    await commit(
      await waitFor(() => inForm(`${AREA} wz-text-input`), "champ coordonnées"),
      JSON.stringify(data.polygon),
    );
    inForm(`${AREA} [class*=showOnMapButtonContainer] wz-button`)?.click();
    await waitFor(() => !inForm(`${AREA} wz-text-input`), "création du polygone");
  }

  const sel = inForm("wz-select.category") as HTMLElement & { value: string };
  sel.value = data.category;
  sel.dispatchEvent(new CustomEvent("change", { bubbles: true, composed: true }));
  await sleep(150);

  // Lock chips are wz-checkable-chip#lockRank-0..3 (level 1..4).
  inForm(`wz-checkable-chip#lockRank-${data.lockLevel - 1}`)?.click();
  await sleep(150);

  const [sd, st] = toEditorDateTime(data.start);
  const [ed, et] = toEditorDateTime(data.end);
  await commit(inForm("#mte-start-date"), sd);
  await commit(inForm("#mte-start-time"), st);
  await commit(inForm("#mte-end-date"), ed);
  await commit(inForm("#mte-end-time"), et);

  // Les premiers champs nom/description sont ceux de la langue principale.
  await commit(inForm("wz-text-input[maxlength]"), data.text.name.slice(0, MTE_NAME_MAX));
  await commit(inForm("wz-textarea"), data.text.description);
  if (data.translation) {
    const [name, desc] = await translationFields(data.translation.lang);
    await commit(name, data.translation.name.slice(0, MTE_NAME_MAX));
    await commit(desc, data.translation.description);
  }

  if (data.url) await commit(inForm("wz-text-input[class*=url]"), data.url);

  // Garde-fou : WME ne prend les valeurs qu'au vrai blur (page sans focus) et
  // lit les dates selon sa locale. Mieux vaut échouer que laisser un MTE faux.
  const draft = mtes.getById({ majorTrafficEventId: String(draftId) });
  const got = `${draft?.startDate} → ${draft?.endDate} / ${draft?.names.length ?? 0} nom(s)`;
  const want = `${data.start.replace("T", " ")} → ${data.end.replace("T", " ")} / ${data.translation ? 2 : 1} nom(s)`;
  if (got !== want) throw new Error(`[mteForm] valeurs non prises par WME : ${got} ≠ ${want}`);
  return draftId;
}

/**
 * Appelle onSaved(newId) quand WME remplace l'ID du brouillon par l'ID
 * définitif à l'enregistrement.
 */
export function watchMteSaved(
  sdk: WmeSDK,
  draftId: number | string,
  onSaved: (id: string) => void,
): void {
  try {
    sdk.Events.trackDataModelEvents({ dataModelName: "majorTrafficEvents" });
  } catch {
    // déjà suivi
  }
  // ponytail: le listener reste actif si le brouillon est abandonné ; inoffensif (IDs uniques).
  const off = sdk.Events.on({
    eventName: "wme-data-model-object-changed-id",
    eventHandler: ({ dataModelName, objectIds }) => {
      if (dataModelName !== "majorTrafficEvents") return;
      for (const { oldID, newID } of ([] as (typeof objectIds)[]).concat(objectIds)) {
        if (String(oldID) === String(draftId) && newID != null) {
          off();
          onSaved(String(newID));
          return;
        }
      }
    },
  });
}

/**
 * slowUp : 09:00–17:30 comme les fermetures par défaut, nom EN + traduction FR ;
 * catégorie et verrouillage choisis dans la fenêtre « Préparer le MTE ».
 */
export function slowupFormData(
  d: SlowupFullDetails,
  polygon: Polygon | MultiPolygon | null,
  options: MteEventOptions,
): MteFormData {
  const name = `SlowUP ${d.title}`;
  return {
    category: options.category,
    lockLevel: options.lockLevel,
    polygon,
    start: `${d.date}T09:00`,
    end: `${d.date}T17:30`,
    text: { name, description: d.abstracts.en },
    translation: { lang: "fr", name, description: d.abstracts.fr },
    url: d.urlLink,
  };
}

/** Autre fermeture : infos, catégorie et verrouillage saisis dans « Préparer le MTE ». */
export function manualFormData(
  info: ManualMteInfo,
  polygon: Polygon | MultiPolygon | null,
  options: MteEventOptions,
): MteFormData {
  const text = { name: info.title, description: info.description };
  return {
    category: options.category,
    lockLevel: options.lockLevel,
    polygon,
    start: info.startDate,
    end: info.endDate,
    text,
    translation: { lang: "fr", ...text },
    url: info.urlLink,
  };
}
