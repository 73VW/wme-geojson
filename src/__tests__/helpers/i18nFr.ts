import { i18next } from "../../../locales/i18n";
import fr from "../../../locales/fr/common.json";

/** Real French strings, same namespace as the userscript (locales/i18n.ts). */
export async function initFrench(): Promise<void> {
  await i18next.init({
    lng: "fr",
    defaultNS: "common",
    resources: { fr: { common: fr } },
    interpolation: { escapeValue: false },
  });
}
