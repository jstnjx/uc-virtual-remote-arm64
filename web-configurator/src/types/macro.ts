import type { EntityType } from "@/types/enums";
import type { CommandSequence } from "@/types/command";
import type { IconIdentifier, LanguageText } from "@/types/config";
import type { IncludedEntity, IncludedEntityFull } from "@/types/activity";

export type MacroNewData = {
  name: LanguageText;
  icon?: string;
  description?: LanguageText;
  options?: {
    entity_ids?: string[];
  };
};

/**
 * Basic macro: the fields delivered by `entity_change` events and
 * `GET /api/entities/:id`. Per-entity command lists are absent here — see
 * {@link MacroFull} (ADR 0009 — two-phase entity typing).
 */
export type MacroBasic = {
  entity_id: string;
  entity_type: EntityType.macro;
  integration_id: string;
  device_class?: string;
  name: LanguageText;
  description?: LanguageText;
  icon?: string;
  features?: ["start"];
  options: {
    editable?: boolean;
    sequence?: CommandSequence[];
    included_entities?: IncludedEntity[];
  };
  attributes?: {
    state?: string;
    value?: string;
    unit?: string;
  };
};

/**
 * Full macro from the dedicated endpoint (`getMacro`): the included entities
 * carry their command lists ({@link IncludedEntityFull}) as required fields
 * (ADR 0009).
 */
export type MacroFull = Omit<MacroBasic, "options"> & {
  options: Omit<MacroBasic["options"], "included_entities"> & {
    included_entities?: IncludedEntityFull[];
  };
};

/**
 * Transitional alias for the basic phase. Prefer {@link MacroBasic}
 * (events / list) or {@link MacroFull} (dedicated fetch) at new call sites.
 */
export type Macro = MacroBasic;

export type MacroUpdate = {
  name?: LanguageText;
  description?: LanguageText;
  icon?: IconIdentifier;
  options: {
    entity_ids?: string[];
    sequence?: CommandSequence[];
  };
};
