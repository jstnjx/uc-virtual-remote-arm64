import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  ResourceItem,
  SupportedResource,
  UploadResult,
} from "@/types/resources";
import type { ApiErrorResponse } from "@/types/rest";

const maxUploadTimeout =
  Number(import.meta.env.VITE_API_MAX_RESOURCE_UPLOAD_TIMEOUT ?? "") || 30000;

export default class ServiceResources
  extends BaseService
  implements ServiceInterface
{
  async getSupportedResources(): Promise<SupportedResource[]> {
    const response = await this.rest.request<SupportedResource[]>({
      url: "/api/resources",
      method: "get",
    });
    return response.data || [];
  }

  async loadItems(
    type: string,
    page = 1,
    limit = 100,
    searchText = "",
  ): Promise<{ data: ResourceItem[]; headers: object }> {
    const params: Record<string, unknown> = {};
    if (searchText && searchText.length > 0) {
      params.q = searchText;
    }

    const baseGet = this.rest.baseGet<ResourceItem[]>(
      {
        url: `/api/resources/${type}`,
        method: "get",
        params: params,
      },
      limit,
      page,
    );
    return baseGet;
  }

  async upload(type: string, files: File[]): Promise<UploadResult> {
    const data = new FormData();
    for (const file of files) {
      data.append("file", file);
    }
    const response = await this.rest.request<ResourceItem>(
      {
        method: "post",
        url: `/api/resources/${type}`,
        data,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
      maxUploadTimeout,
    );
    return {
      success: true,
      response: response.data,
    };
  }

  async deleteResource(file: ResourceItem): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/resources/${file.type}/${file.id}`,
    });
    return response.data?.code === "OK";
  }
}
