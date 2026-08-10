<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import ApiConnection from "@/api";

import type { Headers, PaginationMeta } from "@/types/rest";
import type { Macro } from "@/types/macro";

import { macrosStore } from "@/stores/macros";
import { addErrorBottom } from "@/stores/messages";

import { useTiming } from "@/composables/timing";
import { useDataHelper } from "@/composables/dataHelper";
import { getPaginationLimit, readPaginationMeta } from "@/composables/listing";

import MacroListItem from "@/components/macro/MacroListItem.vue";
import ListPaging from "@/components/ui/ListPaging.vue";

const macrosApi = ApiConnection.macros;

const router = useRouter();
const { sleep } = useTiming();
const { objectsDeepEqual } = useDataHelper();

const macrosStorage = macrosStore();

const props = defineProps({
  filterText: {
    type: String,
    default: "",
  },
  pagination: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(["add", "clone", "loaded"]);

const macros = ref<Macro[] | []>([]);
const pagination = ref<PaginationMeta>(
  Object.keys(props.pagination).length > 0
    ? (props.pagination as PaginationMeta)
    : { limit: getPaginationLimit() ?? 20, page: 1 },
);

/**
 * What `ListPaging` renders: the view owns page and limit, the store owns the
 * server's total — so a refetch the view never made (the WS-event reloads)
 * still moves the footer (#685).
 */
const paging = computed<PaginationMeta>(() => ({
  ...pagination.value,
  count: macrosStorage.macrosByPage.count,
}));

const helperFilterText = ref(props.filterText);
const hasMacro = ref(true);
const fetching = ref(false);

watch(
  () => macrosStorage.macrosByPage.macros,
  async () => {
    await sleep(1000);
    if (!objectsDeepEqual(macrosStorage.macrosByPage.macros, macros.value)) {
      await fetchMacros();
    }
  },
  // macrosByPage.macros is mutated in place (splice) as well as replaced,
  // so watch its contents deeply.
  { deep: true },
);

watch(
  () => props.filterText,
  async (newVal) => {
    if (helperFilterText.value !== newVal) {
      pagination.value.page = 1;

      try {
        await fetchMacros();
      } catch (e) {
        addErrorBottom(e);
      }
      helperFilterText.value = newVal;
    }
  },
);

watch(
  () => paging.value.count,
  async (count) => {
    if (count == 0 && props.filterText.length == 0) {
      hasMacro.value = false;
    } else if (count == 0) {
      const activityNumber = await macrosApi.getItemNumber();
      hasMacro.value = activityNumber > 0;
    } else {
      hasMacro.value = true;
    }
  },
);

async function fetchMacros() {
  fetching.value = true;
  try {
    const macroList = await macrosStorage.getMacrosByPageByLimit(
      pagination.value.page,
      pagination.value.limit,
      props.filterText,
    );
    if (macroList && macroList.data) {
      macros.value = macroList.data.macros;

      const macroHeaders = macroList.headers as Headers;
      if (macroHeaders) {
        pagination.value = readPaginationMeta(
          macroHeaders,
          pagination.value.limit,
        );
      }
    }
    emit("loaded", paging.value);
  } catch (e) {
    addErrorBottom(e);
  }
  fetching.value = false;
}

function goToItem(id: string) {
  router.push({
    name: "macro",
    params: { macro_id: id },
    query: { category: "macro" },
  });
}

function changePage(value: number) {
  pagination.value.page = value;
  fetchMacros();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchMacros();
}

async function deleteItem(macro: Macro) {
  try {
    const lastActiveListItem =
      macros.value.length == 1 && pagination.value.page > 1;
    await macrosStorage.delete(macro);

    if (lastActiveListItem) {
      changePage(pagination.value.page - 1);
    } else {
      fetchMacros();
    }
  } catch (e) {
    addErrorBottom(e);
  }
}

function addItem() {
  emit("add");
}

function cloneItem(macro: Macro) {
  emit("clone", macro);
}

onMounted(() => {
  fetchMacros();
  helperFilterText.value = props.filterText;
});
</script>
<template>
  <div class="ent-list ent-list--macro">
    <div
      v-if="macros && macros.length > 0"
      v-overflow-indicator
      class="ent-list__body-wrapper"
    >
      <div class="ent-list__body">
        <MacroListItem
          v-for="macro in macros"
          :key="macro.entity_id"
          :macro="macro"
          @goto="goToItem(macro.entity_id)"
          @clone="cloneItem(macro)"
          @delete="deleteItem(macro)"
        />
      </div>
    </div>
    <ListPaging
      v-if="macros && macros.length > 0"
      :pagination="paging"
      :length="macros.length"
      @change-page="changePage"
      @change-per-page="changePerPage"
    />
    <p
      v-if="!fetching && macros.length < 1 && hasMacro"
      class="ent-list__description"
    >
      {{ $t("ui.nothing_was_found") }}
    </p>
    <div v-else-if="!fetching && macros.length < 1" class="ent-list__no-items">
      <img alt="Add macro" src="/images/add-page.svg" />
      <h3>{{ $t("macro.add_first") }}</h3>
      <p>{{ $t("macro.no_macros") }}</p>
      <button
        class="button button--primary button--hybrid button--hybrid--reversed"
        @click="addItem"
      >
        {{ $t("ui.add") }}
        <i class="fa-light fa-plus"></i>
      </button>
    </div>
  </div>
</template>
