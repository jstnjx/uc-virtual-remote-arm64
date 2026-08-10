<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import type {
  ConfiguredEntity,
  IntegrationInstance,
  EntityFilterData,
} from "@/types/integrationInstance";

import type { ChangeCallbackParams } from "@/types/config";
import type { Activity } from "@/types/activity";
import type { LanguageText } from "@/types/config";
import { EntityType } from "@/types/enums";

import translatedProperty, {
  getCurrentLocale,
} from "@/composables/translatedProperty";
import { useWindowDimension } from "@/composables/windowDimension";
import { getNewIconName } from "@/composables/icon";
import { focusInput } from "@/composables/device";
import {
  getPaginationLimit,
  savePaginationLimit,
  readPaginationMeta,
} from "@/composables/listing";

import { activitiesStore } from "@/stores/activities";
import { integrationsStore } from "@/stores/integrations";
import { addErrorFull, addErrorBottom } from "@/stores/messages";

import AppModal from "@/components/elements/AppModal.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import UCSelect from "@/components/ui/UCSelect.vue";
import UCInput from "@/components/ui/UCInput.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";
import { deepClone } from "@/composables/dataHelper";

const { t } = useTranslation();

const router = useRouter();
const { isMobileScreen } = useWindowDimension();

const activitiesStorage = activitiesStore();
const integrationStorage = integrationsStore();

const props = defineProps({
  clone: {
    type: Object as () => Activity | null,
    default: null,
  },
});

defineExpose({
  open,
});

defineEmits(["close"]);

const excludedEntityTypes = ref([EntityType.sensor]);

const activitySkeleton = {
  name: "",
  icon: "uc:activity",
  description: "",
  preventSleep: false,
};

const entityListFilter = ref(<EntityFilterData>{
  searchText: "",
  entityTypes: "",
  instances: "",
});

const newActivity = ref(deepClone(activitySkeleton));

const filteredEntities = ref<ConfiguredEntity[]>([]);
const instances = computed<IntegrationInstance[]>(
  () => integrationStorage.instances,
);

const assignedEntities = ref<ConfiguredEntity[]>([]);

const activeStep = ref(1);
const slideRight = ref(false);
const showModal = ref(false);
const errorMessage = ref("");

const activeVolumeControl = ref({ label: "", value: "" });
const activeNavigation = ref({ label: "", value: "" });

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
  if (activitySkeleton) {
    newActivity.value = deepClone(activitySkeleton);
  }
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

  if (props.clone) {
    newActivity.value.name = translatedProperty(props.clone.name);
    newActivity.value.description = translatedProperty(props.clone.description);
    newActivity.value.preventSleep =
      props.clone.options?.prevent_sleep || false;

    let iconItem = "uc:clapperboard";

    if (props.clone.icon) {
      if (props.clone.icon.includes("uc:")) {
        const iconName = props.clone.icon.split("uc:")[1];
        const newIconName = await getNewIconName(iconName);

        if (
          iconName &&
          iconName.length > 0 &&
          newIconName &&
          newIconName.length > 0
        ) {
          iconItem = props.clone.icon.replace(iconName, newIconName);
        } else {
          iconItem = props.clone.icon;
        }
      } else {
        iconItem = props.clone.icon;
      }
    }

    newActivity.value.icon = iconItem;
  }
});

