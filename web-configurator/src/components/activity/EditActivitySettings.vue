<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import type { SelectOption } from "@/types/ui";
import type {
  ChangeCallbackParams,
  VoiceAssistant,
  VoiceAssistantProfile,
} from "@/types/config";
import type {
  ConfiguredEntity,
  IntegrationInstance,
  EntityFilterData,
} from "@/types/integrationInstance";
import type {
  ActivityFull,
  ActivityUpdate,
  IncludedEntity,
} from "@/types/activity";
import type { ActivityGroup } from "@/types/activityGroup";
import { EntityType } from "@/types/enums";

import { activitiesStore } from "@/stores/activities";
import { integrationsStore } from "@/stores/integrations";
import { activityGroupsStore } from "@/stores/activityGroups";
import { configStore } from "@/stores/config";
import { addErrorBottom } from "@/stores/messages";

import { getDefaultEntityIcon } from "@/composables/entity";
import translatedProperty, {
  getCurrentLocale,
  getValueByLang,
} from "@/composables/translatedProperty";
import router from "@/composables/router";
import { deepClone, useDataHelper } from "@/composables/dataHelper";
import { useWindowDimension } from "@/composables/windowDimension";
import { normalizeState } from "@/utils/state";
import {
  getPaginationLimit,
  savePaginationLimit,
  readPaginationMeta,
} from "@/composables/listing";
import { isTouchEnabled } from "@/composables/device";

import UCInput from "@/components/ui/UCInput.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import UCSelect from "@/components/ui/UCSelect.vue";
import InfoPanel from "@/components/ui/InfoPanel.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import IncludedEntities from "@/components/elements/entity/IncludedEntities.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";
import SelectVoiceAssistant from "@/components/elements/SelectVoiceAssistant.vue";
import SelectVoiceAssistantProfile from "@/components/elements/SelectVoiceAssistantProfile.vue";

const { updateObjectByKeys, standardizeLangTexts, isNonEmptyObject } =
  useDataHelper();
const { isSmallScreen } = useWindowDimension();

const storage = activitiesStore();
const activityGroupsStorage = activityGroupsStore();
const integrationsStorage = integrationsStore();
const configStorage = configStore();

const props = defineProps({
  activityId: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
});

const activity = ref<ActivityFull | null>(null);
const activityGroups = ref<ActivityGroup[]>([]);
const actiValues = ref<Record<string, any>>({});

const showAvailableEntities = ref(false);

const filteredEntities = ref<ConfiguredEntity[]>([]);
const selectedEntities = ref<IncludedEntity[]>([]);
const instances = computed<IntegrationInstance[]>(
  () => integrationsStorage.instances,
);
const danglingEntities = ref<string[]>([]);

const actiIncludedList =
  useTemplateRef<InstanceType<typeof IncludedEntities>>("actiIncludedList");
const actiAvailableEntities = useTemplateRef<HTMLDivElement>(
  "actiAvailableEntities",
);

const entityListFilter = ref(<EntityFilterData>{
  searchText: "",
  entityTypes: "",
  instances: "",
});

const voiceAssistants = computed<VoiceAssistant[]>(
  () => configStorage.list?.voiceAssistants ?? [],
);
const activeGlobalVoiceAssistant = computed<VoiceAssistant | null>(
  () => configStorage.config?.voice?.voice_assistant?.active ?? null,
);

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

storage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    const { entity_id, event_type } = args[0];
    if (entity_id !== props.activityId) {
      return;
    }
    if (event_type === "DELETE") {
      router.push({
        name: "activities-macros",
      });
    } else if (
      entity_id === props.activityId &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      const updActivity = updateObjectByKeys(
        deepClone(activity.value!),
        args[0].new_state,
      );
      setActivity(updActivity, false);
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
      const container = actiAvailableEntities.value as HTMLElement;
      if (!isTouchEnabled() && container) {
        const firstInput = container.querySelector("input") as HTMLElement;
        firstInput?.focus();
      }
    });
  }
});

