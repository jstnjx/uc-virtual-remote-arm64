import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  ActivityGroupNewData,
  ActivityGroup,
  ActivityGroupUpdate,
} from "@/types/activityGroup";
import type { ApiErrorResponse } from "@/types/rest";

export default class ServiceActivityGroups
  extends BaseService
  implements ServiceInterface
{
  async getAll(): Promise<ActivityGroup[]> {
    const response = await this.rest.request<ActivityGroup[]>({
      url: "/api/activity_groups?page=1&limit=100",
      method: "get",
    });
    return response.data || [];
  }

  async getActivityGroupsByPageByLimit(
    page = 1,
    limit = 100,
  ): Promise<{ data: ActivityGroup[]; headers: object }> {
    const baseGet = this.rest.baseGet<ActivityGroup[]>(
      {
        url: "/api/activity_groups",
        method: "get",
      },
      limit,
      page,
    );
    return baseGet;
  }

  async getActivityGroup(group_id: string): Promise<ActivityGroup> {
    const response = await this.rest.request<ActivityGroup>({
      url: `/api/activity_groups/${group_id}`,
      method: "get",
    });
    return response.data;
  }

  async createNewActivityGroup(
    data: ActivityGroupNewData,
  ): Promise<ActivityGroup> {
    const response = await this.rest.request<ActivityGroup>({
      url: "/api/activity_groups",
      method: "post",
      data,
    });
    return response.data;
  }

  async update(
    group_id: string,
    data: ActivityGroupUpdate,
  ): Promise<ActivityGroup> {
    const response = await this.rest.request<ActivityGroup>({
      url: `/api/activity_groups/${group_id}`,
      method: "patch",
      data,
    });
    return response.data;
  }

  async delete(data: ActivityGroup): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/activity_groups/${data.group_id}`,
      method: "delete",
    });
    return response.data?.code === "OK";
  }
}
