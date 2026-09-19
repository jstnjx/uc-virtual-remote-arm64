/**
 * Power-state contract for the virtual appliance.
 *
 * A UC Virtual Remote is a server process, not a battery-powered handheld.
 * It must therefore never expose a suspend-capable power state to clients:
 * the Web Configurator interprets missing/false power_supply as a device that
 * may enter standby and starts its sleep/reconnect lifecycle.
 */

export const VIRTUAL_POWER_MODE = "NORMAL";

export function virtualBatteryStatus() {
  return {
    capacity: 100,
    status: "CHARGING",
    power_supply: true
  };
}

export function virtualPowerModeStatus() {
  return {
    mode: VIRTUAL_POWER_MODE,
    battery: virtualBatteryStatus()
  };
}

export function virtualRestPowerStatus() {
  return {
    mode: VIRTUAL_POWER_MODE,
    power_supply: true,
    standby_timeout_sec: 0,
    standby_inhibitors: false
  };
}
