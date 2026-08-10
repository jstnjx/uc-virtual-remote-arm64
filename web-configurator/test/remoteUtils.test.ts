import { describe, it, expect } from "vitest";
import {
  adjustWidgetHeights,
  adjustWidgetWidths,
} from "../src/utils/remoteUtils";
import type { ActivityUserInterfaceItem } from "../src/types/activity";

/**
 * Helper to create a partial ActivityUserInterfaceItem for testing.
 */
function createItem(
  type: ActivityUserInterfaceItem["type"],
  x: number,
  y: number,
  width: number,
  height: number,
): ActivityUserInterfaceItem {
  return {
    type,
    location: { x, y },
    size: { width, height },
  } as ActivityUserInterfaceItem;
}

describe("remoteUtils", () => {
  describe("adjustWidgetHeights", () => {
    it("should return false if no media players are present", () => {
      const items = [createItem("icon", 0, 0, 1, 1)];
      const result = adjustWidgetHeights(items, 2);
      expect(result).toBe(false);
    });

    it("should return false if media player height is already sufficient", () => {
      const items = [createItem("media_player", 0, 0, 4, 2)];
      const result = adjustWidgetHeights(items, 2);
      expect(result).toBe(false);
    });

    it("should update height and return true if media player height is too small", () => {
      const items = [createItem("media_player", 0, 0, 4, 2)];
      const result = adjustWidgetHeights(items, 3);
      expect(result).toBe(true);
      expect(items[0].size.height).toBe(3);
    });

    it("should detect collision and shift items down in the same column", () => {
      const player = createItem("media_player", 0, 0, 4, 2);
      const icon = createItem("icon", 0, 2, 1, 1);
      const items = [player, icon];

      // Player grows from height 2 to 3.
      // It now occupies y=0, 1, 2.
      // Icon is at y=2, so it should be shifted down by 1 (heightDiff).
      const result = adjustWidgetHeights(items, 3);

      expect(result).toBe(true);
      expect(player.size.height).toBe(3);
      expect(icon.location.y).toBe(3); // Expected: 3, Actual in current buggy code: 2
    });

    it("should NOT shift items that are in different columns and do not overlap", () => {
      const player = createItem("media_player", 0, 0, 4, 2);
      const icon = createItem("icon", 4, 1, 1, 1);
      const items = [player, icon];

      // Player grows from 2 to 3. It occupies x=0..3, y=0..2.
      // Icon is at x=4, y=1. No overlap.
      const result = adjustWidgetHeights(items, 3);

      expect(result).toBe(true);
      expect(icon.location.y).toBe(1); // Expected: 1, Actual in current buggy code: 2 (because x!=x and y!=y)
    });

    it("should detect collision and shift items down when partially overlapping columns", () => {
      const player = createItem("media_player", 0, 0, 4, 2);
      const icon = createItem("icon", 2, 2, 1, 1); // icon at x=2, player covers x=0..3
      const items = [player, icon];

      const result = adjustWidgetHeights(items, 3);

      expect(result).toBe(true);
      expect(icon.location.y).toBe(3);
    });

    it("should NOT shift items that are above the growing widget", () => {
      const player = createItem("media_player", 0, 2, 4, 2);
      const icon = createItem("icon", 0, 0, 1, 1);
      const items = [player, icon];

      const result = adjustWidgetHeights(items, 3);

      expect(result).toBe(true);
      expect(icon.location.y).toBe(0);
    });

    it("should shift all items below the growing widget when a collision occurs", () => {
      const player = createItem("media_player", 0, 0, 4, 2);
      const icon1 = createItem("icon", 0, 2, 1, 1); // Collides
      const icon2 = createItem("icon", 5, 5, 1, 1); // Below, but different column
      const items = [player, icon1, icon2];

      const result = adjustWidgetHeights(items, 3);

      expect(result).toBe(true);
      expect(icon1.location.y).toBe(3);
      expect(icon2.location.y).toBe(6);
    });

    it("should handle multiple media players growing", () => {
      const player1 = createItem("media_player", 0, 0, 4, 2);
      const player2 = createItem("media_player", 0, 4, 4, 2);
      const items = [player1, player2];

      // player1 grows 2 -> 3. No collision with player2 (at y=4).
      // player2 grows 2 -> 3.
      const result = adjustWidgetHeights(items, 3);

      expect(result).toBe(true);
      expect(player1.size.height).toBe(3);
      expect(player2.size.height).toBe(3);
      expect(player2.location.y).toBe(4);
    });

    it("should detect collision if items are at the same location", () => {
      const player = createItem("media_player", 0, 0, 4, 2);
      const icon = createItem("icon", 0, 0, 1, 1);
      const items = [player, icon];

      const result = adjustWidgetHeights(items, 3);

      expect(result).toBe(true);
      expect(icon.location.y).toBe(1); // Should be shifted by heightDiff=1
    });
  });

  describe("adjustWidgetWidths", () => {
    it("should update width of media players", () => {
      const items = [createItem("media_player", 0, 0, 4, 2)];
      const result = adjustWidgetWidths(items, 6);
      expect(result).toBe(true);
      expect(items[0].size.width).toBe(6);
    });

    it("should detect collision and shift items right in the same row", () => {
      const player = createItem("media_player", 0, 0, 4, 2);
      const icon = createItem("icon", 4, 0, 1, 1);
      const items = [player, icon];

      // Player grows from width 4 to 6.
      // It now occupies x=0..5.
      // Icon is at x=4, so it should be shifted right by 2 (widthDiff).
      const result = adjustWidgetWidths(items, 6);

      expect(result).toBe(true);
      expect(player.size.width).toBe(6);
      expect(icon.location.x).toBe(6); // Expected: 6, Actual in current buggy code: 4 (No collision logic)
    });

    it("should NOT shift items in different rows", () => {
      const player = createItem("media_player", 0, 0, 4, 2);
      const icon = createItem("icon", 0, 2, 1, 1);
      const items = [player, icon];

      // Player grows from 4 to 6. Occupies x=0..5, y=0..1.
      // Icon is at y=2. No overlap.
      const result = adjustWidgetWidths(items, 6);

      expect(result).toBe(true);
      expect(icon.location.x).toBe(0);
    });

    it("should return false if no media players are present", () => {
      const items = [createItem("icon", 0, 0, 1, 1)];
      const result = adjustWidgetWidths(items, 6);
      expect(result).toBe(false);
    });

    it("should shrink a media player to a smaller width without shifting", () => {
      // Width, unlike height, is set to the exact target even when shrinking
      // (the `widthDiff !== 0` branch). No collision shifting on shrink.
      const player = createItem("media_player", 0, 0, 4, 2);
      const icon = createItem("icon", 4, 0, 1, 1);
      const items = [player, icon];

      const result = adjustWidgetWidths(items, 2);

      expect(result).toBe(true);
      expect(player.size.width).toBe(2);
      expect(icon.location.x).toBe(4); // unchanged: no shift on shrink
    });

    it("should return false when the width is already exactly the target", () => {
      const player = createItem("media_player", 0, 0, 4, 2);
      const result = adjustWidgetWidths([player], 4);
      expect(result).toBe(false);
      expect(player.size.width).toBe(4);
    });
  });
});
