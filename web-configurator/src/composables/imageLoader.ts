import {
  onScopeDispose,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";

export type ImageLoadStatus = "pending" | "loading" | "loaded" | "failed";

/**
 * Preloads an image URL so callers can render the image only once it is
 * available, or fall back to a placeholder when it fails to load.
 *
 * An empty URL stays in "pending": nothing is loaded and nothing is rendered.
 */
export function useImageLoader(source: MaybeRefOrGetter<string | undefined>) {
  const status = ref<ImageLoadStatus>("pending");
  let loader: HTMLImageElement | undefined;

  function destroyLoader() {
    if (loader) {
      loader.onload = null;
      loader.onerror = null;
      loader = undefined;
    }
  }

  watch(
    () => toValue(source),
    (url) => {
      destroyLoader();

      if (!url) {
        status.value = "pending";
        return;
      }

      status.value = "loading";
      loader = new Image();
      loader.onload = () => {
        destroyLoader();
        status.value = "loaded";
      };
      loader.onerror = () => {
        destroyLoader();
        status.value = "failed";
      };
      loader.src = url;
    },
    { immediate: true },
  );

  onScopeDispose(destroyLoader);

  return { status };
}
