/**
 * Derivation test for INTEGRATION_ENTITY_TYPES (dedup-copy-paste-families D).
 * The list is derived from the EntityType enum by excluding the types owned
 * elsewhere. This pins the derived set to the intended hand-written list and
 * fails loudly if EntityType gains a value the include/exclude filter does not
 * classify (i.e. a new integration entity type that is not deliberately
 * excluded).
 */
import { describe, expect, test } from "vitest";
import { INTEGRATION_ENTITY_TYPES } from "@/stores/integrations";
import { EntityType } from "@/types/enums";

describe("INTEGRATION_ENTITY_TYPES", () => {
  test("deep-equals the intended hand-written list (order included)", () => {
    expect(INTEGRATION_ENTITY_TYPES).toEqual([
      "button",
      "climate",
      "cover",
      "light",
      "media_player",
      "sensor",
      "switch",
      "select",
    ]);
  });

  test("excludes exactly activity, macro and remote from the enum", () => {
    const excluded = [EntityType.activity, EntityType.macro, EntityType.remote];
    const expected = Object.values(EntityType).filter(
      (t) => !excluded.includes(t),
    );
    expect(INTEGRATION_ENTITY_TYPES).toEqual(expected);
    // every excluded value is genuinely absent
    for (const t of excluded) {
      expect(INTEGRATION_ENTITY_TYPES).not.toContain(t);
    }
  });
});
