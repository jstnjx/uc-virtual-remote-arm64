<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { asyncComputed } from "@vueuse/core";

import type {
  ConfiguredEntity,
  IntegrationInstance,
  EntityFilterData,
} from "@/types/integrationInstance";
import type { DropdownItem } from "@/types/ui";

import { EntityType } from "@/types/enums";

type FilterInstancesType = {
  [key: string]: { [key: string]: any; selected: boolean };
};

import translatedProperty from "@/composables/translatedProperty";
import { isTouchEnabled } from "@/composables/device";
import { useWindowDimension } from "@/composables/windowDimension";
import { getIconName } from "@/composables/icon";
import { deepClone, useDataHelper } from "@/composables/dataHelper";

import Draggable from "vuedraggable";

import UCSearch from "@/components/ui/UCSearch.vue";
import FilterTabs from "@/components/ui/FilterTabs.vue";
import EntityListItem from "@/components/elements/entity/EntityListItem.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import FilterDropdown from "@/components/elements/FilterDropdown.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import ModalMinimal from "@/components/elements/ModalMinimal.vue";
import QuickEditModal from "@/components/elements/QuickEditModal.vue";
import ListPaging from "@/components/ui/ListPaging.vue";

const { isSmallScreen } = useWindowDimension();
const { objectsDeepEqual } = useDataHelper();

const props = defineProps({
  allEntities: {
    type: Array<ConfiguredEntity>,
    required: true,
  },
  instances: {
    type: Array,
    required: false,
    default: () => [],
  },
  dragGroup: {
    type: String,
    default: "",
  },
  hasDropdownFilter: {
    type: Boolean,
    default: true,
  },
  hasActionButtons: {
    type: Boolean,
    default: true,
  },
  hasFormActionButtons: {
    type: Boolean,
    default: false,
  },
  hasQuickOptions: {
    type: Boolean,
    default: false,
  },
  hasDropdownMenu: {
    type: Boolean,
    default: true,
  },
  parent: {
    type: String,
    default: "",
  },
  integrationInfo: {
    type: Boolean,
    default: true,
  },
  pagination: {
    type: Object,
    default: () => ({}),
  },
  excludeEntityTypes: {
    type: Array,
    default: () => [],
  },
});

const entityDropdownItems = [
  {
    icon: "fa-light fa-plus",
    label: "entity.add_to_page",
    value: "add_to_page",
  },
  {
    icon: "fa-light fa-edit",
    label: "ui.edit",
    value: "edit",
  },
] as DropdownItem[];

const emit = defineEmits([
  "changeFilter",
  "moreEntities",
  "reloadEntities",
  "addEntities",
  "cancel",
  "changeAssignedEntities",
  "changePage",
  "changePerPage",
]);

const entities = ref<ConfiguredEntity[]>([]);

const elEntityList =
  useTemplateRef<InstanceType<typeof Draggable>>("elEntityList");
const assignedEntities = ref<ConfiguredEntity[]>([]);

const searchEntity = ref("");
const instance = getCurrentInstance() || {
  uid: Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000,
};

const filterInstances = ref<FilterInstancesType>({});

const filterEntityTypes = ref<Record<EntityType, { selected: boolean }>>(
  Object.values(EntityType)
    .filter((type) => !props.excludeEntityTypes?.includes(type))
    .reduce(
      (obj, type) => {
        obj[type] = { selected: false };
        return obj;
      },
      {} as Record<EntityType, { selected: boolean }>,
    ),
);

const itemToModify = ref<ConfiguredEntity | null>(null);
const itemToEdit = ref<ConfiguredEntity | null>(null);
const dropdownedEntity = ref<ConfiguredEntity | null>(null);

watch(
  props,
  () => {
    setLists();
  },
  // The entity-list props are arrays mutated in place (WS entity changes), so
  // watch them deeply to rebuild the derived lists.
  { deep: true },
);

watch(
  assignedEntities,
  (val) => {
    emit("changeAssignedEntities", val);
  },
  // assignedEntities is mutated in place (push/splice), so watch its contents
  // deeply to emit on content changes, not just replacement.
  { deep: true },
);

const iconDrag = asyncComputed(async () => {
  return await getIconName("fa-grip-vertical");
});

const paramEntityTypes = computed(() => {
  return Object.entries(filterEntityTypes.value)
    .filter(([_key, value]) => value.selected === true)
    .map(([key, _value]) => key)
    .join(",");
});

const paramInstances = computed(() => {
  return Object.entries(filterInstances.value)
    .filter(([_key, value]) => value.selected === true)
    .map(([key, _value]) => key)
    .join(",");
});

