import type {
  Activity,
  ActivityFull,
  CommandItem,
  CommandParameter,
  CommandSequenceListItem,
  EntityCmdParamBool,
  EntityCmdParamEnum,
  EntityCmdParamNumber,
  EntityCmdParamRegex,
  EntityCmdParamSelection,
  EntityCommandMetadata,
  IncludedEntity,
  IncludedEntityFull,
} from "@/types/activity";

import type {
  CommandSequence,
  CommandSequenceDelay,
  CommandSequenceEntity,
} from "@/types/command";
import type { ConfiguredEntity } from "@/types/integrationInstance";
import type { EntityType } from "@/types/enums";
import {
  SequenceType,
  RemoveTurnOnDelays,
  TurnOffUnusedEntities,
  BinarySensorUnit,
  BinarySensorUnitOn,
  BinarySensorUnitOff,
} from "@/types/enums";
import { computed, ref } from "vue";
import type { Ref } from "vue";
import type { TFunction } from "i18next";

export function getAvailableEntitesForActivityByType(
  activity: Activity,
  type: EntityType,
): IncludedEntity[] {
  return (activity.options?.included_entities || []).filter((entity) => {
    return entity.entity_type === type;
  });
}

export function getAvailableCommandsForActivity(
  activity: ActivityFull,
  commandMetadata: EntityCommandMetadata[],
): CommandItem[] {
  const commands: CommandItem[] = [];
  (activity.options?.included_entities || []).forEach(
    (entity: IncludedEntityFull) => {
      commands.push(...getAvailableEntityCommands(entity, commandMetadata));
    },
  );
  return commands;
}

export function getAvailableEntityCommands(
  entity: IncludedEntityFull,
  commandMetadata: EntityCommandMetadata[],
): CommandItem[] {
  const commands: string[] = [];

  if (entity.entity_commands && entity.entity_commands.length) {
    commands.push(...entity.entity_commands);
  }
  if (entity.simple_commands && entity.simple_commands.length) {
    commands.push(...entity.simple_commands);
  }
  return commands.map((id) => {
    let type: "simple" | "entity" | null = null;
    if (entity.simple_commands?.includes(id)) {
      type = "simple";
    } else if (entity.entity_commands?.includes(id)) {
      type = "entity";
    }

    let cmd;
    if (type === "entity") {
      cmd = commandMetadata.find((cmd: EntityCommandMetadata) => {
        return cmd.id === id;
      });

      if (!cmd) {
        cmd = {
          id,
          cmd_id: id,
          name: { en: id },
          entity_id: entity.entity_id,
          entity_name: entity.name,
        } as EntityCommandMetadata;
      }
    } else if (type === "simple") {
      cmd = {
        id,
        cmd_id: id,
        name: { en: id },
        entity_id: entity.entity_id,
        entity_name: entity.name,
      } as EntityCommandMetadata;
    }
    return {
      command_type: type,
      type: SequenceType.command,
      id: entity.entity_id + ":" + id,
      cmd: cmd as EntityCommandMetadata,
      entity,
    };
  });
}

export function sequencesToListItems(
  sequences: CommandSequence[],
  allEntities: ConfiguredEntity[],
  commandMetadata: EntityCommandMetadata[],
): CommandSequenceListItem[] {
  return sequences.map((sequence: CommandSequence, pos: number) => {
    if (sequence.type === SequenceType.delay) {
      return {
        command_type: "delay",
        pos,
        type: SequenceType.delay,
        sequence,
      };
    }
    const entity = allEntities.find((item: IncludedEntity) => {
      return item.entity_id === sequence.command.entity_id;
    });
    let cmd = commandMetadata.find((item: EntityCommandMetadata) => {
      return item.id === sequence.command.cmd_id;
    });

    if (!cmd && sequence.command.cmd_id) {
      cmd = {
        id: sequence.command.cmd_id,
        cmd_id: sequence.command.cmd_id,
        name: { en: sequence.command.cmd_id },
        entity_name: entity?.name,
        entity_id: entity?.entity_id || sequence.command.entity_id,
      };
    }
    return {
      command_type: "entity",
      pos,
      id: entity?.entity_id + ":" + cmd?.id,
      type: SequenceType.command,
      cmd,
      entity,
      sequence,
    };
  });
}

