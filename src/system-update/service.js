import { SystemUpdateService as LocalSystemUpdateService } from "./local-service.js";
import { SupervisorSystemUpdateService } from "./supervisor-service.js";
import { supervisorManagedEnvironment } from "./supervisor.js";

export class SystemUpdateService {
  constructor(platform, options = {}) {
    if (supervisorManagedEnvironment()) {
      return new SupervisorSystemUpdateService(platform, options);
    }
    return new LocalSystemUpdateService(platform, options);
  }
}
