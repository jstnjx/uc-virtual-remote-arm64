import type Connection from "@/api/connection";
import type ServiceInterface from "@/api/services/ServiceInterface";
import type ConnectionRest from "@/api/connection/rest";
import type ConnectionWebSocket from "@/api/connection/socket";

export default abstract class BaseService implements ServiceInterface {
  protected _connection: Connection;

  constructor(connection: Connection) {
    this._connection = connection;
  }

  setConnection(connection: Connection) {
    this._connection = connection;
    return this;
  }

  get rest(): ConnectionRest {
    return this._connection.rest();
  }

  get ws(): ConnectionWebSocket {
    return this._connection.websocket();
  }
}