export function createSequenceForUpdate(
  items: CommandSequenceListItem[],
  entity_ids: string[],
): CommandSequence[] {
  return items
    .map((item) => {
      if (item.type === SequenceType.delay) {
        return (
          item.sequence ||
          ({
            type: "delay",
            delay: 200,
          } as CommandSequenceDelay)
        );
      }

      const sequence = item.sequence as CommandSequenceEntity;

      // handle new step in sequence
      if (!sequence && item.cmd) {
        return createNewSequenceItem(item);
      }

      // update existing step in sequence
      return sequence;
    })
    .filter((item) => {
      if (item.type === SequenceType.delay || !item.command?.entity_id) {
        return true;
      }
      return entity_ids.includes(item.command.entity_id);
    });
}

function createNewSequenceItem(
  item: CommandSequenceListItem,
): CommandSequenceEntity {
  if (!item.cmd) {
    throw new Error(`item.cmd must be set for a new command item`);
  }

  if (item.command_type === "simple") {
    return {
      type: "command",
      command: {
        cmd_id: item.cmd.cmd_id,
        entity_id: item.cmd.entity_id,
      },
    } as CommandSequenceEntity;
  } else if (item.command_type === "entity") {
    const params = createNewCommandParams(item.cmd);
    return {
      type: item.type,
      command: {
        cmd_id: item.cmd.id,
        entity_id: item.entity?.entity_id,
        params: params,
      },
    } as CommandSequenceEntity;
  } else {
    throw new Error(`only simple and entity command_type allowed`);
  }
}

function createNewCommandParams(
  entityCommandMetadata: EntityCommandMetadata,
): CommandParameter {
  let params = {};
  if (Array.isArray(entityCommandMetadata.params)) {
    for (const param of entityCommandMetadata.params) {
      // Skip optional param
      if (param.optional) continue;

      if (param.type === "number") {
        params = {
          ...params,
          ...createEntityCmdParamNumber(param as EntityCmdParamNumber),
        };
      } else if (param.type === "bool") {
        params = {
          ...params,
          ...createEntityCmdParamBool(param as EntityCmdParamBool),
        };
      } else if (param.type === "regex") {
        params = {
          ...params,
          ...createEntityCmdParamRegex(param as EntityCmdParamRegex),
        };
      } else if (param.type === "enum") {
        params = {
          ...params,
          ...createEntityCmdParamEnum(param as EntityCmdParamEnum),
        };
      } else if (param.type === "selection") {
        params = {
          ...params,
          ...createEntityCmdParamSelection(param as EntityCmdParamSelection),
        };
      } else {
        console.warn(`Unsupported parameter type: ${param.name}`);
      }
    }
  }

  return params;
}

function createEntityCmdParamNumber(
  param: EntityCmdParamNumber,
): CommandParameter {
  return {
    [param.param]: param.default ?? param.min ?? 0,
  } as CommandParameter;
}

function createEntityCmdParamBool(param: EntityCmdParamBool) {
  return {
    [param.param]: param.default ?? false,
  } as CommandParameter;
}

function createEntityCmdParamRegex(param: EntityCmdParamRegex) {
  // TODO check if for a regex value the param object could be omitted for the initial save, because we most likely don't have a valid value
  return {
    [param.param]: param.default ?? "",
  } as CommandParameter;
}

function createEntityCmdParamEnum(param: EntityCmdParamEnum) {
  const value = param.default ?? param.values[0];

  if (value !== undefined) {
    return { [param.param]: value } as CommandParameter;
  }

  return {} as CommandParameter;
}

function createEntityCmdParamSelection(param: EntityCmdParamSelection) {
  // TODO default value. Check if defined in API, if not: decide if we should add it.
  return {
    [param.param]: "",
  } as CommandParameter;
}

