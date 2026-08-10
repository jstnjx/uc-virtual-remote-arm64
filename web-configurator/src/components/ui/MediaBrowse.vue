<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { storeToRefs } from "pinia";
import ApiConnection from "@/api";
import type { Headers, PaginationMeta } from "@/types/rest";
import type { MediaItem } from "@/types/media";
import type { ConfiguredEntity } from "@/types/integrationInstance";

import { addErrorBase, hideMessage, messagesStore } from "@/stores/messages";
import { integrationsStore } from "@/stores/integrations";

import UCSearch from "@/components/ui/UCSearch.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import ListPaging from "@/components/ui/ListPaging.vue";

import { useTiming } from "@/composables/timing";
import { getPaginationLimit, savePaginationLimit } from "@/composables/listing";

const integrationsApi = ApiConnection.integrations;
const messagesStorage = messagesStore();
const integrationStorage = integrationsStore();

const props = withDefaults(
  defineProps<{
    entityId: string;
    disablePlayback?: boolean;
    disableSearch?: boolean;
    mode?: "SELECTION" | "PLAY";
  }>(),
  {
    disablePlayback: false,
    disableSearch: false,
    mode: "SELECTION",
  },
);

const { sleep } = useTiming();

const emit = defineEmits(["select"]);

defineExpose({
  open,
});

const { configuredEntities } = storeToRefs(integrationStorage);
const { message: notificationMessage } = storeToRefs(messagesStorage);

const showBrowse = ref(false);
const searchMediaText = ref("");
const mediaCollectionFilters = ref<{ q: string; classFilter: string[] }[]>([]);
const classFilter = ref<string[]>([]);
const searching = ref(false);
const direction = ref("slide-item-left");
const mediaCollection = ref<{ media: MediaItem; pagination: PaginationMeta }[]>(
  [],
);
const activeCollIndex = ref(-1);

const hasError = ref(false);
const loading = ref(false);
const loadingNext = ref(false);

const imageLoading = ref<Record<string, boolean>>({});
const imageErrors = ref<Record<string, boolean>>({});

const elCollectionWrapper = useTemplateRef<HTMLDivElement>(
  "elCollectionWrapper",
);

const fallbackMediaIcons = {
  album: "album",
  app: "browser",
  artist: "album-circle-user",
  channel: "rss",
  composer: "pen-clip",
  directory: "folder",
  episode: "folder",
  game: "gamepad",
  genre: "music",
  image: "image",
  movie: "film",
  music: "music",
  playlist: "album",
  podcast: "podcast",
  radio: "radio",
  season: "folder",
  track: "music",
  tv_show: "tv",
  url: "link",
  video: "video",
};

watch(showBrowse, (val) => {
  if (val) {
    init();
  }
});

watch(searchMediaText, (val, oldVal) => {
  if (val.length > 0) {
    mediaCollectionFilters.value[activeCollIndex.value].q = val;
    mediaCollection.value[activeCollIndex.value].pagination.page = 1;
    searchMedia(true);
  } else if (val.length === 0 && oldVal.length > 0) {
    mediaCollectionFilters.value[activeCollIndex.value].q = "";
    mediaCollectionFilters.value[activeCollIndex.value].classFilter = [];
    searchMediaText.value = "";
    fetchMedia(true);
  }
});

watch(notificationMessage, async (val, oldVal) => {
  if (hasError.value && val === null && oldVal !== null) {
    await sleep(300);
    hasError.value = false;
  }
});

const entity = computed(() => {
  return (configuredEntities.value ?? []).find(
    (e: ConfiguredEntity) => e.entity_id === props.entityId,
  );
});

const stableIdSupport = computed(() => {
  // open config leaf → narrow to the numeric bitmask it is (ADR 0002)
  return entity.value?.options?.stable_id_support as number | undefined;
});

const enableSearch = computed(() => {
  if (props.disableSearch === true) return false;
  if (activeMediaCollection.value.media.can_search === true) return true;
  if (stableIdSupport.value === undefined || (stableIdSupport.value & 12) > 0)
    return true;

  return false;
});

const enableBrowse = computed(() => {
  if (stableIdSupport.value === undefined || (stableIdSupport.value & 3) > 0)
    return true;

  return false;
});

