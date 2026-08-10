<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";
import { useTranslation } from "i18next-vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import type { Activity } from "@/types/activity";
import type { ChangeCallbackParams } from "@/types/config";
import type {
  IntegrationInstance,
  EntityFilterData,
  ConfiguredEntity,
} from "@/types/integrationInstance";

import type { ActivityGroup } from "@/types/activityGroup";

import { activityGroupsStore } from "@/stores/activityGroups";
import { activitiesStore } from "@/stores/activities";
import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import {
  getCurrentLocale,
  getValueByLang,
} from "@/composables/translatedProperty";
import router from "@/composables/router";
import { getActivityGroupOptions } from "@/composables/activities";
import { deepClone, useDataHelper } from "@/composables/dataHelper";
import {
  getPaginationLimit,
  savePaginationLimit,
  paginationCount,
  readPaginationMeta,
} from "@/composables/listing";
import { isTouchEnabled } from "@/composables/device";

import UCInput from "@/components/ui/UCInput.vue";
import UCSelect from "@/components/ui/UCSelect.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import IncludedEntities from "@/components/elements/entity/IncludedEntities.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";

const { t } = useTranslation();
const { updateObjectByKeys, standardizeLangTexts } = useDataHelper();

const storage = activityGroupsStore();
const activitiesStorage = activitiesStore();
const integrationsStorage = integrationsStore();

const props = defineProps({
  groupId: {
    type: String,
    required: true,
  },
});

/** Select option `{ value, label }` for the two activity-group toggles. */
type ActivityGroupOptionValue = { value: string; label: string };
/** Form model for the edit screen (was `Record<string, any>` before the
 *  activity-group `options` payload was modelled — ws-and-integration-payload-typing). */
type ActivityGroupFormValues = {
  icon?: string;
  name: { value: string; langCode: string };
  description: { value: string; langCode: string };
  removeTurnOnDelays: ActivityGroupOptionValue;
  turnOffUnusedEntities: ActivityGroupOptionValue;
};

const activityGroup = ref<ActivityGroup | null>(null);
const actiGroupValues = ref<ActivityGroupFormValues>({
  name: { value: "", langCode: getCurrentLocale() },
  description: { value: "", langCode: getCurrentLocale() },
  removeTurnOnDelays: { value: "", label: "" },
  turnOffUnusedEntities: { value: "", label: "" },
});

const showAvailableEntities = ref(false);

const filteredActivities = ref<ConfiguredEntity[]>([]);
const includedActivities = ref<Activity[]>([]);
const instances = computed<IntegrationInstance[]>(
  () => integrationsStorage.instances,
);

const activityGroupIncludedList = useTemplateRef<
  InstanceType<typeof IncludedEntities>
>("activityGroupIncludedList");
const actiGroupAvailableEntities = useTemplateRef<HTMLDivElement>(
  "actiGroupAvailableEntities",
);

const activityListFilter = ref(<EntityFilterData>{
  searchText: "",
});

const activityGroupOptions = ref(getActivityGroupOptions(t));

const loading = ref(false);

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

storage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    const { group_id, event_type } = args[0];
    if (group_id !== props.groupId) {
      return;
    }
    if (event_type === "DELETE") {
      router.push({
        name: "activities-macros",
      });
    } else if (
      group_id === props.groupId &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      const updActivityGroup = updateObjectByKeys(
        deepClone(activityGroup.value!),
        args[0].new_state,
      );
      setActivityGroup(updActivityGroup);
    }
  });
});

watch(showAvailableEntities, (newVal) => {
  if (newVal) {
    nextTick(() => {
      const container = actiGroupAvailableEntities.value as HTMLElement;
      if (!isTouchEnabled() && container) {
        const firstInput = container.querySelector("input") as HTMLElement;
        firstInput?.focus();
      }
    });
  }
});

function setActivityGroup(newValue: ActivityGroup, onInit: boolean = false) {
  const nameLang = actiGroupValues.value.name?.langCode ?? getCurrentLocale();
  const descLang =
    actiGroupValues.value.description?.langCode ?? getCurrentLocale();

  activityGroup.value = newValue;

  const actiGrName = getValueByLang(newValue.name, nameLang, !onInit);
  const actiGrDescr = getValueByLang(newValue.description, descLang, !onInit);

  // Open config leaves → narrow to the string the toggles carry (ADR 0002).
  const removeTurnOnDelays = newValue.options?.remove_turn_on_delays as
    string | undefined;
  const turnOffUnusedEntities = newValue.options?.turn_off_unused_entities as
    string | undefined;

  actiGroupValues.value = {
    icon: newValue.icon,
    name: {
      value: actiGrName.value,
      langCode: actiGrName.lang,
    },
    description: {
      value: actiGrDescr.value,
      langCode: actiGrDescr.lang,
    },
    removeTurnOnDelays: removeTurnOnDelays
      ? {
          value: removeTurnOnDelays,
          label: t(
            `activity_group.options.remove_turn_on_delays.options.${removeTurnOnDelays}`,
          ),
        }
      : { value: "", label: "" },
    turnOffUnusedEntities: turnOffUnusedEntities
      ? {
          value: turnOffUnusedEntities,
          label: t(
            `activity_group.options.turn_off_unused_entities.options.${turnOffUnusedEntities}`,
          ),
        }
      : { value: "", label: "" },
  };

  includedActivities.value = newValue.activities || [];

  activityGroupIncludedList.value?.updateSelected(includedActivities.value);
}

