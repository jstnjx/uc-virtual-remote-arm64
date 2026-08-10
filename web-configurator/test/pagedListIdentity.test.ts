// @vitest-environment jsdom
//
// A paged getter hands the caller its `$state` page envelope, and every view
// that renders such a page assigns the inner array to a local ref:
//
//   configured.value = entList.data.configuredEntities   // EditIntegration.vue
//
// so the array identity is part of the contract, not an implementation detail.
// A refetch that assigns a *fresh* array leaves those views holding the previous
// one — detached from the in-place `entity_change` merge the store keeps doing
// on the new one, and missing whatever rows the refetch added or removed (#683).
//
// That is not a theoretical path: the stores refetch their own page from their
// WS event handlers, without telling the view — `applyNew`, `applyDelete`, the
// unrecognized-event fallback and the wake/resync handler all do it. So the
// list on screen freezes for good the first time any of them fires.
//
// `configuredEntityStateLive.test.ts` pins the *first* fetch handing back the
// cached objects. This file pins every later one, for all five paged families.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { shallowMount, flushPromises } from "@vue/test-utils";
import { toRaw } from "vue";

import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import { integrationsStore } from "@/stores/integrations";
import { activitiesStore } from "@/stores/activities";
import { macrosStore } from "@/stores/macros";
import { activityGroupsStore } from "@/stores/activityGroups";
import { remotesStore } from "@/stores/remotes";
import { DriverState, DriverType, EntityType } from "@/types/enums";
import type {
  AvailableEntity,
  ConfiguredEntity,
  IntegrationDriver,
  IntegrationInstance,
  IntegrationStatus,
} from "@/types/integrationInstance";
import type { Activity } from "@/types/activity";
import type { Macro } from "@/types/macro";
import type { ActivityGroup } from "@/types/activityGroup";
import type { Remote } from "@/types/remote";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { exists: () => false },
  }),
}));

import EditIntegration from "@/components/integration/EditIntegration.vue";

const INTEGRATION_ID = "int.1";

function entity(entityId: string, state = "ON"): ConfiguredEntity {
  return {
    entity_id: entityId,
    entity_type: EntityType.media_player,
    integration_id: INTEGRATION_ID,
    name: { en: entityId },
    // The list attributes are required by the type but irrelevant here.
    attributes: { state, source_list: [], sound_mode_list: [] },
  };
}

/** A paged service response, for `mockResolvedValueOnce`. */
function page<T>(data: T[]) {
  return { data, headers: {} };
}

