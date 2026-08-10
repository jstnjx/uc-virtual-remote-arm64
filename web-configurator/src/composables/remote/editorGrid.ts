import type {
  ActivityUserInterfaceGrid,
  ActivityUserInterfaceGridItem,
  ActivityUserInterfaceItem,
  ActivityUserInterfacePage,
} from "@/types/activity";

/**
 * Pure grid geometry and layout helpers for the page editor.
 *
 * These functions carry no editor state: everything they need is passed in.
 * They were carved out of the `useEditorKeyboardEvents` composable so the
 * collision/placement/layout math can be reasoned about and tested in
 * isolation. The composable keeps the reactive refs and delegates here.
 */

/**
 * Given two layoutitems, check if they collide.
 *
 * @return {Boolean}   True if colliding.
 */
export function collides(
  l1: ActivityUserInterfaceGridItem,
  l2: ActivityUserInterfaceGridItem,
): boolean {
  // same element.
  if (l1.item === l2.item) {
    return false;
  }

  // l1 is left of l2
  if (l1.x + l1.w <= l2.x) {
    return false;
  }

  // l1 is right of l2
  if (l1.x >= l2.x + l2.w) {
    return false;
  }

  // l1 is above l2
  if (l1.y + l1.h <= l2.y) {
    return false;
  }

  // l1 is below l2
  if (l1.y >= l2.y + l2.h) {
    return false;
  }
  // boxes overlap
  return true;
}

export function getAllCollisions(
  layout: ActivityUserInterfaceGridItem[],
  layoutItem: ActivityUserInterfaceGridItem,
): ActivityUserInterfaceGridItem[] {
  return layout.filter((l) => {
    return collides(l, layoutItem);
  });
}

export function validateChange(
  items: ActivityUserInterfaceItem[],
  updatedIndex: number,
  newValues: ActivityUserInterfaceItem,
) {
  const list = items.map((item, index) => {
    return {
      x: item.location?.x || 0,
      y: item.location?.y || 0,
      w: item.size?.width || 1,
      h: item.size?.height || 1,
      i: index.toString(),
      item,
    } as ActivityUserInterfaceGridItem;
  });
  const checkItem = {
    ...list[updatedIndex],
    w: newValues.size.width,
    h: newValues.size.height,
  };
  return getAllCollisions(list, checkItem).length === 0;
}

/**
 * Return the lowest bottom edge that pokes below `height`, or -1 if the whole
 * layout stays within it.
 */
export function offTheGrid(
  newLayout: ActivityUserInterfaceGridItem[],
  height: number,
) {
  let newHeight = -1;
  for (let index = 0; index < newLayout.length; index++) {
    const itemBottom = newLayout[index].h + newLayout[index].y;
    if (itemBottom > height && itemBottom > newHeight) {
      newHeight = itemBottom;
    }
  }

  return newHeight;
}

export function buildLayout(items: ActivityUserInterfaceItem[]) {
  return items.map((item, index: number) => {
    return {
      x: item.type === "numpad" ? 0 : item.location.x,
      y: item.type === "numpad" ? 0 : item.location.y,
      w: item.size?.width || 1,
      h: item.size?.height || 1,
      i: index.toString(),
      item,
    };
  });
}

/**
 * True if the `width`x`height` box at (`x`,`y`) leaves the grid or overlaps an
 * existing item on `page`.
 */
export function isOccupiedSpace(
  page: ActivityUserInterfacePage,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  for (const obj of page.items) {
    const objX = obj.location.x;
    const objY = obj.location.y;
    const objWidth = obj.size && obj.size.width ? obj.size.width : 1;
    const objHeight = obj.size && obj.size.height ? obj.size.height : 1;

    if (x + width > page.grid.width || y + height > page.grid.height) {
      return true;
    }

    if (
      x < objX + objWidth &&
      x + width > objX &&
      y < objY + objHeight &&
      y + height > objY
    ) {
      return true;
    }
  }
  return false;
}

export function getButtonSize(colNumber: number, rowNumber: number) {
  if (colNumber > 6 || rowNumber > 10) {
    return "content-size--xs";
  }
  if (colNumber > 4 || rowNumber > 8) {
    return `content-size--sm col-buttons--${colNumber}`;
  }
  if (colNumber > 3 || rowNumber > 6) {
    return "content-size--md";
  }
  if (colNumber == 1) {
    return "content-size--full-width";
  }
  return "content-size--md";
}

/**
 * Absolute CSS placement for an empty-cell overlay at (`x`,`y`).
 *
 * The overlay has to sit exactly on the cell that `.ui-page__background` draws,
 * so it is expressed the way that flex layout is, not in pixels: percentages of
 * the shared containing block (`.ui-page__content`), spaced by the same
 * `--ui-page-grid-gap` / `--ui-page-grid-pad` variables that style the
 * background. Pixel math needed the grid area's size and the gap constants
 * duplicated in JS, and drifted whenever either changed — a CSS-only breakpoint
 * moved the gap from 8px to 6px without the JS knowing.
 *
 * @param cellGrid - the page's grid in cell counts
 */
export function getEmptyItemStyle(
  cellGrid: ActivityUserInterfaceGrid,
  x: number,
  y: number,
) {
  const gap = "var(--ui-page-grid-gap)";
  const pad = "var(--ui-page-grid-pad)";
  // Percentages resolve against the containing block's width for left/width and
  // its height for top/height, so one formula serves both axes.
  const cell = (count: number) =>
    `(100% - 2 * ${pad} - ${count - 1} * ${gap}) / ${count}`;
  const offset = (count: number, index: number) =>
    `calc(${pad} + ${index} * ((${cell(count)}) + ${gap}))`;

  let itemStyle = `left:${offset(cellGrid.width, x)};`;
  itemStyle += `top:${offset(cellGrid.height, y)};`;
  itemStyle += `width:calc(${cell(cellGrid.width)});`;
  itemStyle += `height:calc(${cell(cellGrid.height)});`;

  return itemStyle;
}
