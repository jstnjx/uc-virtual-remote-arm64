import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";

import type {
  SystemInfo,
  WifiStatus,
  PowerStatus,
  BatteryStatus,
  StandbyInhibitor,
  NewStandbyInhibitor,
  CustomWebConfiguratorStatus,
} from "@/types/systemBase";
import type { ApiErrorResponse } from "@/types/rest";

export default class ServiceSystem
  extends BaseService
  implements ServiceInterface
{
  async restartRemote(): Promise<ApiErrorResponse> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: "/api/system?cmd=REBOOT",
      method: "post",
    });
    return response.data;
  }

  async getSystemInfo(): Promise<SystemInfo> {
    const response = await this.rest.request<SystemInfo>({
      url: "/api/system",
      method: "get",
    });
    return response.data;
  }

  async getWifiStatus(): Promise<WifiStatus> {
    const response = await this.rest.request<WifiStatus>({
      url: "/api/system/wifi",
      method: "get",
    });
    return response.data;
  }

  async getPowerStatus(): Promise<PowerStatus> {
    const response = await this.rest.request<PowerStatus>({
      url: "/api/system/power",
      method: "get",
    });
    return response.data;
  }

  async getBatteryStatus(): Promise<BatteryStatus> {
    const response = await this.rest.request<BatteryStatus>({
      url: "/api/system/power/battery",
      method: "get",
    });
    return response.data;
  }

  async getStandbyInhibitors(): Promise<StandbyInhibitor[]> {
    const response = await this.rest.request<StandbyInhibitor[]>({
      url: "/api/system/power/standby_inhibitors",
      method: "get",
    });
    return response.data || [];
  }

  async updateStandbyInhibitors(
    data: NewStandbyInhibitor,
  ): Promise<StandbyInhibitor[]> {
    const response = await this.rest.request<StandbyInhibitor[]>({
      url: "/api/system/power/standby_inhibitors",
      method: "post",
      data,
    });
    return response.data || [];
  }

  async removeStandbyInhibitor(id: string) {
    const response = await this.rest.request({
      url: `/api/system/power/standby_inhibitors/${id}`,
      method: "delete",
    });
    return response.data || {};
  }

  async getCustomWebConfigStatus(): Promise<CustomWebConfiguratorStatus> {
    const response = await this.rest.request<CustomWebConfiguratorStatus>({
      url: "/api/system/install/web_configurator",
      method: "get",
    });
    return response.data;
  }
}