const activeItem = computed(() => {
  return (
    activity.value &&
    activity.value.attributes &&
    (activity.value.attributes?.state == "ON" ||
      activity.value.attributes?.state == "RUNNING")
  );
});

const actiGroupList = computed(() => {
  return activityGroups.value.map((item) => ({
    label: translatedProperty(item.name),
    value: item.group_id,
  }));
});

const hasDanglingSelectedEntity = computed(() => {
  if (!selectedEntities.value) {
    return false;
  }

  return danglingEntities.value && danglingEntities.value.length > 0;
});

const activeVoiceAssistant = computed(() => {
  // console.warn('HAS DEMO!');
  //   return  {
  //     "entity_id": "222",
  //     "name": {
  //       "en": "Voice Assistant 2",
  //       "de": "Voice Assistant 3ó2 DE",
  //     },
  //     "icon": "uc:battery-three-quarters",
  //     "state": "string",
  //     "features": [
  //       "Text transcription"
  //     ],
  //     "profiles": [
  //       {
  //         "id": "profile11",
  //         "name": "Profile 11",
  //         "language": "cu",
  //         "features": [
  //           "transcription"
  //         ]
  //       },
  //       {
  //         "id": "profile22",
  //         "name": "Profile 22",
  //         "language": "cu",
  //         "features": [
  //           "transcription"
  //         ]
  //       }
  //     ],
  //     "preferred_profile": "profile22"
  //   };
  // DEMO END

  return voiceAssistants.value.find(
    (v) =>
      (v as VoiceAssistant).entity_id ===
      (activity.value?.options?.voice_assistant?.target?.entity_id ?? ""),
  );
});

const voiceAssistantProfiles = computed(() => {
  return activeVoiceAssistant.value?.profiles ?? [];
});

function setActivity(
  newVal: ActivityFull | undefined,
  onInit: boolean = false,
) {
  if (!newVal || !isNonEmptyObject(newVal)) {
    return false;
  }

  const newValue = newVal as ActivityFull;
  const nameLang = actiValues.value.name?.langCode ?? getCurrentLocale();
  const descLang = actiValues.value.description?.langCode ?? getCurrentLocale();

  activity.value = deepClone(newValue) as ActivityFull;

  const actiName = getValueByLang(newValue.name, nameLang, !onInit);
  const actiDescr = getValueByLang(newValue.description, descLang, !onInit);

  actiValues.value = {
    icon: newValue.icon || getDefaultEntityIcon(newValue),
    name: {
      value: actiName.value,
      langCode: actiName.lang,
    },
    description: {
      value: actiDescr.value,
      langCode: actiDescr.lang,
    },
    preventSleep: newValue.options?.prevent_sleep ?? false,
    readyCheck: newValue.options?.ready_check ?? true,
    activityGroup: newValue.options?.activity_group
      ? {
          label: translatedProperty(newValue.options.activity_group.name),
          value: newValue.options.activity_group.group_id,
        }
      : {
          label: "",
          value: "",
        },
  };

  selectedEntities.value = newValue.options?.included_entities ?? [];

  danglingEntities.value = selectedEntities.value
    .filter((e: IncludedEntity) => e.available === false)
    .map((e: IncludedEntity) => {
      return e.entity_id;
    });

  if (actiIncludedList.value) {
    actiIncludedList.value.updateSelected(selectedEntities.value);
  }
}

function changeItemIcon(change: ChangeCallbackParams) {
  actiValues.value.icon = change.value as string;

  if (!activity.value || activity.value == null) {
    return;
  }

  const newValues = {
    // ...activity.value,
    icon: actiValues.value.icon,
  } as ActivityUpdate;

  submitChange(newValues);
}

