import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type { LogsBoots, LogsParamsDownload, LogsServices } from "@/types/logs";

import { useUrlHelper } from "@/composables/urlHelper";
const { addParams } = useUrlHelper();

export default class ServiceLogs
  extends BaseService
  implements ServiceInterface
{
  async getBoots(): Promise<LogsBoots[]> {
    const response = await this.rest.request<LogsBoots[]>({
      url: "/api/system/logs/boots",
      method: "get",
    });
    const data = response.data;
    return data || [];
  }

  async getServices(): Promise<LogsServices[]> {
    const response = await this.rest.request<LogsServices[]>({
      url: "/api/system/logs/services",
      method: "get",
    });
    const data = response.data;
    return data || [];
  }

  async downloadLogs(params: LogsParamsDownload): Promise<any> {
    const headers = {
      //'accept': 'text/plain',
      "Content-Type": "text/plain",
    };

    let url = "/api/system/logs";
    url = addParams(params, url);

    const response = await this.rest.request<Blob>({
      url: url,
      method: "get",
      data: {}, // It's necessary for send headers
      responseType: "blob",
      headers: headers,
    });
    return { data: response.data, headers: response.headers };
  }
}
