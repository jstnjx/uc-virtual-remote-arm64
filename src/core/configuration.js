import { clampInteger } from "../shared/util.js";

function localeParts(locale) {
  const [language = "en", country = "US"] = String(locale || "en-US")
    .replace("_", "-")
    .split("-");
  return {
    language: language.toLowerCase(),
    country: country.toUpperCase(),
  };
}

function mergeObject(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ...base };
  }
  return { ...base, ...patch };
}

function mergeFeatures(defaults, stored) {
  const saved = new Map(
    (Array.isArray(stored) ? stored : [])
      .filter((item) => item?.id)
      .map((item) => [item.id, item]),
  );
  const known = new Set(defaults.map((item) => item.id));
  return [
    ...defaults.map((item) => ({
      ...item,
      ...(saved.get(item.id) || {}),
      enabled: Boolean(saved.get(item.id)?.enabled ?? item.enabled),
    })),
    ...(Array.isArray(stored)
      ? stored.filter((item) => item?.id && !known.has(item.id))
      : []),
  ];
}

export class ConfigurationService {
  constructor(platform) {
    this.platform = platform;
    this.#syncLightingToSimulator(this.getAll());
  }

  defaults() {
    const { country } = localeParts(this.platform.locale);
    const bluetoothAddress =
      this.platform.hardware?.bluetoothAddress?.() || "00:00:00:00:00:00";
    return {
      button: {
        brightness: 70,
        auto_brightness: true,
        static_color: { rgb: [255, 255, 255] },
      },
      device: { name: this.platform.name },
      display: { brightness: 70, auto_brightness: true },
      features: [
        {
          id: "entity_button_func_inverted",
          enabled: false,
          title: { en: "Invert entity button function" },
          description: {
            en: "Use the alternate entity action as the primary button action.",
          },
        },
        {
          id: "show_battery_percentage",
          enabled: true,
          title: { en: "Show battery percentage" },
          description: {
            en: "Show the virtual battery percentage in the status bar.",
          },
        },
        {
          id: "demo_mode",
          enabled: false,
          title: { en: "Demo mode" },
          description: {
            en: "Add a built-in Watch TV demo with a media player, light, cover, climate, remote, and activity.",
          },
        },
      ],
      haptic: { enabled: true },
      bt: {
        peripheral_connections: 1,
        enable_hci_log: false,
        version: "BlueZ",
        advertisement_name: this.platform.name,
      },
      localization: {
        language_code: "en_US",
        country_code: country,
        time_zone: this.platform.timezone,
        time_format_24h: true,
        measurement_unit: "METRIC",
      },
      network: {
        bt_enabled: false,
        wifi_enabled: true,
        wake_on_wlan: { enabled: false },
        bt: { address: bluetoothAddress },
        wifi: {
          band: "auto",
          bands: ["a", "b"],
          scan_interval_sec: 15,
        },
      },
      power_saving: {
        wakeup_sensitivity: 2,
        display_off_sec: 30,
        standby_sec: 0,
      },
      profile: {
        has_admin_pin: Boolean(
          this.platform.db.getSetting("admin_pin_hash", null),
        ),
      },
      software_update: {
        check_for_updates: false,
        auto_update: false,
        ota_window_start: "02:00:00",
        ota_window_end: "05:00:00",
        channel: "DEFAULT",
      },
      sound: { enabled: true, volume: 50 },
      voice_control: {
        microphone: false,
        enabled: false,
        voice_assistant: "None",
      },
      sync_mode:
        this.platform.syncMode?.configurationState?.(false) || {
          enabled: false,
          settings: { enabled: false },
        },
      restart_required: false,
    };
  }

  getAll() {
    const defaults = this.defaults();
    const stored = this.platform.db.getSetting("configuration", {});
    const storedNetwork =
      stored.network && typeof stored.network === "object"
        ? stored.network
        : {};
    const network = {
      ...defaults.network,
      ...storedNetwork,
      wake_on_wlan: {
        ...(defaults.network.wake_on_wlan || {}),
        ...(storedNetwork.wake_on_wlan || {}),
      },
      bt: {
        ...(defaults.network.bt || {}),
        ...(storedNetwork.bt || {}),
        address: defaults.network.bt.address,
      },
      wifi: {
        ...(defaults.network.wifi || {}),
        ...(storedNetwork.wifi || {}),
      },
    };
    const voiceControl = mergeObject(
      defaults.voice_control,
      stored.voice_control,
    );
    return {
      ...defaults,
      ...stored,
      button: mergeObject(defaults.button, stored.button),
      device: mergeObject(defaults.device, stored.device),
      display: mergeObject(defaults.display, stored.display),
      haptic: mergeObject(defaults.haptic, stored.haptic),
      bt: mergeObject(defaults.bt, stored.bt),
      localization: {
        ...mergeObject(defaults.localization, stored.localization),
        language_code: "en_US",
      },
      network,
      power_saving: mergeObject(
        defaults.power_saving,
        stored.power_saving,
      ),
      profile: {
        has_admin_pin: Boolean(
          this.platform.db.getSetting("admin_pin_hash", null),
        ),
      },
      software_update: mergeObject(
        defaults.software_update,
        stored.software_update,
      ),
      sound: mergeObject(defaults.sound, stored.sound),
      voice_control: voiceControl,
      // Web Configurator 2.3.3 exposes this aggregate section as `voice`
      // while its write endpoint remains /cfg/voice_control.
      voice: structuredClone(voiceControl),
      features: mergeFeatures(defaults.features, stored.features),
      sync_mode:
        this.platform.syncMode?.configurationState?.(true) ||
        defaults.sync_mode,
      restart_required: Boolean(stored.restart_required),
    };
  }

