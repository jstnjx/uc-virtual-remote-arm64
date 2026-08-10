/**
 * Starts the simulator the whole run shares — and, since the deviation from
 * §3.2 documented in simulator.ts, the only container the run creates. It boots
 * pristine, and each spec file returns it to that state over REST in a
 * beforeAll (seed.ts resetDeviceState).
 */
import { execFileSync } from "node:child_process";
import { SIM_NAME, simUp } from "./simulator";

/** FM-3: a crashed run can leave a container holding the port. Sweep it first. */
function sweepStale(): void {
  const stale = execFileSync("docker", [
    "ps",
    "-aq",
    "-f",
    `name=^${SIM_NAME}$`,
  ])
    .toString()
    .trim();
  if (stale) {
    execFileSync("docker", ["rm", "-f", SIM_NAME], { stdio: "ignore" });
  }
}

export default async function globalSetup(): Promise<void> {
  sweepStale();
  await simUp();
}
