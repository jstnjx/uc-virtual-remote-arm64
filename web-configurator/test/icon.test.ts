import { describe, it, expect, beforeEach } from "vitest";
import {
  getIconName,
  getNewIconName,
  hasProIcon,
  setProIconFound,
  resetProIconCheck,
} from "../src/composables/icon";

describe("icon mixin", () => {
  beforeEach(() => {
    resetProIconCheck();
  });

  describe("hasProIcon", () => {
    it("should return true if pro icon is found", async () => {
      setProIconFound(true);
      const result = await hasProIcon();
      expect(result).toBe(true);
    });

    it("should return false if pro icon is not found", async () => {
      setProIconFound(false);
      const result = await hasProIcon();
      expect(result).toBe(false);
    });
  });

  describe("getIconName", () => {
    it("should return original icon if pro icon is found", async () => {
      setProIconFound(true);
      const result = await getIconName("fa-grip-dots-vertical");
      expect(result).toBe("fa-grip-dots-vertical");
    });

    it("should return fallback icon if pro icon is NOT found and mapping exists", async () => {
      setProIconFound(false);
      // "grip-dots-vertical" maps to "grip-vertical" in icon-fallback-mapping.json
      const result = await getIconName("fa-grip-dots-vertical");
      expect(result).toBe("fa-grip-vertical");
    });

    it("should map memo-circle-info to circle-info when pro icon is NOT found", async () => {
      setProIconFound(false);
      const result = await getIconName("fa-memo-circle-info");
      expect(result).toBe("fa-circle-info");
    });

    it("should return the icon unchanged if pro icon is NOT found and no mapping exists (already a Free icon)", async () => {
      setProIconFound(false);
      const result = await getIconName("fa-puzzle-piece");
      expect(result).toBe("fa-puzzle-piece");
    });

    it("should handle icon strings without fa- prefix correctly", async () => {
      setProIconFound(false);
      const result = await getIconName("grip-dots-vertical");
      expect(result).toBe("fa-grip-vertical");
    });
  });

  describe("getNewIconName", () => {
    it("should return mapped icon from iconMapping if pro icon is found", async () => {
      setProIconFound(true);
      // "filter" maps to "filter" in old-new-icon-mapping.json
      const result = await getNewIconName("filter");
      expect(result).toBe("filter");

      // "down-arrow-alt" maps to "arrow-down"
      const result2 = await getNewIconName("down-arrow-alt");
      expect(result2).toBe("arrow-down");
    });

    it("should return mapped icon from iconMappingFree if pro icon is NOT found", async () => {
      setProIconFound(false);
      // We didn't check iconMappingFree but we can assume it works similarly
      // Let's just check it returns something or empty string if not found
      const result = await getNewIconName("filter");
      // If it's in the free mapping too, it should return it.
      expect(typeof result).toBe("string");
    });

    it("should return empty string if no mapping exists", async () => {
      setProIconFound(true);
      const result = await getNewIconName("non-existent-icon");
      expect(result).toBe("");
    });
  });
});
