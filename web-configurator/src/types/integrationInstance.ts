import type {
  DeviceState,
  DriverState,
  DriverType,
  EntityType,
  IntegrationDiscoveryChangeEventType,
  IntegrationSetupState,
  IntegrationSetupError,
} from "@/types/enums";
import type { IconIdentifier, LanguageText } from "@/types/config";
import type { IntegrationState, MediaClass } from "@/types/enums";

/**
 * IntegrationId string($^[a-zA-Z0-9-_\.]+$)
 *   minLength: 1
 *   maxLength: 73
 */
export type IntegrationId = string;

/**
 * DriverId string($^[a-zA-Z0-9-_]+$)
 *   minLenth: 1
 *   maxLength: 36
 */
export type DriverId = string;

/**
 * DeviceId string($^[a-zA-Z0-9-_]+$)
 *   minLength: 1
 *   maxLength: 36
 */
export type DeviceId = string;

export type IntegrationInstance = {
  integration_id: IntegrationId;
  driver_id: DriverId;
  device_id?: DeviceId;
  name: LanguageText;
  icon?: IconIdentifier;
  enabled: boolean;
  setup_data?: Record<string, unknown>;
  device_state?: DeviceState;
};

export type IntegrationRequest = {
  device_id?: DeviceId;
  name?: LanguageText;
  icon?: IconIdentifier;
  enabled?: boolean;
  setup_data?: Record<string, unknown>;
};

export type IntegrationUpdateStatus = {
  supported: boolean;
  available: boolean;
  available_version?: string | null;
  checked_at?: string | null;
  error?: string | null;
};

export type InstalledIntegrationManagementItem = {
  id: IntegrationId;
  update?: IntegrationUpdateStatus | null;
};

export type IntegrationStatus = {
  driver_id?: DriverId;
  integration_id?: IntegrationId;
  name: LanguageText;
  icon?: IconIdentifier;
  state?: IntegrationState;
  driver_type: DriverType;
};

export type IntegrationStateMessage = {
  driver_id?: DriverId;
  integration_id: IntegrationId;
  device_state: DeviceState;
};

export type IntegrationDriverUpdate = {
  name?: LanguageText;
  driver_url?: string;
  token?: string;
  auth_method?: "HEADER" | "MESSAGE";
  icon?: IconIdentifier;
  enabled?: boolean;
};

export type IntegrationDriverInfo = {
  driver_id: DriverId;
  name: LanguageText;
  developer_name?: string;
  driver_type: DriverType;
  driver_url: string;
  version: string;
  icon?: IconIdentifier;
  enabled?: boolean;
  driver_state?: DriverState;
  pwd_protected?: boolean;
  discovered?: boolean;
};

export type IntegrationDriver = {
  driver_id: DriverId;
  name: LanguageText;
  driver_type?: DriverType;
  driver_state?: DriverState;
  driver_url: string;
  token?: string;
  auth_method?: "HEADER" | "MESSAGE";
  version: string;
  min_core_api?: string;
  icon?: IconIdentifier;
  enabled?: boolean;
  description?: LanguageText;
  developer?: DriverDeveloper;
  home_page?: string;
  device_discovery?: boolean;
  setup_data_schema?: DriverSettingsPage;
  release_date?: string;
  pwd_protected?: boolean;
  discovered?: boolean;
  instance_count?: number;
};

export type DriverSettingsPage = {
  title: LanguageText;
  settings: DriverSetting[];
};

export type DriverSetting = {
  id: string;
  label: LanguageText;
  field: DriverSettingField;
};

export type DriverSettingValueField =
  | SettingTypeNumber
  | SettingTypeText
  | SettingTypeTextArea
  | SettingTypePassword
  | SettingTypeCheckbox
  | SettingTypeDropdown;

export type DriverSettingField = DriverSettingValueField | SettingTypeLabel;

export type SettingTypeNumber = {
  number: {
    value: number;
    min?: number;
    max?: number;
    steps?: number;
    decimals?: number;
    unit?: LanguageText;
  };
};
export type SettingTypeText = {
  text: {
    value?: string;
    regex?: string;
  };
};
export type SettingTypeTextArea = {
  textarea: {
    value?: string;
  };
};
export type SettingTypePassword = {
  password: {
    value?: string;
    regex?: string;
  };
};
export type SettingTypeCheckbox = {
  checkbox: {
    value: boolean;
  };
};
export type SettingTypeDropdown = {
  dropdown: {
    value?: string;
    items: SettingTypeDropdownItem[];
  };
};
export type SettingTypeDropdownItem = {
  id: string;
  label: LanguageText;
};
export type SettingTypeLabel = {
  label: {
    value: LanguageText;
  };
};

