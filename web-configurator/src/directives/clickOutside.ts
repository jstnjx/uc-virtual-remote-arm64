import { onClickOutside } from "@vueuse/core";
import type { Directive } from "vue";

type ClickOutsideHandler = (event: PointerEvent) => void;

interface ClickOutsideElement extends HTMLElement {
  __clickOutside?: {
    handler: ClickOutsideHandler;
    stop: () => void;
  };
}

const clickOutside: Directive<ClickOutsideElement, ClickOutsideHandler> = {
  mounted(el, binding) {
    let stop: (() => void) | undefined;
    // Elements using this directive are typically revealed by a click ("+" adds a
    // page). Vue patches the DOM in a microtask, i.e. while that click is still
    // bubbling towards the window, so a listener registered here and now would see
    // the opening click as an outside click and close the element again. Deferring
    // the registration by a task keeps the opening click out of reach.
    const timer = window.setTimeout(() => {
      // capture: false keeps the handler in the bubble phase, so the click target's
      // own listeners run before the outside handler does.
      stop = onClickOutside(el, (event) => el.__clickOutside?.handler(event), {
        capture: false,
      });
    });
    el.__clickOutside = {
      handler: binding.value,
      stop: () => {
        window.clearTimeout(timer);
        stop?.();
      },
    };
  },
  updated(el, binding) {
    if (el.__clickOutside) {
      el.__clickOutside.handler = binding.value;
    }
  },
  unmounted(el) {
    el.__clickOutside?.stop();
    delete el.__clickOutside;
  },
};

export default clickOutside;