const activeMediaCollection = computed(() => {
  return mediaCollection.value[activeCollIndex.value];
});

const activeClassFilter = computed(() => {
  return mediaCollectionFilters.value[activeCollIndex.value].classFilter;
});

function getMediaIcon(mediaClass?: string) {
  const key = (mediaClass ?? "").toLowerCase();

  if (key in fallbackMediaIcons) {
    return fallbackMediaIcons[key as keyof typeof fallbackMediaIcons];
  }

  return fallbackMediaIcons.music;
}

async function browseMediaContainers(
  pagePage = 1,
  pagLimit = 50,
  reload = false,
  mediaId?: string,
  mediaType?: string,
) {
  let media = {} as MediaItem;
  let pagination = {};
  const paginationPage = reload ? 1 : pagePage;
  const paginationLimit = reload ? getPagLimit() : pagLimit;

  const params = {
    ...(props.mode === "SELECTION" && { stable_ids: true }),
    ...(mediaId && mediaType && { media_id: mediaId }),
    ...(mediaId && mediaType && { media_type: mediaType }),
  };

  try {
    const res = await integrationsApi.browseMediaContainers(
      props.entityId,
      paginationPage,
      paginationLimit,
      params,
    );
    if (res?.data?.media) {
      media = res.data.media;
      initImageState(res.data.media?.items ?? []);

      const listHeaders = res.headers as Headers;
      if (listHeaders) {
        const headerLimit = Number(listHeaders["pagination-limit"]);
        const newLimit =
          headerLimit <= Number(listHeaders["pagination-count"] ?? 0)
            ? paginationLimit
            : headerLimit;
        pagination = {
          count: Number(listHeaders["pagination-count"]),
          limit: newLimit || 0,
          page: Number(listHeaders["pagination-page"]) || 0,
        };

        if (newLimit) {
          savePaginationLimit(newLimit, true);
        }
      }
    }
  } catch (e) {
    showError(e);
  }

  return {
    media: media ?? {},
    pagination: (pagination ?? {
      limit: getPagLimit(),
      page: 1,
    }) as PaginationMeta,
  };
}

async function searchMediaItems(
  pagePage = 1,
  pagLimit = 50,
  reload = false,
  q = "",
  mediaClasses?: string[],
  mediaId?: string,
  mediaType?: string,
) {
  let mediaItems = {} as MediaItem[];
  let pagination = {} as PaginationMeta;

  const paginationPage = reload ? 1 : pagePage;
  const paginationLimit = reload ? getPagLimit() : pagLimit;

  const params = {
    q: q,
    ...((mediaClasses ?? []).length > 0 && {
      media_classes: (mediaClasses ?? []).join(","),
    }),
    ...(props.mode === "SELECTION" && { stable_ids: true }),
    ...(mediaId && mediaType && { media_id: mediaId }),
    ...(mediaId && mediaType && { media_type: mediaType }),
  };

  try {
    const res = await integrationsApi.searchMediaItems(
      props.entityId,
      paginationPage,
      paginationLimit,
      params,
    );

    if (res?.data) {
      mediaItems = res.data;
      initImageState(mediaItems ?? []);

      const listHeaders = res.headers as Headers;
      if (listHeaders) {
        const headerLimit = Number(listHeaders["pagination-limit"]);
        const newLimit =
          headerLimit <= Number(listHeaders["pagination-count"] ?? 0)
            ? paginationLimit
            : headerLimit;

        pagination = {
          count: Number(listHeaders["pagination-count"]),
          limit: newLimit || 0,
          page: Number(listHeaders["pagination-page"]) || 0,
        };

        if (newLimit) {
          savePaginationLimit(newLimit, true);
        }
      }
    }
  } catch (e) {
    showError(e);
  }

  return {
    mediaItems: mediaItems ?? {},
    pagination: (pagination ?? {
      limit: getPagLimit(),
      page: 1,
    }) as PaginationMeta,
  };
}

async function changePage(value: number) {
  if (activeCollIndex.value > -1) {
    mediaCollection.value[activeCollIndex.value].pagination.page = value;
  }

  if (searching.value) {
    searchMedia();
  } else {
    fetchMedia();
  }
}

