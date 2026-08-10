import BaseService from "@/api/services/BaseService";
import { DockCommandType } from "@/types/enums";

import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  DockCommand,
  DockConfiguration,
  DockConfigurationChange,
  DockConfigurationList,
  DockDiscovery,
  DockDiscoveryList,
  DockDiscoveryStatusResponse,
  DockUpdateCheck,
  DockSetupInfo,
  DockSetup,
  DockPort,
  DockPortChange,
} from "@/types/dock";
import type { ApiErrorResponse } from "@/types/rest";

export default class ServiceDocks
  extends BaseService
  implements ServiceInterface
{
  async getDockList(): Promise<DockConfigurationList> {
    const params = {
      url: "/api/docks",
      method: "get",
    };
    const active = this.rest.pagedGet<DockConfiguration>(
      {
        ...params,
        params: { active: true },
      },
      50,
    );
    const inactive = this.rest.pagedGet<DockConfiguration>(
      {
        ...params,
        params: { active: false },
      },
      50,
    );
    const result: DockConfigurationList = {};
    const responses = await Promise.all([active, inactive]);
    responses.forEach((docks: DockConfiguration[]) => {
      docks.forEach((dock: DockConfiguration) => {
        result[dock.dock_id] = dock;
      });
    });
    return result;
  }

  async identifyDock(dock_id: string): Promise<boolean> {
    return this.sendDockCommand(dock_id, {
      command: DockCommandType.IDENTIFY,
    });
  }

  async factoryReset(dock_id: string): Promise<boolean> {
    return this.sendDockCommand(dock_id, {
      command: DockCommandType.RESET,
    });
  }

  async removeDock(dock_id: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/docks/devices/${dock_id}`,
    });
    return response.data.code === "OK";
  }

  async setDockBrightness(dock_id: string, value: number): Promise<boolean> {
    return this.sendDockCommand(dock_id, {
      command: DockCommandType.SET_LED_BRIGHTNESS,
      value: String(Math.round(value)),
    });
  }

  async sendDockCommand(
    dock_id: string,
    command: DockCommand,
  ): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/docks/devices/${dock_id}/command`,
      method: "post",
      data: command,
    });
    return response.data.code === "OK";
  }

  async getDock(dock_id: string): Promise<DockConfiguration> {
    const response = await this.rest.request<DockConfiguration>({
      url: `/api/docks/devices/${dock_id}`,
      method: "get",
    });
    return response.data;
  }

  async updateDock(
    dock_id: string,
    changes: DockConfigurationChange,
  ): Promise<DockConfiguration> {
    const response = await this.rest.request<DockConfiguration>({
      url: `/api/docks/devices/${dock_id}`,
      method: "patch",
      data: changes,
    });
    return response.data;
  }

  async updateDockPort(
    dock_id: string,
    port_id: number,
    changes: DockPortChange,
  ): Promise<DockPort> {
    const response = await this.rest.request<DockPort>({
      url: `/api/docks/devices/${dock_id}/ports/${port_id}`,
      method: "patch",
      data: changes,
    });
    return response.data;
  }

  async getUpdateStatus(
    dock_id: string,
    forcedCheck = false,
  ): Promise<DockUpdateCheck> {
    let methodType = "get";
    if (forcedCheck === true) {
      methodType = "put";
    }

    const response = await this.rest.request<DockUpdateCheck>({
      method: methodType,
      url: `/api/docks/devices/${dock_id}/update`,
    });
    return response.data;
  }

  async startUpgrade(dock_id: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "post",
      url: `/api/docks/devices/${dock_id}/update`,
    });

    return response.data.code === "OK";
  }

  async abortUpgrade(dock_id: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/docks/devices/${dock_id}/update`,
    });

    return response.data.code === "OK";
  }

  async startDiscovery(): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "put",
      url: "/api/docks/discover",
    });
    return response.data.code === "OK";
  }

  async stopDiscovery(): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: "/api/docks/discover",
    });
    return response.data.code === "OK";
  }

  async getDiscoveryStatus(): Promise<DockDiscoveryStatusResponse> {
    const response = await this.rest.request<{
      active: boolean;
      docks: DockDiscovery[];
    }>({
      method: "get",
      url: "/api/docks/discover",
    });
    const discovered: DockDiscoveryList = {};
    response.data.docks.forEach((dock: DockDiscovery) => {
      discovered[dock.id] = dock;
    });
    return {
      active: response.data.active,
      discovered,
    };
  }

  async getDockStatus(dock_id: string): Promise<DockSetupInfo> {
    const response = await this.rest.request<DockSetupInfo>({
      method: "get",
      url: `/api/docks/setup/${dock_id}`,
    });
    return response.data;
  }

  async startSetupDiscoveredSetup(
    discovery: DockDiscovery,
  ): Promise<DockSetupInfo> {
    const response = await this.rest.request<DockSetupInfo>({
      method: "post",
      url: "/api/docks/setup",
      data: {
        discovery,
      },
    });
    return this.getDockStatus(response.data.id);
  }

  async startSetupManualSetup(dock: DockSetup): Promise<DockSetupInfo> {
    const response = await this.rest.request<DockSetupInfo>({
      method: "post",
      url: "/api/docks/setup",
      data: {
        manually: { ...dock },
      },
    });
    return this.getDockStatus(response.data.id);
  }

  async startDockSetupProcess(
    dock_id: string,
    setup: DockSetup,
  ): Promise<DockSetupInfo> {
    const response = await this.rest.request<DockSetupInfo>({
      method: "put",
      url: `/api/docks/setup/${dock_id}`,
      data: {
        ...setup,
      },
    });
    return response.data;
  }

  async startSetupProcess(
    dock_id: string,
    dock_setup: DockSetup,
  ): Promise<DockSetupInfo> {
    const response = await this.rest.request<DockSetupInfo>({
      method: "put",
      url: `/api/docks/setup/${dock_id}`,
      data: dock_setup,
    });

    return response.data;
  }

  async cancelSetup(dock_id: string): Promise<boolean> {
    try {
      const response = await this.rest.request<ApiErrorResponse>({
        method: "delete",
        url: `/api/docks/setup/${dock_id}`,
      });
      return response.data.code === "OK";
    } catch (e) {
      if (this.rest.isNotFoundError(e)) {
        return true;
      }
      throw e;
    }
  }
}
