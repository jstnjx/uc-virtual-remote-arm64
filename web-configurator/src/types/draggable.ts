export type DraggableChange = {
  element: any;
};
export type DraggableAdded = DraggableChange & {
  newIndex: number;
};
export type DraggableRemoved = DraggableChange & {
  oldIndex: number;
};

export type DraggableMoved = DraggableChange & {
  oldIndex: number;
  newIndex: number;
};

export type DraggableChangeEvent = {
  added?: DraggableAdded;
  moved?: DraggableMoved;
  removed?: DraggableRemoved;
};

/**
 * The SortableJS drag event surfaced by vuedraggable's `@start` / `@end`.
 * vuedraggable 4.x ships no usable type for it (OQ-2), so we model the
 * fields we consume locally.
 */
export type DraggableSortEvent = {
  oldDraggableIndex: number;
  originalEvent: MouseEvent;
};
