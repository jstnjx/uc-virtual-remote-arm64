import type ConnectionRest from "@/api/connection/rest";
import type ConnectionWebSocket from "@/api/connection/socket";
import type ServiceInterface from "@/api/services/ServiceInterface";

export default interface ConnectionInterface {
  rest(): ConnectionRest;

  websocket(): ConnectionWebSocket;

  addService(id: string, service: ServiceInterface): ConnectionInterface;

  getService(id: string): undefined | ServiceInterface;
}
