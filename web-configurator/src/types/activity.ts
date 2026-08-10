import type {
  DeviceButtonGroup,
  EntityType,
  SequenceType,
  ButtonMappingPressType,
} from "@/types/enums";

import type { ActivityGroup } from "@/types/activityGroup";
import type { CommandSequence, CommandSequenceDelay } from "@/types/command";
import type { IconIdentifier, LanguageText } from "@/types/config";

export type ActivityNewData = {
  name: LanguageText;
  icon?: string;
  description?: LanguageText;
  options?: {
    entity_ids?: string[];
    prevent_sleep?: boolean;
  };
};

export type IncludedEntity = {
  entity_id: string;
  entity_type?: EntityType;
  name?: LanguageText;
  icon?: IconIdentifier;
  integration_id?: string;
  integration?: {
    name?: LanguageText;
    icon?: IconIdentifier;
  };
  available?: boolean;
};

/**
 * Enriched included entity. `entity_commands` / `simple_commands` are delivered
 * only by the dedicated Activity/Macro endpoints, never by `entity_change`
 * events or `GET /api/entities/:id` (ADR 0009 — two-phase entity typing).
 */
export type IncludedEntityFull = IncludedEntity & {
  entity_commands: string[];
  simple_commands: string[];
};

/**
 * Basic activity: the fields delivered by `entity_change` events and
 * `GET /api/entities/:id`. The enriched `activity_group` and per-entity command
 * lists are absent here — see {@link ActivityFull} (ADR 0009).
 */
export type ActivityBasic = {
  entity_id: string;
  entity_type: EntityType.activity;
  integration_id: string;
  device_class?: string;
  name: LanguageText;
  description?: LanguageText;
  icon?: string;
  features?: "on_off" | "start";
  options?: {
    editable: boolean;
    sequences: ActivitySequences;
    button_mapping: DeviceButtonMapping[];
    user_interface: ActivityUserInterface;
    included_entities?: IncludedEntity[];
    prevent_sleep?: boolean;
    ready_check?: boolean;
    touch_slider?: ActivityTouchSlider;
    voice_assistant?: {
      target: {
        entity_id?: string;
        profile_id?: string;
      };
    };
  };
  attributes?: {
    state?: string;
    value?: string;
    unit?: string;
  };
};

/**
 * Full activity from the dedicated endpoint (`getActivity`): adds the enriched
 * `activity_group` and per-entity command lists ({@link IncludedEntityFull}) as
 * required fields (ADR 0009).
 */
export type ActivityFull = Omit<ActivityBasic, "options"> & {
  options?: Omit<NonNullable<ActivityBasic["options"]>, "included_entities"> & {
    activity_group: ActivityGroup;
    included_entities?: IncludedEntityFull[];
  };
};

/**
 * Transitional alias for the basic phase. Prefer {@link ActivityBasic}
 * (events / list) or {@link ActivityFull} (dedicated fetch) at new call sites.
 */
export type Activity = ActivityBasic;

export type ActivityUpdate = {
  name?: LanguageText;
  description?: LanguageText;
  icon?: IconIdentifier;
  options?: {
    entity_ids?: string[];
    sequences?: ActivitySequences;
    button_mapping?: DeviceButtonMapping[];
    user_interface?: ActivityUserInterface;
    prevent_sleep?: boolean;
    ready_check?: boolean;
    touch_slider?: ActivityTouchSlider;
    voice_assistant?: {
      target?: {
        entity_id?: string;
        profile_id?: string;
      };
    };
  };
};

export type ActivitySequences = {
  on: CommandSequence[];
  off: CommandSequence[];
};

export type ActivityUserInterface = {
  pages: ActivityUserInterfacePage[];
};

export type NewActivityUserInterfacePage = {
  page_id?: string;
  name: string;
  items?: ActivityUserInterfaceItem[];
  grid?: ActivityUserInterfaceGrid;
};

export type ActivityUserInterfacePage = {
  page_id: string;
  name?: string;
  items: ActivityUserInterfaceItem[];
  grid: ActivityUserInterfaceGrid;
};

export type ActivityUserInterfacePageUpdate = {
  page_id: string;
  name?: string;
  items?: ActivityUserInterfaceItem[];
  grid?: ActivityUserInterfaceGrid;
};

export type ActivityUserInterfaceGridItem = {
  x: number;
  y: number;
  w: number;
  h: number;
  i: string;
  item: ActivityUserInterfaceItem;
};

