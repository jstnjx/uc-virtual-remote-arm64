<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import type { ChangeCallbackParams } from "@/types/config";
import type {
  ConfiguredEntity,
  IntegrationInstance,
  EntityFilterData,
} from "@/types/integrationInstance";

import type { Macro } from "@/types/macro";
import type { IncludedEntity } from "@/types/activity";
import { EntityType } from "@/types/enums";

import { macrosStore } from "@/stores/macros";
import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import { getDefaultEntityIcon } from "@/composables/entity";
import {
  getCurrentLocale,
  getValueByLang,
} from "@/composables/translatedProperty";
import router from "@/composables/router";
import { deepClone, useDataHelper } from "@/composables/dataHelper";
import {
  getPaginationLimit,
  savePaginationLimit,
  readPaginationMeta,
} from "@/composables/listing";
import { isTouchEnabled } from "@/composables/device";

import UCInput from "@/components/ui/UCInput.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import IncludedEntities from "@/components/elements/entity/IncludedEntities.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";

const { updateObjectByKeys, standardizeLangTexts } = useDataHelper();

const storage = macrosStore();
const integrationsStorage = integrationsStore();

const props = defineProps({
  macroId: {
    type: String,
    required: true,
  },
});

defineEmits(["changeButton"]);

const macro = ref<Macro | null>(null);
const macroValues = ref<Record<string, any>>({});

const showAvailableEntities = ref(false);

const filteredEntities = ref<ConfiguredEntity[]>([]);
const selectedEntities = ref<IncludedEntity[]>([]);
const instances = computed<IntegrationInstance[]>(
  () => integrationsStorage.instances,
);

const macroIncludedList =
  useTemplateRef<InstanceType<typeof IncludedEntities>>("macroIncludedList");

const entityListFilter = ref(<EntityFilterData>{
  searchText: "",
  entityTypes: "",
  instances: "",
});

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
  count: integrationsStorage.configuredEntitiesByPage.count,
}));

const loading = ref(false);
const macroAvailableEntities = useTemplateRef<HTMLDivElement>(
  "macroAvailableEntities",
);

storage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    const { entity_id, event_type } = args[0];
    if (entity_id !== props.macroId) {
      return;
    }
    if (event_type === "DELETE") {
      router.push({
        name: "activities-macros",
      });
    } else if (
      entity_id === props.macroId &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      const updMacro = updateObjectByKeys(
        deepClone(macro.value!),
        args[0].new_state,
      );
      setMacro(updMacro);
    }
  });
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
      const container = macroAvailableEntities.value as HTMLElement;
      if (!isTouchEnabled() && container) {
        const firstInput = container.querySelector("input") as HTMLElement;
        firstInput?.focus();
      }
    });
  }
});

function setMacro(newValue: Macro, onInit: boolean = false) {
  const nameLang = macroValues.value.name?.langCode ?? getCurrentLocale();
  const descLang =
    macroValues.value.description?.langCode ?? getCurrentLocale();

  macro.value = deepClone(newValue) as Macro;

  const macroName = getValueByLang(newValue.name, nameLang, !onInit);
  const macroDescr = getValueByLang(newValue.description, descLang, !onInit);

  macroValues.value = {
    icon: newValue.icon || getDefaultEntityIcon(newValue),
    name: {
      value: macroName.value,
      langCode: macroName.lang,
    },
    description: {
      value: macroDescr.value,
      langCode: macroDescr.lang,
    },
  };

  selectedEntities.value = newValue.options?.included_entities ?? [];

  if (macroIncludedList.value) {
    macroIncludedList.value.updateSelected(selectedEntities.value);
  }
}

function changeItemIcon(change: ChangeCallbackParams) {
  macroValues.value.icon = change.value as string;

  if (!macro.value || macro.value == null) {
    return;
  }

  const newValues = {
    ...macro.value,
    icon: macroValues.value.icon,
  } as Macro;

  submitChange(newValues);
}

