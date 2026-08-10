import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type {
  IrCodeDefinition,
  IrEmitter,
  IrEmitterLearnStatus,
  ManufacturerCodeset,
  ManufacturerInfo,
  RemoteIrCode,
  CodeSetFileData,
} from "@/types/ir";
import type { RemoteIrCodeFormat } from "@/types/enums";
import type { ApiErrorResponse } from "@/types/rest";

const maxUploadTimeout =
  Number(import.meta.env.VITE_API_MAX_IMPORT_IR_CODE_TIMEOUT ?? "") || 30000;

export default class ServiceIr extends BaseService implements ServiceInterface {
  async getEmitters(): Promise<IrEmitter[]> {
    return await this.rest.pagedGet<IrEmitter>(
      {
        url: "/api/ir/emitters",
      },
      50,
    );
  }

  async getManufacturers(q: string): Promise<ManufacturerInfo[]> {
    return await this.rest.pagedGet<ManufacturerInfo>(
      {
        url: "/api/ir/codes/manufacturers",
        method: "get",
        params: {
          q,
        },
      },
      50,
    );
  }

  async getManufacturerCodeSets(
    manufacturer_id: string,
    q: string | null = null,
  ): Promise<ManufacturerCodeset[]> {
    return await this.rest.pagedGet<ManufacturerCodeset>(
      {
        url: `/api/ir/codes/manufacturers/${manufacturer_id}`,
        method: "get",
        params: {
          q,
        },
      },
      50,
    );
  }

  async getManufacturerCodeSet(
    manufacturer_id: string,
    code_set_id: string,
  ): Promise<string[]> {
    const response = await this.rest.request<string[]>({
      url: `/api/ir/codes/manufacturers/${manufacturer_id}/${code_set_id}`,
      method: "get",
    });
    return response.data;
  }

  async downloadCustomCodeSet(codeSetId = ""): Promise<CodeSetFileData> {
    const headers = {
      "Content-Type": "text/csv",
    };

    let url = "/api/ir/codes/custom";
    if (codeSetId && codeSetId.length > 0) {
      url += `/${codeSetId}`;
    }

    const response = await this.rest.request<CodeSetFileData["data"]>({
      url: url,
      method: "get",
      data: {}, // It's necessary for send headers
      responseType: "blob",
      headers: headers,
    });
    return { data: response.data, headers: response.headers };
  }

  async uploadCustomCodeSet(
    code_set_id: string,
    file: File,
    overwrite = false,
    comment = "",
    delimiter = "",
  ): Promise<string> {
    const data = new FormData();
    data.append("file", file);

    let params = `?overwrite=${overwrite}`;
    if (comment.length > 0) {
      params += `&comment=${encodeURIComponent(comment)}`;
    }
    if (delimiter.length > 0) {
      params += `&delimiter=${encodeURIComponent(delimiter)}`;
    }

    const response = await this.rest.request<string>(
      {
        method: "post",
        url: `/api/ir/codes/custom/${code_set_id}${params}`,
        data,
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
      maxUploadTimeout,
    );
    return response.data;
  }

  async sendCodeToEmiter(
    device_id: string,
    cmd_id: string,
    codeset_id: string,
    port_id?: string,
  ): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "put",
      url: `/api/ir/emitters/${device_id}/send`,
      data: {
        codeset_id: codeset_id,
        cmd_id: cmd_id,
        ...(port_id !== undefined &&
          port_id.length > 0 && { port_id: port_id }),
      },
    });
    return response.data?.code === "OK";
  }

  async sendTestCodeToRemote(
    device_id: string,
    cmd_id: string,
  ): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "put",
      url: `/api/entities/${device_id}/command`,
      data: {
        params: {
          command: cmd_id,
        },
        cmd_id: "send",
      },
    });
    return response.data?.code === "OK";
  }

  async getLearnedCodes(emitter_id: string): Promise<IrEmitterLearnStatus> {
    const response = await this.rest.request<IrEmitterLearnStatus>({
      method: "get",
      url: `/api/ir/emitters/${emitter_id}/learn`,
    });
    return response.data;
  }

  async startLearning(emitter_id: string, timeout = 60): Promise<boolean> {
    const response = await this.rest.request<ApiErrorResponse>({
      method: "put",
      url: `/api/ir/emitters/${emitter_id}/learn`,
      params: {
        timeout,
      },
    });
    return response.data?.code === "OK";
  }

  async stopLearning(emitter_id: string): Promise<IrEmitterLearnStatus> {
    const response = await this.rest.request<IrEmitterLearnStatus>({
      method: "delete",
      url: `/api/ir/emitters/${emitter_id}/learn`,
    });
    return response.data;
  }

  async testCode(
    device_id: string,
    port_id: string,
    format: RemoteIrCodeFormat | "",
    value: string,
  ): Promise<boolean> {
    // @todo check this!
    const response = await this.rest.request<ApiErrorResponse>({
      method: "put",
      url: `/api/ir/emitters/${device_id}/send`,
      data: {
        port_id,
        code: value,
        format,
      },
    });
    return response.data.code === "OK";
  }

  async saveIrCode(
    modify: boolean,
    remote_id: string,
    ir_code: string,
    code: IrCodeDefinition,
  ): Promise<RemoteIrCode> {
    const response = await this.rest.request<RemoteIrCode>({
      method: modify ? "patch" : "post",
      url: `/api/remotes/${remote_id}/ir/${encodeURIComponent(ir_code)}`,
      data: {
        ...code,
      },
    });
    return response.data;
  }
}
