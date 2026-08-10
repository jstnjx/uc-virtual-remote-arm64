export type ViewportGeometry = {
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
};

export type ReferenceGeometry = {
  top: number;
  bottom: number;
  left: number;
  height: number;
};

export type DropdownGeometry = {
  width: number;
  height: number;
};

export type DropdownPlacement = {
  top: number;
  left: number;
  isDropUp: boolean;
};

/**
 * Pure placement math: drops below when there is room, flips up when there is
 * not (or when there is more room above), and clamps the result into the
 * viewport with a 10px margin.
 */
export function calculatePosition(
  reference: ReferenceGeometry,
  dropdown: DropdownGeometry,
  viewport: ViewportGeometry,
): DropdownPlacement {
  const spaceBelow = viewport.innerHeight - reference.bottom - 20;
  const spaceAbove = reference.top - 20;

  let top: number;
  let isDropUp = false;

  if (spaceBelow >= dropdown.height) {
    top = reference.top + viewport.scrollY + reference.height;
  } else if (spaceAbove >= dropdown.height) {
    top = reference.top + viewport.scrollY - dropdown.height;
    isDropUp = true;
  } else if (spaceBelow >= spaceAbove) {
    top = reference.top + viewport.scrollY + reference.height;
  } else {
    top = reference.top + viewport.scrollY - dropdown.height;
    isDropUp = true;
  }

  if (top < 10) top = 10;

  const tentativeLeft = reference.left + viewport.scrollX;
  const dropdownRight = tentativeLeft + dropdown.width;
  const maxRight = viewport.innerWidth - 10;

  let left =
    dropdownRight > maxRight ? maxRight - dropdown.width : tentativeLeft;

  if (left < 10) left = 10;

  return { top, left, isDropUp };
}

/**
 * Positions `dropdownEl` against `referenceEl` as an absolutely positioned
 * element on `document.body`, keeps it in place while the page is resized or
 * scrolled, and returns a cleanup function detaching those listeners.
 */
export function useDropdownPosition(
  referenceEl: HTMLElement,
  dropdownEl: HTMLElement,
  { width }: { width?: string | null } = {},
): () => void {
  if (width) {
    dropdownEl.style.width = width;
  }

  dropdownEl.style.position = "absolute";
  dropdownEl.style.visibility = "hidden";
  dropdownEl.style.display = "block";

  dropdownEl.classList.add("dynamic-dropdown");
  dropdownEl.classList.remove("animate-dropdown", "drop-up");

  const applyPosition = () => {
    const position = calculatePosition(
      referenceEl.getBoundingClientRect(),
      dropdownEl.getBoundingClientRect(),
      {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
    );

    dropdownEl.style.top = `${position.top}px`;
    dropdownEl.style.left = `${position.left}px`;

    dropdownEl.classList.toggle("drop-up", position.isDropUp);

    // overflow only if actually needed
    dropdownEl.style.maxHeight = window.innerHeight - 40 + "px";

    dropdownEl.style.overflowY =
      dropdownEl.scrollHeight > window.innerHeight - 40 ? "auto" : "";
  };

  requestAnimationFrame(() => {
    applyPosition();

    dropdownEl.style.visibility = "visible";
    dropdownEl.style.display = "";

    requestAnimationFrame(() => {
      dropdownEl.classList.add("animate-dropdown");
    });
  });

  window.addEventListener("resize", applyPosition);
  window.addEventListener("scroll", applyPosition);

  return () => {
    window.removeEventListener("resize", applyPosition);
    window.removeEventListener("scroll", applyPosition);
  };
}
