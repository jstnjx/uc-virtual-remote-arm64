import { ref, computed, onMounted, onUnmounted } from "vue";

export function useWindowDimension() {
  const windowWidth = ref(window.innerWidth);

  const isMediumScreen = computed(() => {
    return windowWidth.value < 1201;
  });

  const isSmallScreen = computed(() => {
    return windowWidth.value < 993;
  });

  const isMobileScreen = computed(() => {
    return windowWidth.value < 601;
  });

  const updateWindowWidth = () => {
    windowWidth.value = window.innerWidth;
  };

  onMounted(() => {
    window.addEventListener("resize", updateWindowWidth);
  });

  onUnmounted(() => {
    window.removeEventListener("resize", updateWindowWidth);
  });

  return {
    isMediumScreen,
    isSmallScreen,
    isMobileScreen,
  };
}
