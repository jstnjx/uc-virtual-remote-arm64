<script setup lang="ts">
import {
  ref,
  watch,
  computed,
  onMounted,
  getCurrentInstance,
  useTemplateRef,
} from "vue";
import { asyncComputed } from "@vueuse/core";
import type { Group } from "@/types/group";
import type { DropdownItem } from "@/types/ui";

import { isTouchEnabled } from "@/composables/device";
import { useWindowDimension } from "@/composables/windowDimension";
import { getIconName } from "@/composables/icon";

import Draggable from "vuedraggable";

import UCSearch from "@/components/ui/UCSearch.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import GroupListItem from "@/components/elements/group/GroupListItem.vue";
import AddGroup from "@/components/elements/group/AddGroup.vue";
import EditGroup from "@/components/elements/group/EditGroup.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import ModalMinimal from "@/components/elements/ModalMinimal.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";

const props = defineProps({
  allGroups: {
    type: Array,
    required: true,
  },
  selectedGroups: {
    type: Array,
    required: false,
    default: () => [],
  },
  dragGroup: {
    type: String,
    default: "",
  },
  dragItemHandle: {
    type: Boolean,
    default: true,
  },
  page: {
    type: Object,
    required: false,
  },
  hasQuickOptions: {
    type: Boolean,
    default: false,
  },
});

const groupDropdownItems = [
  {
    icon: "fa-light fa-plus",
    label: "entity.add_to_page",
    value: "add_to_page",
  },
  {
    icon: "fa-light fa-pencil",
    label: "ui.edit",
    value: "edit",
  },
  {
    icon: "fa-light fa-trash",
    label: "ui.delete",
    value: "delete",
  },
] as DropdownItem[];

const emit = defineEmits(["addGroups", "delete"]);

const { isSmallScreen } = useWindowDimension();

const elGroupList =
  useTemplateRef<InstanceType<typeof Draggable>>("elGroupList");
const assignedGroups = ref<Group[]>([]);

const searchGroup = ref("");
const instance = getCurrentInstance() || {
  uid: Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000,
};

const reducedGroupList = ref<Group[]>([]);

const itemToModify = ref<Group | null>(null);
const itemToEdit = ref<Group | null>(null);
const itemToDelete = ref<Group | null>(null);
const dropdownedGroup = ref<Group | null>(null);

const modalAddGroup =
  useTemplateRef<InstanceType<typeof AddGroup>>("modalAddGroup");
const modalEditGroup =
  useTemplateRef<InstanceType<typeof EditGroup>>("modalEditGroup");
const dialogDeleteGroup =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDeleteGroup");

watch(
  props,
  () => {
    setLists();
  },
  // The group-list props are arrays mutated in place (WS group changes), so
  // watch them deeply to rebuild the derived lists.
  { deep: true },
);

watch(searchGroup, () => {
  reducedGroupList.value = getReducedGroupList();
});

watch(reducedGroupList, async () => {
  if (itemToModify.value != null) {
    const newItemData = reducedGroupList.value.find((item) => {
      return item.group_id === itemToModify.value?.group_id;
    });
    if (newItemData) {
      itemToModify.value = newItemData;
    }
  }
});

const iconDrag = asyncComputed(async () => {
  return await getIconName("fa-grip-vertical");
});

const buttonStyle = computed(() => {
  return isSmallScreen.value ? "button--secondary" : "button--tertiary";
});

function getReducedGroupList() {
  const skipGroups = (props.selectedGroups as Group[]).map((group) => {
    return group.group_id;
  });

  return (props.allGroups as Group[]).filter((group: Group) => {
    if (skipGroups.includes(group.group_id)) {
      return false;
    }
    return (
      group.name.toLowerCase().includes(searchGroup.value) ||
      (group.description || "").toLowerCase().includes(searchGroup.value)
    );
  });
}

function goTo(item: DropdownItem, group: Group) {
  switch (item.value) {
    case "add_to_page":
      addToPage(group);
      break;
    case "edit":
      editGroup(group);
      break;
    case "delete":
      startDeleteGroup(group);
      break;
    default:
      return false;
  }
}

function dropdownVisibility(state: boolean, group: Group) {
  if (state == true) {
    dropdownedGroup.value = group;
  } else {
    dropdownedGroup.value = null;
  }
}

function assignAllGroups(array: Group[]) {
  assignedGroups.value = [];
  array.forEach((obj) => {
    assignedGroups.value.push(obj);
  });
}

function deAssignAllGroups() {
  assignedGroups.value = [];
}

function addGroupsToPage() {
  if (assignedGroups.value.length > 0) {
    emit("addGroups", assignedGroups.value);
    deAssignAllGroups();
  }
}

function isAssignedItem(group: Group) {
  return (
    assignedGroups.value.findIndex(
      (item: Group) => item.group_id === group.group_id,
    ) > -1
  );
}

function toggleItemCheckbox(group: Group) {
  const itemIndex = assignedGroups.value.findIndex(
    (item: Group) => item.group_id === group.group_id,
  );
  if (itemIndex > -1) {
    assignedGroups.value.splice(itemIndex, 1);
  } else {
    assignedGroups.value.push(group);
  }
}

function createGroup() {
  modalAddGroup.value?.open();
}

function setLists() {
  reducedGroupList.value = getReducedGroupList();
}

async function openItemModify(group: Group) {
  if (!isTouchEnabled()) {
    return false;
  }

  itemToModify.value = group;
}

function addToPage(group: Group | null) {
  if (group == null) {
    return;
  }

  const arrayMessage = [group];
  emit("addGroups", arrayMessage);
  itemToModify.value = null;
}

