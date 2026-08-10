const cleanupMap = new WeakMap<
  HTMLElement,
  {
    scrollCleanup: () => void;
    mutationObserverCleanup: () => void;
    resizeObserverCleanup: () => void;
    pollingCleanup: () => void;
  }
>();

export default {
  mounted(el: HTMLElement) {
    const mainClass = "v-overflow-indicator";
    const topClass = "v-overflow-indicator--on-top";
    const bottomClass = "v-overflow-indicator--on-bottom";
    const scrollableClass = "v-overflow-indicator--scrollable";
    let pollingId: number;
    const bottomWidthAddition = 1;
    let elBottomText: HTMLElement;

    setTimeout(() => {
      init();
    }, 10);

    function init() {
      el.classList.add(mainClass, topClass);
      setIndicators(el);
    }

    function setIndicators(el: HTMLElement) {
      const isTouchScreen = document.body.classList.contains("touch-screen");
      const parentDimensions = el.getBoundingClientRect();
      const availableIndicatorTop = el.querySelector(
        ":scope > .v-overflow-indicator__top",
      ) as HTMLElement;
      const availableIndicatorBottom = el.querySelector(
        ":scope > .v-overflow-indicator__bottom",
      ) as HTMLElement;

      const parentStyle = getComputedStyle(el);
      if (parentStyle.display === "none") return;

      if (el.scrollHeight <= el.clientHeight) {
        if (availableIndicatorTop) {
          availableIndicatorTop.remove();
        }

        if (availableIndicatorBottom) {
          availableIndicatorBottom.remove();
        }

        el.classList.remove(scrollableClass);

        return;
      } else {
        el.classList.add(scrollableClass);
      }

      if (availableIndicatorTop) {
        availableIndicatorTop.classList.add("v-overflow-indicator__top");
        availableIndicatorTop.style.left = parentDimensions.left + "px";
        availableIndicatorTop.style.top =
          parentDimensions.top - 1 + (isTouchScreen ? 0 : -8) + "px";
        availableIndicatorTop.style.width = parentDimensions.width - 8 + "px";
      } else {
        const parentDimensions = el.getBoundingClientRect();
        const indicatorTop = document.createElement("div");
        indicatorTop.classList.add("v-overflow-indicator__top");
        indicatorTop.style.position = "fixed";
        indicatorTop.style.left = parentDimensions.left + "px";
        indicatorTop.style.top =
          parentDimensions.top - 1 + (isTouchScreen ? 0 : -8) + "px";
        indicatorTop.style.width = parentDimensions.width - 8 + "px";
        el.appendChild(indicatorTop);
      }

      if (availableIndicatorBottom) {
        availableIndicatorBottom.style.left = parentDimensions.left + "px";
        availableIndicatorBottom.style.top = parentDimensions.bottom + "px";
        availableIndicatorBottom.style.width =
          Math.ceil(parentDimensions.width + bottomWidthAddition) + "px";
      } else {
        const indicatorBottom = document.createElement("div");
        const indicatorScrollButton = document.createElement("button");
        indicatorScrollButton.classList.add(
          "v-overflow-indicator__scroll-button",
        );
        const indicatorBottomIcon = document.createElement("i");
        indicatorBottomIcon.classList.add("fa-light");
        indicatorBottomIcon.classList.add("fa-arrow-down");
        const indicatorBottomText = document.createElement("span");
        const textContent = document.querySelector(
          ".global-translations .global-translations_overflow-indicator",
        )?.innerHTML;
        indicatorBottomText.classList.add("v-overflow-indicator__bottom__text");
        indicatorBottomText.innerHTML = "Scroll for more";
        if (textContent) {
          indicatorBottomText.innerHTML = textContent;
        }
        indicatorBottomText.style.opacity = "0";
        elBottomText = indicatorBottomText;

        indicatorScrollButton.appendChild(indicatorBottomIcon);
        indicatorBottom.appendChild(indicatorScrollButton);
        indicatorBottom.appendChild(indicatorBottomText);

        indicatorBottom.addEventListener("click", (e) => {
          const target = e.srcElement as HTMLElement | null;
          if (
            target?.classList.contains("v-overflow-indicator__bottom") ||
            target?.classList.contains("v-overflow-indicator__bottom__text")
          ) {
            indicatorBottomText.style.opacity = "1";
          }
        });

        indicatorBottomIcon.addEventListener("click", () => {
          el.scrollTo({ left: 0, top: el.scrollTop + 75, behavior: "smooth" });
          indicatorBottomText.style.opacity = "0";
        });

        indicatorBottom.classList.add("v-overflow-indicator__bottom");
        indicatorBottom.style.position = "fixed";
        indicatorBottom.style.left = parentDimensions.left + "px";
        indicatorBottom.style.top = parentDimensions.bottom + "px";
        indicatorBottom.style.width =
          Math.ceil(parentDimensions.width + bottomWidthAddition) + "px";
        el.appendChild(indicatorBottom);
      }
    }

    function onEvent() {
      const scrollPosition = el.scrollTop;
      const maxScrollTop = el.scrollHeight - el.clientHeight;
      const scrollTolerance = 2;

      const isScrollAtTop = scrollPosition <= scrollTolerance;
      const isScrollAtBottom = scrollPosition >= maxScrollTop - scrollTolerance;

      if (elBottomText && elBottomText.style.opacity === "1") {
        elBottomText.style.opacity = "0";
      }

      if (isScrollAtTop) {
        el.classList.add(topClass);
        el.classList.remove(bottomClass);
      } else if (isScrollAtBottom) {
        el.classList.add(bottomClass);
        el.classList.remove(topClass);
      } else {
        el.classList.remove(topClass);
        el.classList.remove(bottomClass);
      }
    }

    el.addEventListener("scroll", onEvent);

    const observer = new MutationObserver(() => {
      onEvent();
    });

    const resizeObserver = new ResizeObserver(() => {
      setIndicators(el);
    });

    observer.observe(el, { childList: true });
    resizeObserver.observe(el);

    function trackPosition(element: HTMLElement) {
      let lastPosition = element.getBoundingClientRect();

      function checkPosition() {
        const currentPosition = element.getBoundingClientRect();
        if (
          currentPosition.top !== lastPosition.top ||
          currentPosition.left !== lastPosition.left
        ) {
          setIndicators(el);
          lastPosition = currentPosition;
        }
        pollingId = requestAnimationFrame(checkPosition);
      }

      checkPosition();
    }

    trackPosition(el);

    cleanupMap.set(el, {
      scrollCleanup: () => {
        el.removeEventListener("scroll", onEvent);
      },
      mutationObserverCleanup: () => {
        observer.disconnect();
      },
      resizeObserverCleanup: () => {
        resizeObserver.disconnect();
      },
      pollingCleanup: () => {
        if (pollingId) {
          cancelAnimationFrame(pollingId);
        }
      },
    });
  },
  unmounted(el: HTMLElement) {
    // Cleanup scroll listener
    const cleanup = cleanupMap.get(el);
    if (cleanup) {
      cleanup.scrollCleanup();
      cleanup.mutationObserverCleanup();
      cleanup.resizeObserverCleanup();
      cleanup.pollingCleanup();
      cleanupMap.delete(el);
    }
  },
};