const buttonStyle = computed(() => {
  return isSmallScreen.value ? "button--secondary" : "button--tertiary";
});

const hasBlackBg = computed(() => {
  const themeColoredViews = [
    "add-group",
    "edit-group",
    "add-activity",
    "add-macro",
    "add-activity-group",
    "add-integration",
  ];
  return themeColoredViews.includes(props.parent);
});

// searchEntity is a string ref and the two params are computed strings, so
// there is nothing to traverse deeply — the `deep` flag was a no-op.
watch([searchEntity, paramEntityTypes, paramInstances], () => {
  const data: EntityFilterData = {
    searchText: searchEntity.value,
    entityTypes: paramEntityTypes.value,
    instances: paramInstances.value,
  };
  emit("changeFilter", data);
});

function setFilterInstances() {
  if (Object.keys(filterInstances.value).length > 0) {
    return true;
  }

  filterInstances.value = (props.instances as IntegrationInstance[]).reduce(
    (
      obj: { [key: string]: any },
      item: { integration_id: string; [key: string]: any },
    ) => {
      obj[item.integration_id] = { selected: false, ...item };
      return obj;
    },
    {},
  );
}

function goTo(item: DropdownItem, entity: ConfiguredEntity) {
  switch (item.value) {
    case "add_to_page":
      addToPage(entity);
      break;
    case "edit":
      editEntity(entity);
      break;
    default:
      return false;
  }
}

function dropdownVisibility(state: boolean, entity: ConfiguredEntity) {
  if (state == true) {
    dropdownedEntity.value = entity;
  } else {
    dropdownedEntity.value = null;
  }
}

function disableEntityType(
  keyEntityType: string,
  collection: { [key: string]: any },
) {
  if (collection) {
    collection[keyEntityType].selected = false;
  }
}

function assignAllEntities(array: ConfiguredEntity[]) {
  assignedEntities.value = [];
  array.forEach((obj) => {
    assignedEntities.value.push(obj);
  });
}

function deAssignAllEntities() {
  assignedEntities.value = [];
}

function addEntitiesToList() {
  if (assignedEntities.value.length > 0) {
    emit("addEntities", assignedEntities.value);
    deAssignAllEntities();
  }
}

function isAssignedItem(entity: ConfiguredEntity) {
  return (
    assignedEntities.value.findIndex(
      (item: ConfiguredEntity) => item.entity_id === entity.entity_id,
    ) > -1
  );
}

function toggleItemCheckbox(entity: ConfiguredEntity) {
  const itemIndex = assignedEntities.value.findIndex(
    (item: ConfiguredEntity) => item.entity_id === entity.entity_id,
  );
  if (itemIndex > -1) {
    assignedEntities.value.splice(itemIndex, 1);
  } else {
    assignedEntities.value.push(entity);
  }
}

function setLists() {
  if (!objectsDeepEqual(props.allEntities, entities.value)) {
    entities.value = deepClone(props.allEntities);

    if (itemToModify.value != null) {
      const newItemData = entities.value.find((item: ConfiguredEntity) => {
        return item.entity_id === itemToModify.value?.entity_id;
      });
      if (newItemData) {
        itemToModify.value = newItemData;
      }
    }
  }

  setFilterInstances();
}

async function openItemModify(entity: ConfiguredEntity) {
  if (!isTouchEnabled()) {
    return false;
  }

  itemToModify.value = entity;
}

function addToPage(entity: ConfiguredEntity | null) {
  if (entity == null) {
    return;
  }

  const arrayMessage = [entity];
  emit("addEntities", arrayMessage);
  itemToModify.value = null;
}

function editEntity(entity: ConfiguredEntity | null) {
  if (entity == null) {
    return;
  }

  itemToEdit.value = entity;
}

function getEntityList() {
  return entities.value;
}

function changePage(value: number) {
  emit("changePage", value);
}

function changePerPage(value: number) {
  emit("changePerPage", value);
}

function reloadEntities() {
  emit("reloadEntities");
}

onMounted(() => {
  setLists();
});

