<script setup lang="ts">
import { ref, watch, computed, useTemplateRef } from "vue";
import { useTranslation } from "i18next-vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import type {
  ConfiguredEntity,
  IntegrationInstance,
  EntityFilterData,
} from "@/types/integrationInstance";

import type { Page } from "@/types/page";
import type { NewGroupData, Group } from "@/types/group";
import type { ChangeCallbackParams } from "@/types/config";

import { useTiming } from "@/composables/timing";
import { useWindowDimension } from "@/composables/windowDimension";
import { focusInput } from "@/composables/device";
import {
  getPaginationLimit,
  savePaginationLimit,
  readPaginationMeta,
} from "@/composables/listing";

import { integrationsStore } from "@/stores/integrations";
import { profileStore } from "@/stores/profile";
import { addErrorBottom } from "@/stores/messages";

import AppModal from "@/components/elements/AppModal.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import UCInput from "@/components/ui/UCInput.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";
import { deepClone } from "@/composables/dataHelper";

const { t } = useTranslation();
const { sleep } = useTiming();
const { isMobileScreen } = useWindowDimension();

const integrationStorage = integrationsStore();

const props = defineProps({
  page: {
    type: Object,
    required: false,
  },
});

defineExpose({
  open,
});
defineEmits(["close"]);

const groupSkeleton = {
  name: "",
  icon: "uc:layer-group",
  description: "",
};

const entityListFilter = ref(<EntityFilterData>{
  searchText: "",
  entityTypes: "",
  instances: "",
});

const profileStorage = profileStore();

const newGroup = ref<NewGroupData>(deepClone(groupSkeleton));
const filteredEntities = ref<ConfiguredEntity[]>([]);
const instances = computed<IntegrationInstance[]>(
  () => integrationStorage.instances,
);

const assignedEntities = ref<ConfiguredEntity[]>([]);

const activeStep = ref(1);
const slideRight = ref(false);
const showModal = ref(false);
const addToPage = ref(true);
const errorMessage = ref("");

const dialogCreateGroup =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogCreateGroup");

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

watch(showModal, async (val) => {
  newGroup.value = deepClone(groupSkeleton);
  assignedEntities.value = [];
  if (val == true) {
    pagination.value = {
      limit: getPaginationLimit() ?? 20,
      page: 1,
    };
    fetchFilteredEntities(true);
    try {
      await integrationStorage.getInstances();
    } catch (e) {
      addErrorBottom(e);
    }
  }
});

watch(activeStep, () => {
  const modalAddGroup = document.querySelector(
    ".modal--add-group",
  ) as HTMLElement;
  if (modalAddGroup) {
    focusInput(modalAddGroup, true);
  }
});

watch(
  () => pagination.value.limit,
  (val) => {
    savePaginationLimit(val);
  },
);

const stepTransition = computed(() => {
  return slideRight.value == true ? "slide-tab-right" : "slide-tab-left";
});

/** Gates the step-1 button. Same predicate as `goToStep`, so the two cannot disagree. */
const isNameValid = computed(() => newGroup.value.name.trim().length > 0);

function changeFilter(data: EntityFilterData) {
  entityListFilter.value = data;
  fetchFilteredEntities(true);
}

function reloadEntities() {
  fetchFilteredEntities(true);
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
  activeStep.value = 1;
}

function closeModal() {
  showModal.value = false;
  activeStep.value = 1;
}

function goToStep(step: number) {
  clearErrors();
  // The step-1 button is disabled while this holds; kept for the paths that
  // reach here without it.
  if (step == 2 && !isNameValid.value) {
    return (errorMessage.value = t("ui.required_field"));
  }

  slideRight.value = step < activeStep.value ? true : false;
  activeStep.value = step;
}

async function changeGroupIcon(params: ChangeCallbackParams) {
  const { value } = params;
  if (newGroup.value) {
    newGroup.value.icon = value as string;
  }
}

function changeAssignedEntities(val: ConfiguredEntity[]) {
  assignedEntities.value = val;
}

function startCreateGroup() {
  if (assignedEntities.value.length > 0) {
    createGroup();
  } else {
    dialogCreateGroup.value?.open();
  }
}