beforeEach(() => {
  // A fresh Pinia re-runs each store's init(), which re-registers its WS routes
  // on the singleton router; clear them so that does not throw.
  (eventRouter as unknown as { routes: Map<string, unknown> }).routes.clear();
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

// Every paged family, driven the way a view drives it: fetch, keep the array,
// fetch again. The array the view kept has to be the one that updated.
describe("a refetch replaces a page's contents, not its array", () => {
  it("integrations — configured entities", async () => {
    vi.spyOn(ApiConnection.integrations, "getConfiguredEntitiesPaged")
      .mockResolvedValueOnce(page([entity("media_player.tv")]))
      .mockResolvedValue(
        page([entity("media_player.tv"), entity("media_player.amp")]),
      );
    const store = integrationsStore();

    const held = (
      await store.getConfiguredEntitiesByPageByLimit(INTEGRATION_ID)
    ).data.configuredEntities;
    await store.getConfiguredEntitiesByPageByLimit(INTEGRATION_ID, true);

    expect(toRaw(held)).toBe(
      toRaw(store.$state.configuredEntitiesByPage.configuredEntities),
    );
    expect(held.map((e) => e.entity_id)).toEqual([
      "media_player.tv",
      "media_player.amp",
    ]);
  });

  it("integrations — available entities", async () => {
    // An available entity is the same row without the configured-only fields.
    const available = (entityId: string) =>
      ({ ...entity(entityId), features: [] }) as AvailableEntity;
    vi.spyOn(ApiConnection.integrations, "getAvailableEntitiesPaged")
      .mockResolvedValueOnce(page([available("media_player.tv")]))
      .mockResolvedValue(page([available("media_player.amp")]));
    const store = integrationsStore();

    const held = (await store.getAvailableEntitiesByPageByLimit(INTEGRATION_ID))
      .data.availableEntities;
    await store.getAvailableEntitiesByPageByLimit(INTEGRATION_ID, true);

    expect(toRaw(held)).toBe(
      toRaw(store.$state.availableEntitiesByPage.availableEntities),
    );
    expect(held.map((e) => e.entity_id)).toEqual(["media_player.amp"]);
  });

  it("activities", async () => {
    vi.spyOn(ApiConnection.activities, "getActivitiesByPageByLimit")
      .mockResolvedValueOnce(page([{ entity_id: "act.1" }] as Activity[]))
      .mockResolvedValue(
        page([{ entity_id: "act.1" }, { entity_id: "act.2" }] as Activity[]),
      );
    const store = activitiesStore();

    const held = (await store.getActivitiesByPageByLimit()).data.activities;
    await store.getActivitiesByPageByLimit();

    expect(toRaw(held)).toBe(toRaw(store.$state.activitiesByPage.activities));
    expect(held.map((a) => a.entity_id)).toEqual(["act.1", "act.2"]);
  });

  it("macros", async () => {
    vi.spyOn(ApiConnection.macros, "getMacrosPaged")
      .mockResolvedValueOnce(page([{ entity_id: "macro.1" }] as Macro[]))
      .mockResolvedValue(
        page([{ entity_id: "macro.1" }, { entity_id: "macro.2" }] as Macro[]),
      );
    const store = macrosStore();

    const held = (await store.getMacrosByPageByLimit()).data.macros;
    await store.getMacrosByPageByLimit();

    expect(toRaw(held)).toBe(toRaw(store.$state.macrosByPage.macros));
    expect(held.map((m) => m.entity_id)).toEqual(["macro.1", "macro.2"]);
  });

  it("activity groups", async () => {
    vi.spyOn(ApiConnection.activityGroups, "getActivityGroupsByPageByLimit")
      .mockResolvedValueOnce(page([{ group_id: "grp.1" }] as ActivityGroup[]))
      .mockResolvedValue(
        page([{ group_id: "grp.1" }, { group_id: "grp.2" }] as ActivityGroup[]),
      );
    const store = activityGroupsStore();

    const held = (await store.getActivityGroupsByPageByLimit()).data
      .activityGroups;
    await store.getActivityGroupsByPageByLimit();

    expect(toRaw(held)).toBe(
      toRaw(store.$state.activityGroupsByPage.activityGroups),
    );
    expect(held.map((g) => g.group_id)).toEqual(["grp.1", "grp.2"]);
  });

  it("remotes", async () => {
    vi.spyOn(ApiConnection.remotes, "getRemotesByPageByLimit")
      .mockResolvedValueOnce(page([{ entity_id: "remote.1" }] as Remote[]))
      .mockResolvedValue(
        page([
          { entity_id: "remote.1" },
          { entity_id: "remote.2" },
        ] as Remote[]),
      );
    const store = remotesStore();

    const held = (await store.getRemotesByPageByLimit("IR")).data.remotes;
    await store.getRemotesByPageByLimit("IR", true);

    expect(toRaw(held)).toBe(toRaw(store.$state.remotesByPage.remotes));
    expect(held.map((r) => r.entity_id)).toEqual(["remote.1", "remote.2"]);
  });
});

// The symptom the identity guarantee exists for, through the real component.
describe("an open integration detail view survives a store-side refetch", () => {
  /** What the API layer serves the view; `served` is swapped between events. */
  function mockApi(served: () => ConfiguredEntity[]) {
    const api = ApiConnection.integrations;
    /* eslint-disable @typescript-eslint/require-await */
    vi.spyOn(api, "getIntegration").mockImplementation(
      async () =>
        ({
          integration_id: INTEGRATION_ID,
          driver_id: "drv.1",
          name: { en: "Integration" },
          enabled: true,
        }) as IntegrationInstance,
    );
    vi.spyOn(api, "getDriver").mockImplementation(
      async () =>
        ({
          driver_id: "drv.1",
          driver_type: DriverType.LOCAL,
          driver_state: DriverState.ACTIVE,
          name: { en: "Driver" },
        }) as unknown as IntegrationDriver,
    );
    vi.spyOn(api, "getIntegrationStatuses").mockImplementation(async () => [
      {
        integration_id: INTEGRATION_ID,
        driver_id: "drv.1",
        driver_type: DriverType.LOCAL,
      } as IntegrationStatus,
    ]);
    vi.spyOn(api, "getConfiguredEntitiesPaged").mockImplementation(
      async () => ({
        data: [...served()],
        headers: {},
      }),
    );
    vi.spyOn(api, "getAvailableEntitiesPaged").mockImplementation(async () => ({
      data: [],
      headers: {},
    }));
    /* eslint-enable @typescript-eslint/require-await */
  }

  /** The list the view renders, read off its setup state. */
  function renderedList(wrapper: { vm: unknown }): ConfiguredEntity[] {
    return (wrapper.vm as { configured: ConfiguredEntity[] }).configured;
  }

  function dispatch(msgData: Record<string, unknown>) {
    eventRouter.dispatch({
      msg: "entity_change",
      msg_data: { entity_type: EntityType.media_player, ...msgData },
    } as never);
  }

  it("shows an entity added by a NEW event, and still follows later changes", async () => {
    let served = [entity("media_player.tv")];
    mockApi(() => served);

    const wrapper = shallowMount(EditIntegration, {
      props: { integrationId: INTEGRATION_ID },
      global: {
        mocks: { $t: (key: string) => key },
        directives: { "overflow-indicator": {} },
      },
    });
    await flushPromises();
    expect(renderedList(wrapper).map((e) => e.entity_id)).toEqual([
      "media_player.tv",
    ]);

    // The driver adds an entity. `applyEntityNew` refetches the page behind the
    // view's back — coalesced, so wait out the 250 ms trailing edge.
    served = [entity("media_player.tv"), entity("media_player.amp")];
    dispatch({
      entity_id: "media_player.amp",
      event_type: "NEW",
      new_state: entity("media_player.amp"),
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await flushPromises();

    expect(renderedList(wrapper).map((e) => e.entity_id)).toEqual([
      "media_player.tv",
      "media_player.amp",
    ]);

    // …and the rows that were already on screen must not have gone stale.
    dispatch({
      entity_id: "media_player.tv",
      event_type: "CHANGE",
      new_state: {
        entity_id: "media_player.tv",
        attributes: { state: "OFF" },
      },
    });
    await flushPromises();

    expect(renderedList(wrapper)[0]?.attributes?.state).toBe("OFF");

    wrapper.unmount();
  });
});
