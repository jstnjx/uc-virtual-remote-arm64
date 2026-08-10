// @vitest-environment jsdom
//
// Regression guard for the state line and the unavailable marker in the
// "Included entities" list of the activity, macro and group detail views.
//
// The Activity/Macro endpoints return `options.included_entities` as entity
// *references* (`IncludedEntity`): entity_id, name, icon, integration — but no
// `attributes`, so no `state`. `EntityListItem` derives both the state line and
// the red crossed-out icon from `attributes.state`, so those rows rendered a
// nameplate with no state and no unavailable marker, while the very same entity
// in the "Add entities" picker and in the integration's "Configured entities"
// list (both fed full `ConfiguredEntity` objects) rendered them correctly.
//
// It also produced a half-rendered row: an entity added through the picker
// arrives as a full entity, then the reload after the save replaces it with the
// reference-only copy. `EntityListItem` keeps a last-known-state fallback for
// the state *text* but not for `isUnavailable`, so the row kept the word
// "unavailable" while losing the red line.
//
// The fix overlays the live entity state from the integrations store, which the
// WS `entity_change` handler keeps current — so these rows now show what the
// integration detail view shows, before and after a reload.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import { eventRouter } from "@/api/eventRouter";
import { integrationsStore } from "@/stores/integrations";
import { EntityType } from "@/types/enums";
import type { IncludedEntity } from "@/types/activity";
import type { ConfiguredEntity } from "@/types/integrationInstance";

// The component tree calls i18next through i18next-vue's inject-based
// composable; no plugin is installed here. `exists: false` keeps the state
// text raw, so the assertions read the entity state rather than a lang key.
vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { exists: () => false },
  }),
}));

import IncludedEntities from "@/components/elements/entity/IncludedEntities.vue";

const UNAVAILABLE_ICON = "entity-item__icon--unavailable";

/** A row as the Activity/Macro endpoints deliver it: a reference, no state. */
function includedEntity(entityId: string): IncludedEntity {
  return {
    entity_id: entityId,
    entity_type: EntityType.media_player,
    name: { en: entityId },
    integration_id: "int.1",
  };
}

/** The same entity as the entity endpoints deliver it: with live state. */
function configuredEntity(entityId: string, state: string): ConfiguredEntity {
  return {
    entity_id: entityId,
    entity_type: EntityType.media_player,
    integration_id: "int.1",
    name: { en: entityId },
    // The list attributes are required by the type but irrelevant here.
    attributes: { state, source_list: [], sound_mode_list: [] },
  };
}

function mountList(entities: IncludedEntity[]) {
  return mount(IncludedEntities, {
    props: { entities, instances: [], dragGroup: "test-entities" },
    global: {
      mocks: { $t: (key: string) => key },
      directives: { "overflow-indicator": {} },
      stubs: { SelectedIcon: true, QuickEditModal: true, AppDialog: true },
    },
  });
}

/** The rendered row of one entity, or undefined when it is not listed. */
function row(wrapper: ReturnType<typeof mountList>, entityId: string) {
  return wrapper
    .findAll(".entity-item")
    .find((item) => item.find(".entity-item__title").text() === entityId);
}

/** The state line below the name — the empty string when there is none. */
function stateOf(wrapper: ReturnType<typeof mountList>, entityId: string) {
  return row(wrapper, entityId)?.find(".entity-item__state").text();
}

/** Whether the row carries the red crossed-out marker. */
function isMarkedUnavailable(
  wrapper: ReturnType<typeof mountList>,
  entityId: string,
) {
  return row(wrapper, entityId)
    ?.find(".entity-item__icon")
    .classes()
    .includes(UNAVAILABLE_ICON);
}

describe("included entities show the live entity state", () => {
  beforeEach(() => {
    // A fresh Pinia re-runs the store's init(), which re-registers its WS
    // routes on the singleton router; clear them so that does not throw.
    (eventRouter as unknown as { routes: Map<string, unknown> }).routes.clear();
    setActivePinia(createPinia());
  });

  it("renders the state of a reference-only included entity", () => {
    integrationsStore().$state.configuredEntities = [
      configuredEntity("media_player.tv", "ON"),
    ];

    const wrapper = mountList([includedEntity("media_player.tv")]);

    expect(stateOf(wrapper, "media_player.tv")).toBe("on");
    expect(isMarkedUnavailable(wrapper, "media_player.tv")).toBe(false);
  });

  it("marks an unavailable included entity as unavailable", () => {
    integrationsStore().$state.configuredEntities = [
      configuredEntity("media_player.gone", "UNAVAILABLE"),
    ];

    const wrapper = mountList([includedEntity("media_player.gone")]);

    expect(stateOf(wrapper, "media_player.gone")).toBe("unavailable");
    // The red crossed-out line is `--unavailable::after` in _entity.scss.
    expect(isMarkedUnavailable(wrapper, "media_player.gone")).toBe(true);
  });

  it("keeps the state when the picker's full entity is replaced by a reference", async () => {
    integrationsStore().$state.configuredEntities = [
      configuredEntity("media_player.gone", "UNAVAILABLE"),
    ];

    // Adding through the "Add entities" picker concatenates the full entity;
    // saving reloads the activity, which hands back the reference-only copy.
    const wrapper = mountList([
      configuredEntity("media_player.gone", "UNAVAILABLE") as IncludedEntity,
    ]);
    await wrapper.setProps({ entities: [includedEntity("media_player.gone")] });
    await nextTick();

    expect(stateOf(wrapper, "media_player.gone")).toBe("unavailable");
    expect(isMarkedUnavailable(wrapper, "media_player.gone")).toBe(true);
  });

  it("follows a live state change of the cached entity", async () => {
    const store = integrationsStore();
    store.$state.configuredEntities = [
      configuredEntity("media_player.tv", "UNAVAILABLE"),
    ];

    const wrapper = mountList([includedEntity("media_player.tv")]);
    expect(stateOf(wrapper, "media_player.tv")).toBe("unavailable");

    // What a WS `entity_change` event does to the cached lists.
    store.applyEntityChange("media_player.tv", {
      entity_id: "media_player.tv",
      attributes: { state: "ON" },
    } as never);
    await nextTick();

    expect(stateOf(wrapper, "media_player.tv")).toBe("on");
    expect(isMarkedUnavailable(wrapper, "media_player.tv")).toBe(false);
  });

  // The group and activity-group lists pass whole entities. For an `activity`
  // the cached copy is the staler one — that type is owned by the activities
  // store, so `entity_change` never reaches the lists the overlay reads
  // (INTEGRATION_ENTITY_TYPES) — so a row's own state has to win.
  it("leaves a row that carries its own state alone", () => {
    integrationsStore().$state.configuredEntities = [
      configuredEntity("uc.main.activity", "OFF"),
    ];

    const wrapper = mountList([
      configuredEntity("uc.main.activity", "ON") as IncludedEntity,
    ]);

    expect(stateOf(wrapper, "uc.main.activity")).toBe("on");
  });

  it("renders an entity that is not cached without a state", () => {
    const wrapper = mountList([includedEntity("media_player.unknown")]);

    expect(row(wrapper, "media_player.unknown")).toBeDefined();
    expect(stateOf(wrapper, "media_player.unknown")).toBe("");
  });
});
