import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  AvailableEntity,
  ConfiguredEntity,
  DriverConnectionTestResult,
  DriverId,
  EntityRequest,
  IntegrationDriver,
  IntegrationDriverInfo,
  IntegrationDriverUpdate,
  IntegrationInstance,
  IntegrationRequest,
  IntegrationSetupData,
  IntegrationSetupDataInput,
  IntegrationSetupInfo,
  IntegrationStatus,
  NewIntegrationData,
} from "@/types/integrationInstance";
import type { MediaItem } from "@/types/media";
import type { ApiErrorResponse } from "@/types/rest";
import type { RawAxiosRequestConfig } from "axios";
import { DriverType } from "@/types/enums";

/** Options for {@link ServiceIntegrations.getAvailableEntitiesPaged} (P3-6 B). */
export interface AvailableEntitiesPageQuery {
  integrationId?: string;
  reload?: boolean;
  page?: number;
  limit?: number;
  filter?: string;
  search?: string;
  types?: string;
}

/** Options for {@link ServiceIntegrations.getConfiguredEntitiesPaged} (P3-6 B). */
export interface ConfiguredEntitiesPageQuery {
  integrationIds?: string;
  reload?: boolean;
  page?: number;
  limit?: number;
  search?: string;
  types?: string;
  exclude?: string;
}

// The correctly spelled variable wins; the misspelled "INTEGRATON" name is
// still read as a fallback for operators who have it set (deprecated).
const maxUploadTimeout =
  Number(
    import.meta.env.VITE_API_MAX_IMPORT_INTEGRATION_TIMEOUT ??
      import.meta.env.VITE_API_MAX_IMPORT_INTEGRATON_TIMEOUT ??
      "",
  ) || 180000;

