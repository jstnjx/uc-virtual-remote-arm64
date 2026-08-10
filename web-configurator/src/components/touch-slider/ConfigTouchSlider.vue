<script setup lang="ts">
import { ref, watch, computed, onMounted, useTemplateRef } from "vue";
import { useTranslation } from "i18next-vue";

import { EntityType } from "@/types/enums";
import type {
  Activity,
  ActivityUpdate,
  ActivityTouchSlider,
  IncludedEntity,
} from "@/types/activity";
import type { ConfiguredEntity } from "@/types/integrationInstance";

type ExtendedEntity = { features: string[] } & ConfiguredEntity;

import { appStateStore } from "@/stores/appState";
import { activitiesStore } from "@/stores/activities";
import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import translatedProperty from "@/composables/translatedProperty";
import { useEditorKeyboardEvents } from "@/composables/remote/editor";
import { useWindowDimension } from "@/composables/windowDimension";
import { getAvailableEntitesForActivityByType } from "@/composables/activities";
import { useTiming } from "@/composables/timing";

import UCToggle from "@/components/ui/UCToggle.vue";
import CommandField from "@/components/ui/CommandField.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import EntitySelect from "@/components/touch-slider/EntitySelect.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";

const { t } = useTranslation();
const { isSmallScreen } = useWindowDimension();
const { sleep } = useTiming();

const emit = defineEmits(["itemMouseOver", "itemMouseLeave", "update"]);

const appState = appStateStore();
const activitiesStorage = activitiesStore();
const integrationsStorage = integrationsStore();

const props = defineProps({
  entity: {
    type: Object,
    required: true,
  },
  entityType: {
    type: String,
    default: "activity",
  },
  danglingEntities: {
    type: Array,
    default: () => [],
  },
});

const { editTouchSlider, popupLeft, startTouchSliderEdit } =
  useEditorKeyboardEvents(t);

const featureMap: Record<string, string[]> = {
  media_player: ["volume", "seek"],
  light: ["dim"],
  cover: ["position"],
};

const defaultTouchSlider = { enabled: true };
const sliderItemConfig = useTemplateRef<HTMLDivElement>("sliderItemConfig");
const dialogConfirmReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogConfirmReset");
const elEntitySelect =
  useTemplateRef<InstanceType<typeof EntitySelect>>("elEntitySelect");
const itemToModify = ref<ActivityTouchSlider | null>(null);
const saving = ref(false);
const showFeatureSelect = ref(false);

const allEntities = computed<ConfiguredEntity[]>(
  () => integrationsStorage.configuredEntities,
);

watch(
  () => props.entity,
  () => {
    if (props.entity.options?.touch_slider && editTouchSlider.value == true) {
      itemToModify.value = getTouchSliderData();
    }
  },
);

watch(
  () => appState.editButton,
  (val) => {
    if (val && val != null && val.button && val.button === "TOUCH_SLIDER") {
      startEdit();
    }
  },
);

watch(itemToModify, async (val) => {
  if (val == null) {
    await sleep(600);
    appState.clearEditButton();
  }
});

watch(editTouchSlider, (val) => {
  if (val == false) {
    itemToModify.value = null;
  }
});

const showFixedWrapper = computed(() => {
  return (
    appState.editButton != null && appState.editButton.button === "TOUCH_SLIDER"
  );
});

const activeEntityId = computed(() => {
  return getActiveEntity()?.entity_id ?? "";
});

const activeFeature = computed(() => {
  const actEnt = getActiveEntity();
  if (actEnt?.features && actEnt?.features.length > 0) {
    if (
      (actEnt.entity_type === EntityType.media_player ||
        actEnt.entity_type === EntityType.light ||
        actEnt.entity_type === EntityType.cover) &&
      featureMap[actEnt.entity_type]
    ) {
      if (
        featureMap[actEnt.entity_type].includes(
          props.entity.options?.touch_slider?.target?.feature,
        )
      ) {
        return props.entity.options?.touch_slider?.target?.feature;
      } else {
        const commonFeatures = featureMap[actEnt.entity_type].filter((x) =>
          actEnt.features.includes(x),
        );
        return commonFeatures[0];
      }
    }
  }

  return null;
});

const availableFeatureEntityIds = computed(() => {
  return entityList.value.map((entity) => entity.entity_id);
});

