<script setup lang="ts">
import { ref, watch, onMounted } from "vue";

import type { Group } from "@/types/group";
import type { Page } from "@/types/page";

import { profileStore } from "@/stores/profile";
import { addErrorBottom } from "@/stores/messages";

import { useTiming } from "@/composables/timing";

import GroupListFiltered from "@/components/elements/group/GroupListFiltered.vue";

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  page: {
    type: Object,
    default: () => ({}),
  },
});

const { sleep } = useTiming();

const emit = defineEmits(["close", "addToPage"]);

const profileStorage = profileStore();

const groupList = ref<Group[]>([]);
const selectedGroups = ref<Group[]>([]);

const showList = ref(false); // For transition, animation

watch(
  () => profileStorage.groups,
  (groups) => {
    if (groups) {
      groupList.value = groups;
    }
  },
);

watch(props, async (val) => {
  getGroupsData();

  if (val.show == true) {
    showList.value = true;
  } else if (showList.value == true) {
    await sleep(1000);
    showList.value = false;
  }
});

function getGroupsData() {
  groupList.value = profileStorage.$state.groups;
  const pageItems = (props.page as Page).items;
  if (!pageItems) {
    return false;
  }

  selectedGroups.value = pageItems.filter((item) => {
    return item.group_id;
  }) as unknown as Group[];
}

async function addToPage(groups: Group[]) {
  emit("addToPage", groups);
}

async function deleteGroup(group: Group) {
  try {
    groupList.value = await profileStorage.deleteGroup(group);
  } catch (e) {
    addErrorBottom(e);
  }
}

function close() {
  emit("close");
}

onMounted(async () => {
  getGroupsData();
});
</script>
<template>
  <div class="custom-remote-modify custom-remote-add-groups">
    <div class="custom-remote-modify__header custom-remote-add-groups__header">
      <button
        class="button button--blank button--icon button--icon--medium"
        @click="close"
      >
        <i class="fa-regular fa-arrow-left"></i>
      </button>
      <span>{{ $t("customise_remote.add_groups.title") }}</span>
    </div>
    <GroupListFiltered
      v-if="show || showList"
      :all-groups="groupList"
      :selected-groups="selectedGroups"
      :drag-group="'customise-remote-items'"
      :page="page"
      :has-quick-options="true"
      @add-groups="addToPage"
      @delete="deleteGroup"
    />
  </div>
</template>
