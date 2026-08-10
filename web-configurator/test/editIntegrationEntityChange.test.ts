// @vitest-environment jsdom
//
// The integration detail view must not maintain its own copy of the
// configured-entities cache.
//
// `EditIntegration.vue` subscribes to the integrations store's `socketUpdate`
// action. By the time that subscriber runs, `onEntityEvent` has already merged
// the same `new_state` into every cached list through `applyEntityChange` —
// in place, including the very array the view renders (`fetchPagedInto` hands
// back the `$state` page envelope itself). A second merge in the view is
// redundant, and it used to be done on a `deepClone` that was then written
// back into the cached array: that swaps the shared entity object for a
// detached copy, so any holder of the previous reference goes stale
// (spec `websocket-events` § "The render path preserves the in-place merge").
//
// It also used the wrong merge helper: `updateExistingObjectKeys` defaults to
// `add = false` and silently drops keys the target does not have yet, where
// `mergeEventPayload` — the documented merge boundary (ADR 0002) — adds them.
//
// Pinned here at the level the bug lives on: dispatch a real `entity_change`
// through the event router with the view mounted, and check what the store's
// cached list holds afterwards. `configuredEntityStateLive.test.ts` covers the
// other half — that the fetched objects reach the view uncopied in the first
// place.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { shallowMount, flushPromises } from "@vue/test-utils";
import { toRaw } from "vue";

import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import { integrationsStore } from "@/stores/integrations";
import { DriverState, DriverType, EntityType } from "@/types/enums";
import type {
  ConfiguredEntity,
  IntegrationDriver,
  IntegrationInstance,
  IntegrationStatus,
} from "@/types/integrationInstance";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { exists: () => false },
  }),
}));

import EditIntegration from "@/components/integration/EditIntegration.vue";

const INTEGRATION_ID = "int.1";
const ENTITY_ID = "media_player.tv";

function configuredEntity(state: string): ConfiguredEntity {
  return {
    entity_id: ENTITY_ID,
    entity_type: EntityType.media_player,
    integration_id: INTEGRATION_ID,
    name: { en: "TV" },
    // The list attributes are required by the type but irrelevant here.
    attributes: { state, source_list: [], sound_mode_list: [] },
  };
}

/**
 * What the API layer serves the view while it is mounted. Returns the spies
 * the tests assert on, so no test has to re-read a mocked method off the
 * service object.
 */
function mockApi(entity: ConfiguredEntity) {
  const api = ApiConnection.integrations;
  const instance = {
    integration_id: INTEGRATION_ID,
    driver_id: "drv.1",
    name: { en: "Integration" },
    enabled: true,
  } as IntegrationInstance;
  const driver = {
    driver_id: "drv.1",
    driver_type: DriverType.LOCAL,
    driver_state: DriverState.ACTIVE,
    name: { en: "Driver" },
  } as unknown as IntegrationDriver;
  const status = {
    integration_id: INTEGRATION_ID,
    driver_id: "drv.1",
    driver_type: DriverType.LOCAL,
  } as IntegrationStatus;

  /* eslint-disable @typescript-eslint/require-await */
  vi.spyOn(api, "getIntegration").mockImplementation(async () => instance);
  vi.spyOn(api, "getDriver").mockImplementation(async () => driver);
  vi.spyOn(api, "getIntegrationStatuses").mockImplementation(async () => [
    status,
  ]);
  vi.spyOn(api, "getConfiguredEntitiesPaged").mockImplementation(async () => ({
    data: [entity],
    headers: {},
  }));
  const availableEntitiesPaged = vi
    .spyOn(api, "getAvailableEntitiesPaged")
    .mockImplementation(async () => ({ data: [], headers: {} }));
  /* eslint-enable @typescript-eslint/require-await */

  return { availableEntitiesPaged };
}

function mountView() {
  return shallowMount(EditIntegration, {
    props: { integrationId: INTEGRATION_ID },
    global: {
      mocks: { $t: (key: string) => key },
      directives: { "overflow-indicator": {} },
    },
  });
}

/** A WS `entity_change` CHANGE, as the transport hands it to the router. */
function dispatchChange(newState: Record<string, unknown>) {
  eventRouter.dispatch({
    msg: "entity_change",
    msg_data: {
      entity_id: ENTITY_ID,
      entity_type: EntityType.media_player,
      event_type: "CHANGE",
      new_state: newState,
    },
  } as never);
}

/** The entity as the store's paged cache holds it, unwrapped from its proxy. */
function cachedRow() {
  const list =
    integrationsStore().$state.configuredEntitiesByPage.configuredEntities;
  return toRaw(list.find((e) => e.entity_id === ENTITY_ID)!);
}

describe("the integration detail view leaves the entity cache alone", () => {
  beforeEach(() => {
    // A fresh Pinia re-runs the store's init(), which re-registers its WS
    // routes on the singleton router; clear them so that does not throw.
    (eventRouter as unknown as { routes: Map<string, unknown> }).routes.clear();
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the cached entity object identity across a change event", async () => {
    const fetched = configuredEntity("ON");
    mockApi(fetched);

    const wrapper = mountView();
    await flushPromises();
    expect(cachedRow()).toBe(fetched);

    dispatchChange({ entity_id: ENTITY_ID, attributes: { state: "OFF" } });
    await flushPromises();

    // The merge is in place: same object, new state. Writing a clone back into
    // the list would leave every other holder of `fetched` on "ON".
    expect(cachedRow()).toBe(fetched);
    expect(fetched.attributes?.state).toBe("OFF");

    wrapper.unmount();
  });

  it("adds a field the cached entity did not have yet", async () => {
    const fetched = configuredEntity("ON");
    mockApi(fetched);

    const wrapper = mountView();
    await flushPromises();

    dispatchChange({
      entity_id: ENTITY_ID,
      attributes: { state: "PLAYING", media_title: "Episode 1" },
    });
    await flushPromises();

    // `mergeEventPayload` adds new keys; `updateExistingObjectKeys` (add=false)
    // drops them. Pinned so the view cannot re-introduce a second, weaker merge
    // over the store's.
    expect(cachedRow().attributes).toMatchObject({
      state: "PLAYING",
      media_title: "Episode 1",
    });

    wrapper.unmount();
  });

  // The store's `applyEntityDelete` only splices the *configured* lists; a
  // deleted configured entity becomes available again, so the "Add entities"
  // picker has to be refetched by the view. That reload used to sit behind an
  // "is the entity in my list" guard that could never be true — the store had
  // already spliced it out of that same array — so it never fired.
  it("refetches the available entities on a delete event", async () => {
    const { availableEntitiesPaged } = mockApi(configuredEntity("ON"));

    const wrapper = mountView();
    await flushPromises();
    const before = availableEntitiesPaged.mock.calls.length;

    eventRouter.dispatch({
      msg: "entity_change",
      msg_data: {
        entity_id: ENTITY_ID,
        entity_type: EntityType.media_player,
        event_type: "DELETE",
      },
    } as never);
    await flushPromises();

    expect(availableEntitiesPaged.mock.calls.length).toBeGreaterThan(before);

    wrapper.unmount();
  });
});