export default class ServiceIntegrations
  extends BaseService
  implements ServiceInterface
{
  async getConfiguredEntityNumber(): Promise<number> {
    const response = await this.rest.request({
      url: "/api/entities",
      method: "head",
    });
    return Number(response.headers["pagination-count"]) || 0;
  }

  async getIntegrationStatuses(): Promise<IntegrationStatus[]> {
    return this.rest.pagedGet<IntegrationStatus>(
      {
        url: "/api/intg",
        method: "get",
        params: {
          enabled: true,
        },
      },
      50,
    );
  }

  async getInstances(): Promise<IntegrationInstance[]> {
    return this.rest.pagedGet<IntegrationInstance>(
      {
        url: "/api/intg/instances",
        method: "get",
        params: {
          enabled: true,
        },
      },
      50,
    );
  }
  async getEnabledDrivers(): Promise<IntegrationDriverInfo[]> {
    return this.getDrivers({
      enabled: true,
    });
  }
  async getInstantiableDrivers(): Promise<IntegrationDriverInfo[]> {
    return this.getDrivers({
      instantiable: true,
      enabled: true,
    });
  }
  async getNotConfiguredDrivers(): Promise<IntegrationDriverInfo[]> {
    return this.getDrivers({
      has_instances: false,
      enabled: true,
    });
  }

  async getNotConfiguredCustomDrivers(): Promise<IntegrationDriverInfo[]> {
    return this.getDrivers({
      driver_type: DriverType.CUSTOM,
      has_instances: false,
      enabled: true,
    });
  }

  async getNotConfiguredExternalDrivers(): Promise<IntegrationDriverInfo[]> {
    return this.getDrivers({
      driver_type: DriverType.EXTERNAL,
      has_instances: false,
      enabled: true,
    });
  }

  protected async getDrivers(params = {}): Promise<IntegrationDriverInfo[]> {
    return await this.rest.pagedGet<IntegrationDriverInfo>(
      {
        url: "/api/intg/drivers",
        method: "get",
        params,
      },
      50,
    );
  }

  async getEntities(
    integration_id: string,
    filter: string,
    reload = false,
  ): Promise<AvailableEntity[]> {
    const params: Record<string, unknown> = {};
    params.reload = reload;
    if (filter && filter.length > 0) {
      params.filter = filter;
    }
    return this.rest.pagedGet<AvailableEntity>(
      {
        url: `/api/intg/instances/${integration_id}/entities`,
        method: "get",
        params: params,
      },
      50,
    );
  }

  /**
   * Paged fetch of an integration instance's available entities (P3-6 B). One
   * method for the former `getEntitiesByPageByLimit` / `getEntitiesByPage`
   * pair, which differed only in the `limit` passed to `baseGet`; the caller
   * now passes it explicitly.
   */
  async getAvailableEntitiesPaged(
    options: AvailableEntitiesPageQuery,
  ): Promise<{ data: AvailableEntity[]; headers: object }> {
    const {
      integrationId = "",
      reload = false,
      page = 1,
      limit = 100,
      filter = "NEW",
      search = "",
      types = "",
    } = options;
    const params: Record<string, unknown> = {};
    params.reload = reload;
    if (filter && filter.length > 0) {
      params.filter = filter;
    }
    if (search && search.length > 0) {
      params.q = search;
    }
    if (types && types.length > 0) {
      params.entity_types = types;
    }

    return this.rest.baseGet<AvailableEntity[]>(
      {
        url: `/api/intg/instances/${integrationId}/entities`,
        method: "get",
        params: params,
      },
      limit,
      page,
    );
  }

  /**
   * Paged fetch of configured entities (P3-6 B). One method for the former
   * `getConfiguredEntitiesByPageByLimit` / `getConfiguredEntitiesByPage` pair,
   * which differed only in the `limit` passed to `baseGet` and the `exclude`
   * param (absent → omitted anyway).
   */
  async getConfiguredEntitiesPaged(
    options: ConfiguredEntitiesPageQuery,
  ): Promise<{ data: ConfiguredEntity[]; headers: object }> {
    const {
      integrationIds = "",
      reload = false,
      page = 1,
      limit = 100,
      search = "",
      types = "",
      exclude = "",
    } = options;
    const params: Record<string, unknown> = {};
    params.reload = reload;
    if (integrationIds && integrationIds.length > 0) {
      params.intg_ids = integrationIds;
    }
    if (search && search.length > 0) {
      params.q = search;
    }
    if (types && types.length > 0) {
      params.entity_types = types;
    }
    if (exclude && exclude.length > 0) {
      params.exclude = exclude;
    }

    return this.rest.baseGet<ConfiguredEntity[]>(
      {
        url: "/api/entities",
        method: "get",
        params: params,
      },
      limit,
      page,
    );
  }

  async getConfiguredEntities(
    intg_id: string | null = null,
  ): Promise<ConfiguredEntity[]> {
    const params: Record<string, unknown> = {};
    if (intg_id) {
      params.intg_id = intg_id;
    }
    return this.rest.pagedGet<ConfiguredEntity>(
      {
        url: "/api/entities",
        method: "get",
        params,
      },
      50,
    );
  }

  async getConfiguredEntitiesByTypes(
    entityTypes: string,
  ): Promise<ConfiguredEntity[]> {
    const params: Record<string, unknown> = {};
    if (entityTypes && entityTypes.length > 0) {
      params.entity_types = entityTypes;
    }
    return this.rest.pagedGet<ConfiguredEntity>(
      {
        url: `/api/entities`,
        method: "get",
        params: params,
      },
      50,
    );
  }

  async addIntegration(
    driver_id: DriverId,
    data: NewIntegrationData,
  ): Promise<IntegrationInstance> {
    const response = await this.rest.request<IntegrationInstance>({
      url: `/api/intg/drivers/${driver_id}`,
      method: "post",
      data,
    });
    return response.data;
  }

  async updateIntegration(
    inst_id: string,
    data: IntegrationRequest,
  ): Promise<IntegrationInstance> {
    const response = await this.rest.request<IntegrationInstance>({
      url: `/api/intg/instances/${inst_id}`,
      method: "patch",
      data,
    });
    return response.data;
  }

  async getIntegration(inst_id: string): Promise<IntegrationInstance> {
    const response = await this.rest.request<IntegrationInstance>({
      method: "get",
      url: `/api/intg/instances/${inst_id}`,
    });
    return response.data;
  }

  async getDriver(driver_id: string): Promise<IntegrationDriver> {
    const response = await this.rest.request<IntegrationDriver>({
      method: "get",
      url: `/api/intg/drivers/${driver_id}`,
    });
    return response.data;
  }

  async addInstanceEntity(
    inst: IntegrationInstance,
    entity: AvailableEntity,
  ): Promise<ConfiguredEntity> {
    const response = await this.rest.request<ConfiguredEntity>({
      method: "post",
      url: `/api/intg/instances/${inst.integration_id}/entities/${entity.entity_id}`,
      data: {
        name: entity.name,
      },
    });
    return response.data;
  }

  async addInstanceEntities(
    inst: IntegrationInstance,
    entity_ids: string[],
  ): Promise<string[]> {
    const data = entity_ids;
    const response = await this.rest.request<string[]>({
      method: "post",
      url: `/api/intg/instances/${inst.integration_id}/entities`,
      data: data,
    });
    return response.data;
  }

  async getEntity(entity_id: string): Promise<ConfiguredEntity> {
    const response = await this.rest.request<ConfiguredEntity>({
      method: "get",
      url: `/api/entities/${entity_id}`,
    });
    return response.data;
  }

  async updateEntity(
    entity_id: string,
    changes: EntityRequest,
  ): Promise<ConfiguredEntity> {
    const response = await this.rest.request<ConfiguredEntity>({
      method: "patch",
      url: `/api/entities/${entity_id}`,
      data: changes,
    });
    return response.data;
  }

  async removeEntity(entity: ConfiguredEntity): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/entities/${entity.entity_id}`,
    });
    return response.data?.code === "OK";
  }

  async removeEntities(entity_ids: string[]): Promise<boolean> {
    const data = {
      entity_ids: entity_ids,
    };
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/entities`,
      data: data,
    });
    return response.data?.code === "OK";
  }

  async executeEntityCommand(
    entity_id: string,
    cmd_id: string,
    params?: object,
  ): Promise<boolean> {
    const data = {
      entity_id: entity_id,
      cmd_id: cmd_id,
      ...(params && { params: params }),
    };

    const response = await this.rest.request<boolean>({
      method: "put",
      url: `/api/entities/${entity_id}/command`,
      data,
    });
    return response.data;
  }

  async browseMediaContainers(
    entity_id: string,
    page = 1,
    limit = 10,
    parameters?: object,
  ): Promise<{ data: { media: MediaItem }; headers: object }> {
    const params = {
      ...parameters,
      page: page,
      limit: limit,
    };

    const baseGet = this.rest.baseGet<{ media: MediaItem }>(
      {
        url: `/api/entities/${entity_id}/media/browse`,
        method: "get",
        params: params,
      },
      limit,
      page,
    );

    return baseGet;
  }

  async searchMediaItems(
    entity_id: string,
    page = 1,
    limit = 10,
    parameters?: object,
  ): Promise<{ data: MediaItem[]; headers: object }> {
    const params = {
      ...parameters,
      page: page,
      limit: limit,
    };

    const baseGet = this.rest.baseGet<MediaItem[]>(
      {
        url: `/api/entities/${entity_id}/media/search`,
        method: "get",
        params: params,
      },
      limit,
      page,
    );

    return baseGet;
  }

  async connectInst(inst_id: string): Promise<IntegrationInstance> {
    return this.changeConnectionStatus(inst_id, true);
  }
  async disconnectInst(inst_id: string): Promise<IntegrationInstance> {
    return this.changeConnectionStatus(inst_id, false);
  }
  protected async changeConnectionStatus(
    inst_id: string,
    connect: boolean,
  ): Promise<IntegrationInstance> {
    await this.rest.request({
      url: `/api/intg/instances/${inst_id}`,
      method: "put",
      params: {
        cmd: connect ? "CONNECT" : "DISCONNECT",
      },
    });
    return this.getIntegration(inst_id);
  }

  async deleteIntegration(integration: IntegrationStatus): Promise<boolean> {
    const config: RawAxiosRequestConfig = {
      method: "delete",
    };
    if (integration.integration_id) {
      config.url = `/api/intg/instances/${integration.integration_id}`;
    } else if (integration.driver_id && !integration.integration_id) {
      config.url = `/api/intg/drivers/${integration.driver_id}`;
    } else {
      throw new Error("Cannot delete integration");
    }
    const response = await this.rest.request<ApiErrorResponse>(config);
    return response.data.code === "OK";
  }

  async updateDriver(
    driver_id: string,
    data: IntegrationDriverUpdate,
  ): Promise<IntegrationDriver> {
    const response = await this.rest.request<IntegrationDriver>({
      method: "patch",
      url: `/api/intg/drivers/${driver_id}`,
      data,
    });
    return response.data;
  }

  async startDiscovery() {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "put",
      url: "/api/intg/discover",
    });
    return response.data.code === "OK";
  }

  async stopDiscovery() {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: "/api/intg/discover",
    });
    return response.data.code === "OK";
  }

  async testConnection(
    driver_id: string,
    driver_url: string,
    token: string | undefined = undefined,
  ): Promise<DriverConnectionTestResult> {
    const request = await this.rest.request<
      IntegrationDriver & Partial<ApiErrorResponse>
    >({
      method: "put",
      url: `/api/intg/discover/${driver_id}`,
      params: {
        cmd: "CONNECTION_TEST",
      },
      data: {
        connection: {
          driver_url,
          token,
        },
      },
    });
    const result: DriverConnectionTestResult = {
      code: 200,
      result: false,
      message: request.data.message,
    };
    if (request.data.driver_id === driver_id) {
      result.result = true;
      result.driver = request.data;
    }
    return result;
  }

  async registerIntegration(
    driver_id: string,
    driver_url: string,
    token: string | undefined = undefined,
  ): Promise<IntegrationDriver> {
    const request = await this.rest.request<IntegrationDriver>({
      method: "post",
      url: `/api/intg/discover/${driver_id}`,
      data: {
        driver_url,
        token,
      },
    });
    return await this.getDriver(request.data.driver_id);
  }

  async startSetupIntegration(
    driver_id: string,
    reconfigure = false,
    data: IntegrationSetupDataInput,
  ): Promise<IntegrationSetupInfo> {
    const response = await this.rest.request<IntegrationSetupInfo>({
      method: "post",
      url: "/api/intg/setup",
      data: {
        driver_id,
        reconfigure,
        setup_data: data.input_values || {},
      },
    });
    return response.data;
  }

  async continueSetupIntegration(
    driver_id: string,
    data: IntegrationSetupData,
  ): Promise<IntegrationSetupInfo> {
    const response = await this.rest.request<IntegrationSetupInfo>({
      method: "put",
      url: `/api/intg/setup/${driver_id}`,
      data,
    });
    return response.data;
  }

  async stopSetupIntegration(driver_id: string): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "delete",
      url: `/api/intg/setup/${driver_id}`,
    });
    return response.data.code === "OK";
  }

  async importCustomIntegration(
    file: File,
    update = false,
  ): Promise<IntegrationDriverInfo> {
    const data = new FormData();
    data.append("file", file);

    const response = await this.rest.request<IntegrationDriverInfo>(
      {
        method: "post",
        url: `/api/intg/install?update=${update}`,
        data,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
      maxUploadTimeout,
    );
    return response.data;
  }
}
