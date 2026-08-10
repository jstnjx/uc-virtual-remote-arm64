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
import type { Macro } from "@/types/macro";
import type { LanguageText } from "@/types/config";
import { EntityType } from "@/types/enums";

import { getNewIconName } from "@/composables/icon";

import translatedProperty, {
  getCurrentLocale,
} from "@/composables/translatedProperty";
import { useWindowDimension } from "@/composables/windowDimension";
import { focusInput } from "@/composables/device";
import {
  getPaginationLimit,
  savePaginationLimit,
  readPaginationMeta,
} from "@/composables/listing";

import { macrosStore } from "@/stores/macros";
import { integrationsStore } from "@/stores/integrations";
import { addErrorFull, addErrorBottom } from "@/stores/messages";

import AppModal from "@/components/elements/AppModal.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import UCInput from "@/components/ui/UCInput.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";
import { deepClone } from "@/composables/dataHelper";

const { t } = useTranslation();

const router = useRouter();
const { isMobileScreen } = useWindowDimension();

const macrosStorage = macrosStore();
const integrationStorage = integrationsStore();

const props = defineProps({
  clone: {
    type: Object as () => Macro | null,
    default: null,
  },
});

defineExpose({
  open,
});

defineEmits(["close"]);

const excludedEntityTypes = ref([EntityType.sensor]);

const macroSkeleton = {
  name: "",
  icon: "uc:macro",
  description: "",
};

const filterSkeleton = {
  searchText: "",
  entityTypes: "",
  instances: "",
};

const newMacro = ref(deepClone(macroSkeleton));
const entityListFilter = ref<EntityFilterData>(deepClone(filterSkeleton));

const filteredEntities = ref<ConfiguredEntity[]>([]);
const instances = computed<IntegrationInstance[]>(
  () => integrationStorage.instances,
);

const assignedEntities = ref<ConfiguredEntity[]>([]);

const activeStep = ref(1);
const slideRight = ref(false);
const showModal = ref(false);
const errorMessage = ref("");

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
  if (macroSkeleton) {
    newMacro.value = deepClone(macroSkeleton);
  }
  entityListFilter.value = deepClone(filterSkeleton);
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
    newMacro.value.name = translatedProperty(props.clone.name);
    newMacro.value.description = translatedProperty(props.clone.description);

    let iconItem = "uc:macro";

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

    newMacro.value.icon = iconItem;
  }
});

watch(activeStep, () => {
  const modalAddMacro = document.querySelector(
    ".modal--add-macro",
  ) as HTMLElement;
  if (modalAddMacro) {
    focusInput(modalAddMacro, true);
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
const isNameValid = computed(() => newMacro.value.name.trim().length > 0);

async function submitForm() {
  try {
    let macro;
    const nameValue: LanguageText = {
      [getCurrentLocale()]: newMacro.value.name,
    };

    const descriptionValue = {
      [getCurrentLocale()]: newMacro.value.description,
    };

    const iconRegex = /fa-/;
    const iconValue = newMacro.value.icon.replace(iconRegex, "uc:");

    const entity_ids = assignedEntities.value.map((entity) => {
      return entity.entity_id;
    });

    if (props.clone) {
      macro = await macrosStorage.clone(
        {
          name: nameValue,
          description: descriptionValue,
          icon: iconValue,
        },
        props.clone.entity_id,
      );
    } else {
      macro = await macrosStorage.create({
        name: nameValue,
        description: descriptionValue,
        icon: iconValue,
        options: {
          entity_ids: entity_ids,
        },
      });
    }

    await macrosStorage.getAll();
    router.push({
      name: "macro",
      params: { macro_id: macro.entity_id },
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

async function fetchFilteredEntities(userFetchFirstPage = false) {
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

async function changeMacroIcon(params: ChangeCallbackParams) {
  const { value } = params;
  if (newMacro.value) {
    newMacro.value.icon = value as string;
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
      name="add-macro"
      class="modal--steps modal--add modal--add-macro"
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
            $t("macro.clone.clone_macro")
          }}</template>
          <template v-else>{{ $t("macro.add.add_new_macro") }}</template>
        </span>
        <span class="modal__header__item--phone">
          <template v-if="clone != null">{{
            $t("macro.clone.clone_macro")
          }}</template>
          <template v-else>{{ $t("macro.add.new_macro") }}</template>
        </span>
      </template>
      <Transition :name="stepTransition">
        <div v-show="activeStep == 1" class="modal__body__step">
          <div
            v-overflow-indicator
            class="modal__body__step__body modal--add__base-data"
          >
            <IconSelect
              :key="newMacro.icon"
              :value="newMacro.icon"
              :change-callback="changeMacroIcon"
              :fallback="'fa-thin fa-list-alt'"
              :has-tv-channel="true"
            />
            <UCInput
              v-model="newMacro.name"
              :label="$t('form.name')"
              :error-message="errorMessage ? $t(errorMessage) : ''"
              :full-w="true"
              :focus="true"
              @click="clearErrors"
            />
            <UCInput
              v-model="newMacro.description as string"
              :type="'textarea'"
              :label="$t('form.description')"
              :full-w="true"
              @click="clearErrors"
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
              {{ $t("macro.add.select_entities") }}
            </p>
            <EntityListFiltered
              :all-entities="filteredEntities"
              :instances="instances"
              :pagination="paging"
              :has-action-buttons="false"
              :has-quick-options="true"
              :has-dropdown-menu="false"
              :parent="'add-macro'"
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
      </template>
    </AppModal>
  </Teleport>
</template>
