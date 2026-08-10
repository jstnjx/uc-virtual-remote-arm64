/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified build first published: 2026-08-03.
 * Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
 * See MODIFICATIONS.md for details.
 */
import { getIconName } from "@/composables/icon";
import { simulatorEnabled, simulatorRouteBlocked } from "@/simulator/config";

export function useMenuItems() {
  const items = {
    home: {
      to: { name: "home" },
      title: "page.home",
    },
    ...(simulatorEnabled()
      ? { remote_simulator: { to: { name: "remote-simulator" }, title: "Remote" } }
      : {}),
    customise_remote: {
      to: { name: "customise-remote" },
      title: "page.customise_remote",
      additional: true,
    },
    entities: {
      to: { name: "entities" },
      title: "page.entities",
    },
    integrations: {
      to: { name: "integrations" },
      title: "page.integrations",
    },
    activities_macros: {
      to: { name: "activities-macros" },
      title: "page.activities_macros",
    },
    settings: {
      to: { name: "settings" },
      title: "page.settings",
    },
  };

  async function getSettingsItems() {
    const iconSound = await getIconName("fa-volume-up");
    return [
      {
        value: "general",
        label: "page.general",
        icon: "fa-light fa-gear",
      },
      {
        value: "display",
        label: "page.display",
        icon: "fa-light fa-display",
      },
      {
        value: "sound-haptic",
        label: "page.sound_haptic",
        icon: `fa-light ${iconSound}`,
      },
      {
        value: "voice-control",
        label: "page.voice_control",
        icon: "fa-light fa-microphone",
      },
      {
        value: "power-saving",
        label: "page.power_saving",
        icon: "fa-light fa-battery-three-quarters",
      },
      {
        value: "wifi-bluetooth",
        label: "page.wifi_bluetooth",
        icon: "fa-light fa-wifi",
      },
      {
        value: "localization",
        label: "page.localization",
        icon: "fa-light fa-globe",
      },
      {
        value: "admin-password",
        label: "page.admin_password",
        icon: "fa-light fa-lock",
      },
      {
        value: "application-credentials",
        label: "page.application_credentials",
        icon: "fa-light fa-key",
      },
      {
        value: "sync-mode",
        label: "Sync Mode",
        icon: "fa-light fa-arrows-rotate",
      },
      {
        value: "development",
        label: "page.development",
        icon: "fa-light fa-code",
      },
      {
        value: "factory-reset",
        label: "page.factory_reset",
        icon: "fa-light fa-warning",
      },
    ].map((item) => ({ ...item, disabled: simulatorRouteBlocked(item.value) }));
  }

  function fromEntries<V>(entries: [string, V][]): Record<string, V> {
    return entries.reduce<Record<string, V>>((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  }

  function getMenuItems(base = false) {
    if (base) {
      return fromEntries(
        Object.entries(items).filter(
          ([_key, value]) => !("additional" in value && value.additional),
        ),
      );
    }

    return items;
  }

  return {
    getMenuItems,
    getSettingsItems,
  };
}
