import { CfgGroups, SettingTypes, SelectTypes } from "@/types/enums";

import type { CfgAll } from "@/types/config";
import type { SegmentDefinition } from "@/types/segments";

export function useSegments() {
  function secondsToTime(value: number) {
    let totalSeconds = value;
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (hours > 0) {
      parts.push(hours + "h");
    }
    if (minutes > 0) {
      parts.push(minutes + "m");
    }
    if (hours < 1 && minutes < 10) {
      parts.push(seconds + "s");
    }
    return parts.join(" ").replace(" 0s", "").replace(" 0m", "");
  }

  function getSegments(cfg: CfgAll): SegmentDefinition[] {
    return [
      {
        title: "settings.rows.display.title",
        items: [
          {
            name: "auto_brightness",
            icon: "tv",
            value: cfg?.display?.auto_brightness,
            group: CfgGroups.display,
            title: "settings.auto_brightness.title",
            type: SettingTypes.BOOL,
            description: "settings.auto_brightness.description",
          },
          {
            name: "brightness",
            icon: "tv",
            value: cfg?.display?.brightness,
            group: CfgGroups.display,
            title: "settings.display_brightness.title",
            type: SettingTypes.PERCENT,
          },
          {
            name: "auto_brightness",
            icon: "remote",
            value: cfg?.button?.auto_brightness,
            group: CfgGroups.button,
            title: "settings.button_backlight.title",
            type: SettingTypes.BOOL,
            description: "settings.button_backlight.description",
          },
          {
            name: "brightness",
            icon: "remote",
            value: cfg?.button?.brightness,
            group: CfgGroups.button,
            title: "settings.button_brightness.title",
            type: SettingTypes.PERCENT,
          },
        ],
      },
      {
        title: "settings.rows.network.title",
        items: [
          // {
          //   name: "wifi_enabled",
          //   icon: "wifi-bluetooth",
          //   value: cfg?.network?.wifi_enabled,
          //   group: CfgGroups.network,
          //   title: "settings.network_wifi.title",
          //   type: SettingTypes.BOOL,
          //   // description: "settings.button_backlight.description",
          // },
          {
            name: "bt_enabled",
            icon: "bluetooth",
            value: cfg?.network?.bt_enabled,
            group: CfgGroups.network,
            title: "settings.network_bt.title",
            type: SettingTypes.BOOL,
            // description: "settings.button_backlight.description",
          },
        ],
      },
      {
        title: "settings.rows.sound.title",
        items: [
          {
            name: "enabled",
            icon: "volume",
            value: cfg?.sound?.enabled,
            group: CfgGroups.sound,
            title: "settings.sound_effects.title",
            type: SettingTypes.BOOL,
          },
          {
            name: "volume",
            icon: "volume",
            value: cfg?.sound?.volume,
            group: CfgGroups.sound,
            title: "settings.sound_effects_volume.title",
            type: SettingTypes.PERCENT,
          },
          {
            name: "enabled",
            icon: "heat",
            value: cfg?.haptic?.enabled,
            group: CfgGroups.haptic,
            title: "settings.haptic_feedback.title",
            type: SettingTypes.BOOL,
          },
        ],
      },
      // TODO: Re-add when voice control is implemented
      // {
      //   title: "settings.rows.voice_control.title",
      //   items: [
      //     {
      //       name: "enabled",
      //       icon: "microphone",
      //       value: cfg?.voice_control?.enabled,
      //       group: CfgGroups.voice_control,
      //       title: "settings.voice_control.title",
      //       type: SettingTypes.BOOL,
      //       description: "settings.voice_control.description",
      //     },
      //     {
      //       name: "microphone",
      //       icon: "microphone",
      //       value: cfg?.voice_control?.microphone,
      //       group: CfgGroups.voice_control,
      //       title: "settings.microphone.title",
      //       type: SettingTypes.BOOL,
      //       description: "settings.microphone.description",
      //     },
      //     {
      //       name: "voice_assistant",
      //       icon: "volume",
      //       value: cfg?.voice_control?.voice_assistant,
      //       group: CfgGroups.voice_control,
      //       title: "settings.voice_assistant.title",
      //       type: SettingTypes.SELECT,
      //       settings: {
      //         none: "None",
      //         required: false,
      //         type: SelectTypes.VoiceAssistant,
      //         title: "settings.voice_assistant.select_title",
      //       },
      //     },
      //   ],
      // },
      {
        title: "settings.rows.power_saving.title",
        items: [
          {
            name: "wakeup_sensitivity",
            icon: "battery",
            value: cfg?.power_saving?.wakeup_sensitivity,
            group: CfgGroups.power_saving,
            settings: {
              min: 0,
              max: 3,
              showValue: false,
              showDescription: true,
            },
            title: "settings.wakeup_sensitivity.title",
            type: SettingTypes.SLIDE,
            description: "settings.wakeup_sensitivity.description",
          },
          {
            name: "display_off_sec",
            icon: "tv",
            value: cfg?.power_saving?.display_off_sec,
            group: CfgGroups.power_saving,
            settings: {
              min: 0,
              max: 60,
              valueFormatter: secondsToTime,
            },
            title: "settings.display_timeout.title",
            type: SettingTypes.SECONDS,
          },
          {
            name: "standby_sec",
            icon: "charging",
            value: cfg?.power_saving?.standby_sec,
            group: CfgGroups.power_saving,
            settings: {
              min: 0,
              max: 1800,
              valueFormatter: secondsToTime,
            },
            title: "settings.sleep_timeout.title",
            type: SettingTypes.SECONDS,
          },
        ],
      },
      {
        title: "settings.rows.localization.title",
        items: [
          {
            name: "language_code",
            icon: "language",
            value: cfg?.localization?.language_code,
            group: CfgGroups.localization,
            title: "settings.language.title",
            type: SettingTypes.SELECT,
            settings: {
              title: "settings.language.select_title",
              type: SelectTypes.Language,
            },
          },
          {
            name: "country_code",
            icon: "home1",
            value: cfg?.localization?.country_code,
            group: CfgGroups.localization,
            title: "settings.country.title",
            type: SettingTypes.SELECT,
            settings: {
              title: "settings.country.select_title",
              type: SelectTypes.Country,
            },
          },
          {
            name: "time_zone",
            icon: "language",
            value: cfg?.localization?.time_zone,
            group: CfgGroups.localization,
            title: "settings.timezone.title",
            type: SettingTypes.SELECT,
            settings: {
              title: "settings.timezone.select_title",
              type: SelectTypes.TimeZone,
            },
          },
          {
            name: "time_format_24h",
            icon: "language",
            value: cfg?.localization?.time_format_24h,
            group: CfgGroups.localization,
            title: "settings.timeformat.title",
            type: SettingTypes.BOOL,
          },
          {
            name: "measurement_unit",
            icon: "eye",
            value: cfg?.localization?.measurement_unit,
            group: CfgGroups.localization,
            title: "settings.unit_system.title",
            type: SettingTypes.SELECT,
            settings: {
              title: "settings.unit_system.select_title",
              type: SelectTypes.UnitSystem,
            },
          },
        ],
      },
    ];
  }

  function getDescriptionClasses(titleItem: HTMLElement) {
    if (titleItem == undefined) {
      return "";
    }

    const titleRows = Math.ceil(titleItem.getBoundingClientRect().height / 34);
    const descrRows = 4 - titleRows;

    return `segment--item--description--rows segment--item--description--rows--${descrRows}`;
  }

  return {
    getSegments,
    getDescriptionClasses,
  };
}
