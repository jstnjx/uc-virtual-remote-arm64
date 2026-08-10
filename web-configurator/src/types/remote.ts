import type { IconIdentifier, LanguageText } from "@/types/config";

import type { IntegrationId } from "@/types/integrationInstance";
import type {
  ActivitySequences,
  ActivityUserInterface,
  DeviceButtonMapping,
} from "@/types/activity";
import type { DeviceType, RemoteKind, EntityType } from "@/types/enums";

export type RemoteOverview = {
  entity_id: string;
  entity_type: "remote";
  integration_id: IntegrationId;
  device_class?: string;
  name: LanguageText;
  icon?: IconIdentifier;
  description?: LanguageText;
  features?: ["send"];
  options?: {
    editable?: boolean;
  };
};

/**
 * Basic remote: the fields delivered by `entity_change` events and
 * `GET /api/entities/:id`. The enriched `options.simple_commands` list is
 * absent here — see {@link RemoteFull} (ADR 0009 — two-phase entity typing).
 */
export type RemoteBasic = {
  entity_id: string;
  entity_type: EntityType;
  integration_id: string;
  device_class?: string;
  name: LanguageText;
  icon?: IconIdentifier;
  description?: LanguageText;
  features: string[];
  options?: {
    bt?: {
      dev_profile_id: string;
      dev_profile_version: number;
      peripherals: {
        keyboard: boolean;
        mouse: boolean;
      };
      profile: number;
    };
    editable?: boolean;
    ir?: {
      codeset?: {
        id?: string;
        name?: string;
        type?: string;
      };
      output?: {
        device_id?: string;
        port_id?: string;
      };
    };
    button_mapping?: DeviceButtonMapping[];
    user_interface?: ActivityUserInterface;
    kind?: RemoteKind;
  };
  attributes?: {
    state?: string;
    value?: string;
    unit?: string;
    connected?: boolean;
  };
};

/**
 * Full remote from the dedicated endpoint (`getRemote`): adds the enriched
 * `options.simple_commands` list as a required field (ADR 0009).
 */
export type RemoteFull = Omit<RemoteBasic, "options"> & {
  options?: NonNullable<RemoteBasic["options"]> & {
    simple_commands: string[];
  };
};

/**
 * Transitional alias for the basic phase. Prefer {@link RemoteBasic}
 * (events / list) or {@link RemoteFull} (dedicated fetch) at new call sites.
 */
export type Remote = RemoteBasic;

export type RemoteUpdate = {
  name?: LanguageText;
  icon?: IconIdentifier;
  description?: LanguageText;
  options?: {
    entity_ids?: string[];
    sequences?: ActivitySequences;
    button_mapping?: DeviceButtonMapping[];
    user_interface?: ActivityUserInterface;
    ir?: {
      codeset?: {
        id: string;
      };
      output?: {
        device_id: string;
        port_id: string;
      };
    };
  };
};

export type RemoteNewData = {
  name: LanguageText;
  icon?: IconIdentifier;
  description?: LanguageText;

  clone_from?: string;
  codeset_id?: string;
  custom_codeset?: {
    manufacturer?: string;
    manufacturer_id?: string;
    device_name: string;
    device_type?: DeviceType;
  };
};

export type PageItem = {
  entity_id?: string;
  group_id?: string;
  pos: number;
};

export type RemoteUpdateCheck = {
  entity_id: string;
  // version: string;
  update_available: boolean;
  // update_check_enabled: boolean;
  // firmware_update?: ;
  // update_id?: string;
  remote_configuration: Remote;
};