  get(section) {
    const value = this.getAll()[section];
    if (value === undefined) {
      throw Object.assign(
        new Error(`Unknown configuration section ${section}`),
        { status: 404 },
      );
    }
    return value;
  }

  update(section, patch) {
    if (section === "sync_mode") {
      return this.platform.syncMode.handleConfigurationPatch(patch);
    }

    const all = this.getAll();
    if (!(section in all)) {
      throw Object.assign(
        new Error(`Unknown configuration section ${section}`),
        { status: 404 },
      );
    }
    let next;
    if (section === "features") {
      const updates = Array.isArray(patch) ? patch : [patch];
      const byId = new Map(
        all.features.map((item) => [item.id, { ...item }]),
      );
      for (const item of updates) {
        if (!item?.id || !byId.has(item.id)) continue;
        byId.set(item.id, {
          ...byId.get(item.id),
          enabled: Boolean(item.enabled),
        });
      }
      next = [...byId.values()];
    } else {
      next = mergeObject(all[section], patch);
    }
    this.#validate(section, next);
    const stored = this.platform.db.getSetting("configuration", {});
    const result = { ...stored, [section]: next };
    this.platform.db.setSetting("configuration", result);
    if (section === "button" || section === "display") {
      this.#syncLightingToSimulator({ [section]: next });
    }
    if (section === "device" && next.name) {
      this.platform.name = String(next.name);
    }
    this.platform.events.publish("configuration.change", {
      event_type: "CHANGE",
      key: section,
      new_state: this.#eventState(section, next),
    });
    return next;
  }

  reset(section = null) {
    if (section === "sync_mode") {
      return this.platform.syncMode.handleConfigurationPatch({
        action: "disable",
        ...this.platform.syncMode.defaults(),
      });
    }
    if (!section) {
      this.platform.db.setSetting("configuration", {});
      const value = this.getAll();
      this.#syncLightingToSimulator(value);
      this.platform.events.publish("configuration.change", {
        event_type: "RESET",
        key: "all",
        new_state: value,
      });
      return value;
    }
    const stored = this.platform.db.getSetting("configuration", {});
    delete stored[section];
    this.platform.db.setSetting("configuration", stored);
    const value = this.get(section);
    if (section === "button" || section === "display") {
      this.#syncLightingToSimulator({ [section]: value });
    }
    this.platform.events.publish("configuration.change", {
      event_type: "RESET",
      key: section,
      new_state: this.#eventState(section, value),
    });
    return value;
  }

  #eventState(section, value) {
    if (section === "voice_control") {
      return {
        voice_control: value,
        voice: structuredClone(value),
      };
    }
    return { [section]: value };
  }

  #syncLightingToSimulator(configuration) {
    const simulator = this.platform.db.getSetting("simulator", {});
    const next = { ...simulator };
    const button = configuration?.button;
    if (button) {
      const rgb = Array.isArray(button.static_color?.rgb)
        ? button.static_color.rgb.slice(0, 3)
        : [255, 255, 255];
      next.button = {
        ...button,
        static_color: {
          ...(button.static_color || {}),
          rgb,
        },
      };
    }
    const display = configuration?.display;
    if (display) next.display = { ...display };
    this.platform.db.setSetting("simulator", next);
  }

  #validate(section, value) {
    if (section === "button" || section === "display") {
      value.brightness = clampInteger(value.brightness, 0, 100, 70);
      value.auto_brightness = Boolean(value.auto_brightness);
    }
    if (section === "button") {
      const staticColor =
        value.static_color &&
        typeof value.static_color === "object" &&
        !Array.isArray(value.static_color)
          ? { ...value.static_color }
          : {};
      const rgb = Array.isArray(staticColor.rgb)
        ? staticColor.rgb
        : [255, 255, 255];
      staticColor.rgb = [0, 1, 2].map((index) =>
        clampInteger(rgb[index], 0, 255, 255),
      );
      value.static_color = staticColor;
    }
    if (section === "haptic") value.enabled = Boolean(value.enabled);
    if (section === "bt") {
      value.peripheral_connections = clampInteger(
        value.peripheral_connections,
        1,
        5,
        1,
      );
      value.enable_hci_log = Boolean(value.enable_hci_log);
      value.version = String(value.version || "BlueZ");
      value.advertisement_name = String(
        value.advertisement_name || this.platform.name,
      );
    }
    if (section === "sound") {
      value.enabled = Boolean(value.enabled);
      value.volume = clampInteger(value.volume, 0, 100, 50);
    }
    if (section === "power_saving") {
      value.wakeup_sensitivity = clampInteger(
        value.wakeup_sensitivity,
        0,
        3,
        2,
      );
      value.display_off_sec = clampInteger(
        value.display_off_sec,
        0,
        60,
        30,
      );
      value.standby_sec = clampInteger(
        value.standby_sec,
        0,
        10800,
        0,
      );
    }
    if (section === "device") {
      value.name = String(value.name || this.platform.name)
        .trim()
        .slice(0, 50);
      if (!value.name) {
        throw Object.assign(new Error("Device name cannot be empty"), {
          status: 400,
        });
      }
    }
    if (section === "localization") {
      value.language_code = "en_US";
      value.country_code = String(value.country_code || "US").toUpperCase();
      value.time_zone = String(value.time_zone || "UTC");
      value.time_format_24h = Boolean(value.time_format_24h);
      if (!["METRIC", "US", "UK"].includes(value.measurement_unit)) {
        value.measurement_unit = "METRIC";
      }
    }
  }
}
