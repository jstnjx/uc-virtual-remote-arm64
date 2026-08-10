// @vitest-environment jsdom
/**
 * The Licenses row on Settings > General > About.
 *
 * Every other field in that column reports something the device told us and is `v-if`-gated on
 * it. The Licenses row is not: the attribution page ships with the app, so the row must be
 * there even when the backend answers nothing at all — the case that is awkward to reach
 * against the simulator, which always reports a system info block.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";

import SettingsAbout from "@/components/settings/SettingsAbout.vue";
import { configStore } from "@/stores/config";
import { systemBaseStore } from "@/stores/systemBase";
import type { CfgAll } from "@/types/config";

import en from "@/i18next/en_US.json";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { language: "en_US", exists: () => false },
  }),
}));

function translate(key: string): string {
  return (
    (key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        en.translation,
      ) as string) ?? key
  );
}

const openLicenses = vi.fn();
const SettingsLicensesStub = defineComponent({
  name: "SettingsLicenses",
  setup(_props, { expose }) {
    expose({ open: openLicenses });
    return () => h("div", { class: "licenses-stub" });
  },
});

/**
 * `deviceMeta: null` / `systemInfo: null` stands for a backend that answered nothing — every
 * data field is then gated away and the Licenses row is the column's only child.
 */
async function mountAbout(
  options: { btAddress?: string; withDeviceData?: boolean } = {},
) {
  const config = configStore();
  const systemBase = systemBaseStore();

  config.$state.config = (
    options.btAddress ? { network: { bt: { address: options.btAddress } } } : {}
  ) as CfgAll;

  const meta = options.withDeviceData
    ? { os: "1.2.3", core: "4.5.6", ui: "7.8.9" }
    : null;
  vi.spyOn(config, "getDeviceMeta").mockResolvedValue(
    meta as Awaited<ReturnType<typeof config.getDeviceMeta>>,
  );
  vi.spyOn(systemBase, "getSystemInfo").mockResolvedValue(
    null as Awaited<ReturnType<typeof systemBase.getSystemInfo>>,
  );
  vi.spyOn(systemBase, "getCustomWebConfigStatus").mockResolvedValue(
    null as Awaited<ReturnType<typeof systemBase.getCustomWebConfigStatus>>,
  );
  vi.spyOn(systemBase, "getWifiStatus").mockResolvedValue(
    null as Awaited<ReturnType<typeof systemBase.getWifiStatus>>,
  );

  const wrapper = mount(SettingsAbout, {
    props: { back: vi.fn() },
    global: {
      stubs: { SettingsLicenses: SettingsLicensesStub },
      mocks: { $t: translate },
    },
  });

  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  openLicenses.mockClear();
});

describe("the Licenses row", () => {
  it("is rendered even when the device reports nothing", async () => {
    const wrapper = await mountAbout();

    const row = wrapper.find(".settings-data-field--link");
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("License information");
  });

  /**
   * The row shipped once with a label nobody could read: it is a `<button>`, and neither the
   * global `button` rule nor `.settings-data-field__label` sets a colour, so the label
   * inherited the user agent's `buttontext` (black) and vanished on the dark theme. jsdom does
   * not load the stylesheet, so the colour itself cannot be asserted here — what this pins is
   * that the label is real text in the row rather than an icon-only control, which is the shape
   * that made the regression easy to miss.
   */
  it("labels the row in words, not just a chevron", async () => {
    const wrapper = await mountAbout();

    const label = wrapper.find(
      ".settings-data-field--link .settings-data-field__label",
    );
    expect(label.exists()).toBe(true);
    expect(label.text().trim()).toBe("License information");
  });

  it("is the last row, directly below the Bluetooth address", async () => {
    const wrapper = await mountAbout({
      btAddress: "AA:BB:CC:DD:EE:FF",
      withDeviceData: true,
    });

    const rows = wrapper.findAll(
      ".about-remote__data-fields .settings-data-field",
    );
    const labels = rows.map((row) =>
      row.find(".settings-data-field__label").text(),
    );

    expect(labels[labels.length - 1]).toContain("License information");
    expect(labels[labels.length - 2]).toBe(
      translate("remote.meta_label.bluetooth_address"),
    );
    // The last row carries no divider, so appending it hands the Bluetooth row its own back.
    expect(rows[rows.length - 1].classes()).toContain(
      "settings-data-field--link",
    );
  });

  it("is a button, so it is reachable by keyboard", async () => {
    const wrapper = await mountAbout();

    expect(wrapper.find(".settings-data-field--link").element.tagName).toBe(
      "BUTTON",
    );
  });

  it("opens the licenses view when activated", async () => {
    const wrapper = await mountAbout();
    await wrapper.find(".settings-data-field--link").trigger("click");

    expect(openLicenses).toHaveBeenCalledTimes(1);
  });
});
