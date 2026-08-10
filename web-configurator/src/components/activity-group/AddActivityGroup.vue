<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import type {
  ConfiguredEntity,
  EntityFilterData,
} from "@/types/integrationInstance";

import type { ChangeCallbackParams } from "@/types/config";
import type { ActivityGroupOptions } from "@/types/activityGroup";
import type { LanguageText } from "@/types/config";

import { getActivityGroupOptions } from "@/composables/activities";
import { getCurrentLocale } from "@/composables/translatedProperty";
import { useWindowDimension } from "@/composables/windowDimension";
import { focusInput } from "@/composables/device";
import {
  getPaginationLimit,
  savePaginationLimit,
  paginationCount,
  readPaginationMeta,
} from "@/composables/listing";

import { activityGroupsStore } from "@/stores/activityGroups";
import { activitiesStore } from "@/stores/activities";
import { addErrorFull } from "@/stores/messages";

import AppModal from "@/components/elements/AppModal.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import UCSelect from "@/components/ui/UCSelect.vue";
import UCInput from "@/components/ui/UCInput.vue";
import { deepClone } from "@/composables/dataHelper";

const { t } = useTranslation();

const router = useRouter();
const { isMobileScreen } = useWindowDimension();

const storage = activityGroupsStore();
const activitiesStorage = activitiesStore();

defineExpose({
  open,
});

defineEmits(["close"]);

const activityGroupOptions = ref(getActivityGroupOptions(t));

const activityGrSkeleton = {
  name: "",
  icon: "fa-layer-group",
  description: "",
  removeTurnOnDelays: {
    label: activityGroupOptions.value.removeTurnOnDelaysOptions[0].label || "",
    value: activityGroupOptions.value.removeTurnOnDelaysOptions[0].value || "",
  },
  turnOffUnusedEntities: {
    label:
      activityGroupOptions.value.turnOffUnusedEntitiesOptions[0].label || "",
    value:
      activityGroupOptions.value.turnOffUnusedEntitiesOptions[0].value || "",
  },
};

const entityListFilter = ref(<EntityFilterData>{
  searchText: "",
});

const newActivityGroup = ref(deepClone(activityGrSkeleton));
const filteredEntities = ref<ConfiguredEntity[]>([]);

const assignedEntities = ref<ConfiguredEntity[]>([]);

const activeStep = ref(1);
const slideRight = ref(false);
const showModal = ref(false);
const errorMessage = ref("");

/**
 * The picker owns its pagination, count included: it queries a different set
 * than the activity list (ungrouped activities only), so it cannot read the
 * store's page state without also writing to it.
 */
const pagination = ref<PaginationMeta>({
  limit: getPaginationLimit() ?? 20,
  page: 1,
  count: 0,
});

watch(showModal, async (val) => {
  newActivityGroup.value = deepClone(activityGrSkeleton);
  entityListFilter.value = { searchText: "" };
  assignedEntities.value = [];
  if (val == true) {
    pagination.value = {
      limit: getPaginationLimit() ?? 20,
      page: 1,
    };
    fetchEntities(true);
  }
});