async function changePerPage(value: number) {
  if (activeCollIndex.value > -1) {
    mediaCollection.value[activeCollIndex.value].pagination.page = 1;
    mediaCollection.value[activeCollIndex.value].pagination.limit = value;
  }

  if (searching.value) {
    searchMedia();
  } else {
    fetchMedia();
  }
}

function clearSearch() {
  searching.value = false;
  searchMediaText.value = "";
  if (activeCollIndex.value > -1) {
    mediaCollectionFilters.value[activeCollIndex.value] = {
      q: "",
      classFilter: [],
    };
  }
  fetchMedia(true);
}

async function fetchMedia(reload = false) {
  if (mediaCollection.value.length > 0 && activeCollIndex.value > -1) {
    const mediaColl = mediaCollection.value[activeCollIndex.value];
    const res = await browseMediaContainers(
      mediaColl.pagination.page,
      mediaColl.pagination.limit,
      reload,
      mediaColl.media.media_id,
      mediaColl.media.media_type,
    );
    mediaColl.media = res.media;
    mediaColl.pagination = res.pagination;
  }
}

async function searchMedia(reload = false) {
  if (mediaCollection.value.length > 0 && activeCollIndex.value > -1) {
    const mediaColl = mediaCollection.value[activeCollIndex.value];
    const res = await searchMediaItems(
      mediaColl.pagination.page,
      mediaColl.pagination.limit,
      reload,
      mediaCollectionFilters.value[activeCollIndex.value].q,
      mediaCollectionFilters.value[activeCollIndex.value].classFilter,
      mediaColl.media.media_id,
      mediaColl.media.media_type,
    );
    mediaColl.media.items = res.mediaItems;
    mediaColl.pagination = res.pagination;
  }
}

async function fetchBaseMedia(reload = false) {
  const res = await browseMediaContainers(1, getPagLimit(), reload);
  if (res) {
    mediaCollection.value.push(res);
    mediaCollectionFilters.value.push({ q: "", classFilter: [] });
    activeCollIndex.value = mediaCollection.value.length - 1;
  }
}

function toggleClassFilter(value: string) {
  if (activeClassFilter.value === undefined) return false;
  const index = activeClassFilter.value.indexOf(value);

  if (!mediaCollectionFilters.value[activeCollIndex.value].classFilter) return;

  if (index === -1) {
    mediaCollectionFilters.value[activeCollIndex.value].classFilter.push(value);
  } else {
    mediaCollectionFilters.value[activeCollIndex.value].classFilter.splice(
      index,
      1,
    );
  }

  searchMedia(true);
}

function open() {
  showBrowse.value = true;
}

function close() {
  showBrowse.value = false;
  hasError.value = false;
  hideMessage();
}

async function back() {
  searching.value = false;
  direction.value = "slide-item-right";
  activeCollIndex.value = mediaCollection.value.length - 2;
  await sleep(500);
  mediaCollection.value = mediaCollection.value.slice(0, -1);
  mediaCollectionFilters.value = mediaCollectionFilters.value.slice(0, -1);

  if (mediaCollectionFilters.value[activeCollIndex.value]) {
    searchMediaText.value =
      mediaCollectionFilters.value[activeCollIndex.value].q;
  }

  if (searchMediaText.value.length > 0) {
    searching.value = true;
  }
}

async function nextLevel(item: MediaItem) {
  if (
    (stableIdSupport.value !== undefined && enableBrowse.value === false) ||
    item.can_browse === undefined ||
    item.can_browse === false ||
    loadingNext.value === true
  )
    return;

  searching.value = false;
  loadingNext.value = true;

  let loadingTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    loadingTimer = setTimeout(() => {
      loading.value = true;
    }, 400);

    const res = await browseMediaContainers(
      1,
      getPagLimit(),
      true,
      item.media_id,
      item.media_type,
    );

    if (res) {
      mediaCollection.value.push(res);
      mediaCollectionFilters.value.push({ q: "", classFilter: [] });
    }

    direction.value = "slide-item-left";
    await sleep(400);
    activeCollIndex.value = mediaCollection.value.length - 1;
    searchMediaText.value =
      mediaCollectionFilters.value[activeCollIndex.value].q;
  } catch (e) {
    showError(e);
  } finally {
    if (loadingTimer) {
      clearTimeout(loadingTimer);
    }

    await sleep(500);
    loading.value = false;
    loadingNext.value = false;
  }
}

