import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  Cfg,
  CfgAll,
  CfgWiFi,
  ConfigApiAll,
  CountryListItem,
  LanguageListItem,
  MeasurementUnitList,
  ChangeCallbackParams,
  DeviceMeta,
  VoiceAssistant,
} from "@/types/config";
import type {
  DeviceButtonLayout,
  DeviceScreenLayout,
  EntityCommandMetadata,
} from "@/types/activity";
import { CfgGroups } from "@/types/enums";

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace Intl {
  type Key =
    | "calendar"
    | "collation"
    | "currency"
    | "numberingSystem"
    | "timeZone"
    | "unit";

  function supportedValuesOf(input: Key): string[];
}

export default class ServiceConfig
  extends BaseService
  implements ServiceInterface
{
  protected cfg: CfgAll | null = null;

  protected commands: EntityCommandMetadata[] | null = null;

  async getAll(): Promise<CfgAll> {
    const response = await this.rest.request<CfgAll>({
      url: "/api/cfg",
      method: "get",
    });
    this.cfg = { ...response.data };
    return { ...this.cfg } as CfgAll;
  }

  async getDeviceMeta(): Promise<DeviceMeta> {
    const response = await this.rest.request<DeviceMeta>({
      method: "get",
      url: "/api/pub/version",
    });
    return response.data;
  }

  async loadAll(): Promise<ConfigApiAll> {
    const all = [
      this.getAll(),
      this.getTzNames(),
      this.getVoiceAssistants(),
      this.getLanguages(),
      this.getCountries(),
      this.getUnitSystem(),
      this.getCommandData(),
      this.getButtonLayout(),
      this.getScreenLayout(),
    ];
    return Promise.all(all).then((values: Awaited<any>) => {
      const [
        cfg,
        tz,
        voiceAssistants,
        languages,
        countries,
        unitSystems,
        commands,
        buttonLayout,
        screenLayout,
      ] = values;
      this.commands = commands;
      return {
        cfg,
        tz,
        voiceAssistants,
        languages,
        countries,
        unitSystems,
        buttonLayout,
        screenLayout,
      };
    });
  }

  async getTzNames(): Promise<string[]> {
    try {
      const response = await this.rest.request<string[]>({
        url: "/api/cfg/localization/tz_names",
        method: "get",
      });
      const apiList = response.data;

      if (Array.isArray(apiList) && apiList.length) {
        return apiList;
      }
    } catch {
      // @todo handle error.
    }
    const list: string[] = Array.from(Intl.supportedValuesOf("timeZone"));
    list.push("UTC");
    return list;
  }

  async getVoiceAssistants(): Promise<VoiceAssistant[]> {
    const response = await this.rest.request<VoiceAssistant[]>({
      url: "/api/cfg/voice_control/voice_assistants",
      method: "get",
    });
    return response.data || [];
  }

  async getLanguages(): Promise<LanguageListItem[]> {
    const response = await this.rest.request<{
      translations?: LanguageListItem[];
    }>({
      url: "/api/cfg/localization/translations",
      method: "get",
    });
    return (
      response.data?.translations || [
        {
          code: "en_US",
          name: "English (US)",
        },
      ]
    );
  }

  async getCountries(): Promise<CountryListItem[]> {
    const response = await this.rest.request<CountryListItem[]>({
      url: "/api/cfg/localization/countries",
      method: "get",
    });
    return response.data || [];
  }

  async getCommandData(update = false): Promise<EntityCommandMetadata[]> {
    if (!this.commands || update) {
      const response = await this.rest.request<EntityCommandMetadata[]>({
        url: "/api/cfg/entity/commands",
        method: "get",
      });
      this.commands = response.data;
    }
    return this.commands as EntityCommandMetadata[];
  }

  async getUnitSystem(): Promise<MeasurementUnitList> {
    return new Promise((resolve) => {
      resolve({
        METRIC: "measurement_units.metric",
        US: "measurement_units.us",
        UK: "measurement_units.uk",
      });
    });
  }

  async getWiFiSettings(): Promise<CfgWiFi> {
    const response = await this.rest.request<CfgWiFi>({
      url: "/api/cfg/network/wifi",
      method: "get",
    });
    return response.data;
  }

  protected getEndpoint(group: string): string {
    switch (group) {
      case CfgGroups.button:
        return "/api/cfg/button";
      case CfgGroups.bt:
        return "/api/cfg/bt";
      case CfgGroups.display:
        return "/api/cfg/display";
      case CfgGroups.sound:
        return "/api/cfg/sound";
      case CfgGroups.haptic:
        return "/api/cfg/haptic";
      case CfgGroups.voice_control:
        return "/api/cfg/voice_control";
      case CfgGroups.localization:
        return "/api/cfg/localization";
      case CfgGroups.network:
        return "/api/cfg/network";
      case CfgGroups.network_wifi:
        return "/api/cfg/network/wifi";
      case CfgGroups.power_saving:
        return "/api/cfg/power_saving";
      case CfgGroups.software_update:
        return "/api/cfg/software_update";
      case CfgGroups.device:
        return "/api/cfg/device";
      case CfgGroups.profile:
        return "/api/cfg/profile";
      case CfgGroups.features:
        return "/api/cfg/features";
    }
    return "/api/cfg";
  }

  async update(group: string, name: string, value: unknown): Promise<CfgAll> {
    const cfg = ({ ...this.cfg }?.[group] || {}) as Cfg;
    cfg[name] = value;

    const response = await this.rest.request<CfgAll>({
      url: this.getEndpoint(group),
      method: "patch",
      data: cfg,
    });
    return response.data;
  }

  async updateByList(
    group: string,
    configs: ChangeCallbackParams[],
  ): Promise<CfgAll> {
    const cfg = {} as Cfg;
    for (let index = 0; index < configs.length; index++) {
      const cfgName = configs[index].name;
      if (cfgName) {
        cfg[cfgName] = configs[index].value;
      }
    }

    const response = await this.rest.request<CfgAll>({
      url: this.getEndpoint(group),
      method: "patch",
      data: cfg,
    });
    return response.data;
  }

  async baseUpdate(group: string, data: unknown): Promise<CfgAll> {
    const response = await this.rest.request<CfgAll>({
      url: this.getEndpoint(group),
      method: "patch",
      data: data,
    });
    return response.data;
  }

  async reset() {
    await this.rest.request({
      url: "/api/cfg",
      method: "delete",
    });
    return this.getAll();
  }

  async getDeviceSettings(): Promise<Cfg> {
    const response = await this.rest.request<Cfg>({
      url: "/api/cfg/device",
      method: "get",
    });
    return response.data;
  }

  async getButtonLayout(): Promise<DeviceButtonLayout[]> {
    const response = await this.rest.request<DeviceButtonLayout[]>({
      url: "/api/cfg/device/button_layout",
      method: "get",
    });
    return response.data || [];
  }

  async getScreenLayout(): Promise<DeviceScreenLayout> {
    const response = await this.rest.request<DeviceScreenLayout>({
      url: "/api/cfg/device/screen_layout",
      method: "get",
    });
    return response.data;
  }
}