async function createGroup() {
  if (assignedEntities.value.length > 0) {
    newGroup.value.entities = assignedEntities.value.map((entity) => {
      return entity.entity_id;
    });
  }

  try {
    const newItem = await profileStorage.createGroup(newGroup.value);
    if (addToPage.value == true) {
      addGroupToPage(newItem);
    }
    await sleep(2000);
    closeModal();
  } catch (e) {
    addErrorBottom(e);
  }
}

async function addGroupToPage(newItem: Group) {
  if (!props.page) {
    return;
  }

  const modifiedPage = deepClone(props.page);
  const itemsLength = modifiedPage.items.length;
  modifiedPage.items.push({
    group_id: newItem.group_id,
    pos: itemsLength + 1,
  });
  try {
    await profileStorage.updatePage(modifiedPage as Page);
  } catch (e) {
    addErrorBottom(e, "customise_remote.pages.update");
  }
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

function clearErrors() {
  if (errorMessage.value.length > 0) {
    errorMessage.value = "";
  }
}
</script>
<template>
  <Teleport to="body">
    <AppModal
      :show="showModal"
      name="add-group"
      class="modal--steps modal--add modal--add-group"
      @close="closeModal"
    >
      <template #header>
        <button
          v-show="activeStep == 2"
          class="button button--tertiary button--icon modal__header__button-back"
          :class="{ 'button--secondary button--icon--small': isMobileScreen }"
          @click="goToStep(1)"
        >
          <i class="fa-light fa-arrow-left"></i>
        </button>
        <span class="modal__header__item--desktop">{{
          $t("group.add.add_new_group")
        }}</span>
        <span class="modal__header__item--phone">{{
          $t("group.add.new_group")
        }}</span>
      </template>
      <Transition :name="stepTransition">
        <div v-show="activeStep == 1" class="modal__body__step">
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add-group__base-data"
          >
            <IconSelect
              :key="newGroup.icon ? newGroup.icon : 'fa-regular fa-user'"
              :value="newGroup.icon ? newGroup.icon : 'fa-regular fa-user'"
              :change-callback="changeGroupIcon"
            />
            <UCInput
              v-model="newGroup.name"
              :label="$t('form.name')"
              :error-message="errorMessage ? $t(errorMessage) : ''"
              :full-w="true"
              :focus="true"
              @click="clearErrors"
            />
            <UCInput
              v-model="newGroup.description as string"
              :type="'textarea'"
              :label="$t('form.description')"
              :full-w="true"
              @click="clearErrors"
            />
            <UCToggle
              v-if="page"
              v-model="addToPage"
              :label="`${$t('group.add.add_to')} ${page && page.name ? page.name : ''}`"
              :full-w="true"
              :description="$t('group.add.add_to_description')"
            />
          </div>
        </div>
      </Transition>
      <Transition :name="stepTransition">
        <div
          v-show="activeStep == 2"
          class="modal__body__step modal__body__step--list"
        >
          <div class="modal__body__step__body modal__body__step__body--list">
            <p class="modal__body__step__header-info">
              {{ $t("group.add.select_entities") }}
            </p>
            <EntityListFiltered
              :pagination="paging"
              :all-entities="filteredEntities"
              :instances="instances"
              :has-action-buttons="false"
              :has-quick-options="true"
              :has-dropdown-menu="false"
              :parent="'add-group'"
              @change-filter="changeFilter"
              @reload-entities="reloadEntities"
              @change-assigned-entities="changeAssignedEntities"
              @change-page="changePage"
              @change-per-page="changePerPage"
            />
          </div>
        </div>
      </Transition>
      <template #footer>
        <button
          v-if="activeStep == 1"
          :disabled="!isNameValid"
          class="button button--primary button--min-w"
          @click="goToStep(2)"
        >
          {{ $t("ui.next") }}
        </button>
        <button
          v-else-if="activeStep == 2"
          class="button button--primary button--min-w"
          @click="startCreateGroup"
        >
          {{ $t("ui.add") }}
        </button>
      </template>
    </AppModal>
  </Teleport>
  <AppDialog
    ref="dialogCreateGroup"
    :title="$t('group.add.confirm_empty.title')"
    :text="$t('group.add.confirm_empty.question')"
    :submit-text="$t('ui.ok')"
    :cancel-text="$t('ui.cancel')"
    @submit="createGroup"
  />
</template>