watch(
  () => pagination.value.limit,
  (val) => {
    savePaginationLimit(val);
  },
);

function changeItemIcon(change: ChangeCallbackParams) {
  actiGroupValues.value.icon = change.value as string;

  if (!activityGroup.value || activityGroup.value == null) {
    return;
  }

  const newValues = {
    ...activityGroup.value,
    icon: actiGroupValues.value.icon,
  } as ActivityGroup;

  submitChange(newValues);
}

function changeItemName(message: any) {
  if (!activityGroup.value || activityGroup.value == null) {
    return;
  }

  const name = standardizeLangTexts(
    {
      ...(activityGroup.value.name || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    ...activityGroup.value,
    name: name,
  } as ActivityGroup;

  submitChange(newValues);
}

function changeItemDescription(message: any) {
  if (!activityGroup.value || activityGroup.value == null) {
    return;
  }

  const description = standardizeLangTexts(
    {
      ...(activityGroup.value.description || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    ...activityGroup.value,
    description: description,
  } as ActivityGroup;

  submitChange(newValues);
}

// function changeActivityGroup(item: any) {
//   const selectedGroup = activityGroups.value.find(g => g.group_id == item.value);

//   if (!activityGroup.value || activityGroup.value == null || !activityGroup.value.options || !selectedGroup?.group_id) {
//     return;
//   }

//   let actiOptions = activityGroup.value.options;

//   actiOptions['activity_group'] = {
//     group_id: selectedGroup?.group_id,
//     name: selectedGroup?.name,
//   }

//   const newValues = {
//     ...activityGroup.value,
//     options: actiOptions,
//   } as Activity;

//   submitChange(newValues);
// }

async function submitChange(message: ActivityGroup) {
  if (!activityGroup.value) {
    return;
  }

  try {
    activityGroup.value = (await storage.update(
      activityGroup.value.group_id,
      message,
    )) as ActivityGroup;
  } catch (e) {
    addErrorBottom(e, "activity_group.update");
  }
}

function changeItemNameLang(lang: string) {
  actiGroupValues.value.name.langCode = lang;

  if (activityGroup.value) {
    actiGroupValues.value.name.value = getValueByLang(
      activityGroup.value.name,
      lang,
      true,
    ).value;
  }
}

function changeItemDescriptionLang(lang: string) {
  actiGroupValues.value.description.langCode = lang;

  if (activityGroup.value) {
    actiGroupValues.value.description.value = getValueByLang(
      activityGroup.value.description,
      lang,
      true,
    ).value;
  }
}

function changeRemoveTurnOnDelays(item: ActivityGroupOptionValue) {
  actiGroupValues.value.removeTurnOnDelays = item;
  saveActivityGroupOptions();
}

function changeTurnOffUnusedEntities(item: ActivityGroupOptionValue) {
  actiGroupValues.value.turnOffUnusedEntities = item;
  saveActivityGroupOptions();
}

async function saveActivityGroupOptions() {
  if (activityGroup.value == null) {
    return;
  }

  try {
    await storage.update(activityGroup.value.group_id, {
      options: {
        ...(actiGroupValues.value.removeTurnOnDelays?.value && {
          remove_turn_on_delays:
            actiGroupValues.value.removeTurnOnDelays?.value,
        }),
        ...(actiGroupValues.value.turnOffUnusedEntities?.value && {
          turn_off_unused_entities:
            actiGroupValues.value.turnOffUnusedEntities?.value,
        }),
      },
    });
  } catch (e) {
    addErrorBottom(e, "activity_group.update");
  }
}

async function setDefaults() {
  await integrationsStorage.getInstances();
}

async function includedActivityListChanged(newList: Activity[]) {
  if (!activityGroup.value) {
    return;
  }

  includedActivities.value = newList;

  const activity_ids = includedActivities.value.map((activity: Activity) => {
    return activity.entity_id;
  });

  try {
    activityGroup.value = (await storage.update(activityGroup.value.group_id, {
      activity_ids: activity_ids,
    })) as ActivityGroup;
    reloadIncludedActivities();
  } catch (e) {
    addErrorBottom(e, "activity_group.update");
  }
}

function addActivitiesToGroup(activities: Activity[]) {
  const newList = deepClone(includedActivities.value).concat(activities);
  includedActivityListChanged(newList);
}

async function reloadIncludedActivities() {
  fetchFilteredActivites(true);
}

function changeFilter(data: EntityFilterData) {
  activityListFilter.value = data;
  fetchFilteredActivites(true);
}

async function fetchFilteredActivites(userFetchFirstPage: boolean = false) {
  if (userFetchFirstPage === true) {
    pagination.value.page = 1;
  }

  const searchText = activityListFilter.value.searchText;

  try {
    const entList = await activitiesStorage.getUngroupedActivities(
      pagination.value.page,
      pagination.value.limit,
      searchText,
    );
    filteredActivities.value = entList.data as ConfiguredEntity[];

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

function changePage(value: number) {
  pagination.value.page = value;
  fetchFilteredActivites();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchFilteredActivites();
}

onMounted(async () => {
  loading.value = true;
  try {
    const newValue = await storage.getActivityGroup(props.groupId);
    await setDefaults();
    setActivityGroup(newValue, true);
    fetchFilteredActivites(true);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
});
</script>
<template>
  <div class="ep-settings">
    <div v-overflow-indicator class="ep-settings__form panel-col panel-col--40">
      <div class="ep-settings__form__wrapper">
        <div class="ep-settings__form__header">
          <IconSelect
            :key="
              actiGroupValues && actiGroupValues.icon
                ? actiGroupValues.icon
                : 'fa-light fa-layer-group'
            "
            :value="
              actiGroupValues && actiGroupValues.icon
                ? actiGroupValues.icon
                : ''
            "
            :fallback="'fa-light fa-layer-group'"
            :change-callback="changeItemIcon"
          />
        </div>
        <UCInput
          v-if="actiGroupValues.name"
          v-model="actiGroupValues.name"
          :translations="activityGroup?.name"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.name')"
          @submit="changeItemName"
          @change-lang="changeItemNameLang"
        />
        <UCInput
          v-if="actiGroupValues.description"
          v-model="actiGroupValues.description"
          :translations="activityGroup?.description"
          :type="'textarea'"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.description')"
          @submit="changeItemDescription"
          @change-lang="changeItemDescriptionLang"
        />
        <div class="form-item form-item--select">
          <span class="form-item--select__label">{{
            $t("activity_group.options.remove_turn_on_delays.title")
          }}</span>
          <UCSelect
            v-if="actiGroupValues.removeTurnOnDelays"
            v-model="actiGroupValues.removeTurnOnDelays"
            :options="activityGroupOptions.removeTurnOnDelaysOptions"
            :light="true"
            :dynamic-width="true"
            :dynamic-position="true"
            @select="changeRemoveTurnOnDelays"
          />
        </div>
        <div class="form-item form-item--select form-item--select--no-border">
          <span class="form-item--select__label">{{
            $t("activity_group.options.turn_off_unused_entities.title")
          }}</span>
          <UCSelect
            v-if="actiGroupValues.removeTurnOnDelays"
            v-model="actiGroupValues.turnOffUnusedEntities"
            :options="activityGroupOptions.turnOffUnusedEntitiesOptions"
            :light="true"
            :dynamic-width="true"
            :dynamic-position="true"
            @select="changeTurnOffUnusedEntities"
          />
        </div>
      </div>
    </div>
    <div class="ep-settings__included-entities panel-col panel-col--60">
      <div class="ep-settings__included-entities__wrapper">
        <IncludedEntities
          ref="activityGroupIncludedList"
          :entities="includedActivities"
          :instances="instances"
          :show-button-add="showAvailableEntities == false"
          :drag-group="'activity-group-entities'"
          :title="$t('activity_group.edit.included_activities')"
          :loading="loading"
          :text-add-first-title="$t('activity_group.edit.add_first.title')"
          :text-add-first-descr="$t('activity_group.edit.add_first.descr')"
          @entity-list-changed="includedActivityListChanged"
          @reload-entities="reloadIncludedActivities"
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
        ref="actiGroupAvailableEntities"
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
            <span>{{ $t("activity_group.edit.available_activities") }}</span>
          </div>
          <EntityListFiltered
            :pagination="pagination"
            :all-entities="filteredActivities"
            :instances="instances"
            :drag-group="'activity-group-entities'"
            :has-dropdown-filter="false"
            :has-dropdown-menu="false"
            :has-quick-options="true"
            :parent="'edit-activity-group'"
            @add-entities="addActivitiesToGroup"
            @change-filter="changeFilter"
            @reload-entities="reloadIncludedActivities"
            @change-page="changePage"
            @change-per-page="changePerPage"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>
