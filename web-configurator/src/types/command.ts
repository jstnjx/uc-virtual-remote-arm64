import type { EntityCommand } from "@/types/activity";
import type { SequenceType, EntityType } from "@/types/enums";
import type { LanguageText } from "@/types/config";

export type CommandSequence = CommandSequenceEntity | CommandSequenceDelay;
export type CommandSequenceEntity = {
  type: SequenceType.command;
  command: EntityCommand;
};
export type CommandSequenceDelay = {
  type: SequenceType.delay;
  delay: number;
};

export type ActiveSequence = {
  type?: "on" | "off" | "run" | null;
  state: string;
  steps: SequenceStep[];
  totalSteps: number;
};

export type SequenceStep = {
  index: number;
  command?: EntityCommand;
  entity?: SequenceStepEntity;
  state?: string;
  error?: string;
};

export type SequenceStepEntity = {
  integration_id: string;
  name: LanguageText;
  type: EntityType;
};

export type MsgRunningSequence = {
  ignore_errors: boolean;
  skip_missing_entities: boolean;
  state: string;
  step?: SequenceStep;
  timeout?: number;
  total_steps?: number;
};