function editGroup(group: Group | null) {
  if (group == null) {
    return;
  }

  itemToEdit.value = group;
  modalEditGroup.value?.open();
}

function startDeleteGroup(group: Group | null) {
  if (group == null) {
    return;
  }

  itemToDelete.value = group;
  dialogDeleteGroup.value?.open();
}

function deleteGroup() {
  if (itemToDelete.value == null) {
    return;
  }

  emit("delete", itemToDelete.value);
  itemToDelete.value = null;
  itemToModify.value = null;
}

onMounted(() => {
  setLists();
});
</script>
<template>
  <ListWithFilter :skip-items-wrapper="true" class="lwf-group-list">
    <template #form>
      <div class="list-with-filter__search list-with-filter__search--small">
        <UCSearch v-model="searchGroup" :small="true" />
      </div>
    </template>
    <template #items>
      <Draggable
        ref="elGroupList"
        v-model="reducedGroupList"
        :group="dragGroup"
        :force-fallback="true"
        class="lwf-group-list__items"
        item-key="group_id"
        handle=".entity-item__drag"
      >
        <template #item="{ element }">
          <div
            class="entity-item"
            :class="{
              'entity-item--selected': isAssignedItem(element) === true,
              'entity-item--dropdowned':
                dropdownedGroup?.group_id == element.group_id,
            }"
          >
            <GroupListItem
              :list-item="element"
              :inactive="true"
              :edit-button="true"
              @click-meta="openItemModify"
              @edit="editGroup"
            >
              <template #checkbox>
                <div
                  class="form-item form-item--checkbox-tick entity-item__checkbox-tick"
                >
                  <input
                    :id="`${instance.uid}-${element.entity_id}-checkbox-tick`"
                    type="checkbox"
                    :checked="isAssignedItem(element)"
                  />
                  <label
                    class="toggle"
                    :for="`${instance.uid}-${element.entity_id}-checkbox-tick`"
                  />
                  <button
                    class="button--toggle-tick"
                    @click="toggleItemCheckbox(element)"
                  ></button>
                </div>
              </template>
              <template #options>
                <DropdownMenu
                  :list-data="groupDropdownItems"
                  :icon="'fa-light fa-edit'"
                  :title="element.name"
                  :on-right="true"
                  class="entity-item__dropdown-menu"
                  @item-click="(item) => goTo(item, element)"
                  @show="(state) => dropdownVisibility(state, element)"
                />
              </template>
            </GroupListItem>
            <span
              v-if="isSmallScreen && hasQuickOptions"
              class="entity-item__quick-options"
              @click="openItemModify(element)"
            >
              <i class="fa-regular fa-ellipsis-vertical"></i>
            </span>
            <span v-else-if="dragGroup.length > 0" class="entity-item__drag">
              <i v-if="iconDrag" class="fa-regular" :class="iconDrag"></i>
            </span>
          </div>
        </template>
      </Draggable>
    </template>
    <template #footer>
      <div class="list-with-filter__footer">
        <div class="lwf-group-list__actions">
          <template v-if="!isSmallScreen && reducedGroupList.length > 0">
            <button
              v-if="
                reducedGroupList.length === assignedGroups.length &&
                reducedGroupList.length > 0
              "
              class="button"
              :class="buttonStyle"
              @click="deAssignAllGroups()"
            >
              <i class="fa-thin fa-circle-xmark"></i>
              {{ $t("ui.clear_all") }}
            </button>
            <button
              v-else-if="reducedGroupList.length > 0"
              class="button"
              :class="buttonStyle"
              @click="assignAllGroups(reducedGroupList)"
            >
              <i class="fa-thin fa-circle-check"></i>
              {{ $t("ui.select_all") }}
            </button>
          </template>
          <button class="button" :class="buttonStyle" @click="createGroup()">
            <i class="fa-thin fa-circle-plus"></i>
            {{ $t("ui.new") }}
          </button>
          <Transition name="opacity-fast">
            <button
              v-show="assignedGroups.length > 0 && reducedGroupList.length > 0"
              class="button"
              :class="buttonStyle"
              @click="addGroupsToPage()"
            >
              <i class="fa-thin fa-circle-arrow-right"></i>
              {{ $t("ui.add") }}
            </button>
          </Transition>
        </div>
      </div>
    </template>
  </ListWithFilter>
  <Teleport to="body">
    <ModalMinimal
      :show="itemToModify != null"
      :name="'modal-group-options'"
      :title="itemToModify != null ? itemToModify?.name : ''"
      class="modal-minimal--item-options"
      @close="itemToModify = null"
    >
      <div v-if="itemToModify != null" class="modal-minimal__list">
        <button @click="addToPage(itemToModify)">
          <i class="fa-light fa-plus"></i>
          <span>{{ $t("entity.add_to_page") }}</span>
        </button>
        <button @click="editGroup(itemToModify)">
          <i class="fa-light fa-pencil"></i>
          <span>{{ $t("ui.edit") }}</span>
        </button>
        <button @click="startDeleteGroup(itemToModify)">
          <i class="fa-light fa-trash"></i>
          <span>{{ $t("ui.delete") }}</span>
        </button>
      </div>
    </ModalMinimal>
  </Teleport>
  <AppDialog
    ref="dialogDeleteGroup"
    :title="$t('group.delete.title')"
    :text="$t('group.delete.question')"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    @submit="deleteGroup"
    @close="itemToDelete = null"
  />
  <AddGroup ref="modalAddGroup" :page="page" />
  <EditGroup ref="modalEditGroup" :group="itemToEdit || {}" />
</template>
