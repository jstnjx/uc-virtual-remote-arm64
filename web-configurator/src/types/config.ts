import type { CfgGroups } from "@/types/enums";
import type { DeviceButtonLayout, DeviceScreenLayout } from "@/types/activity";

export type CfgAll = {
  bt?: CfgBt;
  button?: CfgButtons;
  display?: CfgDisplay;
  haptic?: CfgHaptic;
  localization?: CfgLocalization;
  network?: CfgNetwork;
  power_saving?: CfgPowerSaving;
  profile?: CfgProfile;
  software_update?: CfgSoftwareUpdate;
  sound?: CfgSound;
  voice?: CfgVoice;
  device?: CfgDevice;
  features?: CfgFeature[];
};

export type ConfigApiAll = ConfigLists & {
  cfg: CfgAll;
};

export interface Cfg {
  [name: string]: unknown;
}

export interface CfgBt extends Cfg {
  advertisement_name: string;
  enable_debug_port: boolean;
  enable_hci_log: boolean;
  peripheral_connections: number;
}

export interface CfgButtons extends Cfg {
  /** @description Button backlight brightness. 0 = off, 100 = max. */
  brightness: number;
  /** @description When enabled, button backlight will automatically turn on in a dark room. */
  auto_brightness: boolean;
  /** @description Button backlight color in rgb */
  static_color?: {
    rgb: number[];
    zones: string;
  };
}

export interface CfgDisplay extends Cfg {
  /** @description Display brightness. */
  brightness: number;
  /** @description Automatically adjust the display brightness based on ambient lighting conditions. */
  auto_brightness: boolean;
}

export interface CfgHaptic extends Cfg {
  /** @description Haptic feedback enabled. */
  enabled: boolean;
}

export interface CfgLocalization extends Cfg {
  language_code: LanguageCode;
  country_code: CountryCode;
  /** @description Time zone name according to IANA <https://www.iana.org/time-zones>, e.g. `Europe/Copenhagen`. */
  time_zone: string;
  time_format_24h: boolean;
  measurement_unit: MeasurementUnit;
}

export interface CfgNetwork extends Cfg {
  /** @description Enable Bluetooth. */
  bt_enabled: boolean;
  /** @description Enable WiFi. */
  wifi_enabled: boolean;
  /** @description Wake on WLAN. */
  wake_on_wlan: {
    enabled: boolean;
  };
  /** @description Bluetooth information. */
  bt?: {
    address?: string;
  };
  wifi?: CfgWiFi;
}

export interface CfgWiFi extends Cfg {
  /** @description Wake on WLAN. */
  wake_on_wlan: {
    enabled: boolean;
  };

  /** @description WiFi settings. */
  bands?: string[];
  band?: string;
  ipv4_type?: string;

  scan_interval_sec?: number;
}

export interface CfgProfile extends Cfg {
  /** @description Profile pin. */
  pin: number;
  /** @description Enable profile pin. */
  has_admin_pin: boolean;
}

export interface CfgFeature extends Cfg {
  /** @description Preview feature ID. */
  id: string;
  /** @description Enable preview feature. */
  enabled: boolean;
  /** @description Preview feature title. */
  title?: LanguageText;
  /** @description Preview feature description. */
  description?: LanguageText;
  /** @description Preview feature help URL. */
  help_url?: string;
}

export interface CfgPowerSaving extends Cfg {
  /** @description Amount of movement needed to wake up the remote. 0 = disabled. */
  wakeup_sensitivity: number;
  /** @description Turn off display after given seconds. */
  display_off_sec: number;
  /** @description Activate standby after given seconds. 0 disables standby mode. */
  standby_sec: number;
}

export interface CfgSoftwareUpdate extends Cfg {
  /**
   * @description Automatically check for updates. If `auto_update` is enabled,
   *   the updates are automatically installed, otherwise the user is only
   *   notified about the updates.
   */
  check_for_updates: boolean;
  /** @description Automatically update the remote when new software is available. Requires `check_for_updates` to be enabled. */
  auto_update: boolean;
  channel: string;
}

export interface CfgSound extends Cfg {
  /** @description Sound effects enabled. */
  enabled: boolean;
  /** @description Sound effects volume. */
  volume: number;
}

export interface CfgVoice extends Cfg {
  /**
   * @description Enable microphone. Disabling the microphone will completely
   *   turn it off. Voice control and dictation won't work with the remote or
   *   integrations.
   */
  microphone: boolean;
  /**
   * @description Enable voice control. Disabling voice control will still let
   *   you use voice dictation with integrations. Disable the microphone to
   *   completely switch off any microphone related functionality.
   */
  enabled: boolean;
  /**
   * @description TODO
   *
   * @default None
   */
  voice_assistant: CfgVoiceAssistant;
}

export interface CfgVoiceAssistant extends Cfg {
  active?: VoiceAssistant;
  profile_id: string;
  speech_response: boolean;
}

export interface VoiceAssistant extends Cfg {
  entity_id: string;
  name: LanguageText;
  icon: IconIdentifier;
  state: string;
  features: string[];
  profiles: VoiceAssistantProfile[];
  preferred_profile?: string;
}

export interface VoiceAssistantProfile extends Cfg {
  id: string;
  name: string;
  language: LanguageCode;
  features?: string[];
}

export interface CfgDevice extends Cfg {
  name: string;
}
/**
 * Format: iso-3166
 * @description Two letter country code according to
 *   [ISO-3166-1-alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2).
 */
export type CountryCode = string;

/**
 * @description Language culture code: starting with the two-letter
 *   [ISO-639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) code,
 *   followed by an optional [ISO-3166 country
 *   code](https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes),
 *   separated by an underscore. Examples: `en`, `en_UK`, `en_US`, `de`,
 *   `de_DE`, `de_CH` etc.
 */
export type LanguageCode = string;

export type LanguageListItem = {
  code: LanguageCode;
  name: string;
};

export type CountryListItem = {
  code: CountryCode;
  name_en: string;
  [name_translations: string]: string;
};

/** @enum {string} */
export type MeasurementUnit = "METRIC" | "US" | "UK";

export type MeasurementUnitList = {
  [code: string]: string;
};

export type ConfigLists = {
  tz: string[];
  voiceAssistants: VoiceAssistant[];
  languages: LanguageListItem[];
  countries: CountryListItem[];
  unitSystems: MeasurementUnitList;
  buttonLayout: DeviceButtonLayout[];
  screenLayout: DeviceScreenLayout;
};

export type ChangeCallbackParams = {
  ev?: Event;
  group?: CfgGroups;
  name?: string;
  value: unknown;
};

export type IconDefinition = {
  icon: {
    paths: string[];
    attrs: unknown[];
    isMulticolor: boolean;
    isMulticolor2: boolean;
    grid: number;
    tags: string[];
  };
  attr: unknown[];
  properties: {
    order: number;
    id: number;
    name: string;
    prevSize: number;
    code: number;
  };
  setIdx: number;
  setId: number;
  iconIds: number;
};

export type SelectOption = {
  index: number;
  value: number | string;
  label: string;
  search: string;
};

export type LanguageText = {
  [code: string]: string;
};

/**
 * IconIdentifier string($^[a-zA-Z0-9-_\.:]+$)
 * maxLength: 255
 */
export type IconIdentifier = string;

export type DeviceMeta = {
  model?: string;
  device_name: string;
  hostname?: string;
  api?: string;
  core?: string;
  ui?: string;
  os?: string;
};
