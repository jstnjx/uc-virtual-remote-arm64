<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import type {
  ConfiguredEntity,
  IntegrationInstance,
  EntityFilterData,
} from "@/types/integrationInstance";

import type { Group } from "@/types/group";
import type { IncludedEntity } from "@/types/activity";
import type { ChangeCallbackParams } from "@/types/config";

import {
  getPaginationLimit,
  savePaginationLimit,
  readPaginationMeta,
} from "@/composables/listing";
import { isTouchEnabled } from "@/composables/device";

import { integrationsStore } from "@/stores/integrations";
import { profileStore } from "@/stores/profile";
import { addErrorBottom } from "@/stores/messages";

import AppModal from "@/components/elements/AppModal.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import UCInput from "@/components/ui/UCInput.vue";
import IncludedEntities from "@/components/elements/entity/IncludedEntities.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";
import { deepClone } from "@/composables/dataHelper";

const integrationStorage = integrationsStore();

defineExpose({
  open,
});

const props = defineProps({
  group: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["close", "saved"]);

const entityListFilter = ref(<EntityFilterData>{
  searchText: "",
  entityTypes: "",
  instances: "",
});

const profileStorage = profileStore();

const activeGroup = ref<Group>(deepClone(props.group) as Group);
const values = ref<Record<string, any>>({});
const allEntities = ref<ConfiguredEntity[]>([]);
const filteredEntities = ref<ConfiguredEntity[]>([]);
const selectedEntities = ref<IncludedEntity[]>([]);
const instances = computed<IntegrationInstance[]>(
  () => integrationStorage.instances,
);

const showModal = ref(false);
const showAvailableEntities = ref(false);

const pagination = ref<PaginationMeta>({
  limit: getPaginationLimit() ?? 20,
  page: 1,
});

/**
 * What `ListPaging` renders: the view owns page and limit, the store owns the
 * server's total — so a refetch the view never made (the WS-event reloads)
 * still moves the footer (#685).
 */
const paging = computed<PaginationMeta>(() => ({
  ...pagination.value,
  count: integrationStorage.configuredEntitiesByPage.count,
}));

const loading = ref(false);

const groupAvailableEntities = useTemplateRef<HTMLDivElement>(
  "groupAvailableEntities",
);

watch(showModal, async (val) => {
  activeGroup.value = deepClone(props.group) as Group;
  if (val == true) {
    setDefaults();
    allEntities.value = integrationStorage.$state.configuredEntities;
    fetchFilteredEntities(true);
  }
});

watch(activeGroup, () => {
  if (activeGroup.value) {
    values.value = {
      icon: activeGroup.value.icon || "uc:profile",
      name: activeGroup.value.name,
      description: activeGroup.value.description || "",
    };
  }
});

watch(
  () => pagination.value.limit,
  (val) => {
    savePaginationLimit(val);
  },
);

watch(showAvailableEntities, (newVal) => {
  if (newVal) {
    nextTick(() => {
      const container = groupAvailableEntities.value as HTMLElement;
      if (!isTouchEnabled() && container) {
        const firstInput = container.querySelector("input") as HTMLElement;
        firstInput?.focus();
      }
    });
  }
});

async function setDefaults() {
  loading.value = true;
  try {
    await integrationStorage.getInstances();
  } catch (e) {
    addErrorBottom(e);
  }
  selectedEntities.value = getGroupEntities(activeGroup.value);
  loading.value = false;
}

function getGroupEntities(group: Group): ConfiguredEntity[] {
  return group.entities.map((entity_id: string) => {
    return allEntities.value.find((entity: ConfiguredEntity) => {
      return entity.entity_id === entity_id;
    }) as ConfiguredEntity;
  });
}

function changeFilter(data: EntityFilterData) {
  entityListFilter.value = data;
  fetchFilteredEntities(true);
}

function reloadEntities() {
  setDefaults();
}

async function fetchFilteredEntities(userFetchFirstPage: boolean = false) {
  if (userFetchFirstPage === true) {
    pagination.value.page = 1;
  }

  const searchText = entityListFilter.value.searchText;

  try {
    const entList = await integrationStorage.getConfiguredEntitiesByPageByLimit(
      entityListFilter.value.instances || "",
      false,
      pagination.value.page,
      pagination.value.limit,
      searchText,
      entityListFilter.value.entityTypes,
      props.group.group_id,
    );
    filteredEntities.value = entList.data
      .configuredEntities as ConfiguredEntity[];

    const listHeaders = entList.headers as Headers;
    if (listHeaders) {
      pagination.value = readPaginationMeta(
        listHeaders,
        pagination.value.limit,
      );
    }
  } catch (e) {
    console.error(e);
  }
}

function open() {
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function changeGroupIcon(params: ChangeCallbackParams) {
  const { value } = params;

  const newValues = {
    ...activeGroup.value,
    icon: value as string,
  } as Group;

  submitChange(newValues);
}

function changeItemName(name: unknown) {
  const newValues = {
    ...activeGroup.value,
    name: name as string,
  } as Group;

  submitChange(newValues);
}

function changeItemDescription(description: unknown) {
  const newValues = {
    ...activeGroup.value,
    description: description as string,
  } as Group;

  submitChange(newValues);
}

async function submitChange(message: Group) {
  if (!message) {
    return;
  }

  try {
    const mess = await profileStorage.updateGroup(message);
    await fetchFilteredEntities(true);
    setNewData(mess);
    emit("saved", activeGroup.value);
  } catch (e) {
    addErrorBottom(e, "group.update");
  }
}

async function entityListChanged(newList: IncludedEntity[]) {
  selectedEntities.value = newList;
  const newValues = {
    ...activeGroup.value,
    entities: selectedEntities.value.map((entity) => {
      return entity.entity_id;
    }),
  } as Group;

  submitChange(newValues);
}

function setNewData(groupList: Group[]) {
  const updatedGroup = groupList.find(
    (g) => g.group_id == activeGroup.value.group_id,
  );
  if (updatedGroup) {
    activeGroup.value = deepClone(updatedGroup);
  }
}

function addEntitiesToGroup(entities: ConfiguredEntity[]) {
  const newList = deepClone(selectedEntities.value).concat(entities);
  entityListChanged(newList);
}

function changePage(value: number) {
  pagination.value.page = value;
  fetchFilteredEntities();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchFilteredEntities();
}
</script>
<template>
  <Teleport to="body">
    <AppModal
      :show="showModal"
      :height="'100%'"
      :cols="true"
      name="edit-group"
      class="modal--edit-group"
      @close="closeModal"
    >
      <template #header>
        {{ $t("group.edit.edit_group") }}
      </template>
      <div class="modal__body__col modal__body__col-50 modal__body__col--meta">
        <IconSelect
          :key="activeGroup.icon ? activeGroup.icon : 'fa-light fa-layer-group'"
          :value="
            activeGroup.icon ? activeGroup.icon : 'fa-light fa-layer-group'
          "
          :fallback="'fa-light fa-layer-group'"
          :change-callback="changeGroupIcon"
        />
        <UCInput
          v-model="values.name"
          :full-w="true"
          :label="$t('form.name')"
          @submit="changeItemName"
        />
        <UCInput
          v-model="values.description"
          :type="'textarea'"
          :full-w="true"
          :label="$t('form.description')"
          @submit="changeItemDescription"
        />
        <p class="modal--edit-group__meta-info">
          {{ $t("group.edit.drag_instructions") }}
        </p>
        <Transition
          :name="
            showAvailableEntities == true ? 'slide-tab-right' : 'slide-tab-left'
          "
        >
          <div
            v-show="showAvailableEntities == true"
            ref="groupAvailableEntities"
            class="modal--edit-group__available-entities"
          >
            <div class="modal--edit-group__available-entities__header">
              <button
                class="button button--secondary button--icon"
                @click="showAvailableEntities = false"
              >
                <i class="fa-light fa-arrow-left"></i>
              </button>
              <span>{{ $t("group.edit.add_entities") }}</span>
            </div>
            <EntityListFiltered
              :pagination="paging"
              :all-entities="filteredEntities"
              :instances="instances"
              :drag-group="'group-entities'"
              :has-quick-options="true"
              :parent="'edit-group'"
              @add-entities="addEntitiesToGroup"
              @change-filter="changeFilter"
              @reload-entities="reloadEntities"
              @change-page="changePage"
              @change-per-page="changePerPage"
            />
          </div>
        </Transition>
      </div>
      <div class="modal__body__col modal__body__col-50">
        <IncludedEntities
          ref="includedList"
          :entities="selectedEntities"
          :instances="instances"
          :show-button-add="showAvailableEntities == false"
          :drag-group="'group-entities'"
          :drag-button="true"
          :loading="loading"
          :text-add-first-descr="
            $t('group.edit.empty') + ' ' + $t('entity.add_first_btn_below')
          "
          @entity-list-changed="entityListChanged"
          @reload-entities="reloadEntities"
          @click-add="showAvailableEntities = true"
        />
      </div>
    </AppModal>
  </Teleport>
</template>
