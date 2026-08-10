// @vitest-environment jsdom
/**
 * Bluetooth slot availability on the entities view.
 *
 * The occupied-slot states cannot be exercised end-to-end: the simulator ships
 * no BT device profiles (`GET /api/cfg/bt/profiles` is empty and the core
 * answers `POST /api/remotes` with "BT device profile doesn't exist"), so no
 * Bluetooth remote can be created against it, and raising
 * `bt.peripheral_connections` needs a reboot the container does not survive.
 * bluetoothSlots.spec.ts therefore covers the empty-slot device against the
 * real backend, and every occupied state is asserted here — against the real
 * en_US strings, so the plural keys are covered too.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import type { RouteLocationNormalizedLoaded, Router } from "vue-router";

import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import { configStore } from "@/stores/config";
import { remotesStore } from "@/stores/remotes";
import { RemoteKind } from "@/types/enums";
import type { CfgAll } from "@/types/config";
import type { Remote } from "@/types/remote";

import en from "@/i18next/en_US.json";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { language: "en_US", exists: () => false },
  }),
}));

const ROUTER = {
  push: vi.fn(),
  options: { history: { state: { current: "/entities?category=bt" } } },
};

vi.mock(import("vue-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => ROUTER as unknown as Router,
  useRoute: () =>
    ({
      path: "/entities",
      query: {},
    }) as unknown as RouteLocationNormalizedLoaded,
}));

import DevicesEntities from "@/views/entities/DevicesEntities.vue";

function lookup(path: string): string | undefined {
  const found = path
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      (en as { translation: unknown }).translation,
    );
  return typeof found === "string" ? found : undefined;
}

/**
 * Enough of i18next to prove the keys resolve and that the plural form is
 * picked from the maximum: `_one`/`_other` selection on `count`, then `{{ }}`
 * interpolation.
 */
function translate(key: string, opts?: Record<string, unknown>): string {
  const count = opts?.count;
  const plural =
    count === undefined
      ? undefined
      : lookup(`${key}_${count === 1 ? "one" : "other"}`);

  return (plural ?? lookup(key) ?? key).replace(
    /{{\s*(\w+)\s*}}/g,
    (_match, name: string) => {
      const value = opts?.[name];
      return typeof value === "number" || typeof value === "string"
        ? String(value)
        : "";
    },
  );
}

const openAddRemoteBt = vi.fn();

/** Stands in for AddRemoteBt so the view's template ref resolves to a spy. */
const AddRemoteBtStub = defineComponent({
  name: "AddRemoteBt",
  setup(_props, { expose }) {
    expose({ open: openAddRemoteBt, startPairing: vi.fn() });
    return () => h("div");
  },
});

/** The view calls into the list on every tab change, so the stub needs its API. */
const BaseEntityListStub = defineComponent({
  name: "BaseEntityList",
  setup(_props, { expose }) {
    expose({ clearAssignedEntities: vi.fn(), startDelete: vi.fn() });
    return () => h("div");
  },
});

const STUBS = {
  TabMenu: true,
  UCSearch: true,
  FilterTabs: true,
  FilterDropdown: true,
  AddDevice: true,
  AddRemoteIr: true,
  AddDock: true,
  AddIntegration: true,
  AddRemoteBt: AddRemoteBtStub,
  BaseEntityList: BaseEntityListStub,
};

function btRemotes(count: number): Remote[] {
  return Array.from(
    { length: count },
    (_value, index) => ({ entity_id: `remote.bt${index}` }) as Remote,
  );
}

/**
 * Mount the entities view on the Bluetooth tab of a device with `max` slots and
 * `paired` Bluetooth remotes. `max: null` stands for a configuration that has
 * not loaded.
 */
async function mountBtTab(max: number | null, paired: number) {
  vi.spyOn(ApiConnection.remotes, "getAll").mockResolvedValue(
    btRemotes(paired),
  );

  configStore().$state.config = (
    max === null ? {} : { bt: { peripheral_connections: max } }
  ) as CfgAll;

  const wrapper = mount(DevicesEntities, {
    global: { stubs: STUBS, mocks: { $t: translate } },
  });

  await flushPromises();
  // onMounted awaits sleep(10) between restoring the tab and the rest of it.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flushPromises();
  return wrapper;
}

