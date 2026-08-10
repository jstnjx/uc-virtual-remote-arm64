import { defineStore } from "pinia";
import ApiConnection from "@/api";
import type {
  Cfg,
  CfgAll,
  CfgFeature,
  CfgWiFi,
  CfgVoice,
  CountryListItem,
  LanguageListItem,
  MeasurementUnitList,
  ConfigLists,
  ChangeCallbackParams,
  DeviceMeta,
  VoiceAssistant,
} from "@/types/config";
import { SelectTypes } from "@/types/enums";
import type { DeviceButtonLayout, DeviceScreenLayout } from "@/types/activity";
import type { SupportedResource } from "@/types/resources";
import { mergeEventPayload } from "@/composables/dataHelper";
import { createCoalescer } from "@/composables/requestCoalescer";
import { eventRouter } from "@/api/eventRouter";

// const API: ServiceConfig = ApiConnection.config as ServiceConfig;

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

/** init() has no `inited` state guard; the router enforces single ownership,
 *  so guard the route registration at module level. */
let routesRegistered = false;

/** Single-flight guard for getAll(): the startup REST bootstrap (fired on
 *  authentication) and the first WebSocket session-established resync can call
 *  getAll() near-simultaneously; sharing the in-flight promise collapses that
 *  into one REST round (load-config-on-startup, ADR 0013). */
let getAllInFlight: Promise<CfgAll | null> | null = null;

/**
 * Carry the cached preview feature texts over to an incoming `features` array.
 *
 * The REST config delivers preview features with `title`, `description` and
 * `help_url`, the `configuration_change` event only with `id` and `enabled`.
 * Since arrays are replaced wholesale on merge (see mergeEventPayload), the
 * event after a toggle would otherwise strip the texts the preview features
 * screen renders, until the next full config load.
 */
function keepFeatureTexts(
  cached: CfgFeature[] | undefined,
  incoming: CfgFeature[],
): CfgFeature[] {
  if (!cached?.length) {
    return incoming;
  }
  const cachedById = new Map(cached.map((feature) => [feature.id, feature]));
  return incoming.map((feature) => ({
    ...cachedById.get(feature.id),
    ...feature,
  }));
}

function getList(lists: ConfigLists, type: SelectTypes) {
  if (type === SelectTypes.TimeZone) {
    return lists.tz;
  }
  if (type === SelectTypes.VoiceAssistant) {
    return lists.voiceAssistants;
  }
  if (type === SelectTypes.Language) {
    return lists.languages;
  }
  if (type === SelectTypes.Country) {
    return lists.countries;
  }
  if (type === SelectTypes.UnitSystem) {
    return lists.unitSystems;
  }
  return false;
}