async function showError(e: unknown) {
  hasError.value = true;
  const wrapperParent = elCollectionWrapper.value?.parentElement;

  await sleep(800);
  if (elCollectionWrapper.value) {
    elCollectionWrapper.value.focus();
  }

  if (wrapperParent) {
    addErrorBase(e, "media_browse", wrapperParent);
  }
}

function addMedia(item: MediaItem) {
  if (props.mode === "PLAY" && props.disablePlayback) return;

  emit("select", item);
  close();
}

function initImageState(items: MediaItem[]) {
  for (const item of items) {
    if (item.thumbnail && !item.thumbnail.includes("icon://")) {
      if (imageLoading.value[item.media_id] === undefined) {
        imageLoading.value[item.media_id] = true;
        imageErrors.value[item.media_id] = false;
      }
    }
  }
}

function getPagLimit() {
  return getPaginationLimit(true) ?? 50;
}

function onImageLoad(id: string) {
  imageLoading.value[id] = false;
}

function onImageError(id: string) {
  imageLoading.value[id] = false;
  imageErrors.value[id] = true;
}

function onFocus() {
  searching.value = true;
}

function onBlur() {
  if (searchMediaText.value.length > 0) return;
  searching.value = false;
}

function reset() {
  searchMediaText.value = "";
  classFilter.value = [];
  mediaCollection.value = [];
  mediaCollectionFilters.value = [];
  activeCollIndex.value = -1;
  imageLoading.value = {};
  imageErrors.value = {};
}

