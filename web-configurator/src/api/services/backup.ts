import BaseService from "@/api/services/BaseService";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type { RestoreBackupParams } from "@/types/backup";

const maxUploadTimeout =
  Number(import.meta.env.VITE_API_MAX_BACKUP_TIMEOUT ?? "") || 180000;

export default class ServiceBackup
  extends BaseService
  implements ServiceInterface
{
  async exportBackup(): Promise<any> {
    const headers = {
      "Content-Type": "application/octet-stream",
    };

    const url = "/api/system/backup/export";

    const response = await this.rest.request<Blob>({
      url: url,
      method: "get",
      data: {}, // It's necessary for send headers
      responseType: "blob",
      headers: headers,
    });
    return { data: response.data, headers: response.headers };
  }

  async restoreBackup(
    params: RestoreBackupParams,
    file: File,
  ): Promise<string> {
    const data = new FormData();
    data.append("file", file);

    let parameters = "";

    if (params.merge === true) {
      parameters = `?merge=${params.merge}`;
    }

    const response = await this.rest.request<string>(
      {
        method: "put",
        url: `/api/system/backup/restore${parameters}`,
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
