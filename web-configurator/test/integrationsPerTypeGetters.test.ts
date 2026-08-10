/**
 * Characterization tests for the per-type configured-entity getters
 * (dedup-copy-paste-families A.1). These pin the behaviour the A.2 collapse
 * must preserve: each getter calls the service with its own EntityType, caches
 * the result in its own per-type $state field, and honours the `update` force
 * flag independently of the sibling type.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import { integrationsStore } from "@/stores/integrations";
import { EntityType } from "@/types/enums";
import type { ConfiguredEntity } from "@/types/integrationInstance";

function entity(id: string): ConfiguredEntity {
  return { entity_id: id } as ConfiguredEntity;
}

describe("per-type configured-entity getters", () => {
  beforeEach(() => {
    // Fresh Pinia re-runs store init(), which re-registers WS routes on the
    // singleton router; clear them so re-registration does not throw.
    (eventRouter as unknown as { routes: Map<string, unknown> }).routes.clear();
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  test("getConfiguredSensorEntities fetches with EntityType.sensor and caches", async () => {
    const spy = vi
      .spyOn(ApiConnection.integrations, "getConfiguredEntitiesByTypes")
      .mockResolvedValue([entity("sensor.a")]);
    const store = integrationsStore();

    const first = await store.getConfiguredSensorEntities();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(EntityType.sensor);
    expect(first).toEqual([entity("sensor.a")]);

    // cached: no second fetch without force
    await store.getConfiguredSensorEntities();
    expect(spy).toHaveBeenCalledTimes(1);

    // force refetch
    await store.getConfiguredSensorEntities(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(EntityType.sensor);
  });

  test("getConfiguredSelectEntities fetches with EntityType.select and caches", async () => {
    const spy = vi
      .spyOn(ApiConnection.integrations, "getConfiguredEntitiesByTypes")
      .mockResolvedValue([entity("select.a")]);
    const store = integrationsStore();

    const first = await store.getConfiguredSelectEntities();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(EntityType.select);
    expect(first).toEqual([entity("select.a")]);

    await store.getConfiguredSelectEntities();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("sensor and select caches are independent", async () => {
    const spy = vi
      .spyOn(ApiConnection.integrations, "getConfiguredEntitiesByTypes")
      .mockImplementation(async (types: string) =>
        types === EntityType.select
          ? [entity("select.a")]
          : [entity("sensor.a"), entity("sensor.b")],
      );
    const store = integrationsStore();

    const sensors = await store.getConfiguredSensorEntities();
    const selects = await store.getConfiguredSelectEntities();

    expect(sensors).toEqual([entity("sensor.a"), entity("sensor.b")]);
    expect(selects).toEqual([entity("select.a")]);
    expect(store.$state.configuredSensorEntities.list).toEqual(sensors);
    expect(store.$state.configuredSelectEntities.list).toEqual(selects);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
