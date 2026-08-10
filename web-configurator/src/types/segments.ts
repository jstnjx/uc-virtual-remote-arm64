import type { CfgGroups, SettingTypes } from "@/types/enums";

export type SegmentDefinition = {
  title: string;
  items: SegmentItemDefinition[];
};

export type SegmentItemDefinition = {
  name: string;
  group?: CfgGroups;
  type?: SettingTypes;
  icon?: string;
  value?: unknown;
  settings?: object;
  title?: string;
  description?: string;
};
