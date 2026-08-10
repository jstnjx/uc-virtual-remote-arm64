/**
 * Preview feature texts survive a `configuration_change` event.
 *
 * Toggling a preview feature makes core emit a `configuration_change` whose
 * `features` array carries `id` and `enabled` only — no `title`, `description`
 * or `help_url`. Arrays are replaced wholesale on merge, so without carrying
 * the cached texts over, the preview features screen loses every label right
 * after a toggle and only a full reload brings them back.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../src/api", () => ({
  default: {
    config: {},
    rest: () => ({}),
    websocket: () => ({}),
    getService: () => ({}),
  },
}));

import { configStore } from "../src/stores/config";
import type { CfgAll, CfgFeature } from "../src/types/config";

function cachedFeatures(): CfgFeature[] {
  return [
    {
      id: "internal_ir",
      enabled: false,
      title: { en: "Internal infrared (IR) blaster" },
      description: { en: "Enable the internal IR blaster." },
      help_url: "https://example.com/ir",
    },
    {
      id: "routable_iflink",
      enabled: true,
      title: { en: "New reconnect logic" },
      description: {
        en: "Enable the new dock & integration connection logic.",
      },
      help_url: "https://example.com/reconnect",
    },
  ];
}

/** The payload core sends after a preview feature was toggled. */
const toggleEvent = {
  features: [
    { id: "internal_ir", enabled: true },
    { id: "routable_iflink", enabled: true },
  ],
};

describe("config store updateConfig() with preview features", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("keeps the feature texts of a stripped-down event payload", () => {
    const store = configStore();
    store.$state.config = { features: cachedFeatures() } as CfgAll;

    store.updateConfig(toggleEvent);

    expect(store.config?.features).toEqual([
      { ...cachedFeatures()[0], enabled: true },
      cachedFeatures()[1],
    ]);
  });

  test("applies the enabled state of the event", () => {
    const store = configStore();
    store.$state.config = { features: cachedFeatures() } as CfgAll;

    store.updateConfig({
      features: [
        { id: "internal_ir", enabled: true },
        { id: "routable_iflink", enabled: false },
      ],
    });

    expect(store.config?.features?.map((f) => [f.id, f.enabled])).toEqual([
      ["internal_ir", true],
      ["routable_iflink", false],
    ]);
  });

  test("drops features the event no longer lists", () => {
    const store = configStore();
    store.$state.config = { features: cachedFeatures() } as CfgAll;

    store.updateConfig({ features: [{ id: "internal_ir", enabled: false }] });

    expect(store.config?.features).toEqual([cachedFeatures()[0]]);
  });

  test("takes over a feature the cache does not know", () => {
    const store = configStore();
    store.$state.config = { features: cachedFeatures() } as CfgAll;

    store.updateConfig({
      features: [...toggleEvent.features, { id: "brand_new", enabled: true }],
    });

    const features = store.config?.features ?? [];
    expect(features[features.length - 1]).toEqual({
      id: "brand_new",
      enabled: true,
    });
  });

  test("leaves an event without features untouched", () => {
    const store = configStore();
    store.$state.config = { features: cachedFeatures() } as CfgAll;

    store.updateConfig({ display: { brightness: 42 } });

    expect(store.config?.features).toEqual(cachedFeatures());
    expect(store.config?.display).toEqual({ brightness: 42 });
  });
});
