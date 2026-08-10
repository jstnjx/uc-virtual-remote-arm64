import i18next from "../i18next";

import type {
  AvailableEntity,
  ConfiguredEntity,
} from "@/types/integrationInstance";
import type { Activity, IncludedEntity } from "@/types/activity";
import type { Remote } from "@/types/remote";
import type { Macro } from "@/types/macro";
import { EntityType } from "@/types/enums";

import { searchLanguageText } from "@/composables/translatedProperty";
import { formatDate } from "@/composables/date";
import { normalizeState } from "@/utils/state";

export function isEntityMatchFilter(entity: ConfiguredEntity, search: string) {
  if (!search) {
    return true;
  }
  return (
    searchLanguageText(entity.name, search) ||
    searchLanguageText(entity.description, search) ||
    entity.entity_id.toLowerCase().includes(search) ||
    entity.entity_type.toLowerCase().includes(search) ||
    (entity.device_class || "").toLowerCase().includes(search)
  );
}

const iconMap: Record<string, string> = {
  button: "power-on",
  cover: "blind",
  media_player: "music",
  macro: "macro",
  activity: "activity",
  voice_assistant: "microphone",
};

export function getDefaultEntityIcon(
  entity:
    | AvailableEntity
    | ConfiguredEntity
    | IncludedEntity
    | Activity
    | Remote
    | Macro,
) {
  let icon = (entity as any)?.icon;
  if (icon) {
    return icon;
  }

  icon = (
    (entity.entity_type && iconMap[entity.entity_type]) ||
    entity.entity_type
  )?.replace("_", "-");
  return "uc:" + icon;
}

export function getPrimaryCommandByEntityState(
  entity: ConfiguredEntity | Remote,
  omitPrefix = false,
) {
  const prefix =
    !omitPrefix && entity && entity.entity_type ? `${entity.entity_type}.` : "";
  const entityFeatures = entity.features || [];
  const entityState = normalizeState(entity.attributes?.state);

  if (entityState == "unavailable") {
    return null;
  }

  if (
    entity &&
    entity.entity_type &&
    entity.entity_type == EntityType.media_player
  ) {
    if (entityFeatures.includes("play_pause")) {
      return `${prefix}play_pause`;
    } else if (
      entityState == "off" &&
      (entityFeatures.includes("on") || entityFeatures.includes("on_off"))
    ) {
      return `${prefix}on`;
    } else if (
      entityState == "on" &&
      (entityFeatures.includes("off") || entityFeatures.includes("on_off"))
    ) {
      return `${prefix}off`;
    }
  }

  if (entity && entity.entity_type && entity.entity_type == EntityType.cover) {
    if (entityState == "closed" || entityState == "unknown") {
      return `${prefix}open`;
    } else if (entityState == "open") {
      return `${prefix}close`;
    }
  }

  if (entity && entity.entity_type && entity.entity_type == EntityType.remote) {
    if (entityState == "unknown") {
      if (entityFeatures.includes("toggle")) {
        return `${prefix}toggle`;
      } else if (entityFeatures.includes("on_off")) {
        return `${prefix}on`;
      } else {
        return `${prefix}${entityFeatures[0]}`;
      }
    }
  }

  if (entity && entity.entity_type && entity.entity_type == EntityType.select) {
    return `${prefix}select_next`;
  }

  if (entityFeatures.includes("toggle")) {
    return `${prefix}toggle`;
  }

  if (entityState == "off" || entityState == "unknown") {
    return `${prefix}on`;
  } else if (entityState == "on") {
    return `${prefix}off`;
  }

  if (entityFeatures.includes("on_off")) {
    return `${prefix}off`;
  }

  return null;
}

export function getPrimaryCommandLabel(entity: ConfiguredEntity | Remote) {
  const cmd = getPrimaryCommandByEntityState(entity, true);

  if (cmd && i18next.exists(`entity.command.${cmd}`)) {
    return i18next.t(`entity.command.${cmd}`);
  } else if (cmd) {
    return i18next.t(`entity.command.toggle`);
  } else {
    return "";
  }
}

export function getItemAttrValue(
  value: unknown,
  timeFormat24h = true,
  decimals?: number,
) {
  if (value == null || value === "") return value;

  if (typeof value === "string") {
    const isoFullDateRegex =
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?)?$/;

    if (isoFullDateRegex.test(value)) {
      return formatDate(value, timeFormat24h);
    }

    return value;
  }

  if (typeof value === "number") {
    const precision =
      typeof decimals === "number" && Number.isFinite(decimals) && decimals >= 0
        ? decimals
        : 0;
    return Number(value.toFixed(precision)).toString();
  }

  return value;
}
