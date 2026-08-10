import type Connection from "@/api/connection";

export default interface ServiceInterface {
  setConnection(connection: Connection): ServiceInterface;
}
