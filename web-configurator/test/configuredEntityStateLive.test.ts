// @vitest-environment jsdom
//
// The integration detail view's "Configured entities" list must follow live
// entity state, not freeze it at the moment the view was opened.
//
// EditIntegration.vue holds the list in a local ref, filled from
// `getConfiguredEntitiesByPageByLimit`, and hands each row straight to
// `EntityListItem` (`:list-item="element"`). That only stays live because of
// two links, each easy to break without any test noticing:
//
//   1. The paged getter hands back the store's OWN cached objects (see
//      `fetchPagedInto`, which returns the `$state` page envelope itself).
//      Copying the list there — a `.map()`, a `deepClone`, a `structuredClone`
//      of the response — would detach the view from the cache, and the
//      WS `entity_change` merge (`applyEntityChange`, which mutates the cached
//      entries in place) would stop reaching the rendered rows.
//   2. `EntityListItem` derives the state line and the unavailable marker
//      through computeds, so an in-place mutation of the entity it was given
//      re-renders it. Reading `attributes` into a plain local at setup instead
//      would snapshot it.
//
// Both are pinned here. The list rows are the same code path as the activity /
// macro "Included entities" rows, which reach the store's cache through the
// overlay in IncludedEntities.vue — see includedEntityState.test.ts.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick, toRaw } from "vue";

import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import { integrationsStore } from "@/stores/integrations";
import { EntityType } from "@/types/enums";
import type { ConfiguredEntity } from "@/types/integrationInstance";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { exists: () => false },
  }),
}));

import EntityListItem from "@/components/elements/entity/EntityListItem.vue";

const UNAVAILABLE_ICON = "entity-item__icon--unavailable";
const ENTITY_ID = "media_player.tv";

function configuredEntity(state: string): ConfiguredEntity {
  return {
    entity_id: ENTITY_ID,
    entity_type: EntityType.media_player,
    integration_id: "int.1",
    name: { en: "TV" },
    // The list attributes are required by the type but irrelevant here.
    attributes: { state, source_list: [], sound_mode_list: [] },
  };
}

/** How EditIntegration.vue renders one row of the configured list. */
function mountRow(entity: ConfiguredEntity) {
  return mount(EntityListItem, {
    props: { listItem: entity, inactive: true, editButton: true },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { SelectedIcon: true },
    },
  });
}

describe("the configured-entities list follows live entity state", () => {
  beforeEach(() => {
    // A fresh Pinia re-runs the store's init(), which re-registers its WS
    // routes on the singleton router; clear them so that does not throw.
    (eventRouter as unknown as { routes: Map<string, unknown> }).routes.clear();
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("caches the fetched entities themselves, so the view holds live objects", async () => {
    const fetched = configuredEntity("ON");
    vi.spyOn(ApiConnection.integrations, "getConfiguredEntitiesPaged")
      // eslint-disable-next-line @typescript-eslint/require-await
      .mockImplementation(async () => ({ data: [fetched], headers: {} }));
    const store = integrationsStore();

    const page = await store.getConfiguredEntitiesByPageByLimit("int.1");

    // Identity, not equality: the entities the getter hands the view are the
    // ones the cache holds, so the in-place `applyEntityChange` merge reaches
    // the rendered rows. A copy here silently turns the list into a snapshot.
    // The view's own assignment is a plain `configured.value = …` and is not
    // covered — cloning it there would need a mount of EditIntegration.vue.
    expect(toRaw(page.data.configuredEntities[0])).toBe(fetched);
    expect(
      toRaw(store.$state.configuredEntitiesByPage.configuredEntities[0]),
    ).toBe(fetched);
  });

  it("re-renders the state line and the unavailable marker in place", async () => {
    const store = integrationsStore();
    store.$state.configuredEntities = [configuredEntity("ON")];
    const row = store.$state.configuredEntities[0];

    const wrapper = mountRow(row);
    expect(wrapper.find(".entity-item__state").text()).toBe("on");
    expect(wrapper.find(".entity-item__icon").classes()).not.toContain(
      UNAVAILABLE_ICON,
    );

    store.applyEntityChange(ENTITY_ID, {
      entity_id: ENTITY_ID,
      attributes: { state: "UNAVAILABLE" },
    } as never);
    await nextTick();

    expect(wrapper.find(".entity-item__state").text()).toBe("unavailable");
    expect(wrapper.find(".entity-item__icon").classes()).toContain(
      UNAVAILABLE_ICON,
    );
  });
});
