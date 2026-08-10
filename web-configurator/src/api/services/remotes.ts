import BaseService from "@/api/services/BaseService";

import type { RemoteKind } from "@/types/enums";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  Remote,
  RemoteFull,
  RemoteNewData,
  RemoteUpdate,
  RemoteUpdateCheck,
} from "@/types/remote";
import type { BluetoothRemote } from "@/types/bluetooth";
import type { IrCodeDefinition, RemoteDataSet, RemoteIrCode } from "@/types/ir";
import type {
  ActivityUserInterfacePage,
  NewActivityUserInterfacePage,
  ActivityUserInterfacePageUpdate,
  DeviceButtonMapping,
} from "@/types/activity";

import type { ButtonMappingPressType } from "@/types/enums";
import type { ApiErrorResponse } from "@/types/rest";

export default class ServiceRemotes
  extends BaseService
  implements ServiceInterface
{
  async getAll(kind?: RemoteKind): Promise<Remote[]> {
    const paramKind = kind ? `&kind=${kind}` : "";
    const response = await this.rest.request<Remote[]>({
      url: "/api/remotes?page=1&limit=100" + paramKind,
      method: "get",
    });
    return response.data || [];
  }

  async getRemotesByPageByLimit(
    kind = "",
    reload = false,
    page = 1,
    limit = 100,
    searchText = "",
  ): Promise<{ data: Remote[]; headers: object }> {
    const params: Record<string, unknown> = {};
    params.reload = reload;
    if (kind && kind.length > 0) {
      params.kind = kind;
    }
    if (searchText && searchText.length > 0) {
      params.q = searchText;
    }

    const baseGet = this.rest.baseGet<Remote[]>(
      {
        url: "/api/remotes",
        method: "get",
        params: params,
      },
      limit,
      page,
    );
    return baseGet;
  }

  async getItemNumber(kind?: RemoteKind): Promise<number> {
    const paramKind = kind ? `?kind=${kind}` : "";
    const response = await this.rest.request({
      url: "/api/remotes" + paramKind,
      method: "head",
    });
    return Number(response.headers["pagination-count"]) || 0;
  }

  async createNewRemote(data: RemoteNewData): Promise<Remote> {
    const response = await this.rest.request<Remote>({
      url: "/api/remotes",
      method: "post",
      data,
    });
    return response.data;
  }

  async update(entity_id: string, data: RemoteUpdate): Promise<Remote> {
    const response = await this.rest.request<Remote>({
      url: `/api/remotes/${entity_id}`,
      method: "patch",
      data,
    });
    return response.data;
  }

  async delete(remote: Remote | BluetoothRemote): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/remotes/${remote.entity_id}`,
      method: "delete",
    });
    return response.data?.code === "OK";
  }

  async getRemote(entity_id: string): Promise<RemoteFull> {
    const response = await this.rest.request<RemoteFull>({
      url: `/api/remotes/${entity_id}`,
      method: "get",
    });
    return response.data;
  }

  async getRemoteIrCodes(entity_id: string): Promise<RemoteDataSet> {
    const response = await this.rest.request<RemoteDataSet>({
      method: "get",
      url: `/api/remotes/${entity_id}/ir`,
    });
    return response.data;
  }

  async addCustomCodeToSet(
    entity_id: string,
    cmd_id: string,
    code: IrCodeDefinition,
  ): Promise<RemoteIrCode> {
    const response = await this.rest.request<RemoteIrCode>({
      method: "post",
      url: `/api/remotes/${entity_id}/ir/${encodeURIComponent(cmd_id)}`,
      data: code,
    });
    return response.data;
  }

  async getCustomCode(
    entity_id: string,
    cmd_id: string,
  ): Promise<RemoteIrCode> {
    const response = await this.rest.request<RemoteIrCode>({
      method: "get",
      url: `/api/remotes/${entity_id}/ir/${encodeURIComponent(cmd_id)}`,
    });
    return response.data;
  }

  async modifyCustomCodeToSet(
    entity_id: string,
    cmd_id: string,
    code: IrCodeDefinition,
  ): Promise<RemoteIrCode> {
    const response = await this.rest.request<RemoteIrCode>({
      method: "patch",
      url: `/api/remotes/${entity_id}/ir/${encodeURIComponent(cmd_id)}`,
      data: code,
    });
    return response.data;
  }

  async removeCustomCodeFromSet(
    entity_id: string,
    cmd_id: string,
  ): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/remotes/${entity_id}/ir/${encodeURIComponent(cmd_id)}`,
      method: "delete",
    });
    return response.data?.code === "OK";
  }

  async addUiPage(
    remote: Remote,
    data: NewActivityUserInterfacePage,
  ): Promise<ActivityUserInterfacePage> {
    const response = await this.rest.request<ActivityUserInterfacePage>({
      url: `/api/remotes/${remote.entity_id}/ui/pages`,
      method: "post",
      data,
    });
    return response.data;
  }

  async updateUiPageOrder(remote: Remote, page_order: string[]) {
    const response = await this.rest.request({
      url: `/api/remotes/${remote.entity_id}/ui/pages`,
      method: "patch",
      data: {
        page_order: page_order,
      },
    });
    return response.data || {};
  }

  async getPages(remote: Remote): Promise<ActivityUserInterfacePage[]> {
    const params = {};

    const response = await this.rest.request<ActivityUserInterfacePage[]>({
      url: `/api/remotes/${remote.entity_id}/ui/pages`,
      method: "get",
      params,
    });
    return response.data || [];
  }

  async deleteUiPage(remote_id: string, page_id: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/remotes/${remote_id}/ui/pages/${page_id}`,
    });
    return response.data?.code === "OK";
  }

  async updateUiPage(remote_id: string, page: ActivityUserInterfacePageUpdate) {
    const response = await this.rest.request<ActivityUserInterfacePage>({
      method: "patch",
      url: `/api/remotes/${remote_id}/ui/pages/${page.page_id}`,
      data: page,
    });
    return response.data;
  }

  async allUiReset(remote_id: string) {
    const response = await this.rest.request({
      method: "delete",
      url: `/api/remotes/${remote_id}/ui`,
    });
    return response.data;
  }

  async buttonUpdate(
    remote_id: string,
    button: string,
    command: string,
    pressType: ButtonMappingPressType,
  ) {
    if (!pressType) {
      throw new Error("Parameter 'pressType' is required!");
    }

    const data: DeviceButtonMapping = {
      button,
    };

    if (pressType) {
      data[pressType] = { cmd_id: command };
    }

    const response = await this.rest.request({
      method: "patch",
      url: `/api/remotes/${remote_id}/buttons/${button}`,
      data,
    });
    return response.data;
  }

  async buttonReset(
    remote_id: string,
    button: string,
    pressType?: ButtonMappingPressType,
  ) {
    const response = await this.rest.request({
      method: "delete",
      url: `/api/remotes/${remote_id}/buttons/${button}${
        pressType ? "/" + pressType : ""
      }`,
    });
    return response.data;
  }

  async allButtonsMerge(remote_id: string, data: DeviceButtonMapping[]) {
    const response = await this.rest.request({
      method: "patch",
      url: `/api/remotes/${remote_id}/buttons`,
      data,
    });
    return response.data;
  }

  async allButtonsUpdate(remote_id: string, data: DeviceButtonMapping[]) {
    const response = await this.rest.request({
      method: "post",
      url: `/api/remotes/${remote_id}/buttons`,
      data,
    });
    return response.data;
  }

  async allButtonsReset(remote_id: string) {
    const response = await this.rest.request({
      method: "delete",
      url: `/api/remotes/${remote_id}/buttons`,
    });
    return response.data;
  }

  async getUpdateStatus(
    dock_id: string,
    forcedCheck = false,
  ): Promise<RemoteUpdateCheck> {
    let methodType = "get";
    if (forcedCheck === true) {
      methodType = "put";
    }

    const response = await this.rest.request<RemoteUpdateCheck>({
      method: methodType,
      url: `/api/remotes/${dock_id}/update`,
    });
    return response.data;
  }

  async startUpgrade(remote_id: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "post",
      url: `/api/remotes/${remote_id}/update`,
    });

    return response.data.code === "OK";
  }

  async abortUpgrade(remote_id: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/remotes/${remote_id}/update`,
    });

    return response.data.code === "OK";
  }
}
