<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import { useRouter } from "vue-router";

import type { Headers, PaginationMeta } from "@/types/rest";
import type { ActivityGroup } from "@/types/activityGroup";

import { activityGroupsStore } from "@/stores/activityGroups";
import { addErrorBottom } from "@/stores/messages";

import { useTiming } from "@/composables/timing";
import { useDataHelper } from "@/composables/dataHelper";
import { getPaginationLimit, readPaginationMeta } from "@/composables/listing";

import ActivityGroupListItem from "@/components/activity-group/ActivityGroupListItem.vue";
import ListPaging from "@/components/ui/ListPaging.vue";

const router = useRouter();
const { sleep } = useTiming();
const { objectsDeepEqual } = useDataHelper();

const activityGroupsStorage = activityGroupsStore();

const props = defineProps({
  pagination: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(["add", "loaded"]);

const activityGroups = ref<ActivityGroup[] | []>([]);
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
  count: activityGroupsStorage.activityGroupsByPage.count,
}));

const fetching = ref(false);

watch(
  () => activityGroupsStorage.activityGroupsByPage.activityGroups,
  async () => {
    await sleep(1000);
    if (
      !objectsDeepEqual(
        activityGroupsStorage.activityGroupsByPage.activityGroups,
        activityGroups.value,
      )
    ) {
      try {
        await fetchActivityGroups();
      } catch (e) {
        addErrorBottom(e);
      }
    }
  },
  // activityGroupsByPage.activityGroups is mutated in place (splice) as well
  // as replaced, so watch its contents deeply.
  { deep: true },
);

async function fetchActivityGroups() {
  fetching.value = true;
  try {
    const activityGroupList =
      await activityGroupsStorage.getActivityGroupsByPageByLimit(
        pagination.value.page,
        pagination.value.limit,
      );
    if (activityGroupList && activityGroupList.data) {
      activityGroups.value = activityGroupList.data.activityGroups;

      const activityGroupHeaders = activityGroupList.headers as Headers;
      if (activityGroupHeaders) {
        pagination.value = readPaginationMeta(
          activityGroupHeaders,
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
    name: "activity-group",
    params: { group_id: id },
    query: { category: "activity-group" },
  });
}

function changePage(value: number) {
  pagination.value.page = value;
  fetchActivityGroups();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchActivityGroups();
}

async function deleteItem(activityGroup: ActivityGroup) {
  try {
    const lastActiveListItem =
      activityGroups.value.length == 1 && pagination.value.page > 1;
    await activityGroupsStorage.delete(activityGroup);

    if (lastActiveListItem) {
      changePage(pagination.value.page - 1);
    } else {
      fetchActivityGroups();
    }
  } catch (e) {
    addErrorBottom(e);
  }
}

function addItem() {
  emit("add");
}

onMounted(() => {
  fetchActivityGroups();
});
</script>
<template>
  <div class="ent-list ent-list--activity-group">
    <div
      v-if="activityGroups && activityGroups.length > 0"
      v-overflow-indicator
      class="ent-list__body-wrapper"
    >
      <div class="ent-list__body">
        <ActivityGroupListItem
          v-for="activityGroup in activityGroups"
          :key="activityGroup.group_id"
          :activity-group="activityGroup"
          @goto="goToItem(activityGroup.group_id)"
          @delete="deleteItem(activityGroup)"
        />
      </div>
    </div>
    <ListPaging
      v-if="activityGroups && activityGroups.length > 0"
      :pagination="paging"
      :length="activityGroups.length"
      @change-page="changePage"
      @change-per-page="changePerPage"
    />
    <div
      v-if="!fetching && activityGroups.length < 1"
      class="ent-list__no-items"
    >
      <img alt="Add activity group" src="/images/add-page.svg" />
      <h3>{{ $t("activity_group.add_first") }}</h3>
      <p>{{ $t("activity_group.no_activity_groups") }}</p>

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