// TODO(#254) verify return type! Try & error from a non-JS dev :-) And there are too many any's for my taste...
export function getSelectionParamOptions(
  params: any[],
  currentEntity: ConfiguredEntity,
): Ref<Record<string, any>> {
  const selectionOptions = ref<Record<string, any>>({});

  params.forEach((param) => {
    const par = param.param as string;
    // #254 get list field name from command metadata: integrationStorage.commands[x].params[y].items.source & field
    const source = param.items?.source as string;
    const field = param.items?.field;
    if (source === "attributes" && currentEntity.attributes) {
      if (
        field &&
        currentEntity.attributes &&
        Object.prototype.hasOwnProperty.call(currentEntity.attributes, field)
      ) {
        selectionOptions.value[par] = (currentEntity.attributes as any)[field];
      } else {
        console.error(
          `[${currentEntity.entity_id}] invalid command params.items.field for source: ${source}`,
        );
      }
    } else if (source === "options" && currentEntity.options) {
      if (
        field &&
        currentEntity.options &&
        Object.prototype.hasOwnProperty.call(currentEntity.options, field)
      ) {
        selectionOptions.value[par] = (currentEntity.options as any)[field];
      } else {
        console.error(
          `[${currentEntity.entity_id}] invalid command params.items.field for source: ${source}`,
        );
      }
    } else {
      console.error(
        `[${currentEntity.entity_id}] entity command type '${param.type}': invalid source '${source}'. Supported: ['attributes', 'options']`,
      );
    }
  });

  return selectionOptions;
}

export function getActivityGroupOptions(t: TFunction) {
  // computed, not ref: t() only re-runs on a language change when it is read
  // inside a tracked scope, so options built once would keep their language.
  const removeTurnOnDelaysOptions = computed(() => [
    {
      label: t(
        `activity_group.options.remove_turn_on_delays.options.${RemoveTurnOnDelays.previous_cmd_skipped}`,
      ),
      value: RemoveTurnOnDelays.previous_cmd_skipped,
    },
    {
      label: t(
        `activity_group.options.remove_turn_on_delays.options.${RemoveTurnOnDelays.between_skipped_cmds}`,
      ),
      value: RemoveTurnOnDelays.between_skipped_cmds,
    },
    {
      label: t(
        `activity_group.options.remove_turn_on_delays.options.${RemoveTurnOnDelays.never}`,
      ),
      value: RemoveTurnOnDelays.never,
    },
  ]);

  const turnOffUnusedEntitiesOptions = computed(() => [
    {
      label: t(
        `activity_group.options.turn_off_unused_entities.options.${TurnOffUnusedEntities.always}`,
      ),
      value: TurnOffUnusedEntities.always,
    },
    {
      label: t(
        `activity_group.options.turn_off_unused_entities.options.${TurnOffUnusedEntities.in_off_sequence}`,
      ),
      value: TurnOffUnusedEntities.in_off_sequence,
    },
    {
      label: t(
        `activity_group.options.turn_off_unused_entities.options.${TurnOffUnusedEntities.run_off_sequence}`,
      ),
      value: TurnOffUnusedEntities.run_off_sequence,
    },
    {
      label: t(
        `activity_group.options.turn_off_unused_entities.options.${TurnOffUnusedEntities.never}`,
      ),
      value: TurnOffUnusedEntities.never,
    },
  ]);

  return {
    removeTurnOnDelaysOptions,
    turnOffUnusedEntitiesOptions,
  };
}

export function getBinarySensorState(
  deviceClass: BinarySensorUnit | null | undefined,
  value: string,
): string {
  const devClass = (
    deviceClass === null || deviceClass === undefined
      ? BinarySensorUnit.none
      : deviceClass
  ) as BinarySensorUnit;
  const isOn = value?.toLowerCase() === "on";

  return isOn ? BinarySensorUnitOn[devClass] : BinarySensorUnitOff[devClass];
}
