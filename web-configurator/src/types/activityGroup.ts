import type { IconIdentifier, LanguageText } from "@/types/config";
import type { RemoveTurnOnDelays, TurnOffUnusedEntities } from "@/types/enums";
import type { Activity } from "@/types/activity";

export type ActivityGroupNewData = {
  name: LanguageText;
  icon?: IconIdentifier;
  description?: LanguageText;
  activity_ids: string[];
  options?: ActivityGroupOptions;
};

export type ActivityGroup = {
  group_id: string;
  name: LanguageText;
  icon?: IconIdentifier;
  description?: LanguageText;
  activity_count?: number;
  state?: "ACTIVE" | "OFF";
  activities?: Activity[];
  options?: ActivityGroupOptions;
};

export type ActivityGroupOptions = {
  remove_turn_on_delays?: RemoveTurnOnDelays | "";
  turn_off_unused_entities?: TurnOffUnusedEntities | "";
};

export type ActivityGroupUpdate = {
  name?: LanguageText;
  description?: LanguageText;
  icon?: IconIdentifier;
  activity_ids?: string[];
  options?: object;
};
