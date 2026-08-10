/*
 * Modified by Justin Jäger for the Unfolded.Tools Remote Simulator.
 * Modified build first published: 2026-08-03.
 * Licensed as part of the modified Web Configurator under GNU GPL v3.0 only.
 * See MODIFICATIONS.md for details.
 */
export type SimulatorConfig = {
  enabled: boolean;
  public: boolean;
  mode: "remote3";
  sessionKey: string;
  basePath: string;
  blockedRoutes: readonly string[];
};

declare global {
  interface Window {
    __UCVR_BASE_PATH__?: string;
    __UCVR_SIMULATOR__?: SimulatorConfig;
  }
}

export function simulatorConfig(): SimulatorConfig | null {
  return window.__UCVR_SIMULATOR__?.enabled ? window.__UCVR_SIMULATOR__ : null;
}

export function simulatorEnabled(): boolean {
  return simulatorConfig() !== null;
}

function normalizedBasePath(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw || /__UCVR_[A-Z0-9_]+__/.test(raw)) {
    return "";
  }
  return `/${raw.split("/").filter(Boolean).join("/")}`;
}

export function simulatorBaseUrl(): string | null {
  const config = simulatorConfig();
  if (!config) {
    return null;
  }
  return `${window.location.origin}${normalizedBasePath(config.basePath)}`;
}

export function simulatorStoragePrefix(): string {
  return simulatorConfig()?.sessionKey || "default";
}

export function simulatorRouteBlocked(routeName: unknown): boolean {
  return simulatorConfig()?.blockedRoutes.includes(String(routeName || "")) || false;
}
