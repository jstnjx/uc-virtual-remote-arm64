import type { LanguageText } from "@/types/config";
import i18next, { availableLanguages } from "@/i18next";

// The full set of app-supported languages. Sourced from the i18next module rather
// than i18next's loaded resources, because non-default languages are now loaded on
// demand (only the fallback is present at startup).
const availableLangs = availableLanguages;

/**
 * Get the default country locale for a given locale.
 *
 * The default country locale has the same country suffix as the language code. For example: `de_DE`, `fr_FR`, `it_IT`.
 * @param locale the language locale, either just a language identifier as `de` or a full identifier as `de_CH`.
 */
export function getDefaultCountryLocale(locale: string): string {
  const baseLang = locale.split("_")[0];
  return `${baseLang}_${baseLang.toLocaleUpperCase()}`;
}

/**
 * Check if the language code in the given locale has an installed translation for the default country locale.
 *
 * - The language code is the first part of the locale, before the `_` separator.
 * - The default country locale has the same country suffix as the language code. For example: `de_DE`, `fr_FR`, `it_IT`.
 *
 * True is returned if language texts are available for the default locale. Examples:
 * - `de`, `de_##`: `de_DE` is available
 * - `fr`, `fr_##`: `fr_FR` is available
 * @param locale the language locale, either just a language identifier as `de` or a full identifier as `de_CH`.
 */
export function hasDefaultCountryLocale(locale: string): boolean {
  const defaultLang = getDefaultCountryLocale(locale);
  return availableLangs.some((l) => l === defaultLang);
}

/**
 * Check if the given language locale contains a country suffix and is a default country locale for the base language.
 *
 * The default country locale has the same country suffix as the language code. For example: `de_DE`, `fr_FR`, `it_IT`.
 *
 * Attention: this only works for some countries and is not a valid general i18n selection logic!
 * It is good enough for our current use case.
 * @param locale the language locale, either just a language identifier as `de` or a full identifier as `de_CH`.
 */
export function isDefaultCountryLocale(locale: string): boolean {
  return locale === getDefaultCountryLocale(locale);
}

export function getCurrentLocale(): string {
  return i18next.language;
}

export function getCurrentLangcode(): string {
  return getCurrentLocale().replace(/_.*$/, "");
}

/**
 * Perform a case-insensitive text search in the provided language text map.
 *
 * @param text The language text map, key is the language identifier, value the language specific text.
 * @param search The text to search within the language text.
 * @param defaultText The text to return if `text` is empty or the search didn't find a match.
 */
export function searchLanguageText(
  text: LanguageText | undefined,
  search: string,
  defaultText = "",
): string {
  if (!text) {
    return defaultText;
  }

  for (const value of Object.values(text)) {
    if (value.toLowerCase().includes(search)) {
      return value;
    }
  }

  return defaultText;
}

/**
 * Retrieve a language text from a language map for a given locale.
 *
 * This only returns the language text string and not the language entry as getValueByLang.
 * See getValueByLang documentation about the language text retrieval logic.
 * @param translations the language map with (language_key, language_text) entries.
 * @param locale the language locale, either just a language identifier as `de` or a full identifier as `de_CH`.
 */
export default function translatedProperty(
  translations: LanguageText | undefined,
  locale: string = i18next.language,
): string {
  return getValueByLang(translations, locale, false).value;
}

/**
 * Retrieve a language key & text object from a language map for a given locale.
 *
 * The provided fallback text is returned if the map is empty. Language retrieval logic:
 * 1. Try retrieving an exact language match first. E.g. `de_CH`.
 * 2. Then try without country specific variant only. E.g. `de`.
 * 3. If strict mode id enabled: return provided fallback text.
 *    In non-strict mode, continue searching for another country variant.
 * 4. If multiple country variants are available, return the first country text sorted by language key. E.g. `de_AT`
 * 5. If the specific language is not available, the default English text with key `en` is returned.
 * 6. Pick the first English country variant (sorted by language key), e.g. `en_UK`. (At the moment we only have `en_US`).
 * 7. If an English text is missing, the first entry in the map is returned.
 *
 * **Important: This is the exact same logic as in remote-ui!**
 * **Any changes to that logic HAS TO BE implemented in remote-ui as well!**
 *
 * @param translations the language map with (language_key, language_text) entries.
 * @param locale the language locale, either just a language identifier as `de` or a full identifier as `de_CH`.
 * @param strict no fallback handling to countries having same language. E.g. `fr_CA` will fall back to `fr` only, but not `fr_CH`
 * @param fallback the default text if the language map is empty. Default: empty text.
 */
