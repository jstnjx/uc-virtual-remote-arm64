import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  Macro,
  MacroFull,
  MacroNewData,
  MacroUpdate,
} from "@/types/macro";
import type { ApiErrorResponse } from "@/types/rest";

/** Options for {@link ServiceMacros.getMacrosPaged} (P3-6 B). */
export interface MacrosPageQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export default class ServiceMacros
  extends BaseService
  implements ServiceInterface
{
  async getAll(): Promise<Macro[]> {
    const response = await this.rest.request<Macro[]>({
      url: "/api/macros?page=1&limit=100",
      method: "get",
    });
    return response.data || [];
  }

  async getItemNumber(): Promise<number> {
    const response = await this.rest.request({
      url: "/api/macros",
      method: "head",
    });
    return Number(response.headers["pagination-count"]) || 0;
  }

  /** Paged fetch of macros (P3-6 B). */
  async getMacrosPaged(
    options: MacrosPageQuery,
  ): Promise<{ data: Macro[]; headers: object }> {
    const { page = 1, limit = 100, search = "" } = options;
    const params: Record<string, unknown> = {};
    if (search && search.length > 0) {
      params.q = search;
    }

    return this.rest.baseGet<Macro[]>(
      {
        url: "/api/macros",
        method: "get",
        params: params,
      },
      limit,
      page,
    );
  }

  async getMacro(macro_id: string): Promise<MacroFull> {
    const response = await this.rest.request<MacroFull>({
      url: `/api/macros/${macro_id}`,
      method: "get",
    });
    return response.data;
  }

  async createNewMacro(data: MacroNewData): Promise<Macro> {
    const response = await this.rest.request<Macro>({
      url: "/api/macros",
      method: "post",
      data,
    });
    return response.data;
  }

  async cloneFrom(newMacro: MacroNewData, clone_from: string): Promise<Macro> {
    const data = {
      ...newMacro,
      clone_from,
    };
    return this.createNewMacro(data);
  }

  async update(macro_id: string, data: MacroUpdate): Promise<Macro> {
    const response = await this.rest.request<Macro>({
      url: `/api/macros/${macro_id}`,
      method: "patch",
      data,
    });
    return response.data;
  }

  async delete(data: Macro): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      url: `/api/macros/${data.entity_id}`,
      method: "delete",
    });
    return response.data?.code === "OK";
  }
}
