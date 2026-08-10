import { toRaw } from "vue";

import type { LanguageText } from "@/types/config";

import {
  hasDefaultCountryLocale,
  isDefaultCountryLocale,
} from "@/composables/translatedProperty";

/**
 * Rebuild arrays and plain objects with every reactive `Proxy` unwrapped.
 *
 * `toRaw` only unwraps the value it is handed. A raw object can still *hold*
 * proxies: code that assembles a plain object from reactive store data — e.g.
 * CommandSelect's `{ cmd, entity }`, whose `entity` is read off the reactive
 * activity — leaves a proxy sitting in a property. `structuredClone` throws
 * `DataCloneError` on a `Proxy` at any depth, so unwrap the whole tree first.
 *
 * Everything that is not an array or a plain object (`Date`, `Map`, `Set`, ...)
 * is passed through for `structuredClone` to handle; app data is JSON-shaped, so
 * those never hold proxies. The `seen` map keeps cycles from recursing forever.
 */
function toRawDeep<T>(value: T, seen: WeakMap<object, unknown>): T {
  const raw = toRaw(value);
  if (raw === null || typeof raw !== "object") {
    return raw;
  }

  const isPlainObject = Object.getPrototypeOf(raw) === Object.prototype;
  if (!Array.isArray(raw) && !isPlainObject) {
    return raw;
  }

  const existing = seen.get(raw);
  if (existing) {
    return existing as T;
  }

  if (Array.isArray(raw)) {
    const copy: unknown[] = [];
    seen.set(raw, copy);
    for (const item of raw) {
      copy.push(toRawDeep(item, seen));
    }
    return copy as T;
  }

  const copy: Record<string, unknown> = {};
  seen.set(raw, copy);
  for (const [key, val] of Object.entries(raw)) {
    copy[key] = toRawDeep(val, seen);
  }
  return copy as T;
}

/**
 * Deep-clone a value, stripping Vue reactivity.
 *
 * `structuredClone` cannot clone a Vue reactive `Proxy` (it throws a
 * `DataCloneError`), so `toRawDeep` strips them at every depth first; on a
 * proxy-free value it is a no-op in effect.
 *
 * Prefer this over `JSON.parse(JSON.stringify(...))` for in-app deep copies: it
 * preserves `Date`/`Map`/`Set` and keeps `undefined`-valued properties. Do NOT
 * use it where a REST/emit payload relies on JSON dropping `undefined` or
 * function fields — keep the explicit `JSON` clone there (with a comment).
 */
export function deepClone<T>(value: T): T {
  return structuredClone(toRawDeep(value, new WeakMap()));
}

/**
 * Merge a (possibly partial) WebSocket event payload into a cached object,
 * IN PLACE (docs/specs/004-ws-event-handling-rework.md §4.3):
 * - plain objects: deep merge — keys missing from the patch are preserved,
 *   so partial payloads cannot wipe cached data
 * - arrays: REPLACED wholesale — update events always carry complete arrays
 *   (core guarantee, task doc OQ-1); index-wise merging of reordered or
 *   shrunk lists is never correct
 * - primitives: replaced
 *
 * Mutating in place is deliberate: Vue 3 proxies track nested mutation, so
 * no clone is needed and object identity stays stable for watchers.
 */
export function mergeEventPayload<T extends object>(
  target: T,
  patch: Partial<T>,
): T {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const patchValue = patch[key];
    const targetValue = target[key];
    if (Array.isArray(patchValue)) {
      target[key] = patchValue as T[keyof T];
    } else if (
      patchValue !== null &&
      typeof patchValue === "object" &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      mergeEventPayload(targetValue as object, patchValue as Partial<object>);
    } else {
      target[key] = patchValue as T[keyof T];
    }
  }
  return target;
}

export function useDataHelper() {
  function objectsDeepEqual(obj1: unknown, obj2: unknown): boolean {
    if (obj1 === obj2) {
      return true;
    }

    if (
      obj1 == null ||
      typeof obj1 !== "object" ||
      obj2 == null ||
      typeof obj2 !== "object"
    ) {
      return false;
    }

    const o1 = obj1 as Record<string, unknown>;
    const o2 = obj2 as Record<string, unknown>;
    const keys1 = Object.keys(o1);
    const keys2 = Object.keys(o2);

    if (keys1.length !== keys2.length) {
      return false;
    }

    for (const key of keys1) {
      if (!keys2.includes(key) || !objectsDeepEqual(o1[key], o2[key])) {
        return false;
      }
    }

    return true;
  }

  function updateObjectByKeys<T extends object>(target: T, updates: object): T {
    const t = target as Record<string, unknown>;
    const u = updates as Record<string, unknown>;
    for (const key in u) {
      if (target && Object.prototype.hasOwnProperty.call(u, key)) {
        t[key] = u[key];
      }
    }
    return target;
  }

  function updateExistingObjectKeys<T extends object>(
    target: T,
    updates: object,
    add = false,
  ): T {
    if (target == null || updates == null) {
      return target;
    }

    const t = target as Record<string, unknown>;
    const u = updates as Record<string, unknown>;
    for (const key in u) {
      if (Object.prototype.hasOwnProperty.call(u, key)) {
        const targetHasKey = Object.prototype.hasOwnProperty.call(t, key);
        const updateVal = u[key];
        const targetVal = t[key];

        if (targetHasKey) {
          if (
            typeof targetVal === "object" &&
            typeof updateVal === "object" &&
            targetVal !== null &&
            updateVal !== null
          ) {
            updateExistingObjectKeys(targetVal, updateVal, add);
          } else {
            t[key] = updateVal;
          }
        } else if (add) {
          t[key] = deepCopy(updateVal);
        }
      }
    }
    return target;
  }

  function deepCopy<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => deepCopy(item)) as T;
    }

    const copy: Record<string, unknown> = {};
    const source = obj as Record<string, unknown>;
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        copy[key] = deepCopy(source[key]);
      }
    }
    return copy as T;
  }

  function standardizeLangTexts(
    obj: LanguageText,
    langCode?: string,
  ): LanguageText {
    if (!obj) return obj;
    const result: LanguageText = { ...obj };

    if (langCode && langCode.includes("_")) {
      const shortLang = langCode.split("_")[0];

      if (hasDefaultCountryLocale(langCode)) {
        if (isDefaultCountryLocale(langCode) && result[shortLang]) {
          delete result[shortLang];
        }
      } else if (shortLang && result[shortLang]) {
        delete result[shortLang];
      }
    }

    for (const key in result) {
      if (result[key] === "") {
        delete result[key];
      }
    }

    return result;
  }

  function isNonEmptyObject(obj: unknown): obj is Record<string, unknown> {
    return (
      typeof obj === "object" &&
      obj !== null &&
      !Array.isArray(obj) &&
      Object.keys(obj).length > 0
    );
  }

  return {
    objectsDeepEqual,
    updateObjectByKeys,
    updateExistingObjectKeys,
    standardizeLangTexts,
    isNonEmptyObject,
  };
}
