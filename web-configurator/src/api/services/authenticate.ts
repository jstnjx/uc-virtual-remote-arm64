import type ServiceInterface from "@/api/services/ServiceInterface";
import BaseService from "@/api/services/BaseService";
import type { ApiErrorResponse } from "@/types/rest";

export default class ServiceAuth
  extends BaseService
  implements ServiceInterface
{
  async authenticate(pin: string): Promise<{
    result: boolean;
    code?: string;
    message?: any;
  }> {
    try {
      this.rest.reset();
      const resp = await this.rest.requestNonCancellable<
        Partial<ApiErrorResponse>
      >({
        url: "/api/pub/login",
        method: "post",
        data: {
          username: "web-configurator",
          password: pin,
        },
      });
      return {
        ...resp.data,
        result: resp.data.code === "OK",
      };
    } catch (e) {
      if (this.rest.isConnectionError(e)) {
        const err = e as any;
        if (this.rest.isNetworkError(err) || this.rest.isCancelError(err)) {
          return {
            result: false,
            code: err.code,
            message: err.code,
          };
        }
        if (err.response?.data) {
          const resp = err.response?.data as any;
          return {
            ...resp,
            result: resp.code === "OK",
          };
        }
      }
      return {
        result: false,
        message: e,
      };
    }
  }

  async logout(): Promise<boolean> {
    await this.rest.requestNonCancellable({
      url: "/api/pub/logout",
      method: "post",
      data: {
        id: "id",
      },
    });
    return true;
  }
}
