/**
 * Simulator lifecycle for the e2e suite — docs/specs/007-simulator-based-testing.md §3.2.
 *
 * Docker semantics live in tools/simulator/sim.sh (phase 1); this only drives it,
 * so there is one definition of what "a simulator" means.
 *
 * Ports default away from the dev loop's 8080/3000 on purpose: `reset` throws the
 * container away, and an e2e run must never do that to a simulator someone is
 * developing against.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

export const SIM_PORT = Number(process.env.SIM_PORT ?? 8180);
export const SIM_NAME = process.env.SIM_NAME ?? "uc-sim-e2e";
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);

export const SIM_URL = `http://127.0.0.1:${SIM_PORT}/`;
export const APP_URL = `http://127.0.0.1:${APP_PORT}/`;

const repoRoot = path.resolve(__dirname, "../../..");

/**
 * Creating or destroying a container adds and removes a veth pair on the host.
 * Chromium's Linux NetworkChangeNotifier watches netlink and turns that into
 * ERR_NETWORK_CHANGED for everything in flight roughly two seconds later — on
 * CI that killed a route's lazily-loaded chunks, which the app never retries,
 * leaving it stuck behind the "Reconnecting" overlay for the rest of the test.
 *
 * Nothing observable says "the notifier has fired", so the only defence is to
 * keep container churn out of the browser's in-flight window. Hence: containers
 * are created once per run (globalSetup) and specs reset state over REST
 * instead (seed.ts resetDeviceState) — this bounded wait covers the two places
 * that still have to touch Docker while a browser may be running.
 */
const NETWORK_SETTLE_MS = 5_000;

const settle = () =>
  new Promise<void>((resolve) => setTimeout(resolve, NETWORK_SETTLE_MS));

function sim(cmd: "up" | "down" | "reset"): void {
  execFileSync(path.join(repoRoot, "tools/simulator/sim.sh"), [cmd], {
    cwd: repoRoot,
    env: { ...process.env, SIM_PORT: String(SIM_PORT), SIM_NAME },
    // `up` prints the running core version: the only record of what a run was
    // tested against, since the image tag floats (FM-7).
    stdio: "inherit",
  });
}

export async function simUp(): Promise<void> {
  sim("up");
  await settle();
}

export function simDown(): void {
  sim("down");
}

/**
 * Recreate the container: a pristine device. Satisfies I1 by construction.
 *
 * The expensive way to get there — reserved for the one test that asserts the
 * recreate itself wipes state. Specs that just need a clean device call
 * resetDeviceState() from seed.ts, which costs no container churn.
 */
export async function simReset(): Promise<void> {
  sim("reset");
  await settle();
}

/**
 * FM-2 / I3: prove the app's own /api path reaches the simulator before any test
 * writes through it. The target host is loopback by construction (SIM_URL is
 * built here), but that says nothing about what the dev server proxies to: a
 * personal VITE_API_PROXY in env/.env.local points at real hardware, and only
 * asking the backend who it is can rule out that it won.
 */
export async function assertBackendIsSimulator(): Promise<void> {
  const res = await fetch(new URL("/api/pub/version", APP_URL));
  const meta = (await res.json()) as { device_name?: string; core?: string };
  if (meta.device_name !== "Remote Simulator") {
    throw new Error(
      `refusing to run: ${APP_URL}api/pub/version is answered by ` +
        `"${meta.device_name}", not the simulator. Check VITE_API_PROXY.`,
    );
  }
}
