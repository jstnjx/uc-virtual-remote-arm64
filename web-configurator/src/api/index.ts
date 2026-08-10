/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified build first published: 2026-08-03.
 * Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
 * See MODIFICATIONS.md for details.
 */
import Connection from "@/api/connection";
import ServiceAuth from "@/api/services/authenticate";
import ServiceConfig from "@/api/services/config";
import ServiceProfiles from "@/api/services/profiles";
import ServiceActivities from "@/api/services/activities";
import ServiceActivityGroups from "@/api/services/activityGroups";
import ServiceMacros from "@/api/services/macros";
import ServiceIntegrations from "@/api/services/integrations";
import ServiceRemotes from "@/api/services/remotes";
import ServiceIr from "@/api/services/ir";
import ServiceResources from "@/api/services/resources";
import ServiceDocks from "@/api/services/docks";
import ServiceLogs from "@/api/services/logs";
import ServiceSystem from "@/api/services/system";
import ServiceBackup from "@/api/services/backup";
import ServiceSystemUpdate from "@/api/services/systemUpdate";
import ServiceBluetooth from "@/api/services/bluetooth";
import ServiceAuthExternal from "@/api/services/authExternal";
import { simulatorBaseUrl } from "@/simulator/config";

function getBaseUrl(): string {
  return simulatorBaseUrl() || import.meta.env.VITE_API_HOST || import.meta.env.BASE_URL;
}

const baseUrl = getBaseUrl();
const ApiConnection: Connection = new Connection({
  baseUrl,
});
ApiConnection.addService("auth", new ServiceAuth(ApiConnection));
ApiConnection.addService("config", new ServiceConfig(ApiConnection));
ApiConnection.addService("profiles", new ServiceProfiles(ApiConnection));
ApiConnection.addService("activities", new ServiceActivities(ApiConnection));
ApiConnection.addService(
  "activityGroups",
  new ServiceActivityGroups(ApiConnection),
);
ApiConnection.addService("macros", new ServiceMacros(ApiConnection));
ApiConnection.addService("intg", new ServiceIntegrations(ApiConnection));
ApiConnection.addService("remotes", new ServiceRemotes(ApiConnection));
ApiConnection.addService("ir", new ServiceIr(ApiConnection));
ApiConnection.addService("resources", new ServiceResources(ApiConnection));
ApiConnection.addService("docks", new ServiceDocks(ApiConnection));
ApiConnection.addService("logs", new ServiceLogs(ApiConnection));
ApiConnection.addService("system", new ServiceSystem(ApiConnection));
ApiConnection.addService("backup", new ServiceBackup(ApiConnection));
ApiConnection.addService(
  "systemUpdate",
  new ServiceSystemUpdate(ApiConnection),
);
ApiConnection.addService("bluetooth", new ServiceBluetooth(ApiConnection));
ApiConnection.addService(
  "authExternal",
  new ServiceAuthExternal(ApiConnection),
);

export default ApiConnection;
