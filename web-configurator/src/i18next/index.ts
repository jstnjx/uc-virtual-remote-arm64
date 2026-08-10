import i18next from "i18next";
import en_US from "./en_US.json";
import type { Resource, ResourceKey } from "i18next";

const defaultLanguage = "en_US";

// Every language JSON is code-split: each becomes its own chunk, fetched on demand
// via ensureLanguageLoaded() rather than bundled into the entry chunk. en_US ships
// eagerly as the always-available fallback. All shipped languages are loadable so a
// developer build can test any of them; VITE_LANGUAGES only narrows the UI selector
// (see uiLanguages), it does not gate loading.
const modules = import.meta.glob<{ default: Resource[string] }>("./*.json");
const loaders: Record<string, () => Promise<{ default: Resource[string] }>> = {};
for (const path in modules) {
  const code = path.slice(2, -5); // "./de_DE.json" -> "de_DE"
  if (code !== defaultLanguage) {
    loaders[code] = modules[path];
  }
}

// All languages the app ships a translation for (fallback + every on-demand bundle).
export const availableLanguages = [defaultLanguage, ...Object.keys(loaders)];

// Languages offered in the UI language selector: the VITE_LANGUAGES release allowlist
// when set (the fallback is always kept), otherwise every shipped language. This is a
// build-time control over which languages a production build exposes — unset builds
// (developer builds) expose all of them.
function uiLanguageList(): string[] {
  if (import.meta.env.VITE_LANGUAGES) {
    const items = import.meta.env.VITE_LANGUAGES.split(",").map((item) =>
      item.trim(),
    );
    if (!items.includes(defaultLanguage)) {
      items.push(defaultLanguage);
    }
    // only keep languages we actually ship a translation for
    return availableLanguages.filter((code) => items.includes(code));
  }
  return availableLanguages;
}

export const uiLanguages = uiLanguageList();

i18next.init({
  lng: defaultLanguage,
  // Crowdin doesn't support v4 but the TS library only supports v4!
  compatibilityJSON: "v4",
  interpolation: {
    // escapeValue: false
    // skipOnVariables: false
  },
  fallbackLng: defaultLanguage,
  resources: { en_US } as Resource,
});

/**
 * Ensure the resource bundle for `code` is loaded and registered before the UI
 * switches to it. The default language is bundled eagerly; every other shipped
 * language is fetched on demand the first time it is needed.
 *
 * Returns `true` when the language is available to switch to (the fallback, an
 * already-loaded bundle, or one just loaded), `false` when no translation is shipped
 * for `code` — so the caller can leave the UI on the current language instead of
 * switching to an untranslated one.
 */
export async function ensureLanguageLoaded(code: string): Promise<boolean> {
  if (!code) {
    return false;
  }
  if (code === defaultLanguage || i18next.hasResourceBundle(code, "translation")) {
    return true;
  }
  const loader = loaders[code];
  if (!loader) {
    return false;
  }
  const mod = await loader();
  const resources = mod.default as { translation: ResourceKey };
  i18next.addResourceBundle(code, "translation", resources.translation);
  return true;
}

/**
 * The last language actually applied, remembered across reloads.
 *
 * The device config is the source of truth, but it only arrives after auth and a
 * REST round-trip. Without this, every reload first renders in the fallback
 * language — and anything that reads a translation once, rather than re-reading it
 * on `languageChanged`, stays English for the lifetime of that component.
 */
const STORAGE_KEY = "uc.locale";

function readStoredLanguage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    // Private mode / storage disabled: fall back to the config-driven path.
    return "";
  }
}

function storeLanguage(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Nothing to do — the next load just starts on the fallback language again.
  }
}

/**
 * Load the bundle for `code` on demand and switch the UI to it. If no translation
 * is shipped for the locale, the current language is kept (rather than switching to
 * an untranslated one). No-op when the language is already active.
 */
export async function applyLanguage(code: string): Promise<void> {
  if (!code || code === i18next.language) {
    return;
  }
  if (await ensureLanguageLoaded(code)) {
    await i18next.changeLanguage(code);
    storeLanguage(code);
  }
}

/**
 * Restore the language of the previous session, to be awaited *before* the app
 * mounts so the first render is already in the right language. The config
 * subscription still corrects it afterwards if the device language changed in the
 * meantime.
 *
 * Never rejects: a failed chunk fetch must not keep the app from mounting, it only
 * costs us the fallback language.
 */
export async function restoreLanguage(): Promise<void> {
  const code = readStoredLanguage();
  if (!code) {
    return;
  }
  try {
    await applyLanguage(code);
  } catch {
    // Offline, or a stale hashed chunk after an update: mount in en_US.
  }
}

export default i18next;