const CAPTION = "#entities-bt-slots";
const ADD_BUTTON = ".page-devices__tools__filter__options .button--primary";

beforeEach(() => {
  // A fresh Pinia re-runs each store's init(), which re-registers its WS routes
  // on the singleton router; clear them so that does not throw.
  (eventRouter as unknown as { routes: Map<string, unknown> }).routes.clear();
  setActivePinia(createPinia());
  ROUTER.push.mockClear();
  openAddRemoteBt.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Bluetooth slot caption", () => {
  it("reads '1 of 1 slot available' on an empty single-slot device", async () => {
    const wrapper = await mountBtTab(1, 0);
    expect(wrapper.get(CAPTION).text()).toBe("1 of 1 slot available");
  });

  it("reads '0 of 1 slot available' when the only slot is taken", async () => {
    const wrapper = await mountBtTab(1, 1);
    expect(wrapper.get(CAPTION).text()).toBe("0 of 1 slot available");
  });

  it("pluralises on the maximum, not on the free count", async () => {
    const wrapper = await mountBtTab(5, 2);
    expect(wrapper.get(CAPTION).text()).toBe("3 of 5 slots available");
  });

  it("clamps at zero when the maximum is below the number of remotes", async () => {
    const wrapper = await mountBtTab(1, 3);
    expect(wrapper.get(CAPTION).text()).toBe("0 of 1 slot available");
  });

  it("is not rendered while the configuration is unknown", async () => {
    const wrapper = await mountBtTab(null, 0);
    expect(wrapper.find(CAPTION).exists()).toBe(false);
  });

  it("is not rendered on the other tabs", async () => {
    const wrapper = await mountBtTab(1, 1);
    expect(wrapper.find(CAPTION).exists()).toBe(true);

    await wrapper
      .findComponent({ name: "TabMenu" })
      .vm.$emit("itemClick", { value: RemoteKind.IR });
    await flushPromises();

    expect(wrapper.find(CAPTION).exists()).toBe(false);
  });

  it("follows the configured maximum without a remount", async () => {
    const wrapper = await mountBtTab(1, 1);
    expect(wrapper.get(CAPTION).text()).toBe("0 of 1 slot available");

    configStore().$state.config = {
      bt: { peripheral_connections: 5 },
    } as CfgAll;
    await flushPromises();

    expect(wrapper.get(CAPTION).text()).toBe("4 of 5 slots available");
  });
});

describe("the add button", () => {
  it("is disabled when no slot is free", async () => {
    const wrapper = await mountBtTab(1, 1);
    expect(wrapper.get(ADD_BUTTON).attributes("disabled")).toBeDefined();
  });

  it("opens the Bluetooth dialog while a slot is free", async () => {
    const wrapper = await mountBtTab(5, 2);
    expect(wrapper.get(ADD_BUTTON).attributes("disabled")).toBeUndefined();

    await wrapper.get(ADD_BUTTON).trigger("click");

    expect(openAddRemoteBt).toHaveBeenCalled();
  });

  it("stays enabled while the configuration is unknown", async () => {
    const wrapper = await mountBtTab(null, 4);
    expect(wrapper.get(ADD_BUTTON).attributes("disabled")).toBeUndefined();
  });

  it("re-enables when a remote is deleted", async () => {
    const wrapper = await mountBtTab(1, 1);
    expect(wrapper.get(ADD_BUTTON).attributes("disabled")).toBeDefined();

    remotesStore().applyDelete("remote.bt0");
    await flushPromises();

    expect(wrapper.get(ADD_BUTTON).attributes("disabled")).toBeUndefined();
    expect(wrapper.get(CAPTION).text()).toBe("1 of 1 slot available");
  });

  it("points assistive technology at the caption", async () => {
    const wrapper = await mountBtTab(1, 1);
    expect(wrapper.get(ADD_BUTTON).attributes("aria-describedby")).toBe(
      "entities-bt-slots",
    );
  });
});