const availableFeatures = computed(() => {
  const actEnt = getActiveEntity();
  if (
    actEnt &&
    (actEnt.entity_type === EntityType.media_player ||
      actEnt.entity_type === EntityType.light ||
      actEnt.entity_type === EntityType.cover) &&
    featureMap[actEnt.entity_type]
  ) {
    const commonFeatures = featureMap[actEnt.entity_type].filter((x) =>
      actEnt.features.includes(x),
    );
    return commonFeatures;
  }

  return [];
});

const entityList = computed(() => {
  const entitiesMediaPlayer = getAvailableEntitesForActivityByType(
    props.entity as Activity,
    EntityType.media_player,
  ) as IncludedEntity[];
  const entitiesLight = getAvailableEntitesForActivityByType(
    props.entity as Activity,
    EntityType.light,
  ) as IncludedEntity[];
  const entitiesCover = getAvailableEntitesForActivityByType(
    props.entity as Activity,
    EntityType.cover,
  ) as IncludedEntity[];

  const entList = entitiesMediaPlayer.concat(entitiesLight, entitiesCover);

  const referenceMap: Record<string, string[] | undefined> =
    allEntities.value.reduce(
      (acc, item) => {
        acc[item.entity_id] = item.features;
        return acc;
      },
      {} as Record<string, string[] | undefined>,
    );

  const updatedEntList = entList.map((item) => ({
    ...item,
    features: referenceMap[item.entity_id] || [],
  })) as ExtendedEntity[];

  return updatedEntList.filter((entity) => {
    const type = entity.entity_type;
    if (!type) return false;

    const requiredFeatures = featureMap[type] ?? [];
    if (requiredFeatures.length === 0) return false;

    const entityFeatures = entity.features ?? [];

    const intersection = entityFeatures.filter((f) =>
      requiredFeatures.includes(f),
    );

    return intersection.length > 0;
  });
});

const defaultEntity = computed(() => {
  const defId = findDefaultEntityId(
    props.entity.options?.user_interface,
    availableFeatureEntityIds.value,
  );
  return (
    entityList.value.find((m: ExtendedEntity) => m.entity_id == defId) ?? null
  );
});

function startEdit() {
  itemToModify.value = getTouchSliderData();
  startTouchSliderEdit(
    isSmallScreen.value,
    sliderItemConfig.value ?? undefined,
  );
}

function startReset() {
  if (dialogConfirmReset.value) {
    dialogConfirmReset.value?.open();
  }
}

function openEntitySelect() {
  if (elEntitySelect.value) {
    elEntitySelect.value.open();
  }
}

function selectEntity(entity: IncludedEntity) {
  if (itemToModify.value == null) return false;
  if (itemToModify.value?.target?.entity_id) {
    itemToModify.value.target.entity_id = entity.entity_id;
  } else {
    if (!itemToModify.value?.target) {
      itemToModify.value.target = { entity_id: "" };
    }

    itemToModify.value.target.entity_id = entity.entity_id;
  }

  if (itemToModify.value?.target?.feature) {
    delete itemToModify.value.target.feature;
  }

  save();
}

async function selectFeature(feature: string) {
  if (itemToModify.value == null) return false;
  if (itemToModify.value?.target?.feature) {
    itemToModify.value.target.feature = feature;
  } else {
    if (itemToModify.value?.target?.entity_id) {
      itemToModify.value.target.feature = feature;
    }
  }

  save();
  await sleep(100);
  showFeatureSelect.value = false;
}

async function save() {
  if (!itemToModify.value) {
    return false;
  }
  saving.value = true;
  const message = {
    options: {
      // Keep JSON clone: strips `undefined` fields so the REST payload matches
      // the JSON wire shape (`structuredClone` would retain them).
      touch_slider: JSON.parse(JSON.stringify(itemToModify.value)),
    },
  } as ActivityUpdate;

  try {
    (await activitiesStorage.update(
      props.entity.entity_id,
      message,
      true,
    )) as Activity;
  } catch (e) {
    addErrorBottom(e);
    itemToModify.value = getTouchSliderData();
  }

  emit("update");
  saving.value = false;
}

function resetTouchSlider() {
  itemToModify.value = defaultTouchSlider;
  save();
}

function triggerClose() {
  if (document) {
    document?.querySelector("body")?.click();
  }
}

function getEntityNameById(entity_id: string | Record<string, any>) {
  const selected_entity = (
    props.entity.options.included_entities as IncludedEntity[]
  ).find((entity) => {
    return entity.entity_id === entity_id;
  });
  return translatedProperty(selected_entity?.name);
}

