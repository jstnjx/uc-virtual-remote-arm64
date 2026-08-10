import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";

import type {
  ExternalSystem,
  ExternalSystemQueryParams,
  ApplicationCredentialNewData,
} from "@/types/externalToken";
import type { ApiErrorResponse } from "@/types/rest";

export default class ServiceAuthExternal
  extends BaseService
  implements ServiceInterface
{
  async getExternalSystems(
    params: ExternalSystemQueryParams = {},
  ): Promise<ExternalSystem[]> {
    const response = await this.rest.request<ExternalSystem[]>({
      url: "/api/auth/external",
      method: "get",
      params,
    });
    return response.data;
  }

  async createNewApplicationCredential(
    data: ApplicationCredentialNewData,
    systemId: string,
  ): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/auth/external/${systemId}`,
      method: "post",
      data,
    });
    return response.data?.code === "OK";
  }

  async deleteAccessTokens(systemId: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/auth/external/${systemId}`,
      method: "delete",
    });
    return response.data?.code === "OK";
  }
}
