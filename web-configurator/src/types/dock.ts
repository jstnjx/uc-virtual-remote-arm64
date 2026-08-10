import type {
  DockCommandType,
  DockState,
  DockDiscoveryType,
  DockDiscoveryChangeEventType,
  DockSetupError,
  DockSetupState,
  DockUpdateProgressEventState,
  DockUpdateProgressEventType,
  DockPortMode,
} from "@/types/enums";
import type { LanguageText } from "@/types/config";

export type DockId = string;

export type DockConfigurationList = Record<string, DockConfiguration>;
export type DockDiscoveryList = Record<string, DockDiscovery>;

export type DockConfiguration = {
  dock_id: DockId;
  name?: string;
  custom_ws_url?: string;
  resolved_ws_url?: string;
  active: boolean;
  model?: string;
  connection_type?: string;
  version?: string;
  revision?: string;
  state: DockState;
  learning_active?: boolean;
  description?: string;
  led_brightness?: number;
  eth_led_brightness?: number;
  port_count?: number;
  ports?: DockPort[];
};

export type DockConfigurationChange = {
  name?: string;
  custom_ws_url?: string;
  token?: string;
  active?: boolean;
  description?: string;
  wifi?: {
    ssid: string;
    password: string;
  };
  change_dock_token?: boolean;
};

export type DockConfigurationRequest = {
  dock_id: DockId;
  name?: string;
  custom_ws_url?: string;
  token: string;
  active: boolean;
  model?: string;
  description: string;
};

export type DockDiscovery = {
  id: DockId;
  configured: boolean;
  discovery_type: DockDiscoveryType;
  friendly_name?: string;
  address?: string;
  model?: string;
  version?: string;
  timestamp?: string;
  bt?: {
    description?: string;
    signal?: number;
    last_seen_sec?: number;
  };
};

export type DockDiscoveryStatus = {
  active?: boolean;
  docks: DockDiscovery[];
};

export type DockDiscoveryStatusResponse = {
  active: boolean;
  discovered: DockDiscoveryList;
};

export type CreateDockSetup = {
  id: string;
  discovery_type: DockDiscoveryType;
  friendly_name?: string;
  address?: string;
  model?: string;
  version?: string;
};

export type DockSetupInfo = {
  id: string;
  name?: string;
  discovery_type: DockDiscoveryType;
  state: DockSetupState;
  error?: DockSetupError;
  description?: string;
};

export type DockSetup = {
  name: string;
  token?: string;
  custom_ws_url?: string;
  descirption?: string;
  wifi?: {
    ssid: string;
    password: string;
  };
};

export type DockCommand = {
  command: DockCommandType;
  value?: string;
};

export type DockFirmwareUpdate = {
  model: string;
  version: string;
  release_notes_url?: string;
  description?: LanguageText;
};

export type DockUpdateCheck = {
  dock_id: DockId;
  version: string;
  update_available: boolean;
  update_check_enabled: boolean;
  firmware_update?: DockFirmwareUpdate;
  update_id?: string;
  dock_configuration?: DockConfiguration;
};

export type DockUpdateProgress = {
  dock_id: DockId;
  update_id: string;
  version: string;
  progress?: number;
  state: DockSetupState;
  error?: DockSetupError;
};

export type DockIrSendCommand = {
  int1?: boolean;
  int2?: boolean;
  ext1?: boolean;
  ext2?: boolean;
  pronto?: string;
  hex?: string;
};

export type DockUpdateProgressMessage = {
  dock_id: string;
  event_type: DockUpdateProgressEventType;
  progress: number;
  state: DockUpdateProgressEventState;
  update_id: string;
  version: string;
  error?: string;
};

export type DockDiscoveryChangeMessage = {
  event_type: DockDiscoveryChangeEventType;
  dock?: DockDiscovery;
};

export type DockSetupChangeMessage = {
  dock_id: string;
  event_type: "SETUP";
  state: DockSetupState;
  error?: DockSetupError;
};

export type DockStateMessage = {
  dock_id: string;
  state: DockState;
};

export type DockPort = {
  port: number;
  mode: DockPortMode;
  active_mode?: DockPortMode;
  supported_modes: DockPortMode[];
  uart?: {
    baud_rate: number;
    data_bits: number;
    stop_bits: string;
    parity: string;
  };
};

export type DockPortChange = {
  mode: DockPortMode;
  uart?: {
    baud_rate?: number;
    data_bits?: number;
    stop_bits?: string;
    parity?: string;
  };
};