async function init() {
  reset();
  await sleep(100);
  fetchBaseMedia();
}
</script>
<template>
  <Teleport to="body">
    <ModalSecondary
      :show="showBrowse == true"
      :focusable-input="false"
      :width="'40rem'"
      :name="'modal-assign-command'"
      class="modal-secondary--media-browse"
      :class="{
        'modal-secondary--media-browse--disabled': loading || hasError,
      }"
      @close="showBrowse = false"
    >
      <template #header>
        <div class="modal-secondary__header__content">
          <button
            v-if="activeCollIndex > 0"
            :disabled="
              hasError ||
              loading ||
              mediaCollection.length != activeCollIndex + 1
            "
            class="button button--secondary button--icon button--icon--small button-back"
            @click="back"
          >
            <i class="fa-regular fa-arrow-left"></i>
          </button>
          <h2>
            <Transition name="opacity-fast">
              <template v-if="searching">{{ $t("ui.search") }}</template>
              <template
                v-else-if="
                  mediaCollection.length > 1 &&
                  activeCollIndex > 0 &&
                  mediaCollection[activeCollIndex]?.media?.title
                "
              >
                {{ mediaCollection[activeCollIndex].media.title }}
              </template>
              <template v-else>{{ $t("ui.browse") }}</template>
            </Transition>
          </h2>
        </div>
        <Transition name="opacity-fast">
          <div v-show="loading" class="modal-secondary--media-browse__loader">
            <img
              src="/images/loading-indicator.png"
              alt="Loading"
              class="img-loading img-loading--base"
            />
          </div>
        </Transition>
      </template>
      <hr />
      <div ref="elCollectionWrapper" tabindex="-1">
        <template
          v-for="(collection, index) in mediaCollection"
          :key="collection.media.media_id"
        >
          <Transition :name="direction">
            <div
              v-show="
                mediaCollection.length > 0 &&
                activeCollIndex > -1 &&
                index === activeCollIndex
              "
              class="browse-element browse-element--extended browse-element--collection"
            >
              <ListWithFilter :skip-form="enableSearch === false">
                <template #form>
                  <UCSearch
                    v-if="enableSearch"
                    v-model="searchMediaText"
                    :debouncing="true"
                    :small="true"
                    :focus="false"
                    :gray="true"
                    @focus="onFocus"
                    @blur="onBlur"
                  />
                  <template
                    v-if="entity && entity.attributes?.search_media_classes"
                  >
                    <Transition name="opacity-fast">
                      <div
                        v-show="searching && searchMediaText.length > 0"
                        class="filter-item-container"
                      >
                        <span
                          v-for="filter in entity.attributes
                            ?.search_media_classes ?? []"
                          :key="filter"
                          class="filter-item"
                          :class="{
                            'filter-item--active': (
                              mediaCollectionFilters[activeCollIndex]
                                .classFilter ?? []
                            ).includes(filter),
                          }"
                          @click="toggleClassFilter(filter)"
                        >
                          {{
                            $t(
                              `media_class.${filter}`,
                              filter === "url" ? "URL" : filter,
                            )
                          }}
                        </span>
                      </div>
                    </Transition>
                  </template>
                </template>
                <template #items>
                  <div
                    v-for="(item, index) in collection.media?.items ?? []"
                    :key="`${item?.media_id}-${index}`"
                    class="browse-element__item"
                    :class="{
                      'browse-element__item--no-browse':
                        (item?.can_browse === undefined ||
                          item?.can_browse === false) &&
                        enableBrowse === false,
                    }"
                    @click="nextLevel(item)"
                  >
                    <template v-if="item.thumbnail">
                      <SelectedIcon
                        v-if="item.thumbnail.includes('icon://')"
                        :key="`icon-${item?.media_id}`"
                        class="browse-element__item__icon"
                        :icon="item.thumbnail.replace('icon://', '')"
                      />
                      <template v-else>
                        <img
                          v-show="
                            imageErrors[item.media_id] !== true &&
                            imageLoading[item.media_id] === false
                          "
                          :src="item.thumbnail"
                          @load="onImageLoad(item.media_id)"
                          @error="onImageError(item.media_id)"
                        />
                        <SelectedIcon
                          v-if="imageLoading[item.media_id]"
                          class="browse-element__item__icon"
                          :icon="`fa-${getMediaIcon(item.media_class)}`"
                        />
                        <SelectedIcon
                          v-else-if="imageErrors[item.media_id]"
                          class="browse-element__item__icon"
                          :icon="`fa-${getMediaIcon(item.media_class)}`"
                        />
                      </template>
                    </template>
                    <div v-if="item.title" class="browse-element__item__base">
                      <span
                        class="browse-element__item__title"
                        :class="{
                          'browse-element__item__title--one-row':
                            item.subtitle || item.artist || item.album,
                        }"
                      >
                        {{ item.title }}
                      </span>
                      <span
                        v-if="item.subtitle || item.artist || item.album"
                        class="browse-element__item__additional-text"
                      >
                        {{ item.subtitle ?? item.artist ?? item.album }}
                      </span>
                    </div>

                    <button
                      class="button button--secondary button--icon button--icon--medium browse-element__item__add"
                      @click.stop="addMedia(item)"
                    >
                      <i
                        v-if="mode === 'PLAY' && item.can_play"
                        class="fa-light fa-play"
                      ></i>
                      <i v-else class="fa-light fa-plus"></i>
                    </button>
                  </div>
                  <Transition name="opacity-fast">
                    <div
                      v-if="
                        !collection.media?.items ||
                        collection.media?.items.length === 0
                      "
                      class="browse-element__no-item"
                    >
                      <span class="browse-element__no-item__title">{{
                        $t("no_results.title")
                      }}</span>
                      <span class="browse-element__no-item__instruction">{{
                        $t("no_results.instruction")
                      }}</span>
                    </div>
                  </Transition>
                </template>
                <template #pagination>
                  <ListPaging
                    v-if="
                      activeCollIndex > -1 &&
                      collection.media?.items &&
                      collection.media.items.length > 0
                    "
                    :pagination="collection.pagination || {}"
                    :length="collection.media?.items?.length ?? 0"
                    :large-quantity="true"
                    @change-page="changePage"
                    @change-per-page="changePerPage"
                  />
                </template>
              </ListWithFilter>
            </div>
          </Transition>
        </template>
      </div>
    </ModalSecondary>
  </Teleport>
</template>