function getIntegrationNameByEntityId(entity_id: string | Record<string, any>) {
  const selected_entity = (
    props.entity.options.included_entities as IncludedEntity[]
  ).find((entity) => {
    return entity.entity_id === entity_id;
  });
  return translatedProperty(selected_entity?.integration?.name);
}

function getTouchSliderData() {
  return JSON.parse(
    JSON.stringify(props.entity.options?.touch_slider ?? defaultTouchSlider),
  );
}

function findDefaultEntityId(obj: unknown, validIds: string[]): string | null {
  if (typeof obj !== "object" || obj === null) return null;

  const record = obj as Record<string, unknown>;

  if (typeof record.media_player_id === "string") {
    const id = record.media_player_id;
    if (validIds.includes(id)) {
      return id;
    }
  }

  if (
    typeof record.command === "object" &&
    record.command !== null &&
    typeof (record.command as any).entity_id === "string"
  ) {
    const id = (record.command as any).entity_id;
    if (validIds.includes(id)) {
      return id;
    }
  }

  for (const key in record) {
    const result = findDefaultEntityId(record[key], validIds);
    if (result) return result;
  }

  return null;
}

function getActiveEntity() {
  const actEntity = (entityList.value ?? []).find((e) => {
    return (
      e.entity_id ===
      (props.entity.options?.touch_slider?.target?.entity_id ?? "")
    );
  });

  if (actEntity) {
    return actEntity;
  }

  return defaultEntity.value;
}