watch(activeStep, () => {
  const modalAddActivity = document.querySelector(
    ".modal--add-activity",
  ) as HTMLElement;
  if (modalAddActivity) {
    focusInput(modalAddActivity, true);
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
const isNameValid = computed(() => newActivity.value.name.trim().length > 0);

const buttonMappingDevices = computed(() => {
  return assignedEntities.value
    .filter(
      (entity) =>
        entity.entity_type === "remote" ||
        entity.entity_type === "media_player",
    )
    .map((entity) => ({
      label: translatedProperty(entity.name),
      value: entity.entity_id,
    }));
});

async function submitForm() {
  try {
    let activity;
    const nameValue: LanguageText = {
      [getCurrentLocale()]: newActivity.value.name,
    };

    const descriptionValue = {
      [getCurrentLocale()]: newActivity.value.description,
    };

    const iconRegex = /fa-/;
    const iconValue = newActivity.value.icon.replace(iconRegex, "uc:");

    let entity_ids = assignedEntities.value.map((entity) => {
      return entity.entity_id;
    });

    if (props.clone) {
      entity_ids =
        (props.clone.options?.included_entities ?? []).map((entity) => {
          return entity.entity_id;
        }) || [];
    }

    if (props.clone) {
      activity = await activitiesStorage.clone(
        {
          name: nameValue,
          description: descriptionValue,
          icon: iconValue,
          options: {
            entity_ids: entity_ids,
            prevent_sleep: newActivity.value.preventSleep,
          },
        },
        props.clone.entity_id,
      );
    } else {
      activity = await activitiesStorage.create({
        name: nameValue,
        description: descriptionValue,
        icon: iconValue,
        options: {
          entity_ids: entity_ids,
          prevent_sleep: newActivity.value.preventSleep,
        },
      });
    }

    await activitiesStorage.getAll();
    router.push({
      name: "activity",
      params: { activity_id: activity.entity_id },
    });
  } catch (e) {
    addErrorFull(e);
  }
  closeModal();
}

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
  let filterByEntityTypes = JSON.parse(
    JSON.stringify(entityListFilter.value.entityTypes),
  );

  if (filterByEntityTypes.length < 1) {
    const necessaryEntityTypes = Object.values(EntityType)
      .filter((type) => !excludedEntityTypes.value?.includes(type))
      .join(",");

    filterByEntityTypes = necessaryEntityTypes;
  }

  try {
    const entList = await integrationStorage.getConfiguredEntitiesByPageByLimit(
      entityListFilter.value.instances || "",
      false,
      pagination.value.page,
      pagination.value.limit,
      searchText,
      filterByEntityTypes,
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

  if (step == 2 && props.clone) {
    return submitForm();
  }

  slideRight.value = step < activeStep.value ? true : false;
  activeStep.value = step;
}

async function changeActivityIcon(params: ChangeCallbackParams) {
  const { value } = params;
  if (newActivity.value) {
    newActivity.value.icon = value as string;
  }
}

function changeAssignedEntities(val: ConfiguredEntity[]) {
  assignedEntities.value = val;
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
      name="add-activity"
      class="modal--steps modal--add modal--add-activity"
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
          <template v-if="clone != null">{{
            $t("activity.clone.clone_activity")
          }}</template>
          <template v-else>{{ $t("activity.add.add_new_activity") }}</template>
        </span>
        <span class="modal__header__item--phone">
          <template v-if="clone != null">{{
            $t("activity.clone.clone_activity")
          }}</template>
          <template v-else>{{ $t("activity.add.new_activity") }}</template>
        </span>
      </template>
      <Transition :name="stepTransition">
        <div v-show="activeStep == 1" class="modal__body__step">
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <IconSelect
              :key="newActivity.icon"
              :value="newActivity.icon"
              :change-callback="changeActivityIcon"
              :fallback="'fa-thin fa-clapperboard'"
              :has-tv-channel="true"
            />
            <UCInput
              v-model="newActivity.name"
              :label="$t('form.name')"
              :error-message="errorMessage ? $t(errorMessage) : ''"
              :full-w="true"
              :focus="true"
              @click="clearErrors"
            />
            <UCInput
              v-model="newActivity.description as string"
              :type="'textarea'"
              :label="$t('form.description')"
              :full-w="true"
              @click="clearErrors"
            />
            <UCToggle
              v-model="newActivity.preventSleep"
              :label="$t('activity.add.prevent_sleep.label')"
              :full-w="true"
              :description="$t('activity.add.prevent_sleep.description')"
            />
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
              {{ $t("activity.add.select_entities") }}
            </p>
            <EntityListFiltered
              :all-entities="filteredEntities"
              :instances="instances"
              :pagination="paging"
              :has-action-buttons="false"
              :has-quick-options="true"
              :has-dropdown-menu="false"
              :parent="'add-activity'"
              :exclude-entity-types="excludedEntityTypes"
              @change-filter="changeFilter"
              @reload-entities="reloadEntities"
              @change-assigned-entities="changeAssignedEntities"
              @change-page="changePage"
              @change-per-page="changePerPage"
            />
          </div>
        </div>
      </Transition>

      <Transition :name="stepTransition">
        <div v-show="activeStep == 3" class="modal__body__step">
          <Transition name="opacity">
            <button
              v-show="activeStep == 3"
              class="button button--secondary button--icon modal__body__step__back"
              @click="goToStep(2)"
            >
              <i class="fa-light fa-arrow-left"></i>
            </button>
          </Transition>
          <div v-overflow-indicator class="modal__body__step__body">
            <p class="modal__body__step__header-info">
              {{ $t("activity.add.button_mapping.title") }}
            </p>

            <div class="select-extra select-extra--divider">
              <div class="select-extra__text">
                <span class="select-extra__label">
                  {{ $t("activity.add.volume_control.label") }}
                </span>
                <span class="select-extra__description">
                  {{ $t("activity.add.volume_control.description") }}
                </span>
              </div>
              <UCSelect
                v-model="activeVolumeControl"
                :options="buttonMappingDevices"
                :position="'right'"
              />
            </div>

            <div class="select-extra">
              <div class="select-extra__text">
                <span class="select-extra__label">
                  {{ $t("activity.add.navigation.label") }}
                </span>
                <span class="select-extra__description">
                  {{ $t("activity.add.navigation.description") }}
                </span>
              </div>
              <UCSelect
                v-model="activeNavigation"
                :options="buttonMappingDevices"
                :position="'right'"
              />
            </div>

            <p class="modal--add__instruction">
              {{ $t("activity.add.button_mapping.description") }}
            </p>
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
          <template v-if="clone">{{ $t("ui.done") }}</template>
          <template v-else>{{ $t("ui.next") }}</template>
        </button>
        <button
          v-else-if="activeStep == 2"
          class="button button--primary button--min-w"
          @click="submitForm"
        >
          {{ $t("ui.done") }}
        </button>
        <button
          v-else-if="activeStep == 3"
          class="button button--primary button--min-w"
        >
          {{ $t("ui.done") }}
        </button>
      </template>
    </AppModal>
  </Teleport>
</template>
