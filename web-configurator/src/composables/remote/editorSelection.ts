import { ref } from "vue";

import type { PageItemIndex } from "@/types/grid";

/**
 * Multi-selection state for the page editor, keyed by (page index, item index).
 *
 * Carved out of `useEditorKeyboardEvents`: it owns its own `selectedItems` ref
 * and toggle helpers, and the editor composable spreads the result into its
 * return so consumers keep the same surface.
 */
export function useItemSelection() {
  const selectedItems = ref<PageItemIndex[]>([]);

  function toggleItemSelect(page: number, index: number) {
    const itemInd = selectedItems.value.findIndex(
      (obj) => obj.pageIndex === page && obj.itemIndex === index,
    );
    if (itemInd < 0) {
      selectedItems.value.push({ pageIndex: page, itemIndex: index });
    } else {
      selectedItems.value.splice(itemInd, 1);
    }
  }

  function itemSelected(page: number, index: number) {
    return (
      selectedItems.value.findIndex(
        (obj) => obj.pageIndex === page && obj.itemIndex === index,
      ) > -1
    );
  }

  return { selectedItems, toggleItemSelect, itemSelected };
}
