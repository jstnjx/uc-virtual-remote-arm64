/**
 * Default connection handler to API.
 */
import ConnectionRest from "@/api/connection/rest";
import ConnectionWebSocket from "@/api/connection/socket";
import ServiceFactoryReset from "@/api/services/factoryReset";
import type ServiceConfig from "@/api/services/config";
import type ServiceAuth from "@/api/services/authenticate";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type ConnectionInterface from "@/api/connection/ConnectionInterface";
import type ServiceProfiles from "@/api/services/profiles";
import type ServiceActivities from "@/api/services/activities";
import type ServiceActivityGroups from "@/api/services/activityGroups";
import type ServiceMacros from "@/api/services/macros";
import type ServiceIntegrations from "@/api/services/integrations";
import type ServiceRemotes from "@/api/services/remotes";
import type ServiceIr from "@/api/services/ir";
import type ServiceResources from "@/api/services/resources";
import type ServiceDocks from "@/api/services/docks";
import type ServiceLogs from "@/api/services/logs";
import type ServiceSystem from "@/api/services/system";
import type ServiceBackup from "@/api/services/backup";
import type ServiceSystemUpdate from "@/api/services/systemUpdate";
import type ServiceBluetooth from "@/api/services/bluetooth";
import type ServiceAuthExternal from "@/api/services/authExternal";

export type ConnectionSetup = {
  baseUrl: string;
};

export default class Connection implements ConnectionInterface {
  /**
   * API host.
   * @protected
   */
  protected _host: string;
  protected _config: ConnectionSetup;
  protected _rest: ConnectionRest;
  protected _websocket: ConnectionWebSocket;

  protected _services: Map<string, ServiceInterface>;

  constructor(config: ConnectionSetup) {
    this._config = { ...config };
    this._host = this._config.baseUrl;
    this._rest = new ConnectionRest(config);
    this._websocket = new ConnectionWebSocket(config);
    this._services = new Map<string, ServiceInterface>();
  }

  rest() {
    return this._rest;
  }

  websocket() {
    return this._websocket;
  }

  addService(id: string, service: ServiceInterface) {
    service.setConnection(this);
    this._services.set(id, service);
    return this;
  }

  getService(id: string): undefined | ServiceInterface {
    return this._services.get(id);
  }

  getServiceOrThrow<T extends ServiceInterface>(id: string): T {
    const service = this._services.get(id);
    if (!service) {
      throw new Error(`Service "${id}" not registered`);
    }
    return service as T;
  }

  get auth(): ServiceAuth {
    return this.getServiceOrThrow<ServiceAuth>("auth");
  }

  get config(): ServiceConfig {
    return this.getServiceOrThrow<ServiceConfig>("config");
  }

  get profiles(): ServiceProfiles {
    return this.getServiceOrThrow<ServiceProfiles>("profiles");
  }

  get activities(): ServiceActivities {
    return this.getServiceOrThrow<ServiceActivities>("activities");
  }

  get activityGroups(): ServiceActivityGroups {
    return this.getServiceOrThrow<ServiceActivityGroups>("activityGroups");
  }

  get macros(): ServiceMacros {
    return this.getServiceOrThrow<ServiceMacros>("macros");
  }

  get integrations(): ServiceIntegrations {
    return this.getServiceOrThrow<ServiceIntegrations>("intg");
  }

  get remotes(): ServiceRemotes {
    return this.getServiceOrThrow<ServiceRemotes>("remotes");
  }

  get ir(): ServiceIr {
    return this.getServiceOrThrow<ServiceIr>("ir");
  }

  get resources(): ServiceResources {
    return this.getServiceOrThrow<ServiceResources>("resources");
  }

  get docks(): ServiceDocks {
    return this.getServiceOrThrow<ServiceDocks>("docks");
  }

  get logs(): ServiceLogs {
    return this.getServiceOrThrow<ServiceLogs>("logs");
  }

  get system(): ServiceSystem {
    return this.getServiceOrThrow<ServiceSystem>("system");
  }

  get backup(): ServiceBackup {
    return this.getServiceOrThrow<ServiceBackup>("backup");
  }

  get systemUpdate(): ServiceSystemUpdate {
    return this.getServiceOrThrow<ServiceSystemUpdate>("systemUpdate");
  }

  get bluetooth(): ServiceBluetooth {
    return this.getServiceOrThrow<ServiceBluetooth>("bluetooth");
  }

  get authExternal(): ServiceAuthExternal {
    return this.getServiceOrThrow<ServiceAuthExternal>("authExternal");
  }

  getFactoryReset(): ServiceFactoryReset {
    const id = "factory_reset";
    if (!this._services.has(id)) {
      this.addService(id, new ServiceFactoryReset(this));
    }
    return this.getServiceOrThrow<ServiceFactoryReset>(id);
  }
}
