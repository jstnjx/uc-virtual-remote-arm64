<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useTranslation } from "i18next-vue";
import type { SelectOption } from "@/types/ui";

import UCSelect from "@/components/ui/UCSelect.vue";

const { t } = useTranslation();

const props = defineProps({
  pagination: {
    type: Object,
    default: () => ({}),
  },
  length: {
    type: Number,
    default: 0,
  },
  compact: {
    type: Boolean,
    default: false,
  },
  largeQuantity: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["changePerPage", "changePage"]);

const itemsPerPage = ref({
  value: props.pagination.limit.toString() ?? "20",
  label: props.pagination.limit.toString() ?? "20",
});

const currentPage = ref(props.pagination.page ?? 1);

watch(
  () => [props.pagination.page, props.pagination.limit],
  () => {
    itemsPerPage.value = {
      value: props.pagination.limit.toString() ?? "20",
      label: props.pagination.limit.toString() ?? "20",
    };

    currentPage.value = props.pagination.page ?? 1;
  },
);

const perPageItems = computed(() => {
  if (props.largeQuantity) {
    return [
      { value: "10", label: "10" },
      { value: "20", label: "20" },
      { value: "50", label: "50" },
      { value: "100", label: "100" },
    ];
  }
  return [
    { value: "5", label: "5" },
    { value: "10", label: "10" },
    { value: "20", label: "20" },
    { value: "50", label: "50" },
  ];
});

const totalPages = computed(() => {
  if (
    props.pagination.count === null ||
    isNaN(Number(props.pagination.count))
  ) {
    return 0;
  }

  return Math.ceil(props.pagination.count / props.pagination.limit) ?? 0;
});

const showingItem = computed(() => {
  if (
    props.pagination.count === null ||
    isNaN(Number(props.pagination.count))
  ) {
    return "";
  }

  let itemNumber =
    props.pagination.page == 1
      ? 1
      : props.pagination.limit * (props.pagination.page - 1) + 1;

  if (totalPages.value === 0) {
    itemNumber = 0;
  }

  if (props.compact) {
    return t("ent_list.paging.items_total", {
      items: `${itemNumber}-${
        itemNumber > 0 ? itemNumber + props.length - 1 : 0
      }`,
      total: props.pagination.count,
    });
  }

  return t("ent_list.paging.showing", {
    items: `${itemNumber}-${
      itemNumber > 0 ? itemNumber + props.length - 1 : 0
    }`,
    total: props.pagination.count,
  });
});

function changePerPage(value: SelectOption) {
  emit("changePerPage", Number(value.value));
}

function changePage(page: number) {
  if (page >= 1 && page <= totalPages.value) {
    emit("changePage", page);
  }
}
</script>
<template>
  <div class="list-paging">
    <div class="list-paging__left">
      <span v-if="showingItem">{{ showingItem }}</span>
      <div class="list-paging__per-page">
        <span v-if="!compact">{{ $t("ent_list.paging.items_per_page") }}</span>
        <UCSelect
          v-model="itemsPerPage"
          :options="perPageItems"
          :dynamic-position="true"
          @select="changePerPage"
        />
      </div>
    </div>
    <div class="list-paging__right">
      <div class="list-paging__page-buttons">
        <button
          v-if="totalPages != 0"
          class="button button--blank button--icon button--icon--small"
          :disabled="currentPage === 1 || totalPages === 0"
          @click="changePage(currentPage - 1)"
        >
          <i class="fa-regular fa-arrow-left"></i>
        </button>

        <button
          v-if="totalPages != 0"
          class="button button--blank"
          :class="{ 'button--active': currentPage === 1 }"
          @click="changePage(1)"
        >
          1
        </button>

        <span v-if="currentPage > 3" class="list-paging__page-buttons__spacer"
          >...</span
        >

        <button
          v-if="currentPage > 2"
          class="button button--blank"
          @click="changePage(currentPage - 1)"
        >
          {{ currentPage - 1 }}
        </button>
        <button
          v-if="currentPage !== 1 && currentPage !== totalPages"
          class="button button--blank button--active"
        >
          {{ currentPage }}
        </button>
        <button
          v-if="currentPage < totalPages - 1"
          class="button button--blank"
          @click="changePage(currentPage + 1)"
        >
          {{ currentPage + 1 }}
        </button>

        <span
          v-if="currentPage < totalPages - 2"
          class="list-paging__page-buttons__spacer"
          >...</span
        >

        <button
          v-if="totalPages > 1"
          class="button button--blank"
          :class="{ 'button--active': currentPage === totalPages }"
          @click="changePage(totalPages)"
        >
          {{ totalPages }}
        </button>
        <span
          v-if="totalPages > 5 && currentPage < totalPages - 2"
          class="list-paging__page-buttons__spacer"
          >...</span
        >
        <button
          v-if="totalPages != 0"
          class="button button--blank button--icon button--icon--small"
          :disabled="currentPage === totalPages || totalPages === 0"
          @click="changePage(currentPage + 1)"
        >
          <i class="fa-regular fa-arrow-right"></i>
        </button>
      </div>
    </div>
  </div>
</template>
