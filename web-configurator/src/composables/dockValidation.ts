import { DockState } from "@/types/enums";

/**
 * Checks if the dock is in an active/connected state.
 * Only ACTIVE state allows direct dock operations.
 */
export function isDockActive(state: DockState): boolean {
  return state === DockState.ACTIVE;
}

/**
 * Validates password change form submission.
 *
 * Password can be saved when:
 * - Both password fields are filled and match, AND
 * - Either dock is active (can update dock) OR changeDockToken is true (update configurator only)
 */
export function canChangePassword(
  dockState: DockState,
  pass1: string,
  pass2: string,
  changeDockToken: boolean,
): boolean {
  // Basic validation: both fields must be filled and match
  if (!pass1 || !pass2) {
    return false;
  }
  if (pass1 !== pass2) {
    return false;
  }

  // Connection-based validation:
  // - If dock is active: always allow (can update both configurator and dock)
  // - If dock is not active: only allow if NOT updating dock (configurator token only)
  const isActive = isDockActive(dockState);
  if (!isActive && changeDockToken) {
    return false;
  }

  return true;
}

/**
 * Validates WiFi settings form submission.
 *
 * WiFi settings can only be saved when:
 * - Both SSID and password are filled, AND
 * - Dock is in ACTIVE state (connected)
 */
export function canChangeWifi(
  dockState: DockState,
  ssid: string,
  password: string,
): boolean {
  const isActive = isDockActive(dockState);
  const hasSsid = Boolean(ssid);
  const hasPassword = Boolean(password);

  return hasSsid && hasPassword && isActive;
}
