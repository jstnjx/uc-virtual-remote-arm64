<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import ApiConnection from "@/api";

import type { Headers, PaginationMeta } from "@/types/rest";
import type { Activity } from "@/types/activity";

import { activitiesStore } from "@/stores/activities";
import { addErrorBottom } from "@/stores/messages";

import { useTiming } from "@/composables/timing";
import { useDataHelper } from "@/composables/dataHelper";
import { getPaginationLimit, readPaginationMeta } from "@/composables/listing";

import ActivityListItem from "@/components/activity/ActivityListItem.vue";
import ListPaging from "@/components/ui/ListPaging.vue";

const activitiesApi = ApiConnection.activities;

const router = useRouter();
const { sleep } = useTiming();
const { objectsDeepEqual } = useDataHelper();

const activitiesStorage = activitiesStore();

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

const activities = ref<Activity[] | []>([]);
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
  count: activitiesStorage.activitiesByPage.count,
}));

const helperFilterText = ref(props.filterText);
const hasActivity = ref(true);
const fetching = ref(false);

watch(
  () => activitiesStorage.activitiesByPage.activities,
  async () => {
    await sleep(1000);
    if (
      !objectsDeepEqual(
        activitiesStorage.activitiesByPage.activities,
        activities.value,
      )
    ) {
      try {
        await fetchActivities();
      } catch (e) {
        addErrorBottom(e);
      }
    }
  },
  // activitiesByPage.activities is mutated in place (splice) as well as
  // replaced, so watch its contents deeply.
  { deep: true },
);

watch(
  () => props.filterText,
  async (newVal) => {
    if (helperFilterText.value !== newVal) {
      pagination.value.page = 1;

      try {
        await fetchActivities();
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
      hasActivity.value = false;
    } else if (count == 0) {
      const activityNumber = await activitiesApi.getItemNumber();
      hasActivity.value = activityNumber > 0;
    } else {
      hasActivity.value = true;
    }
  },
);

async function fetchActivities() {
  fetching.value = true;
  try {
    const actiList = await activitiesStorage.getActivitiesByPageByLimit(
      pagination.value.page,
      pagination.value.limit,
      props.filterText,
    );
    if (actiList && actiList.data) {
      activities.value = actiList.data.activities;

      const actiHeaders = actiList.headers as Headers;
      if (actiHeaders) {
        pagination.value = readPaginationMeta(
          actiHeaders,
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
    name: "activity",
    params: { activity_id: id },
    query: { category: "activity" },
  });
}

function changePage(value: number) {
  pagination.value.page = value;
  fetchActivities();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchActivities();
}

function addItem() {
  emit("add");
}

function cloneItem(activity: Activity) {
  emit("clone", activity);
}

async function deleteItem(activity: Activity) {
  try {
    const lastActiveListItem =
      activities.value.length == 1 && pagination.value.page > 1;
    await activitiesStorage.delete(activity);

    if (lastActiveListItem) {
      changePage(pagination.value.page - 1);
    } else {
      fetchActivities();
    }
  } catch (e) {
    addErrorBottom(e);
  }
}

onMounted(() => {
  fetchActivities();
  helperFilterText.value = props.filterText;
});
</script>
<template>
  <div class="ent-list">
    <div
      v-if="activities && activities.length > 0"
      v-overflow-indicator
      class="ent-list__body-wrapper"
    >
      <div class="ent-list__body">
        <ActivityListItem
          v-for="activity in activities"
          :key="activity.entity_id"
          :activity="activity"
          @goto="goToItem(activity.entity_id)"
          @clone="cloneItem(activity)"
          @delete="deleteItem(activity)"
        />
      </div>
    </div>
    <ListPaging
      v-if="activities && activities.length > 0"
      :pagination="paging"
      :length="activities.length"
      @change-page="changePage"
      @change-per-page="changePerPage"
    />
    <p
      v-if="!fetching && activities.length < 1 && hasActivity"
      class="ent-list__description"
    >
      {{ $t("ui.nothing_was_found") }}
    </p>
    <div
      v-else-if="!fetching && activities.length < 1"
      class="ent-list__no-items"
    >
      <img alt="Add activity" src="/images/add-page.svg" />
      <h3>{{ $t("activity.add_first") }}</h3>
      <p>{{ $t("activity.no_activities") }}</p>
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
