import { ref } from "vue";

import type {
  ActivityUserInterfaceItem,
  DeviceButtonMapping,
  DeviceButtonMappingChange,
} from "@/types/activity";
import type { ButtonMappingPressType } from "@/types/enums";

type ButtonPressType = typeof ButtonMappingPressType;

// The widget edit popup sits to the left of the widget it edits.
const WIDGET_POPUP_OFFSET = 368;
const MIN_POPUP_LEFT = 8;

/**
 * Widget-edit and physical-button / touch-slider edit popup state for the page
 * editor.
 *
 * This is pure reactive state: opening/closing sets refs and the popup left
 * offset, and the templates drive the grow/shrink animation declaratively with
 * `<Transition name="popup-grow">` (see `_button-list.scss`). There is no
 * imperative DOM manipulation or `setTimeout` choreography here.
 *
 * Carved out of `useEditorKeyboardEvents`: it owns its refs and has no
 * dependency on the editor's page/grid state, so the editor composable
 * destructures the pieces it needs and spreads them into its return.
 */
export function useEditorPopups() {
  const editButton = ref<ActivityUserInterfaceItem | null>(null);
  const editButtonCoord = ref<{ page: number; index: number } | null>(null);

  const editPhysicalButton = ref<object | null>(null);
  // Drives the physical-button popup `<Transition>`. Kept separate from
  // `editPhysicalButton` so the settings stay mounted (and visible) while the
  // shrink animation plays; the data is cleared on `@after-leave`.
  const physicalPopupOpen = ref(false);

  const editTouchSlider = ref<boolean>(false);

  // Horizontal offset for the currently open popup; null falls back to the CSS
  // centered/fixed placement (small screens, keyboard-triggered opens).
  const popupLeft = ref<number | null>(null);

  function boundingLeft($event: MouseEvent) {
    const item = ($event.target as HTMLElement).parentNode as HTMLElement;
    return item.getBoundingClientRect().left;
  }

  function focusSearchInput() {
    setTimeout(() => {
      const searchInput = document.querySelector(
        "#input-search",
      ) as HTMLElement;
      if (searchInput) {
        searchInput.focus();
      }
    }, 200);
  }

  // Open the widget-edit popup for the item at (`page`, `index`), placing it to
  // the left of the widget whose own left edge is `widgetLeft` (viewport px).
  function startWidgetEditAt(
    page: number,
    index: number,
    element: ActivityUserInterfaceItem,
    widgetLeft: number,
  ) {
    editButton.value = element;
    editButtonCoord.value = { page, index };
    popupLeft.value = Math.max(
      MIN_POPUP_LEFT,
      widgetLeft - WIDGET_POPUP_OFFSET,
    );
    focusSearchInput();
  }

  function startButtonEdit(
    page: number,
    index: number,
    element: ActivityUserInterfaceItem,
    $event: MouseEvent,
  ) {
    startWidgetEditAt(page, index, element, boundingLeft($event));
  }

  function startPhysicalButtonEdit(
    element: DeviceButtonMapping,
    pressType: ButtonPressType,
    isSmallScreen = false,
    $event?: MouseEvent,
  ) {
    editPhysicalButton.value = {
      element: element,
      pressType: pressType,
    };
    physicalPopupOpen.value = true;
    popupLeft.value = $event && !isSmallScreen ? boundingLeft($event) : null;
  }

  function startTouchSliderEdit(isSmallScreen = false, item?: HTMLElement) {
    editTouchSlider.value = true;
    popupLeft.value =
      item && !isSmallScreen ? item.getBoundingClientRect().left : null;
  }

  function updatePhysicalButtonEdit(msg: DeviceButtonMappingChange) {
    editPhysicalButton.value = {
      element: msg.button,
      pressType: msg.pressType,
    };
  }

  function closeButtonEdit() {
    editButton.value = null;
    editButtonCoord.value = null;
    physicalPopupOpen.value = false;
    editTouchSlider.value = false;
  }

  // Called from the physical-button popup's `<Transition>` `@after-leave` so the
  // settings outlive the shrink animation before being torn down.
  function onPhysicalPopupAfterLeave() {
    editPhysicalButton.value = null;
  }

  return {
    editButton,
    editButtonCoord,
    editPhysicalButton,
    physicalPopupOpen,
    editTouchSlider,
    popupLeft,
    focusSearchInput,
    closeButtonEdit,
    startButtonEdit,
    startWidgetEditAt,
    startPhysicalButtonEdit,
    startTouchSliderEdit,
    updatePhysicalButtonEdit,
    onPhysicalPopupAfterLeave,
  };
}