// See unit tests in /test for some examples
export function getValueByLang(
  translations: Record<string, string> | undefined,
  locale: string,
  strict = false,
  fallback = "",
): { lang: string; value: string } {
  // if no langCode text is defined use provided default
  if (!translations || Object.keys(translations).length === 0) {
    return {
      lang: locale,
      value: fallback,
    };
  }

  // direct match first, e.g. `de_DE`
  if (locale in translations && translations[locale] !== "") {
    return {
      lang: locale,
      value: translations[locale],
    };
  }

  const baseLang = locale.split("_")[0];

  // for strict mode skip fallback logic: only consider same language
  if (strict) {
    // Any additional strict-mode-only logic

    // If there's only a base language entry (`en`, `de`, etc.) available (e.g. from old data):
    // only return it for the main country language (`de_DE`, `fr_FR`, etc. + `en_US`).
    // Reason: this function is used in LanguageDropdown.vue to populate list of available languages
    // TODO verify old logic:
    //   - not sure if that is the intention of the hard to understand & not fully working "baseLangIsAlias & hasAlias" logic
    //   - make sure this doesn't interfere where it's called in non-strict mode, or with translatedProperty()
    if (
      (isDefaultCountryLocale(locale) || locale === "en_US") &&
      baseLang &&
      baseLang in translations &&
      translations[baseLang] !== ""
    ) {
      return {
        lang: baseLang,
        value: translations[baseLang],
      };
    }

    // nothing found
    return {
      lang: locale,
      value: fallback,
    };
  }

  // try base langCode without country variant, e.g. `de`
  if (baseLang && baseLang in translations && translations[baseLang] !== "") {
    return {
      lang: baseLang,
      value: translations[baseLang],
    };
  }

  // search for a default-country match: fr_## -> fr_FR, it_## -> it_IT etc.
  // This is not a universal i18n logic, but works for languages we support.
  if (hasDefaultCountryLocale(locale)) {
    const defaultLang = getDefaultCountryLocale(locale);
    if (
      defaultLang &&
      defaultLang in translations &&
      translations[defaultLang] !== ""
    ) {
      return {
        lang: defaultLang,
        value: translations[defaultLang],
      };
    }
  }

  // try first non-empty country variant with same base langCode (sorted by language key)
  for (const key of Object.keys(translations).sort((a, b) => {
    return a.localeCompare(b);
  })) {
    if (key.startsWith(baseLang)) {
      // skip special Swiss case
      if (key === "de_CH" || translations[key] === "") {
        continue;
      }
      return {
        lang: key,
        value: translations[key],
      };
    }
  }

  // fallback to English
  if ("en" in translations && translations["en"] !== "") {
    return {
      lang: "en",
      value: translations["en"],
    };
  }

  // pick first non-empty English variant (sorted by language key), e.g. `en_UK`
  for (const key of Object.keys(translations).sort((a, b) => {
    return a.localeCompare(b);
  })) {
    if (key.startsWith("en") && translations[key] !== "") {
      return {
        lang: key,
        value: translations[key],
      };
    }
  }

  // final fallback: return first non-empty language entry
  for (const key of Object.keys(translations)) {
    if (translations[key] !== undefined && translations[key] !== "") {
      return { lang: key, value: translations[key] };
    }
  }

  // nothing found
  return {
    lang: locale,
    value: fallback,
  };
}