export const configStore = defineStore("config", {
  state: () => ({
    config: null as CfgAll | null,
    error: null as string | null,
    updateError: null as string | null,
    deviceMeta: { device_name: "" } as DeviceMeta,
    wifiSettings: null as CfgWiFi | null,
    list: {
      tz: null as string[] | null,
      voiceAssistants: [] as VoiceAssistant[] | [],
      languages: null as LanguageListItem[] | null,
      countries: null as CountryListItem[] | null,
      unitSystems: null as MeasurementUnitList | null,
      buttonLayout: null as DeviceButtonLayout[] | null,
      screenLayout: null as DeviceScreenLayout | null,
      resourceTypes: null as SupportedResource[] | null,
    } as ConfigLists,
  }),
  actions: {
    init() {
      if (routesRegistered) {
        return;
      }
      routesRegistered = true;
      eventRouter.route(
        "configuration_change",
        undefined,
        (e) => {
          if (e.newState) {
            this.updateConfig(e.newState as Cfg);
          } else {
            coalesce("config:full", () =>
              Promise.all([
                ApiConnection.config.getAll().then((cfg) => {
                  this.$state.config = cfg;
                }),
                this.getWiFiSettings(true),
              ]),
            );
          }
        },
        { name: "config" },
      );
    },

    async getDeviceMeta(update = false): Promise<DeviceMeta> {
      if (!this.$state.deviceMeta || !this.$state.deviceMeta?.os || update) {
        this.$state.deviceMeta =
          (await ApiConnection.config.getDeviceMeta()) ??
          this.$state.deviceMeta;
      }
      return this.$state.deviceMeta || null;
    },

    async getDeviceName(update = false): Promise<string> {
      if (
        !this.$state.deviceMeta ||
        !this.$state.deviceMeta?.device_name ||
        update
      ) {
        this.$state.deviceMeta =
          (await ApiConnection.config.getDeviceMeta()) ??
          this.$state.deviceMeta;
      }
      return this.$state.deviceMeta?.device_name || "";
    },

    async getDeviceModel(update = false): Promise<string> {
      if (!this.$state.deviceMeta || !this.$state.deviceMeta?.model || update) {
        this.$state.deviceMeta =
          (await ApiConnection.config.getDeviceMeta()) ??
          this.$state.deviceMeta;
      }
      return this.$state.deviceMeta?.model || "";
    },

    async getWiFiSettings(update = false): Promise<CfgWiFi> {
      if (!this.$state.wifiSettings || update) {
        this.$state.wifiSettings =
          (await ApiConnection.config.getWiFiSettings()) ?? null;
      }
      return this.$state.wifiSettings || null;
    },

    async getVoiceAssistants(update = false): Promise<VoiceAssistant[]> {
      if (!this.$state.list || !this.$state.list?.voiceAssistants || update) {
        this.$state.list.voiceAssistants =
          (await ApiConnection.config.getVoiceAssistants()) ?? [];
      }
      return this.$state.list?.voiceAssistants || [];
    },

    async getAll(): Promise<CfgAll | null> {
      // Coalesce concurrent callers (startup bootstrap + first session resync)
      // onto one in-flight REST round.
      if (getAllInFlight) {
        return getAllInFlight;
      }
      getAllInFlight = (async (): Promise<CfgAll | null> => {
        try {
          const {
            cfg,
            tz,
            voiceAssistants,
            languages,
            countries,
            unitSystems,
            buttonLayout,
            screenLayout,
          } = await ApiConnection.config.loadAll();
          const deviceMeta = this.$state.deviceMeta as DeviceMeta;
          if (cfg.device?.name) {
            deviceMeta.device_name = cfg.device.name;
          }
          this.$state = {
            ...this.$state,
            config: cfg,
            deviceMeta,
            list: {
              ...this.$state.list,
              tz,
              voiceAssistants,
              languages,
              countries,
              unitSystems,
              buttonLayout,
              screenLayout,
            },
          };
          return this.$state.config;
        } catch (e) {
          this.$state.error = e as string;
          return null;
        }
      })();
      try {
        return await getAllInFlight;
      } finally {
        getAllInFlight = null;
      }
    },

    updateConfig(data: Cfg) {
      if (Array.isArray(data.features)) {
        data = {
          ...data,
          features: keepFeatureTexts(
            this.$state.config?.features,
            data.features as CfgFeature[],
          ),
        };
      }

      // In-place, partial-safe merge; arrays replaced wholesale (the former
      // updateExistingObjectKeys recursed into arrays by index, leaving stale
      // tail elements on shrunk lists — REVIEW-Claude-ws-events.md P1-1).
      if (this.$state.config) {
        mergeEventPayload(this.$state.config, data);
      } else {
        this.$state.config = data as CfgAll;
      }

      if (data && "voice" in data && this.$state.config) {
        this.$state.config.voice = data.voice as CfgVoice;
      }

      if (this.$state.config?.network?.wifi) {
        this.wifiSettings = this.$state.config?.network?.wifi;
      }
    },

    async update(
      group: string,
      name: string,
      value: unknown,
    ): Promise<CfgAll | null> {
      try {
        const resp: CfgAll = await ApiConnection.config.update(
          group,
          name,
          value,
        );
        if (resp.device?.name) {
          this.$state.deviceMeta.device_name = resp.device.name;
        }
        return resp;
      } catch (e) {
        this.$state.updateError = e as string;
        throw e;
      }
    },

    async updateByList(
      group: string,
      configs: ChangeCallbackParams[],
    ): Promise<CfgAll | null> {
      try {
        const resp: CfgAll = await ApiConnection.config.updateByList(
          group,
          configs,
        );
        if (resp.device?.name) {
          this.$state.deviceMeta.device_name = resp.device.name;
        }
        return resp;
      } catch (e) {
        this.$state.updateError = e as string;
        throw e;
      }
    },

    async baseUpdate(
      group: string,
      value: unknown,
    ): Promise<Array<any> | object | null> {
      try {
        const resp = await ApiConnection.config.baseUpdate(group, value);
        return resp;
      } catch (e) {
        this.$state.updateError = e as string;
        return null;
      }
    },

    async reset(): Promise<CfgAll | null> {
      try {
        await ApiConnection.config.reset();
        return this.getAll();
      } catch (e) {
        this.$state.updateError = e as string;
        return null;
      }
    },
  },
  getters: {
    options(state) {
      return (type: SelectTypes) => {
        return getList(state.list, type);
      };
    },
    optionValueLabel(state) {
      return (type: SelectTypes, value: string | number) => {
        const options: any = getList(state.list, type);
        console.log("TYPE", type, options);
        if (!options) {
          return null;
        }
        if (Array.isArray(options)) {
          const index = options.indexOf(value);
          if (index !== -1) {
            return value;
          }
        }
        return options[value] || null;
      };
    },
  },
});