function changeItemName(message: any) {
  if (!activity.value || activity.value == null) {
    return;
  }

  const name = standardizeLangTexts(
    {
      ...(activity.value.name || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    // ...activity.value,
    name: name,
  } as ActivityUpdate;

  submitChange(newValues);
}

function changeItemDescription(message: any) {
  if (!activity.value || activity.value == null) {
    return;
  }

  const description = standardizeLangTexts(
    {
      ...(activity.value.description || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    // ...activity.value,
    description: description,
  } as ActivityUpdate;

  submitChange(newValues);
}

async function changePreventSleep() {
  if (!activity.value || activity.value == null || !activity.value.options) {
    return;
  }

  try {
    activity.value = (await storage.update(activity.value.entity_id, {
      options: {
        prevent_sleep: actiValues.value.preventSleep,
      },
    })) as ActivityFull;
  } catch (e) {
    addErrorBottom(e, "activity.settings.update");
  }
}

async function changeReadyCheck() {
  if (!activity.value || activity.value == null || !activity.value.options) {
    return;
  }

  try {
    activity.value = (await storage.update(activity.value.entity_id, {
      options: {
        ready_check: actiValues.value.readyCheck,
      },
    })) as ActivityFull;
  } catch (e) {
    addErrorBottom(e, "activity.settings.update");
  }
}

async function changeActivityGroup(item: SelectOption<string>) {
  try {
    if (activity.value?.options?.activity_group?.group_id) {
      const actiGroup = await activityGroupsStorage.getActivityGroup(
        activity.value?.options?.activity_group?.group_id,
      );
      const updatedActiGroupActiList =
        actiGroup.activities?.filter(
          (a) => a.entity_id != activity.value?.entity_id,
        ) || [];
      const activityIDs = updatedActiGroupActiList.map((entity) => {
        return entity.entity_id;
      });

      await activityGroupsStorage.update(actiGroup.group_id, {
        activity_ids: activityIDs,
      });
    }

    if (item?.value && activity.value?.entity_id) {
      const actiGroup = await activityGroupsStorage.getActivityGroup(
        item.value,
      );
      const activityIDs =
        actiGroup.activities?.map((entity) => {
          return entity.entity_id;
        }) || [];
      activityIDs.push(activity.value.entity_id);

      await activityGroupsStorage.update(actiGroup.group_id, {
        activity_ids: activityIDs,
      });
    }

    const newValue = await storage.getActivity(props.activityId);
    setActivity(newValue);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function submitChange(message: ActivityUpdate) {
  if (!activity.value) {
    return;
  }

  try {
    const newValue = (await storage.update(
      activity.value.entity_id,
      message,
    )) as ActivityFull;
    setActivity(newValue);
  } catch (e) {
    addErrorBottom(e, "activity.settings.update");
    loadPageData();
  }
}

function changeItemNameLang(lang: string) {
  actiValues.value.name.langCode = lang;

  if (activity.value) {
    actiValues.value.name.value = getValueByLang(
      activity.value.name,
      lang,
      true,
    ).value;
  }
}

function changeItemDescriptionLang(lang: string) {
  actiValues.value.description.langCode = lang;

  if (activity.value) {
    actiValues.value.description.value = getValueByLang(
      activity.value.description,
      lang,
      true,
    ).value;
  }
}

async function setActivityGroups() {
  try {
    activityGroups.value = await activityGroupsStorage.getAll();
  } catch (e) {
    addErrorBottom(e);
  }
}

async function setDefaults(reload: boolean = false) {
  try {
    await integrationsStorage.getConfiguredEntities(null, reload);
    await integrationsStorage.getInstances();
  } catch (e) {
    addErrorBottom(e);
  }
}

async function entityListChanged(newList: IncludedEntity[]) {
  if (!activity.value) {
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
    activity.value = (await storage.update(
      activity.value.entity_id,
      newValues,
    )) as ActivityFull;

    if (changedListLength) {
      await fetchFilteredEntities(true);
    }
  } catch (e) {
    addErrorBottom(e);
    loadPageData();
  }
}

function addEntitiesToGroup(entities: ConfiguredEntity[]) {
  const newList = deepClone(selectedEntities.value).concat(entities);
  entityListChanged(newList);
}

function reloadEntities() {
  setDefaults(true);
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
        props.activityId,
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

async function voiceAssistantChanged(item: VoiceAssistant | null) {
  if (!activity.value || activity.value == null || !activity.value.options) {
    return;
  }

  let messageTarget = {};

  if (item != null) {
    messageTarget = {
      entity_id: item.entity_id,
    };
  }

  try {
    activity.value = (await storage.update(activity.value.entity_id, {
      options: {
        voice_assistant: {
          ...(Object.keys(messageTarget).length > 0 && {
            target: messageTarget,
          }),
        },
      },
    })) as ActivityFull;
  } catch (e) {
    addErrorBottom(e, "activity.settings.update");
  }
}

async function voiceAssistantProfileChanged(
  item: VoiceAssistantProfile | null,
) {
  if (!activity.value || activity.value == null || !activity.value.options) {
    return;
  }

  let messageTarget = {};

  if (item != null) {
    messageTarget = {
      entity_id: activeVoiceAssistant.value?.entity_id ?? "",
      profile_id: item.id,
    };
  } else {
    messageTarget = {
      entity_id: activeVoiceAssistant.value?.entity_id ?? "",
    };
  }

  try {
    activity.value = (await storage.update(activity.value.entity_id, {
      options: {
        voice_assistant: {
          target: messageTarget,
        },
      },
    })) as ActivityFull;
  } catch (e) {
    addErrorBottom(e, "activity.settings.update");
  }
}

async function loadPageData() {
  loading.value = true;
  try {
    const newValue = await storage.getActivity(props.activityId);
    await setActivityGroups();
    await setDefaults();
    setActivity(newValue, true);
    await fetchFilteredEntities();
    await configStorage.getVoiceAssistants(true);
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
  <div
    class="ep-settings"
    :class="{
      'ep-settings--has-info-panels': hasDanglingSelectedEntity && activeItem,
    }"
  >
    <div
      v-overflow-indicator
      class="ep-settings__form panel-col panel-col--40"
      :class="{
        'ep-settings__form--has-info-panel':
          hasDanglingSelectedEntity || activeItem,
      }"
    >
      <div class="ep-settings__form__wrapper">
        <div class="ep-settings__form__header">
          <IconSelect
            :key="
              actiValues && actiValues.icon
                ? actiValues.icon
                : 'fa-light fa-clapperboard'
            "
            :value="actiValues && actiValues.icon ? actiValues.icon : ''"
            :fallback="'fa-light fa-clapperboard'"
            :change-callback="changeItemIcon"
            :has-tv-channel="true"
          />
          <span class="ep-settings__form__state">
            <span
              class="ep-settings__form__state__icon"
              :class="{ 'ep-settings__form__state__icon--active': activeItem }"
            >
              <i class="fa-light fa-clapperboard"></i>
            </span>
            <span
              v-if="
                activity && activity.attributes && activity.attributes.state
              "
              class="ep-settings__form__state__text"
            >
              {{
                $t("activity.edit.activity_state", {
                  state: $t(
                    `activity.edit.state.${normalizeState(activity.attributes.state)}`,
                    normalizeState(activity.attributes.state),
                  ),
                })
              }}
            </span>
          </span>
        </div>
        <UCInput
          v-if="actiValues.name"
          v-model="actiValues.name"
          :translations="activity?.name"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.name')"
          @submit="changeItemName"
          @change-lang="changeItemNameLang"
        />
        <UCInput
          v-if="actiValues.description"
          v-model="actiValues.description"
          :translations="activity?.description"
          :type="'textarea'"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.description')"
          @submit="changeItemDescription"
          @change-lang="changeItemDescriptionLang"
        />
        <div class="select-extra">
          <div class="select-extra__text">
            <span class="select-extra__label">
              {{ $t("activity.edit.activity_group.label") }}
            </span>
          </div>
          <UCSelect
            v-if="actiValues.activityGroup"
            v-model="actiValues.activityGroup"
            :options="actiGroupList"
            :position="'right'"
            :light="true"
            :dynamic-width="true"
            :dynamic-position="true"
            @select="changeActivityGroup"
          />
        </div>
        <hr />
        <UCToggle
          v-if="typeof actiValues.preventSleep != 'undefined'"
          v-model="actiValues.preventSleep"
          :label="$t('activity.edit.prevent_sleep.label')"
          :description="$t('activity.edit.prevent_sleep.description')"
          :full-w="true"
          :light="true"
          @change="changePreventSleep"
        />
        <hr />
        <div>
          <div class="select-voice-assistant-input-wrapper">
            <div class="select-extra">
              <div class="select-extra__text">
                <span class="select-extra__label">
                  {{ $t("settings.voice_control.voice_assistant.title") }}
                </span>
              </div>
              <SelectVoiceAssistant
                :value="activeVoiceAssistant ?? null"
                :options="voiceAssistants"
                @save="voiceAssistantChanged"
              />
            </div>
            <div
              v-if="voiceAssistantProfiles && voiceAssistantProfiles.length > 0"
              class="select-extra"
            >
              <div class="select-extra__text">
                <span class="select-extra__label">
                  {{
                    $t("settings.voice_control.voice_assistant.profile.title")
                  }}
                </span>
              </div>
              <SelectVoiceAssistantProfile
                :active-id="
                  activity?.options?.voice_assistant?.target?.profile_id ?? ''
                "
                :options="voiceAssistantProfiles"
                :preferred-profile-id="
                  activeVoiceAssistant?.preferred_profile ?? ''
                "
                @save="voiceAssistantProfileChanged"
              />
            </div>
          </div>

          <p class="ep-settings__form__description">
            <template v-if="!voiceAssistants || voiceAssistants.length < 1">{{
              $t("settings.voice_control.voice_assistant.description.no_items")
            }}</template>
            <template v-else-if="activeGlobalVoiceAssistant != null">{{
              $t("activity.voice_assistant.override")
            }}</template>
            <template v-else>{{
              $t("activity.voice_assistant.select")
            }}</template>
          </p>
          <a
            href="https://support.unfoldedcircle.com/hc/en-us/articles/24061019101596"
            target="_blank"
            class="voice-assistant-support-link"
          >
            <i class="fa-light fa-circle-info"></i>
            <span>{{
              $t("settings.voice_control.voice_assistant.support_link")
            }}</span>
          </a>
        </div>
        <hr />
        <UCToggle
          v-if="typeof actiValues.readyCheck != 'undefined'"
          v-model="actiValues.readyCheck"
          :label="$t('activity.edit.ready_check.label')"
          :description="$t('activity.edit.ready_check.description')"
          :full-w="true"
          :light="true"
          @change="changeReadyCheck"
        />

        <template v-if="active && !showAvailableEntities">
          <Teleport to="body" :disabled="!isSmallScreen">
            <div class="ep-settings__form__info-panel-wrapper">
              <Transition name="opacity-fast">
                <InfoPanel
                  v-show="hasDanglingSelectedEntity"
                  :type="'warning'"
                  :icon="'fa-skull-crossbones'"
                  :text="$t('activity.edit.entities_no_exist_info')"
                >
                </InfoPanel>
              </Transition>
              <Transition name="opacity-fast">
                <InfoPanel
                  v-show="activeItem"
                  :text="$t('activity.edit.editing_info')"
                >
                </InfoPanel>
              </Transition>
            </div>
          </Teleport>
        </template>
      </div>
    </div>
    <div class="ep-settings__included-entities panel-col panel-col--60">
      <div class="ep-settings__included-entities__wrapper">
        <IncludedEntities
          ref="actiIncludedList"
          :entities="selectedEntities"
          :dangling-entities="danglingEntities"
          :instances="instances"
          :show-button-add="showAvailableEntities == false"
          :drag-group="'activity-entities'"
          :loading="loading"
          :text-add-first-descr="
            $t('activity.edit.empty') + ' ' + $t('entity.add_first_btn_below')
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
        ref="actiAvailableEntities"
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
            :pagination="paging"
            :all-entities="filteredEntities"
            :instances="instances"
            :drag-group="'activity-entities'"
            :has-quick-options="true"
            :parent="'edit-activity'"
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
