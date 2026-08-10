/**
 * Shared caching-fetch semantics for Pinia store list state
 * (REVIEW-Claude-20260713.md P1-3):
 *
 * - `loaded` separates "server returned an empty list" from "never fetched",
 *   so a cached empty result is served without refetching on every call.
 * - A failed refresh keeps the previous list (stale beats empty — the WS
 *   resync handlers heal it) and re-throws so the caller can surface the
 *   error instead of rendering a silently empty list.
 * - `fetching` is cleared in `finally`, so a rejection cannot strand a
 *   spinner (P3-7a).
 */

/** List cache state shape for stores that expose `{ list, fetching }`. */
export interface CachedList<T> {
  list: T[];
  loaded: boolean;
  fetching: boolean;
  error?: unknown;
}

export function createCachedList<T>(): CachedList<T> {
  return { list: [], loaded: false, fetching: false, error: undefined };
}

/**
 * Cache metadata for stores whose list lives in a flat `T[]` state field —
 * the public read surface (`store.x` / `$state.x`) must stay a plain array.
 */
export interface ListCacheMeta {
  loaded: boolean;
  fetching: boolean;
  error?: unknown;
}

export function createListCacheMeta(): ListCacheMeta {
  return { loaded: false, fetching: false, error: undefined };
}

/**
 * Cached list fetch against a flat `T[]` state field.
 *
 * @param meta cache metadata (lives in store state next to the list field)
 * @param read returns the current list state
 * @param write replaces the list state with a fresh result
 * @param fetcher performs the REST request
 * @param force refetch even when already loaded
 * @returns the (possibly cached) list; rejects on fetch failure without
 *          touching the cached list
 */
export async function loadListInto<T>(
  meta: ListCacheMeta,
  read: () => T[],
  write: (items: T[]) => void,
  fetcher: () => Promise<T[]>,
  force = false,
): Promise<T[]> {
  if (meta.loaded && !force) {
    return read();
  }
  meta.fetching = true;
  try {
    write((await fetcher()) ?? []);
    meta.loaded = true;
    meta.error = undefined;
  } catch (e) {
    meta.error = e; // keep the cached list — stale beats empty
    throw e; // the caller decides how to surface the failure
  } finally {
    meta.fetching = false;
  }
  return read();
}

/**
 * Replace a cached list's contents without replacing the array (#683).
 *
 * The paged getters return their `$state` page envelope, and views assign the
 * inner array to a local ref (`configured.value = entList.data.configuredEntities`),
 * so the array identity is part of the contract. Assigning a fresh array on a
 * refetch leaves those views holding the previous one: detached from the
 * in-place `entity_change` merge, and missing the rows the refetch added or
 * removed. Pages are bounded by `limit`, so the spread is safe.
 */
export function replaceListContents<T>(list: T[], items: T[]): T[] {
  list.splice(0, list.length, ...items);
  return list;
}

/** Cached list fetch against a `CachedList<T>` state field. */
export async function loadList<T>(
  cache: CachedList<T>,
  fetcher: () => Promise<T[]>,
  force = false,
): Promise<T[]> {
  return loadListInto(
    cache,
    () => cache.list,
    (items) => (cache.list = items),
    fetcher,
    force,
  );
}
