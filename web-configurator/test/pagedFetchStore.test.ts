/**
 * Characterization tests for the store-level paged getters
 * (dedup-copy-paste-families B.1, store side). They pin the store→service
 * contract (the exact options object forwarded) and the paged-state echo the
 * mirror `…ByPageByLimit` getters write, so the B.3 collapse onto the shared
 * `fetchPagedInto` helper is proven behaviour-preserving.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import { integrationsStore } from "@/stores/integrations";
import { macrosStore } from "@/stores/macros";
import type {
  AvailableEntity,
  ConfiguredEntity,
} from "@/types/integrationInstance";
import type { Macro } from "@/types/macro";

beforeEach(() => {
  (eventRouter as unknown as { routes: Map<string, unknown> }).routes.clear();
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe("integrations store paged getters", () => {
  test("getAvailableEntitiesByPageByLimit forwards options and echoes state", async () => {
    const data = [{ entity_id: "a1" }] as AvailableEntity[];
    const spy = vi
      .spyOn(ApiConnection.integrations, "getAvailableEntitiesPaged")
      .mockResolvedValue({ data, headers: { "pagination-count": "1" } });
    const store = integrationsStore();

    const res = await store.getAvailableEntitiesByPageByLimit(
      "intg1",
      true,
      2,
      30,
      "tv",
      "media_player",
    );

    expect(spy).toHaveBeenCalledWith({
      integrationId: "intg1",
      reload: true,
      page: 2,
      limit: 30,
      filter: "NEW",
      search: "tv",
      types: "media_player",
    });
    expect(res.data.availableEntities).toEqual(data);
    expect(res.data.limit).toBe(30);
    expect(res.data.page).toBe(2);
    expect(res.headers).toEqual({ "pagination-count": "1" });
    // full query echo (fields beyond the narrow public return type) via state
    const state = store.$state.availableEntitiesByPage;
    expect(state.availableEntities).toEqual(data);
    expect(state.searchText).toBe("tv");
    expect(state.integrationId).toBe("intg1");
    expect(state.entityTypes).toBe("media_player");
  });

  test("getConfiguredEntitiesByPageByLimit forwards options (incl. exclude) and echoes state", async () => {
    const data = [{ entity_id: "c1" }] as ConfiguredEntity[];
    const spy = vi
      .spyOn(ApiConnection.integrations, "getConfiguredEntitiesPaged")
      .mockResolvedValue({ data, headers: {} });
    const store = integrationsStore();

    const res = await store.getConfiguredEntitiesByPageByLimit(
      "intgA",
      false,
      3,
      25,
      "cam",
      "sensor",
      "e1",
    );

    expect(spy).toHaveBeenCalledWith({
      integrationIds: "intgA",
      reload: false,
      page: 3,
      limit: 25,
      search: "cam",
      types: "sensor",
      exclude: "e1",
    });
    expect(res.data.configuredEntities).toEqual(data);
    expect(res.data.limit).toBe(25);
    expect(res.data.page).toBe(3);
    const state = store.$state.configuredEntitiesByPage;
    expect(state.configuredEntities).toEqual(data);
    expect(state.searchText).toBe("cam");
    expect(state.integrationId).toBe("intgA");
    expect(state.entityTypes).toBe("sensor");
  });

  test("the two mirror getters keep independent page state", async () => {
    vi.spyOn(
      ApiConnection.integrations,
      "getAvailableEntitiesPaged",
    ).mockResolvedValue({
      data: [{ entity_id: "a1" }] as AvailableEntity[],
      headers: {},
    });
    vi.spyOn(
      ApiConnection.integrations,
      "getConfiguredEntitiesPaged",
    ).mockResolvedValue({
      data: [{ entity_id: "c1" }] as ConfiguredEntity[],
      headers: {},
    });
    const store = integrationsStore();

    await store.getAvailableEntitiesByPageByLimit("i", false, 1, 20, "", "");
    await store.getConfiguredEntitiesByPageByLimit("i", false, 2, 40, "", "");

    expect(store.$state.availableEntitiesByPage.page).toBe(1);
    expect(store.$state.availableEntitiesByPage.limit).toBe(20);
    expect(store.$state.configuredEntitiesByPage.page).toBe(2);
    expect(store.$state.configuredEntitiesByPage.limit).toBe(40);
  });
});

describe("macros store paged getter", () => {
  test("getMacrosByPageByLimit forwards options and echoes state", async () => {
    const data = [{ entity_id: "m1" }] as Macro[];
    const spy = vi
      .spyOn(ApiConnection.macros, "getMacrosPaged")
      .mockResolvedValue({ data, headers: { "pagination-count": "1" } });
    const store = macrosStore();

    const res = await store.getMacrosByPageByLimit(2, 40, "movie");

    expect(spy).toHaveBeenCalledWith({ page: 2, limit: 40, search: "movie" });
    expect(res.data.macros).toEqual(data);
    expect(res.data.limit).toBe(40);
    expect(res.data.page).toBe(2);
    expect(store.$state.macrosByPage.macros).toEqual(data);
    expect(store.$state.macrosByPage.searchText).toBe("movie");
  });
});
