import i18next from "i18next";
import type { WmeSDK } from "wme-sdk-typings";
import enCommon from "./en/common.json";
import frCommon from "./fr/common.json";

/**
 * Detect the user's preferred locale for the script.
 *
 * Priority:
 *   1. wmeSDK.Settings.getLocale() — the WME UI language the user has selected.
 *   2. navigator.language — browser language preference.
 *   3. "fr" — default (the primary user language per PRD).
 *
 * We only care about the two-letter language code; WME may return "fr-FR" etc.
 */
function detectLocale(wmeSDK: WmeSDK): string {
  try {
    const localeCode = wmeSDK.Settings.getLocale().localeCode;
    if (localeCode) {
      // Normalise "fr-FR" → "fr" so it matches our bundle keys
      return localeCode.split("-")[0];
    }
  } catch {
    // getLocale() may throw if called before WME is fully ready; fall through
  }

  const browserLang = navigator.language;
  if (browserLang) {
    return browserLang.split("-")[0];
  }

  return "fr";
}

/**
 * Initialise i18next with the bundled FR and EN translations.
 * Must be called once, early in the script lifecycle, before any `t()` calls.
 */
export async function initI18n(wmeSDK: WmeSDK): Promise<void> {
  const lng = detectLocale(wmeSDK);

  await i18next.init({
    lng,
    fallbackLng: "fr",
    defaultNS: "common",
    resources: {
      en: { common: enCommon },
      fr: { common: frCommon },
    },
    interpolation: {
      // React is not used; escaping not needed
      escapeValue: false,
    },
  });
}

export { i18next };