defineExpose({
  addEntitiesToList,
  getEntityList,
});
</script>
<template>
  <ListWithFilter :skip-items-wrapper="true" class="lwf-entity-list">
    <template #form>
      <div class="list-with-filter__form__tools">
        <div class="list-with-filter__search list-with-filter__search--small">
          <UCSearch
            v-model="searchEntity"
            :debouncing="true"
            :small="true"
            :has-sibling="hasDropdownFilter"
            :gray="hasBlackBg"
          />
          <FilterDropdown
            v-if="hasDropdownFilter"
            v-model:filter-entity-types="filterEntityTypes"
            v-model:filter-instances="filterInstances"
          />
        </div>
        <div
          v-if="hasFormActionButtons && entities.length > 0"
          class="list-with-filter__form__actions"
        >
          <button
            v-if="entities.length === assignedEntities.length"
            :title="$t('ui.clear_all')"
            class="button button--secondary button--icon"
            @click="deAssignAllEntities()"
          >
            <i class="fa-light fa-xmark"></i>
          </button>
          <button
            v-else
            :title="$t('ui.select_all')"
            class="button button--secondary button--icon"
            @click="assignAllEntities(entities)"
          >
            <i class="fa-light fa-check"></i>
          </button>
        </div>
      </div>
      <div v-if="hasDropdownFilter" class="list-with-filter__tabs">
        <FilterTabs
          :list="filterEntityTypes"
          @remove-element="(el) => disableEntityType(el, filterEntityTypes)"
        />
        <FilterTabs
          :list="filterInstances"
          @remove-element="(el) => disableEntityType(el, filterInstances)"
        />
      </div>
    </template>
    <template #items>
      <Draggable
        ref="elEntityList"
        v-model="entities"
        v-overflow-indicator
        :group="dragGroup"
        :force-fallback="true"
        class="lwf-entity-list__items"
        item-key="entity_id"
        handle=".entity-item__drag"
      >
        <template #item="{ element }">
          <div
            class="entity-item"
            :class="{
              'entity-item--selected': isAssignedItem(element) === true,
              'entity-item--dropdowned':
                dropdownedEntity?.entity_id == element.entity_id,
            }"
          >
            <EntityListItem
              :list-item="element"
              :instances="instances"
              :integration-info="integrationInfo"
              :inactive="true"
              @click-meta="openItemModify"
              @edit="editEntity"
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
                  v-if="hasDropdownMenu"
                  :list-data="entityDropdownItems"
                  :icon="'fa-light fa-edit'"
                  :title="translatedProperty(element.name) || ''"
                  :on-right="true"
                  class="entity-item__dropdown-menu"
                  @item-click="(item) => goTo(item, element)"
                  @show="(state) => dropdownVisibility(state, element)"
                />
              </template>
            </EntityListItem>
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
      <div v-show="hasActionButtons" class="list-with-filter__footer">
        <div
          v-show="
            (!isSmallScreen || assignedEntities.length > 0) &&
            entities.length > 0
          "
          class="lwf-entity-list__actions"
          :class="{ 'lwf-entity-list__actions--accent': hasBlackBg }"
        >
          <template v-if="!isSmallScreen">
            <button
              v-if="entities.length === assignedEntities.length"
              class="button"
              :class="buttonStyle"
              @click="deAssignAllEntities()"
            >
              <i class="fa-thin fa-circle-xmark"></i>
              {{ $t("ui.clear_all") }}
            </button>
            <button
              v-else
              class="button"
              :class="buttonStyle"
              @click="assignAllEntities(entities)"
            >
              <i class="fa-thin fa-circle-check"></i>
              {{ $t("ui.select_all") }}
            </button>
          </template>
          <Transition name="opacity-fast">
            <button
              v-show="assignedEntities.length > 0"
              class="button"
              :class="buttonStyle"
              @click="addEntitiesToList()"
            >
              <i class="fa-thin fa-circle-arrow-right"></i>
              {{ $t("ui.add") }}
            </button>
          </Transition>
        </div>
      </div>
    </template>
    <template v-if="pagination.page && pagination.limit" #pagination>
      <ListPaging
        v-if="entities"
        :pagination="pagination || {}"
        :length="entities.length"
        :compact="true"
        @change-page="changePage"
        @change-per-page="changePerPage"
      />
    </template>
  </ListWithFilter>
  <Teleport to="body">
    <ModalMinimal
      :show="itemToModify != null"
      :name="'modal-entity-options'"
      :title="
        itemToModify != null ? translatedProperty(itemToModify?.name) : ''
      "
      class="modal-minimal--item-options"
      @close="itemToModify = null"
    >
      <div v-if="itemToModify != null" class="modal-minimal__list">
        <button
          v-if="dragGroup == 'customise-remote-items'"
          @click="addToPage(itemToModify)"
        >
          <i class="fa-light fa-plus"></i>
          <span>{{ $t("entity.add_to_page") }}</span>
        </button>
        <button @click="editEntity(itemToModify)">
          <i class="fa-light fa-pencil"></i>
          <span>{{ $t("ui.edit") }}</span>
        </button>
      </div>
    </ModalMinimal>
  </Teleport>
  <QuickEditModal
    v-if="itemToEdit != null"
    :item="itemToEdit"
    :show-by-parent="true"
    @saved="reloadEntities"
    @closed="itemToEdit = null"
  />
</template>