function changeItemName(message: any) {
  if (!macro.value || macro.value == null) {
    return;
  }

  const name = standardizeLangTexts(
    {
      ...(macro.value.name || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    ...macro.value,
    name: name,
  } as Macro;

  submitChange(newValues);
}

function changeItemDescription(message: any) {
  if (!macro.value || macro.value == null) {
    return;
  }

  const description = standardizeLangTexts(
    {
      ...(macro.value.description || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    ...macro.value,
    description: description,
  } as Macro;

  submitChange(newValues);
}

async function submitChange(message: Macro) {
  if (!macro.value) {
    return;
  }

  try {
    macro.value = (await storage.update(
      macro.value.entity_id,
      message,
    )) as Macro;
  } catch (e) {
    addErrorBottom(e, "macro.settings.update");
    loadPageData();
  }
}

function changeItemNameLang(lang: string) {
  macroValues.value.name.langCode = lang;

  if (macro.value) {
    macroValues.value.name.value = getValueByLang(
      macro.value.name,
      lang,
      true,
    ).value;
  }
}

function changeItemDescriptionLang(lang: string) {
  macroValues.value.description.langCode = lang;

  if (macro.value) {
    macroValues.value.description.value = getValueByLang(
      macro.value.description,
      lang,
      true,
    ).value;
  }
}

async function setDefaults() {
  fetchFilteredEntities(true);

  try {
    await integrationsStorage.getConfiguredEntities(null, true);
    await integrationsStorage.getInstances();
  } catch (e) {
    addErrorBottom(e);
  }
}

async function entityListChanged(newList: IncludedEntity[]) {
  if (!macro.value) {
    return;
  }

  const changedListLength = selectedEntities.value.length != newList.length;
  selectedEntities.value = newList;
  const newValues = {
    options: {
      entity_ids: selectedEntities.value.map((entity) => {
        return entity.entity_id;
      }),
    },
  };

  try {
    macro.value = (await storage.update(
      macro.value.entity_id,
      newValues,
    )) as Macro;

    if (changedListLength) {
      await fetchFilteredEntities(true);
    }
  } catch (e) {
    addErrorBottom(e, "macro.settings.update");
    loadPageData();
  }
}

function addEntitiesToGroup(entities: ConfiguredEntity[]) {
  const newList = deepClone(selectedEntities.value).concat(entities);
  entityListChanged(newList);
}

function reloadEntities() {
  setDefaults();
}

function changeFilter(data: EntityFilterData) {
  entityListFilter.value = data;
  fetchFilteredEntities(true);
}

async function fetchFilteredEntities(userFetchFirstPage: boolean = false) {
  if (userFetchFirstPage === true) {
    pagination.value.page = 1;
  }

  const searchText = entityListFilter.value.searchText;

  try {
    const entList =
      await integrationsStorage.getConfiguredEntitiesByPageByLimit(
        entityListFilter.value.instances || "",
        false,
        pagination.value.page,
        pagination.value.limit,
        searchText,
        entityListFilter.value.entityTypes,
        props.macroId,
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

function changePage(value: number) {
  pagination.value.page = value;
  fetchFilteredEntities();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchFilteredEntities();
}

async function loadPageData() {
  loading.value = true;
  try {
    const newValue = await storage.getMacro(props.macroId);
    await setDefaults();
    setMacro(newValue, true);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
}

onMounted(async () => {
  await loadPageData();
});
</script>
<template>
  <div class="ep-settings">
    <div v-overflow-indicator class="ep-settings__form panel-col panel-col--40">
      <div class="ep-settings__form__wrapper">
        <div class="ep-settings__form__header">
          <IconSelect
            :key="
              macroValues && macroValues.icon
                ? macroValues.icon
                : 'fa-light fa-list-alt'
            "
            :value="macroValues && macroValues.icon ? macroValues.icon : ''"
            :fallback="'fa-light fa-list-alt'"
            :change-callback="changeItemIcon"
            :has-tv-channel="true"
          />
        </div>
        <UCInput
          v-if="macroValues.name"
          v-model="macroValues.name"
          :translations="macro?.name"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.name')"
          @submit="changeItemName"
          @change-lang="changeItemNameLang"
        />
        <UCInput
          v-if="macroValues.description"
          v-model="macroValues.description"
          :translations="macro?.description"
          :type="'textarea'"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.description')"
          @submit="changeItemDescription"
          @change-lang="changeItemDescriptionLang"
        />
      </div>
    </div>
    <div class="ep-settings__included-entities panel-col panel-col--60">
      <div class="ep-settings__included-entities__wrapper">
        <IncludedEntities
          ref="macroIncludedList"
          :entities="selectedEntities"
          :instances="instances"
          :show-button-add="showAvailableEntities == false"
          :drag-group="'macro-entities'"
          :loading="loading"
          :text-add-first-descr="
            $t('macro.edit.empty') + ' ' + $t('entity.add_first_btn_below')
          "
          @entity-list-changed="entityListChanged"
          @reload-entities="reloadEntities"
          @click-add="showAvailableEntities = true"
        />
      </div>
    </div>
    <Transition
      :name="
        showAvailableEntities == true ? 'slide-tab-right' : 'slide-tab-left'
      "
    >
      <div
        v-show="showAvailableEntities == true"
        ref="macroAvailableEntities"
        class="ep-settings__available-entities panel-col panel-col--40"
      >
        <div class="ep-settings__available-entities__wrapper">
          <div class="ep-settings__available-entities__header">
            <button
              class="button button--blank button--icon"
              @click="showAvailableEntities = false"
            >
              <i class="fa-light fa-arrow-left"></i>
            </button>
            <span>{{ $t("activity.edit.add_entities") }}</span>
          </div>
          <EntityListFiltered
            :all-entities="filteredEntities"
            :instances="instances"
            :pagination="paging"
            :drag-group="'macro-entities'"
            :has-quick-options="true"
            :parent="'edit-macro'"
            :exclude-entity-types="[EntityType.sensor]"
            @add-entities="addEntitiesToGroup"
            @change-filter="changeFilter"
            @reload-entities="reloadEntities"
            @change-page="changePage"
            @change-per-page="changePerPage"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>
