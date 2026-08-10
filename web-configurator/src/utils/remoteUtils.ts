import type { ActivityUserInterfaceItem } from "@/types/activity";

/**
 * Axis descriptor for {@link adjustWidgetAxis} (P3-6 C). The height and width
 * adjusters were axis-mirrored clones; the only real asymmetry is that width is
 * set to the exact target even when shrinking, while height only ever grows to
 * a minimum. `allowShrink` captures that difference.
 */
interface WidgetAxis {
  /** Size dimension being adjusted. */
  size: "width" | "height";
  /** Location coordinate shifted when a grow causes a collision. */
  loc: "x" | "y";
  /** Set the exact target even when the media player shrinks (width only). */
  allowShrink: boolean;
}

const HEIGHT_AXIS: WidgetAxis = {
  size: "height",
  loc: "y",
  allowShrink: false,
};
const WIDTH_AXIS: WidgetAxis = { size: "width", loc: "x", allowShrink: true };

/**
 * Grow (and, for width, shrink) media-player widgets along one axis, shifting
 * colliding items out of the way. Shared core for {@link adjustWidgetHeights}
 * and {@link adjustWidgetWidths}.
 *
 * @param pageItems The list of items on the current page.
 * @param target The target size along `axis.size`.
 * @param axis The axis descriptor (height or width).
 * @returns true if any changes were made, false otherwise.
 */
function adjustWidgetAxis(
  pageItems: ActivityUserInterfaceItem[],
  target: number,
  axis: WidgetAxis,
): boolean {
  let doSave = false;

  for (const item of pageItems) {
    const diff = target - item.size[axis.size];
    if (item.type === "media_player" && diff > 0) {
      item.size[axis.size] = target;
      let hasCollision = false;

      for (const itm of pageItems) {
        if (item === itm) continue;

        // Check for overlap (AABB)
        if (
          item.location.x < itm.location.x + itm.size.width &&
          itm.location.x < item.location.x + item.size.width &&
          item.location.y < itm.location.y + itm.size.height &&
          itm.location.y < item.location.y + item.size.height
        ) {
          hasCollision = true;
          break;
        }
      }

      if (hasCollision) {
        for (const itm of pageItems) {
          if (
            item !== itm &&
            itm.location[axis.loc] >= item.location[axis.loc]
          ) {
            itm.location[axis.loc] = itm.location[axis.loc] + diff;
          }
        }
      }

      doSave = true;
    } else if (axis.allowShrink && item.type === "media_player" && diff !== 0) {
      item.size[axis.size] = target;
      doSave = true;
    }
  }

  return doSave;
}

/**
 * Calculates and updates widget heights for media players.
 *
 * @param pageItems The list of items on the current page.
 * @param mediaMinHeight The calculated minimum height for media players.
 * @returns true if any changes were made, false otherwise.
 */
export function adjustWidgetHeights(
  pageItems: ActivityUserInterfaceItem[],
  mediaMinHeight: number,
): boolean {
  return adjustWidgetAxis(pageItems, mediaMinHeight, HEIGHT_AXIS);
}

/**
 * Calculates and updates widget widths for media players.
 *
 * @param pageItems The list of items on the current page.
 * @param newWidth The new width to set for media players.
 * @returns true if any changes were made, false otherwise.
 */
export function adjustWidgetWidths(
  pageItems: ActivityUserInterfaceItem[],
  newWidth: number,
): boolean {
  return adjustWidgetAxis(pageItems, newWidth, WIDTH_AXIS);
}
