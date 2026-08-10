/**
 * Store list-cache helper tests (REVIEW-Claude-20260713.md P1-3 / P3-7a).
 */
import { describe, expect, test } from "vitest";
import {
  createCachedList,
  createListCacheMeta,
  loadList,
  loadListInto,
} from "../src/composables/storeCache";

describe("loadList", () => {
  test("first call fetches and marks loaded", async () => {
    const cache = createCachedList<number>();
    let fetches = 0;
    const result = await loadList(cache, async () => {
      fetches++;
      return [1, 2];
    });
    expect(result).toEqual([1, 2]);
    expect(cache.list).toEqual([1, 2]);
    expect(cache.loaded).toBe(true);
    expect(cache.fetching).toBe(false);
    expect(fetches).toBe(1);
  });

  test("a cached EMPTY result is served without refetching", async () => {
    const cache = createCachedList<number>();
    let fetches = 0;
    const fetcher = async () => {
      fetches++;
      return [] as number[];
    };
    await loadList(cache, fetcher);
    await loadList(cache, fetcher);
    await loadList(cache, fetcher);
    expect(fetches).toBe(1);
    expect(cache.loaded).toBe(true);
  });

  test("force refetches even when loaded", async () => {
    const cache = createCachedList<number>();
    let fetches = 0;
    const fetcher = async () => {
      fetches++;
      return [fetches];
    };
    await loadList(cache, fetcher);
    const result = await loadList(cache, fetcher, true);
    expect(fetches).toBe(2);
    expect(result).toEqual([2]);
  });

  test("a failed refresh keeps the cached list, records the error, re-throws", async () => {
    const cache = createCachedList<number>();
    await loadList(cache, async () => [1, 2, 3]);

    const boom = new Error("boom");
    await expect(
      loadList(
        cache,
        async () => {
          throw boom;
        },
        true,
      ),
    ).rejects.toThrow("boom");
    expect(cache.list).toEqual([1, 2, 3]); // stale beats empty
    expect(cache.error).toBe(boom);
    expect(cache.fetching).toBe(false); // cleared in finally (P3-7a)
  });

  test("a successful refresh clears a previous error", async () => {
    const cache = createCachedList<number>();
    await expect(
      loadList(cache, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // not loaded → next call retries without force
    const result = await loadList(cache, async () => [7]);
    expect(result).toEqual([7]);
    expect(cache.error).toBeUndefined();
    expect(cache.loaded).toBe(true);
  });

  test("a nullish fetch result is coalesced to an empty list", async () => {
    const cache = createCachedList<number>();
    const result = await loadList(
      cache,
      async () => undefined as unknown as number[],
    );
    expect(result).toEqual([]);
    expect(cache.loaded).toBe(true);
  });

  test("fetching is true while the request is in flight", async () => {
    const cache = createCachedList<number>();
    let release!: (items: number[]) => void;
    const pending = loadList(
      cache,
      () => new Promise<number[]>((r) => (release = r)),
    );
    expect(cache.fetching).toBe(true);
    release([1]);
    await pending;
    expect(cache.fetching).toBe(false);
  });
});

describe("loadListInto (flat state field variant)", () => {
  test("reads/writes through the accessors with the same semantics", async () => {
    const meta = createListCacheMeta();
    let field: string[] = [];
    let fetches = 0;
    const fetcher = async () => {
      fetches++;
      return ["a"];
    };
    const read = () => field;
    const write = (items: string[]) => (field = items);

    const result = await loadListInto(meta, read, write, fetcher);
    expect(result).toEqual(["a"]);
    expect(field).toEqual(["a"]);
    expect(meta.loaded).toBe(true);

    // cached — no refetch without force
    await loadListInto(meta, read, write, fetcher);
    expect(fetches).toBe(1);

    // failed forced refresh keeps the field and re-throws
    await expect(
      loadListInto(
        meta,
        read,
        write,
        async () => {
          throw new Error("down");
        },
        true,
      ),
    ).rejects.toThrow("down");
    expect(field).toEqual(["a"]);
    expect(meta.fetching).toBe(false);
  });
});
