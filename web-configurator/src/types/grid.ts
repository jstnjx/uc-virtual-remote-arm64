import type { ComponentPublicInstance } from "vue";

export type GridItemComponent = ComponentPublicInstance & {
  calcXY: (top: number, left: number) => { x: number; y: number };
};

export type GridLayoutComponent = ComponentPublicInstance & {
  dragEvent: (
    eventName: string,
    id: string,
    x: number,
    y: number,
    h: number,
    w: number,
  ) => void;
};

export type PageItemIndex = {
  pageIndex: number;
  itemIndex: number;
};
