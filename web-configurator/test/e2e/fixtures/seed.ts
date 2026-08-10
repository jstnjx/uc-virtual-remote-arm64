/**
 * Fixture seeding over REST — docs/specs/007-simulator-based-testing.md §3.3.
 *
 * The simulator boots empty, so a test declares the state it needs instead of
 * inheriting it (I1). Basic auth is enough; no session, no UI.
 */
import { SIM_URL } from "./simulator";

const AUTH = "Basic " + Buffer.from("web-configurator:1234").toString("base64");

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(new URL(path, SIM_URL), {
    method,
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * The instance the simulator ships pre-configured. A pristine device has
 * exactly this one, so the wipe below has to put it back — integrations.spec.ts
 * deletes it, and the next spec file must not inherit that.
 */
const SIM_DRIVER_ID = "hass";
const SIM_INSTANCE_ID = "hass.main";
const SIM_INSTANCE_NAME = "Home Assistant";

/**
 * Device state back to what a freshly booted container has, over REST — the
 * per-spec-file "pristine device" of §3.2 without recreating the container.
 * See simulator.ts for why container churn mid-run is not something a browser
 * survives reliably.
 *
 * These bulk deletes together reproduce a pristine device exactly: no entities,
 * no activities, macros, IR remotes or docks, and the "default" activity group
 * that the core recreates on its own. Configuration (`DELETE /api/cfg`) is left
 * alone — no spec writes it, and wiping it would cost a core restart.
 */
export async function resetDeviceState(): Promise<void> {
  await api("DELETE", "/api/activity_groups");
  await api("DELETE", "/api/activities");
  await api("DELETE", "/api/macros");
  await api("DELETE", "/api/remotes");
  // The only one that wants a body; an empty filter means "all of them".
  await api("DELETE", "/api/entities", {});
  await api("DELETE", "/api/docks");

  const instances = await api<IntegrationInstance[]>(
    "GET",
    "/api/intg/instances",
  );
  if (!instances.some((i) => i.integration_id === SIM_INSTANCE_ID)) {
    await createIntegrationInstance(SIM_DRIVER_ID, SIM_INSTANCE_NAME);
  }
}

export type Localization = {
  language_code: string;
  country_code: string;
  time_zone: string;
  time_format_24h: boolean;
  measurement_unit: string;
};

export function getLocalization(): Promise<Localization> {
  return api<Localization>("GET", "/api/cfg/localization");
}

/**
 * Switch the device's UI language. `resetDeviceState` deliberately leaves
 * configuration alone, so a spec that changes this has to put it back itself.
 * The endpoint replaces the whole group, hence the read-modify-write.
 */
export async function setDeviceLanguage(code: string): Promise<void> {
  const current = await getLocalization();
  await api<Localization>("PATCH", "/api/cfg/localization", {
    ...current,
    language_code: code,
  });
}

export type ActivityGroup = {
  group_id: string;
  name: Record<string, string>;
};

export function createActivityGroup(name: string): Promise<ActivityGroup> {
  return api<ActivityGroup>("POST", "/api/activity_groups", {
    name: { en: name },
    icon: "uc:red",
  });
}

export function listActivityGroups(): Promise<ActivityGroup[]> {
  return api<ActivityGroup[]>("GET", "/api/activity_groups");
}

export type Activity = {
  entity_id: string;
  name: Record<string, string>;
};

/** An activity; the core adds the default "main" UI page. */
export function createActivity(
  name: string,
  entityIds: string[] = [],
): Promise<Activity> {
  return api<Activity>("POST", "/api/activities", {
    name: { en: name },
    options: { entity_ids: entityIds },
  });
}

export type Remote = {
  entity_id: string;
  name: Record<string, string>;
};

/**
 * An IR remote from a stock code set. On the core-only simulator profile this
 * is the one entity a spec can seed that an activity or macro can include —
 * everything else needs a running integration driver (§3.4).
 */
export function createRemote(name: string): Promise<Remote> {
  return api<Remote>("POST", "/api/remotes", {
    name: { en: name },
    icon: "uc:red",
    codeset_id: "bowerswilkins",
  });
}

export type Macro = {
  entity_id: string;
  name: Record<string, string>;
};

/** An empty macro — enough to open its editor. */
export function createMacro(name: string): Promise<Macro> {
  return api<Macro>("POST", "/api/macros", { name: { en: name } });
}

export type UiPage = {
  page_id: string;
  name?: string;
  grid: { width: number; height: number };
  items: { type: string; text?: string; location: { x: number; y: number } }[];
};

/** The UI pages of an activity, in display order. */
export function listUiPages(activityId: string): Promise<UiPage[]> {
  return api<UiPage[]>("GET", `/api/activities/${activityId}/ui/pages`);
}

/** Replace a page's grid and widgets — placing widgets without driving the editor. */
export function updateUiPage(
  activityId: string,
  page: UiPage,
): Promise<UiPage> {
  return api<UiPage>(
    "PATCH",
    `/api/activities/${activityId}/ui/pages/${page.page_id}`,
    page,
  );
}

export type Profile = {
  profile_id: string;
  name: string;
};

export function listProfiles(): Promise<Profile[]> {
  return api<Profile[]>("GET", "/api/profiles");
}

/**
 * A remote-UI page on the active profile. The simulator boots with none, and
 * the customise-remote options panel — the only way into the add-group dialog —
 * is `v-show`n off until a page is selected for editing.
 */
export async function createProfilePage(name: string): Promise<void> {
  const [profile] = await listProfiles();
  await api("POST", `/api/profiles/${profile.profile_id}/pages`, {
    profile_id: profile.profile_id,
    name,
    items: [],
  });
}

export type IntegrationInstance = {
  integration_id: string;
  driver_id: string;
};

/**
 * Create an instance of an installed driver — what a completed integration
 * setup leaves behind, without driving the setup wizard. The core answers with
 * an `integration_change` NEW event, which is what the app reacts to.
 */
export function createIntegrationInstance(
  driverId: string,
  name: string,
): Promise<IntegrationInstance> {
  return api<IntegrationInstance>("POST", `/api/intg/drivers/${driverId}`, {
    name: { en: name },
    enabled: true,
  });
}

/** Leaves the driver installed but not configured (`has_instances=false`). */
export function deleteIntegrationInstance(
  integrationId: string,
): Promise<{ code: string }> {
  return api<{ code: string }>(
    "DELETE",
    `/api/intg/instances/${integrationId}`,
  );
}