onMounted(async () => {
  try {
    await integrationsStorage.getConfiguredEntities(null, false);
  } catch (e) {
    addErrorBottom(e);
  }
});
</script>
<template>
  <div class="config-touch-slider">
    <div
      class="config-touch-slider__item"
      @click="startEdit"
      @mouseover="$emit('itemMouseOver')"
      @mouseleave="$emit('itemMouseLeave')"
    >
      <div class="config-touch-slider__item__base">
        <span class="config-touch-slider__item__icon">
          <i class="fa-light fa-sliders"></i>
        </span>
        <span class="config-touch-slider__item__name">
          {{ $t("touch_slider.title") }}
        </span>
      </div>
      <div ref="sliderItemConfig" class="config-touch-slider__item__config">
        <template
          v-if="
            typeof props.entity.options?.touch_slider?.enabled != 'undefined' &&
            props.entity.options?.touch_slider?.enabled == false
          "
        >
          <div class="config-touch-slider__item__feature">
            <span class="config-touch-slider__item__feature__value">{{
              $t("ui.disabled")
            }}</span>
          </div>
        </template>
        <template
          v-else-if="
            props.entity.options?.touch_slider?.target?.entity_id &&
            activeFeature
          "
        >
          <div class="config-touch-slider__item__feature">
            <span class="config-touch-slider__item__feature__value">{{
              $t(`entity.features.${activeFeature}`)
            }}</span>
            <span class="config-touch-slider__item__feature__entity">{{
              getEntityNameById(activeEntityId || "")
            }}</span>
          </div>
        </template>
        <template
          v-else-if="
            defaultEntity && defaultEntity.entity_id.length > 0 && activeFeature
          "
        >
          <div class="config-touch-slider__item__feature">
            <span class="config-touch-slider__item__feature__value">{{
              $t(`entity.features.${activeFeature}`)
            }}</span>
            <span class="config-touch-slider__item__feature__entity">{{
              getEntityNameById(defaultEntity.entity_id || "")
            }}</span>
          </div>
          <div class="config-touch-slider__item__extra">
            {{ $t("ui.default") }}
          </div>
        </template>
        <template v-else>
          <div
            class="config-touch-slider__item__feature config-touch-slider__item__feature--inactive"
          >
            {{ $t("ui.none") }}
          </div>
        </template>
      </div>
    </div>

    <Teleport to="body">
      <Transition :name="'opacity-fast'">
        <div v-show="editTouchSlider" class="edit-button-li-bg"></div>
      </Transition>
      <Transition name="popup-grow">
        <div
          v-show="editTouchSlider"
          class="edit-button-li-wrapper"
          :class="[
            { 'edit-button-li-wrapper--fixed': showFixedWrapper },
            `edit-button-li-popup--${entityType}`,
          ]"
          :style="popupLeft != null ? { left: popupLeft + 'px' } : undefined"
        >
          <div class="edit-button-li edit-button-li--touch-slider">
            <div class="edit-button-li__header">
              <div class="edit-button-li__header__main">
                <span class="edit-button-li__title">{{
                  $t("touch_slider.title")
                }}</span>
              </div>
              <Transition name="opacity-fast">
                <button
                  v-show="!saving"
                  class="button button--secondary button--icon button--icon--small edit-button-li__close"
                  @click="triggerClose"
                >
                  <i class="fa-regular fa-close"></i>
                </button>
              </Transition>
              <Transition name="opacity-fast">
                <div v-show="saving" class="edit-button-li__loader">
                  <img
                    src="/images/loading-indicator.png"
                    alt="Loading"
                    class="img-loading"
                  />
                </div>
              </Transition>
            </div>
            <div class="edit-button-li__body">
              <UCToggle
                v-if="itemToModify"
                v-model="itemToModify.enabled"
                :label="`${
                  itemToModify?.enabled ? $t('ui.enabled') : $t('ui.disabled')
                }`"
                :full-w="true"
                :disabled="saving"
                @change="save"
              />

              <Transition name="collapse-small">
                <div
                  v-if="itemToModify?.enabled"
                  class="edit-button-li__command-wrapper"
                >
                  <CommandField
                    :id="
                      props.entity.options?.touch_slider?.target?.entity_id
                        ? activeEntityId
                        : ''
                    "
                    :entity-type="entityType"
                    :name="
                      props.entity.options?.touch_slider?.target?.entity_id
                        ? getEntityNameById(activeEntityId || '')
                        : ''
                    "
                    :entity="
                      props.entity.options?.touch_slider?.target?.entity_id &&
                      activeEntityId
                        ? getIntegrationNameByEntityId(activeEntityId)
                        : ''
                    "
                    :extended-command-select="entityType === 'activity'"
                    :label="$t('entity.title')"
                    @open-command-select="openEntitySelect"
                  />
                </div>
              </Transition>

              <EntitySelect
                v-if="entityType === 'activity'"
                :key="activeEntityId || $t('ui.none')"
                ref="elEntitySelect"
                :value="activeEntityId || ''"
                :activity="entity"
                :entity-list="entityList"
                @select="selectEntity"
              />

              <Transition name="collapse-small">
                <div
                  v-if="
                    itemToModify?.enabled && itemToModify?.target?.entity_id
                  "
                  class="edit-button-li__command-wrapper"
                >
                  <CommandField
                    v-if="availableFeatures && availableFeatures.length > 0"
                    :id="
                      activeFeature
                        ? $t(`entity.features.${activeFeature}`)
                        : ''
                    "
                    :entity-type="entityType"
                    :label="$t('ui.feature')"
                    @toggle-command-select="
                      showFeatureSelect = !showFeatureSelect
                    "
                  />
                  <div
                    v-if="availableFeatures && availableFeatures.length > 0"
                    v-show="showFeatureSelect"
                    class="command-select-wrapper"
                  >
                    <div ref="elCommandSelect" class="command-select">
                      <ListWithFilter>
                        <template #items>
                          <div
                            v-for="(feature, index) in availableFeatures"
                            :key="`${feature}-${index}`"
                            class="command-select__item"
                            @click="selectFeature(feature)"
                          >
                            <h4>
                              {{ $t(`entity.features.${feature}`) }}
                            </h4>
                          </div>
                        </template>
                      </ListWithFilter>
                    </div>
                  </div>
                  <span
                    v-else
                    class="edit-button-li__command-wrapper__information"
                    >{{ $t("entity.features.no_features_found") }}</span
                  >
                </div>
              </Transition>
              <Transition name="collapse-small">
                <div
                  v-show="itemToModify?.enabled"
                  class="edit-button-li__reset"
                >
                  <span
                    class="edit-button-li__reset__button"
                    @click="startReset"
                  >
                    <button class="button button--tertiary button--icon">
                      <i class="fa-regular fa-arrow-rotate-left"></i>
                    </button>
                    <span>{{ $t("ui.reset_to_defaults") }}</span>
                  </span>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <AppDialog
      ref="dialogConfirmReset"
      :title="$t('touch_slider.reset.title')"
      :text="$t('touch_slider.reset.question')"
      :submit-text="$t('ui.accept')"
      :cancel-text="$t('ui.cancel')"
      @submit="resetTouchSlider"
    />
  </div>
</template>
