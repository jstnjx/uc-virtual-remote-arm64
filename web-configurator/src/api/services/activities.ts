import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  Activity,
  ActivityFull,
  ActivityNewData,
  ActivityUpdate,
  ActivityUserInterfacePage,
  NewActivityUserInterfacePage,
  ActivityUserInterfacePageUpdate,
  EntityCommand,
  DeviceButtonMapping,
} from "@/types/activity";

import type { ButtonMappingPressType } from "@/types/enums";
import type { ApiErrorResponse } from "@/types/rest";

export default class ServiceActivities
  extends BaseService
  implements ServiceInterface
{
  async getAll(): Promise<Activity[]> {
    const response = await this.rest.request<Activity[]>({
      url: "/api/activities?page=1&limit=100",
      method: "get",
    });
    return response.data || [];
  }

  async getItemNumber(): Promise<number> {
    const response = await this.rest.request({
      url: "/api/activities",
      method: "head",
    });
    return Number(response.headers["pagination-count"]) || 0;
  }

  async getActivitiesByPageByLimit(
    page = 1,
    limit = 100,
    searchText = "",
    in_group: boolean | undefined = undefined,
  ): Promise<{ data: Activity[]; headers: object }> {
    const params: Record<string, unknown> = {};
    params.in_group = in_group;

    if (searchText && searchText.length > 0) {
      params.q = searchText;
    }

    if (in_group !== undefined) {
      params.in_group = in_group;
    }

    const baseGet = this.rest.baseGet<Activity[]>(
      {
        url: "/api/activities",
        method: "get",
        params: params,
      },
      limit,
      page,
    );
    return baseGet;
  }

  async getActivitiesByPage(
    page = 1,
    searchText = "",
    in_group: boolean | undefined = undefined,
  ): Promise<{ data: Activity[]; headers: object }> {
    const params: Record<string, unknown> = {};
    params.in_group = in_group;

    if (searchText && searchText.length > 0) {
      params.q = searchText;
    }

    if (in_group !== undefined) {
      params.in_group = in_group;
    }

    const baseGet = this.rest.baseGet<Activity[]>(
      {
        url: "/api/activities",
        method: "get",
        params: params,
      },
      100,
      page,
    );
    return baseGet;
  }

  async getActivity(activity_id: string): Promise<ActivityFull> {
    const response = await this.rest.request<ActivityFull>({
      url: `/api/activities/${activity_id}`,
      method: "get",
    });
    return response.data;
  }

  async createNewActivity(data: ActivityNewData): Promise<Activity> {
    const response = await this.rest.request<Activity>({
      url: "/api/activities",
      method: "post",
      data,
    });
    return response.data;
  }

  async cloneFrom(
    newActivity: ActivityNewData,
    clone_from: string,
  ): Promise<Activity> {
    const data = {
      ...newActivity,
      clone_from,
    };
    return this.createNewActivity(data);
  }

  async update(activity_id: string, data: ActivityUpdate): Promise<Activity> {
    const response = await this.rest.request<Activity>({
      url: `/api/activities/${activity_id}`,
      method: "patch",
      data,
    });
    return response.data;
  }

  async delete(data: Activity): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/activities/${data.entity_id}`,
      method: "delete",
    });
    return response.data?.code === "OK";
  }

  async addUiPage(
    activity: Activity,
    data: NewActivityUserInterfacePage,
  ): Promise<ActivityUserInterfacePage> {
    const response = await this.rest.request<ActivityUserInterfacePage>({
      url: `/api/activities/${activity.entity_id}/ui/pages`,
      method: "post",
      data,
    });
    return response.data;
  }

  async deleteUiPage(activity_id: string, page_id: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/activities/${activity_id}/ui/pages/${page_id}`,
    });
    return response.data?.code === "OK";
  }

  async updateUiPage(
    activity_id: string,
    page: ActivityUserInterfacePageUpdate,
  ) {
    const response = await this.rest.request<ActivityUserInterfacePage>({
      method: "patch",
      url: `/api/activities/${activity_id}/ui/pages/${page.page_id}`,
      data: page,
    });
    return response.data;
  }

  async updateUiPageOrder(activity: Activity, page_order: string[]) {
    const response = await this.rest.request({
      url: `/api/activities/${activity.entity_id}/ui/pages`,
      method: "patch",
      data: {
        page_order: page_order,
      },
    });
    return response.data || {};
  }

  async allUiReset(activity_id: string) {
    const response = await this.rest.request({
      method: "delete",
      url: `/api/activities/${activity_id}/ui`,
    });
    return response.data;
  }

  async getPages(activity: Activity): Promise<ActivityUserInterfacePage[]> {
    const params = {};

    const response = await this.rest.request<ActivityUserInterfacePage[]>({
      url: `/api/activities/${activity.entity_id}/ui/pages`,
      method: "get",
      params,
    });
    return response.data || [];
  }

  async buttonUpdate(
    activity_id: string,
    button: string,
    command: EntityCommand,
    pressType: ButtonMappingPressType,
  ) {
    if (!pressType) {
      throw new Error("Parameter 'pressType' is required!");
    }

    const data: DeviceButtonMapping = {
      button,
    };

    if (pressType) {
      data[pressType] = command;
    }

    const response = await this.rest.request({
      method: "patch",
      url: `/api/activities/${activity_id}/buttons/${button}`,
      data,
    });
    return response.data;
  }

  async buttonReset(
    activity_id: string,
    button: string,
    pressType?: ButtonMappingPressType,
  ) {
    const response = await this.rest.request({
      method: "delete",
      url: `/api/activities/${activity_id}/buttons/${button}${
        pressType ? "/" + pressType : ""
      }`,
    });
    return response.data;
  }

  async allButtonsMerge(activity_id: string, data: DeviceButtonMapping[]) {
    const response = await this.rest.request({
      method: "patch",
      url: `/api/activities/${activity_id}/buttons`,
      data,
    });
    return response.data;
  }

  async allButtonsUpdate(activity_id: string, data: DeviceButtonMapping[]) {
    const response = await this.rest.request({
      method: "post",
      url: `/api/activities/${activity_id}/buttons`,
      data,
    });
    return response.data;
  }

  async allButtonsReset(activity_id: string) {
    const response = await this.rest.request({
      method: "delete",
      url: `/api/activities/${activity_id}/buttons`,
    });
    return response.data;
  }
}
