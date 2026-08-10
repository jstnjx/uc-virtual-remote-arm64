import axios from "axios";
import type {
  AxiosInstance,
  AxiosResponse,
  RawAxiosRequestConfig,
  RawAxiosResponseHeaders,
} from "axios";
import type { ConnectionSetup } from "@/api/connection/index";
import type { onRestError } from "@/types/rest";

export default class ConnectionRest {
  /**
   * API host.
   * @protected
   */
  protected _host: string;
  protected _config: ConnectionSetup;

  protected resourcesEndpoint: string;

  protected controller: AbortController;

  readonly axios: AxiosInstance;

  protected pingUrl = "/api/pub/version?ping=1";

  readonly requestTimeout = 30000;

  protected errorInterceptors: Map<string, onRestError> = new Map();

  constructor(config: ConnectionSetup) {
    this._config = { ...config };
    this._host = this._config.baseUrl;
    this.controller = new AbortController();
    this.axios = this.initAxios();
    this.resourcesEndpoint =
      this._config.baseUrl.replace(/\/$/, "") + "/api/resources";
  }

  protected getAxiosConfig(): RawAxiosRequestConfig {
    return {
      // mode: "no-cors",
      withCredentials: true,
    } as RawAxiosRequestConfig;
  }

  protected getMaxTimeout(): number {
    return (
      Number(import.meta.env.VITE_API_MAX_TIMEOUT ?? "") || this.requestTimeout
    );
  }

  protected initAxios() {
    const inst = axios.create(this.getAxiosConfig());
    inst.defaults.baseURL = this._config.baseUrl;
    inst.interceptors.response.use(
      (resonse: AxiosResponse) => {
        return resonse;
      },
      (error: any) => {
        this.errorInterceptors.forEach((callback) => {
          callback(error);
        });
        throw error;
      },
    );
    return inst;
  }

  request<T = unknown>(
    params: RawAxiosRequestConfig,
    timeout?: number,
  ): Promise<AxiosResponse<T>> {
    // if (appStateStore().connected === false) {
    //   const { t } = useTranslation();
    //   throw new Error(t("error.ERR_NETWORK"));
    // }

    if (this.controller) {
      params.signal = this.controller.signal;
    }

    params.timeout = this.getMaxTimeout();

    if (timeout) {
      params.timeout = timeout;
    }

    if (import.meta.env.DEV) {
      const method = (params.method || "GET").toUpperCase();
      console.groupCollapsed(`[API:request] ${method} ${params.url}`);
      console.info(params);
      console.trace();
      console.groupEnd();
    }
    return this.axios.request<T>(params);
  }

  requestNonCancellable<T = unknown>(
    params: RawAxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.axios.request<T>(params);
  }

  /**
   * Build a per-request config with pagination parameters.
   *
   * Always clones the caller's config and its nested `params` object so
   * neither is ever mutated (callers may reuse their config objects, and
   * paged requests must not share one `params` instance).
   */
  protected pageParams(
    params: RawAxiosRequestConfig,
    limit: number,
    page: number,
  ): RawAxiosRequestConfig {
    const reqParams = {
      ...params,
      method: "get",
      params: { ...params.params, limit, page },
    };
    if (reqParams.params.reload && page > 1) {
      reqParams.params.reload = false;
    }
    return reqParams;
  }

  async baseGet<T>(
    params: RawAxiosRequestConfig,
    limit: number,
    page = 1,
  ): Promise<{ data: T; headers: RawAxiosResponseHeaders }> {
    const response = await this.request<T>(
      this.pageParams(params, limit, page),
    );
    return { data: response.data, headers: response.headers };
  }

  async pagedGet<T>(
    params: RawAxiosRequestConfig,
    limit: number,
  ): Promise<T[]> {
    const head = await this.request<T[]>(this.pageParams(params, limit, 1));
    const total = parseInt(head.headers["pagination-count"] || "") || 0;
    const pageCount = Math.ceil(total / limit);
    const result = head.data;

    if (pageCount > 1) {
      const requests = [];
      for (let i = 2; i <= pageCount; i++) {
        requests.push(this.request<T[]>(this.pageParams(params, limit, i)));
      }
      const responses = await Promise.all(requests);
      responses.forEach((response) => {
        result.push(...response.data);
      });
    }
    return result;
  }

  resourceUrl(type: string, id: string): string {
    return this.resourcesEndpoint + "/" + type + "/" + id;
  }

  reset() {
    this.controller = new AbortController();
  }

  abort() {
    this.controller.abort();
    this.reset();
  }

  /**
   * Reachability probe for the ConnectionMonitor
   * (docs/specs/001-connection-monitor-rewrite.md §5.3).
   *
   * Resolves on any HTTP response — a 401 still proves the device is
   * reachable — and rejects only on network error or timeout. Deliberately
   * bypasses request() so it carries no shared abort signal and triggers
   * no error interceptors' side effects beyond logging.
   */
  async probe(timeoutMs: number): Promise<void> {
    try {
      await this.axios.request({
        method: "get",
        url: this.pingUrl,
        timeout: timeoutMs,
      });
    } catch (e) {
      if (axios.isAxiosError(e) && e.response) {
        return; // the device answered → reachable
      }
      throw e;
    }
  }

  addErrorInterceptor(name: string, callback: onRestError, replace = false) {
    if (this.errorInterceptors.has(name) && !replace) {
      throw new Error(`REST error handler with name "${name}" already exists`);
    }
    this.errorInterceptors.set(name, callback);
  }

  /** True if the request was cancelled (aborted), e.g. via {@link abort}. */
  isCancelError(e: unknown): boolean {
    return (
      axios.isCancel(e) || (axios.isAxiosError(e) && e.code === "ERR_CANCELED")
    );
  }
  isUnauthorizedError(e: unknown): boolean {
    return axios.isAxiosError(e) && e.response?.status === 401;
  }
  isNotFoundError(e: unknown): boolean {
    return axios.isAxiosError(e) && e.response?.status === 404;
  }
  /**
   * True for ANY axios error — including HTTP error responses like 404 or
   * 500, where the device answered and is therefore reachable. Despite the
   * name, this is NOT a "device unreachable" check, even though call sites
   * treat it as one; use {@link isNetworkError} for that.
   *
   * @todo revisit the semantics (and call sites) of this helper — it is
   *   merely an alias of axios.isAxiosError().
   */
  isConnectionError(e: unknown): boolean {
    return axios.isAxiosError(e);
  }
  isNetworkError(e: unknown): boolean {
    return axios.isAxiosError(e) && e.code === "ERR_NETWORK";
  }
}
