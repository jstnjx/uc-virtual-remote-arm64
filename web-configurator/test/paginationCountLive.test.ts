// @vitest-environment jsdom
//
// The "Showing 1-3 of 2" defect (#685).
//
// The total item count only ever arrived in the REST response headers, and each
// view parsed it into a local `pagination` ref at fetch time. The stores refetch
// their own page from their WS event handlers — `applyNew`, `applyDelete`, the
// unrecognized-event fallback, the wake/resync handler — and discard the
// returned headers, so the rows refreshed and the footer could not.
//
// The count is store state now: every paged getter echoes it into its page
// state next to `limit` / `page`, and views read it from there. Pinned at both
// levels, because either half alone still leaves a stale footer.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { shallowMount, flushPromises } from "@vue/test-utils";

import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import { integrationsStore } from "@/stores/integrations";
import { activitiesStore } from "@/stores/activities";
import { macrosStore } from "@/stores/macros";
import { activityGroupsStore } from "@/stores/activityGroups";
import { remotesStore } from "@/stores/remotes";
import { DriverState, DriverType, EntityType } from "@/types/enums";
import type { PaginationMeta } from "@/types/rest";
import type {
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

function entity(entityId: string): ConfiguredEntity {
  return {
    entity_id: entityId,
    entity_type: EntityType.media_player,
    integration_id: INTEGRATION_ID,
    name: { en: entityId },
    // The list attributes are required by the type but irrelevant here.
    attributes: { state: "ON", source_list: [], sound_mode_list: [] },
  };
}

/** A paged response carrying the server's total in its headers. */
function page<T>(data: T[], count: number) {
  return {
    data,
    headers: {
      "pagination-count": String(count),
      "pagination-limit": "20",
      "pagination-page": "1",
    },
  };
}

beforeEach(() => {
  // A fresh Pinia re-runs each store's init(), which re-registers its WS routes
  // on the singleton router; clear them so that does not throw.
  (eventRouter as unknown as { routes: Map<string, unknown> }).routes.clear();
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

// Every paged family echoes the header total into its page state, and keeps it
// current — a second fetch reporting a different total must not leave the first.
describe("a paged getter echoes the server's total into its page state", () => {
  it("integrations — configured entities", async () => {
    vi.spyOn(ApiConnection.integrations, "getConfiguredEntitiesPaged")
      .mockResolvedValueOnce(page([entity("media_player.tv")], 1))
      .mockResolvedValue(
        page([entity("media_player.tv"), entity("media_player.amp")], 2),
      );
    const store = integrationsStore();

    await store.getConfiguredEntitiesByPageByLimit(INTEGRATION_ID);
    expect(store.$state.configuredEntitiesByPage.count).toBe(1);

    await store.getConfiguredEntitiesByPageByLimit(INTEGRATION_ID, true);
    expect(store.$state.configuredEntitiesByPage.count).toBe(2);
  });

  it("integrations — available entities", async () => {
    vi.spyOn(ApiConnection.integrations, "getAvailableEntitiesPaged")
      .mockResolvedValueOnce(page([], 7))
      .mockResolvedValue(page([], 4));
    const store = integrationsStore();

    await store.getAvailableEntitiesByPageByLimit(INTEGRATION_ID);
    expect(store.$state.availableEntitiesByPage.count).toBe(7);

    await store.getAvailableEntitiesByPageByLimit(INTEGRATION_ID, true);
    expect(store.$state.availableEntitiesByPage.count).toBe(4);
  });

  it("activities", async () => {
    vi.spyOn(ApiConnection.activities, "getActivitiesByPageByLimit")
      .mockResolvedValueOnce(page([{ entity_id: "act.1" }] as Activity[], 1))
      .mockResolvedValue(page([] as Activity[], 5));
    const store = activitiesStore();

    await store.getActivitiesByPageByLimit();
    expect(store.$state.activitiesByPage.count).toBe(1);

    await store.getActivitiesByPageByLimit();
    expect(store.$state.activitiesByPage.count).toBe(5);
  });

  it("macros", async () => {
    vi.spyOn(ApiConnection.macros, "getMacrosPaged")
      .mockResolvedValueOnce(page([{ entity_id: "macro.1" }] as Macro[], 1))
      .mockResolvedValue(page([] as Macro[], 3));
    const store = macrosStore();

    await store.getMacrosByPageByLimit();
    expect(store.$state.macrosByPage.count).toBe(1);

    await store.getMacrosByPageByLimit();
    expect(store.$state.macrosByPage.count).toBe(3);
  });

  it("activity groups", async () => {
    vi.spyOn(ApiConnection.activityGroups, "getActivityGroupsByPageByLimit")
      .mockResolvedValueOnce(
        page([{ group_id: "grp.1" }] as ActivityGroup[], 1),
      )
      .mockResolvedValue(page([] as ActivityGroup[], 9));
    const store = activityGroupsStore();

    await store.getActivityGroupsByPageByLimit();
    expect(store.$state.activityGroupsByPage.count).toBe(1);

    await store.getActivityGroupsByPageByLimit();
    expect(store.$state.activityGroupsByPage.count).toBe(9);
  });

  it("remotes", async () => {
    vi.spyOn(ApiConnection.remotes, "getRemotesByPageByLimit")
      .mockResolvedValueOnce(page([{ entity_id: "remote.1" }] as Remote[], 1))
      .mockResolvedValue(page([] as Remote[], 2));
    const store = remotesStore();

    await store.getRemotesByPageByLimit("IR");
    expect(store.$state.remotesByPage.count).toBe(1);

    await store.getRemotesByPageByLimit("IR", true);
    expect(store.$state.remotesByPage.count).toBe(2);
  });
});

// The reported symptom, through the real component: the footer total has to
// follow a refetch the view never made.
describe("the integration detail view's footer follows a WS-driven refetch", () => {
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
    vi.spyOn(api, "getConfiguredEntitiesPaged").mockImplementation(async () => {
      const items = served();
      return page([...items], items.length);
    });
    vi.spyOn(api, "getAvailableEntitiesPaged").mockImplementation(async () =>
      page([], 0),
    );
    /* eslint-enable @typescript-eslint/require-await */
  }

  /** What the view hands `ListPaging` for the configured list. */
  function footer(wrapper: { vm: unknown }): PaginationMeta {
    return (wrapper.vm as { configuredEntitiesPaging: PaginationMeta })
      .configuredEntitiesPaging;
  }

  it("shows the new total after an entity_change NEW", async () => {
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
    expect(footer(wrapper).count).toBe(1);

    // `applyEntityNew` refetches the page behind the view's back — coalesced,
    // so wait out the 250 ms trailing edge.
    served = [entity("media_player.tv"), entity("media_player.amp")];
    eventRouter.dispatch({
      msg: "entity_change",
      msg_data: {
        entity_id: "media_player.amp",
        entity_type: EntityType.media_player,
        event_type: "NEW",
        new_state: entity("media_player.amp"),
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await flushPromises();

    expect(footer(wrapper).count).toBe(2);

    wrapper.unmount();
  });
});
