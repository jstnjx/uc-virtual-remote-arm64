import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type { SystemUpdateCheck } from "@/types/update";

export default class ServiceSystemUpdate
  extends BaseService
  implements ServiceInterface
{
  async getUpdateStatus(forcedCheck = false): Promise<SystemUpdateCheck> {
    let methodType = "get";
    if (forcedCheck === true) {
      methodType = "put";
    }

    const response = await this.rest.request<SystemUpdateCheck>({
      method: methodType,
      url: `/api/system/update`,
    });
    return response.data;
  }

  async doUpdate(update_id: string): Promise<any> {
    const data = {};
    const response = await this.rest.request({
      url: `api/system/update/${update_id}`,
      method: "post",
      data,
    });
    return response.data || {};
  }
}
