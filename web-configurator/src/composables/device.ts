import { useTiming } from "@/composables/timing";

const { sleep } = useTiming();

export function isTouchEnabled() {
  return "ontouchstart" in window || navigator.maxTouchPoints;
}

function isVisible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

export async function focusInput(parent: HTMLElement, slow = false) {
  if (!parent) return;

  await sleep(slow ? 800 : 300);

  const input = Array.from(
    parent.querySelectorAll(
      'input[type="text"], input[type="number"], input[type="email"], textarea, input[type="search"]:not([class*="vs__search"])',
    ),
  ) as HTMLElement[];

  const visibleInput = input.find((el) => isVisible(el));

  if (!visibleInput) return;

  const isSearchInput =
    visibleInput instanceof HTMLInputElement && visibleInput.type === "search";

  if (isTouchEnabled() && isSearchInput) return;

  visibleInput.focus();
}
