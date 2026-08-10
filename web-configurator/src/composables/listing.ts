import sStorageWrapper from "@/api/local";
import type { Headers, PaginationMeta } from "@/types/rest";

type PaginationFilters = {
  paginationLimit?: number;
  paginationLimitSecondary?: number;
};

/**
 * The server's total item count for a paged response (#685).
 *
 * The stores echo this into their page state, so it is store state a view reads
 * reactively rather than a snapshot it takes at fetch time — the WS-event
 * reloads (`applyNew` / `applyDelete` / the fallback / resync) go through the
 * paged getters without the view hearing about it, and used to leave the footer
 * reporting the total from whenever the view last fetched.
 */
export function paginationCount(headers?: Headers): number {
  return Number(headers?.["pagination-count"]) || 0;
}

/**
 * The page and limit a paged response reports, for a view's local pagination
 * state. `count` is deliberately absent: it belongs to the store (see
 * {@link paginationCount}).
 *
 * `currentLimit` wins unless the server's limit is larger than the total, which
 * is the rule the ~10 hand-copied versions of this block all carried; it is
 * preserved verbatim here rather than reasoned about.
 */
export function readPaginationMeta(
  headers: Headers,
  currentLimit: number,
): Omit<PaginationMeta, "count"> {
  const headerLimit = Number(headers["pagination-limit"]);
  const limit =
    headerLimit <= paginationCount(headers) ? currentLimit : headerLimit;
  return {
    limit: limit || 0,
    page: Number(headers["pagination-page"]) || 0,
  };
}

export function getPaginationLimit(media = false): number {
  const storedFilters = (sStorageWrapper.getValue("filters") ??
    {}) as PaginationFilters;
  const filterKey: keyof PaginationFilters = media
    ? "paginationLimitSecondary"
    : "paginationLimit";

  return storedFilters[filterKey] ?? 20;
}

export function savePaginationLimit(value = 20, media = false): void {
  const filterKey: keyof PaginationFilters = media
    ? "paginationLimitSecondary"
    : "paginationLimit";
  const storedFilters = (sStorageWrapper.getValue("filters") ??
    {}) as PaginationFilters;

  storedFilters[filterKey] = value;
  sStorageWrapper.setValue("filters", storedFilters);
}

export function hasPaginationLimit(media = false): boolean {
  const storedFilters = (sStorageWrapper.getValue("filters") ??
    {}) as PaginationFilters;
  const filterKey: keyof PaginationFilters = media
    ? "paginationLimitSecondary"
    : "paginationLimit";

  return storedFilters[filterKey] != undefined;
}