watch(activeStep, () => {
  const modalAddActivityGroup = document.querySelector(
    ".modal--add-activity-group",
  ) as HTMLElement;
  if (modalAddActivityGroup) {
    focusInput(modalAddActivityGroup, true);
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
const isNameValid = computed(
  () => newActivityGroup.value.name.trim().length > 0,
);

async function submitForm() {
  try {
    const nameValue: LanguageText = {
      [getCurrentLocale()]: newActivityGroup.value.name,
    };

    const descriptionValue = {
      [getCurrentLocale()]: newActivityGroup.value.description,
    };

    const iconRegex = /fa-/;
    const iconValue = newActivityGroup.value.icon.replace(iconRegex, "uc:");

    const activity_ids = assignedEntities.value.map((entity) => {
      return entity.entity_id;
    });

    const options = {} as ActivityGroupOptions;

    if (
      newActivityGroup.value &&
      newActivityGroup.value.removeTurnOnDelays.value
    ) {
      options.remove_turn_on_delays =
        newActivityGroup.value.removeTurnOnDelays.value;
    }

    if (
      newActivityGroup.value &&
      newActivityGroup.value.turnOffUnusedEntities.value
    ) {
      options.turn_off_unused_entities =
        newActivityGroup.value.turnOffUnusedEntities.value;
    }

    const activityGroup = await storage.create({
      name: nameValue,
      description: descriptionValue,
      icon: iconValue,
      activity_ids: activity_ids,
      ...options,
    });

    await storage.getAll();
    router.push({
      name: "activity-group",
      params: { group_id: activityGroup.group_id },
    });
  } catch (e) {
    addErrorFull(e);
  }
  closeModal();
}

function changeFilter(data: EntityFilterData) {
  entityListFilter.value = data;
  fetchEntities(true);
}

function reloadEntities() {
  fetchEntities(true);
}

async function fetchEntities(userFetchFirstPage: boolean = false) {
  if (userFetchFirstPage === true) {
    pagination.value.page = 1;
  }

  const searchText = entityListFilter.value.searchText;

  try {
    const entList = await activitiesStorage.getUngroupedActivities(
      pagination.value.page,
      pagination.value.limit,
      searchText,
    );
    filteredEntities.value = entList.data as ConfiguredEntity[];

    const listHeaders = entList.headers as Headers;
    if (listHeaders) {
      pagination.value = {
        ...readPaginationMeta(listHeaders, pagination.value.limit),
        count: paginationCount(listHeaders),
      };
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

async function changeActivityIcon(params: ChangeCallbackParams) {
  const { value } = params;
  if (newActivityGroup.value) {
    newActivityGroup.value.icon = value as string;
  }
}

function changeAssignedEntities(val: ConfiguredEntity[]) {
  assignedEntities.value = val;
}

function clearErrors() {
  if (errorMessage.value.length > 0) {
    errorMessage.value = "";
  }
}

function changePage(value: number) {
  pagination.value.page = value;
  fetchEntities();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchEntities();
}
</script>
<template>
  <Teleport to="body">
    <AppModal
      :show="showModal"
      name="add-activity-group"
      class="modal--steps modal--add modal--add-activity-group"
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
        <span class="modal__header__item--desktop">
          {{ $t("activity_group.add.add_new_activity_group") }}
        </span>
        <span class="modal__header__item--phone">
          {{ $t("activity_group.add.new_activity_group") }}
        </span>
      </template>
      <Transition :name="stepTransition">
        <div v-show="activeStep == 1" class="modal__body__step">
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <IconSelect
              :key="newActivityGroup.icon"
              :value="newActivityGroup.icon"
              :change-callback="changeActivityIcon"
              :fallback="'fa-thin fa-layer-group'"
            />
            <UCInput
              v-model="newActivityGroup.name"
              :label="$t('form.name')"
              :error-message="errorMessage ? $t(errorMessage) : ''"
              :full-w="true"
              :focus="true"
              @click="clearErrors"
            />
            <UCInput
              v-model="newActivityGroup.description as string"
              :type="'textarea'"
              :label="$t('form.description')"
              :full-w="true"
              @click="clearErrors"
            />
            <div class="form-item form-item--select">
              <span class="form-item--select__label">{{
                $t("activity_group.options.remove_turn_on_delays.title")
              }}</span>
              <UCSelect
                v-model="newActivityGroup.removeTurnOnDelays"
                :options="activityGroupOptions.removeTurnOnDelaysOptions"
                :light="true"
                :dynamic-width="true"
                :dynamic-position="true"
              />
            </div>
            <div
              class="form-item form-item--select form-item--select--no-border"
            >
              <span class="form-item--select__label">{{
                $t("activity_group.options.turn_off_unused_entities.title")
              }}</span>
              <UCSelect
                v-model="newActivityGroup.turnOffUnusedEntities"
                :options="activityGroupOptions.turnOffUnusedEntitiesOptions"
                :light="true"
                :dynamic-width="true"
                :dynamic-position="true"
              />
            </div>
          </div>
        </div>
      </Transition>
      <Transition :name="stepTransition">
        <div v-show="activeStep == 2" class="modal__body__step">
          <Transition name="opacity">
            <button
              v-show="activeStep == 2"
              class="button button--secondary button--icon modal__body__step__back"
              @click="goToStep(1)"
            >
              <i class="fa-light fa-arrow-left"></i>
            </button>
          </Transition>
          <div class="modal__body__step__body modal__body__step__body--list">
            <p class="modal__body__step__header-info">
              {{ $t("activity_group.add.select_activities") }}
            </p>
            <EntityListFiltered
              :all-entities="filteredEntities"
              :pagination="pagination"
              :has-dropdown-filter="false"
              :has-action-buttons="false"
              :has-quick-options="true"
              :has-dropdown-menu="false"
              :parent="'add-activity-group'"
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
          @click="submitForm"
        >
          {{ $t("ui.done") }}
        </button>
      </template>
    </AppModal>
  </Teleport>
</template>
