import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";

export default class ServiceFactoryReset
  extends BaseService
  implements ServiceInterface
{
  async getToken(): Promise<string> {
    const response = await this.rest.request<{ token?: string }>({
      url: "/api/system/factory_reset",
      method: "get",
    });
    const data = response.data;
    return data.token || "";
  }

  async doReset(token: string) {
    const response = await this.rest.request({
      url: "/api/system/factory_reset",
      method: "post",
      params: {
        token,
      },
      data: {
        token,
      },
    });
    return response.data;
  }
}