export type DriverDeveloper = {
  name?: string;
  url?: string;
  email?: string;
};

export type NewIntegrationData = {
  device_id?: DeviceId;
  name: LanguageText;
  icon?: IconIdentifier;
  enabled?: boolean;
  setup_data?: Record<string, unknown>;
};

export type AvailableEntityId = string;

export type AvailableEntity = {
  entity_id: AvailableEntityId;
  entity_type: EntityType;
  integration_id: IntegrationId;
  device_id?: DeviceId;
  device_class?: string;
  name: LanguageText;
  icon?: IconIdentifier;
  features: string[];
  // Open config record (ws-and-integration-payload-typing): `unknown` leaves,
  // narrow at the read site — no `any` flows out of the payload (ADR 0002).
  options?: Record<string, unknown>;
  area: string;
  selected?: boolean;
  attributes?: EntityAttributes;
};

export type ConfiguredEntity = {
  entity_id: string;
  entity_type: EntityType;
  integration_id: IntegrationId;
  device_class?: string;
  name: LanguageText;
  icon?: IconIdentifier;
  features?: string[];
  // Open config record (ws-and-integration-payload-typing): `unknown` leaves,
  // narrow at the read site — no `any` flows out of the payload (ADR 0002).
  options?: Record<string, unknown>;
  description?: LanguageText;
  area?: string;
  selected?: boolean;
  attributes?: EntityAttributes;
};

export type EntityDataLists = {
  // Full list of loaded entities
  fullList: AvailableEntity[] | ConfiguredEntity[];
  // List of newly loaded entities
  loadedEntityList: AvailableEntity[] | ConfiguredEntity[];
};

export type EntityRequest = {
  name?: LanguageText;
  description?: LanguageText;
  icon?: IconIdentifier;
};

export type IntegrationDiscovery = {
  id: DriverId;
  configured: boolean;
  name: string;
  developer_name?: string;
  icon?: IconIdentifier;
  driver_url: string;
  pwd_protected?: boolean;
  version?: string;
  timestamp?: string;
};

export type IntegrationDiscoveryChangeMessage = {
  event_type: IntegrationDiscoveryChangeEventType;
  integration?: IntegrationDiscovery;
};

export type DriverConnectionTestResult = {
  result: boolean;
  code: number;
  driver?: IntegrationDriver;
  message?: string;
};

export type DriverSetupConfirmationPage = {
  title: LanguageText;
  message1: LanguageText;
  image?: string;
  message2: LanguageText;
};

export type IntegrationSetupRequiredUserAction = {
  input?: DriverSettingsPage;
  confirmation?: DriverSetupConfirmationPage;
};

export type IntegrationSetupInfo = {
  id: string;
  state: IntegrationSetupState;
  error?: IntegrationSetupError;
  require_user_action?: IntegrationSetupRequiredUserAction;
};

export type IntegrationSetupChangeBaseMessage = {
  driver_id: string;
  event_type: "SETUP";
  state: IntegrationSetupState;
  error?: string;
};

export type IntegrationSetupWaitingMessage =
  IntegrationSetupChangeBaseMessage & {
    state: IntegrationSetupState.WAIT_USER_ACTION;
    require_user_action: IntegrationSetupRequiredUserAction;
  };

export type IntegrationSetupChangeMessage =
  IntegrationSetupChangeBaseMessage | IntegrationSetupWaitingMessage;

export type IntegrationSetupData =
  IntegrationSetupDataInput | IntegrationSetupDataConfirm;

export type IntegrationSetupDataInput = {
  input_values: Record<string, unknown>;
};

export type IntegrationSetupDataConfirm = {
  confirm: boolean;
};

export type EntityFilterData = {
  searchText?: string;
  entityTypes?: string;
  instances?: string;
};

export type EntityAttributes = {
  media_image_url?: string;
  media_type?: string;
  muted?: boolean;
  state?: string;
  value?: string;
  unit?: string;
  source_list: string[];
  sound_mode_list: string[];
  custom_label?: string;
  current_option?: string;
  options?: string[];
  search_media_classes?: MediaClass[];
};