export type ActivityUserInterfaceItem = {
  type:
    | "icon"
    | "text"
    | "numpad"
    | "media_player"
    | "slider"
    | "jump"
    | "sensor"
    | "select";
  icon?: IconIdentifier;
  text?: string;
  media_player_id?: string;
  sensor?: {
    sensor_id: string;
    show_label?: boolean;
    show_unit?: boolean;
  };
  select?: {
    select_id: string;
    show_name?: boolean;
  };
  command?: EntityCommand;
  short_press?: EntityCommand;
  double_press?: EntityCommand;
  long_press?: EntityCommand;
  location: GridLocation;
  size: GridItemSize;
};

export type ActivityUserInterfaceGrid = {
  height: number;
  width: number;
};

export type ActivityTouchSlider = {
  enabled: boolean;
  target?: {
    entity_id: string;
    feature?: string;
  };
};

export type EntityCommand = {
  entity_id?: string;
  cmd_id?: string;
  params?: CommandParameter;
};

// I'm a big fan of collections, but somehow the Map was never serialized in the json payload in services/activities:update
// export type CommandParameter = Map<string, any>;
// Therefore, back a plain object
export type CommandParameter = {
  [key: string]: any;
};

export type CommandItem = (EntityCommandListItem | DelayCommandListItem) & {
  command_type: "delay" | "simple" | "entity" | null;
};

export type DelayCommandListItem = {
  type: SequenceType.delay;
  cmd: CommandSequenceDelay;
};

export type EntityCommandListItem = {
  type: SequenceType.command;
  cmd: EntityCommandMetadata;
  id?: string;
  entity?: IncludedEntity;
};

export type CommandSequenceListItem = {
  command_type: "delay" | "simple" | "entity" | null;
  pos: number;
  list?: string;
  id?: string;
  type: SequenceType;
  cmd?: EntityCommandMetadata;
  entity?: IncludedEntity;
  sequence: CommandSequence;
};

export type EntityCommandMetadata = {
  id: string;
  cmd_id: string;
  name: LanguageText;
  params?: EntityCmdParam[] | CommandParameter;
  entity_id?: string;
  entity_name?: LanguageText;
};

export type EntityCmdParam =
  | EntityCmdParamNumber
  | EntityCmdParamBool
  | EntityCmdParamRegex
  | EntityCmdParamEnum
  | EntityCmdParamSelection;

export type EntityCommandMetadataParamBase = {
  name: LanguageText;
  param: string;
  type: "number" | "bool" | "regex" | "enum" | "selection";
  optional?: boolean;
};

export type EntityCmdParamNumber = EntityCommandMetadataParamBase & {
  min?: number;
  max?: number;
  default?: number;
  step?: number;
  //value?: number;
  unit?: string;
};

export type EntityCmdParamBool = EntityCommandMetadataParamBase & {
  default?: boolean;
};

export type EntityCmdParamRegex = EntityCommandMetadataParamBase & {
  regex?: string;
  default?: string;
};

export type EntityCmdParamEnum = EntityCommandMetadataParamBase & {
  values: string[];
  default?: string;
};

export type EntityCmdParamSelection = EntityCommandMetadataParamBase & {
  items: ParamSelectionItems;
};

export type EntityCmdParamChange = {
  paramValue: string | number | boolean | null;
  paramName?: string;
};

export type ParamSelectionItems = {
  source: string;
  field: string;
};

export type DeviceButtonLayout = {
  type: DeviceButtonGroup;
  grid: {
    width: number;
    height: number;
  };
  buttons: DeviceButton[];
};

export type DeviceButton = {
  button: string;
  icon: IconIdentifier;
  name: LanguageText;
  location: GridLocation;
  size: GridItemSize;
};

export type TouchSlider = {
  button: string;
  name: LanguageText;
};

export type DeviceButtonMapping = {
  button: string;
  short_press?: EntityCommand;
  double_press?: EntityCommand;
  long_press?: EntityCommand;
};

export type DeviceScreenLayout = {
  grid: {
    default: ActivityUserInterfaceGrid;
    min: ActivityUserInterfaceGrid;
    max: ActivityUserInterfaceGrid;
  };
};

export type GridLocation = {
  x: number;
  y: number;
};

export type GridItemSize = {
  width: number;
  height: number;
};

export type DeviceButtonMappingChange = {
  button: DeviceButtonMapping;
  pressType?: ButtonMappingPressType;
  cmd?: EntityCommand;
};
