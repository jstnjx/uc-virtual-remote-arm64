<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { storeToRefs } from "pinia";

import { EntityType, BinarySensorUnit } from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";
import type {
  ConfiguredEntity,
  IntegrationInstance,
} from "@/types/integrationInstance";

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";
import { configStore } from "@/stores/config";

import ApiConnection from "@/api";

import {
  getDefaultEntityIcon,
  getPrimaryCommandByEntityState,
  getPrimaryCommandLabel,
  getItemAttrValue,
} from "@/composables/entity";
import translatedProperty, {
  getCurrentLocale,
  getValueByLang,
} from "@/composables/translatedProperty";
import router from "@/composables/router";
import { deepClone, useDataHelper } from "@/composables/dataHelper";
import { getBinarySensorState } from "@/composables/activities";
import { normalizeState } from "@/utils/state";

import UCInput from "@/components/ui/UCInput.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";

const storage = integrationsStore();
const configStorage = configStore();

const props = defineProps({
  entityId: {
    type: String,
    required: true,
  },
});

const integrationsApi = ApiConnection.integrations;
const { updateExistingObjectKeys, standardizeLangTexts } = useDataHelper();

const { config } = storeToRefs(configStorage);

let instances: IntegrationInstance[];
try {
  instances = await storage.getInstances(true);
} catch (e) {
  addErrorBottom(e);
}

const entity = ref<ConfiguredEntity | null>(null);
const entityValues = ref<Record<string, any>>({});
const formWrapper = useTemplateRef<HTMLDivElement>("formWrapper");

const loading = ref(false);

storage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    const { entity_id, event_type } = args[0];
    if (entity_id !== props.entityId) {
      return;
    }
    if (event_type === "DELETE") {
      router.push({
        name: "entities",
      });
    } else if (
      entity_id === props.entityId &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      const updEntity = updateExistingObjectKeys(
        deepClone(entity.value!),
        args[0].new_state,
        true,
      );
      setEntity(updEntity);
    }
  });
});

const timeFormat24h = computed(() => {
  return config.value?.localization?.time_format_24h ?? true;
});

const showCommandButton = computed(() => {
  const entityTypeList = Object.values(EntityType);
  if (
    entity.value == null ||
    getPrimaryCommandByEntityState(entity.value) == null
  ) {
    return false;
  }

  if (!entityTypeList.includes(entity.value?.entity_type)) {
    return false;
  }

  if (entity.value?.entity_type === EntityType.select) {
    return true;
  }

  return (
    entity.value && entity.value.features && entity.value.features.length > 0
  );
});

const hasDisplayValue = computed(() => {
  if (!entity.value) return false;

  const attrs = entity.value.attributes;
  return (
    (attrs != null || entity.value.device_class === "custom") &&
    (attrs?.value != null ||
      attrs?.unit != null ||
      entity.value.options?.custom_unit != null)
  );
});

function getIntegrationIcon(inst_id: string) {
  const inst = instances.find((inst) => {
    return inst.integration_id === inst_id;
  });
  return inst?.icon || "";
}

function getIntegrationName(inst_id: string) {
  const inst = instances.find((inst) => {
    return inst.integration_id === inst_id;
  });
  return inst?.name ? translatedProperty(inst?.name) : "";
}

function setEntity(newValue: ConfiguredEntity, onInit = false) {
  const nameLang = entityValues.value.name?.langCode ?? getCurrentLocale();
  const descLang =
    entityValues.value.description?.langCode ?? getCurrentLocale();

  entity.value = newValue;

  const entityName = getValueByLang(newValue.name, nameLang, !onInit);
  const entityDescr = getValueByLang(newValue.description, descLang, !onInit);

  entityValues.value = {
    icon: newValue.icon || getDefaultEntityIcon(newValue),
    name: {
      value: entityName.value,
      langCode: entityName.lang,
    },
    description: {
      value: entityDescr.value,
      langCode: entityDescr.lang,
    },
  };
}

function changeItemIcon(change: ChangeCallbackParams) {
  entityValues.value.icon = change.value as string;

  if (!entity.value || entity.value == null) {
    return;
  }

  const newValues = {
    ...entity.value,
    icon: entityValues.value.icon,
  } as ConfiguredEntity;

  submitChange(newValues);
}

function changeItemName(message: any) {
  if (!entity.value || entity.value == null) {
    return;
  }

  const name = standardizeLangTexts(
    {
      ...(entity.value.name || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    ...entity.value,
    name: name,
  } as ConfiguredEntity;

  submitChange(newValues);
}

function changeItemDescription(message: any) {
  if (!entity.value || entity.value == null) {
    return;
  }

  const description = standardizeLangTexts(
    {
      ...(entity.value.description || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    ...entity.value,
    description: description,
  } as ConfiguredEntity;

  submitChange(newValues);
}

async function submitChange(message: ConfiguredEntity) {
  if (!entity.value) {
    return;
  }

  try {
    const newValues = (await storage.updateEntity(
      entity.value.entity_id,
      message,
    )) as ConfiguredEntity;
    setEntity(newValues);
  } catch (e) {
    addErrorBottom(e, "entity.update", formWrapper.value ?? undefined);
  }
}

function changeItemNameLang(lang: string) {
  entityValues.value.name.langCode = lang;

  if (entity.value) {
    entityValues.value.name.value = getValueByLang(
      entity.value.name,
      lang,
      true,
    ).value;
  }
}

function changeItemDescriptionLang(lang: string) {
  entityValues.value.description.langCode = lang;

  if (entity.value) {
    entityValues.value.description.value = getValueByLang(
      entity.value.description,
      lang,
      true,
    ).value;
  }
}

async function executeCommand() {
  if (!entity.value) {
    return;
  }

  const command = getPrimaryCommandByEntityState(entity.value);
  if (command != null) {
    try {
      await integrationsApi.executeEntityCommand(
        entity.value.entity_id,
        command,
      );
    } catch (e) {
      addErrorBottom(
        e,
        "entity.execute_command",
        formWrapper.value ?? undefined,
      );
    }
  }
}

onMounted(async () => {
  try {
    loading.value = true;
    const newValue = await storage.getConfiguredEntity(props.entityId);
    setEntity(newValue, true);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
});
</script>
<template>
  <div class="ep-settings">
    <div v-overflow-indicator class="ep-settings__form panel-col panel-col--40">
      <div ref="formWrapper" class="ep-settings__form__wrapper">
        <div class="ep-settings__form__header">
          <IconSelect
            :key="
              entityValues && entityValues.icon
                ? entityValues.icon
                : 'fa-light fa-clapperboard'
            "
            :value="
              entityValues && entityValues.icon
                ? entityValues.icon
                : 'fa-light fa-clapperboard'
            "
            :fallback="'fa-light fa-clapperboard'"
            :change-callback="changeItemIcon"
          />
          <div
            v-if="entity && entity.integration_id"
            class="ep-settings__form__header__integration"
          >
            <SelectedIcon
              :icon="getIntegrationIcon(entity.integration_id)"
              fallback-icon="uc:puzzle"
            />
            <span>{{ getIntegrationName(entity.integration_id) }}</span>
          </div>
        </div>
        <UCInput
          v-if="entityValues.name"
          v-model="entityValues.name"
          :translations="entity?.name"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.name')"
          @submit="changeItemName"
          @change-lang="changeItemNameLang"
        />
        <UCInput
          v-if="entityValues.description"
          v-model="entityValues.description"
          :translations="entity?.description"
          :type="'textarea'"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.description')"
          @submit="changeItemDescription"
          @change-lang="changeItemDescriptionLang"
        />
        <div v-if="entity" class="ep-settings__form__footer">
          <div
            v-if="entity.attributes && entity.attributes?.state"
            class="ep-settings__form__footer__row"
          >
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">{{
                $t("entity.label.state")
              }}</span>
              <span class="ep-settings__form__meta__value">{{
                $t(`entity.state.${normalizeState(entity.attributes?.state)}`)
              }}</span>
            </div>
            <button
              v-if="showCommandButton"
              :disabled="
                !entity.attributes?.state ||
                normalizeState(entity.attributes?.state) == 'unavailable'
              "
              class="button button--secondary button-toggle"
              @click="executeCommand"
            >
              {{ getPrimaryCommandLabel(entity) }}
            </button>
          </div>
          <div
            v-if="
              entity.attributes &&
              entity.attributes?.current_option !== undefined
            "
            class="ep-settings__form__footer__row"
          >
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">{{
                $t("entity.label.current_option")
              }}</span>
              <span class="ep-settings__form__meta__value">{{
                entity.attributes?.current_option
              }}</span>
            </div>
          </div>
          <div v-if="hasDisplayValue" class="ep-settings__form__footer__row">
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">{{
                $t("entity.label.value")
              }}</span>
              <span class="ep-settings__form__meta__value">
                <template
                  v-if="
                    entity.attributes?.unit != null &&
                    entity.attributes?.value != null &&
                    entity.device_class === 'binary'
                  "
                >
                  {{
                    $t(
                      `entity.state.${getBinarySensorState(
                        entity.attributes.unit as BinarySensorUnit,
                        entity.attributes.value,
                      )}`,
                    )
                  }}
                </template>
                <template v-else>
                  {{
                    getItemAttrValue(
                      entity.attributes?.value,
                      timeFormat24h,
                      entity.options?.decimals as number | undefined,
                    )
                  }}
                  <template
                    v-if="
                      entity.attributes?.unit || entity.options?.custom_unit
                    "
                    >{{
                      entity.attributes?.unit ?? entity.options?.custom_unit
                    }}</template
                  >
                </template>
              </span>
            </div>
          </div>
          <div v-if="entity?.entity_id" class="ep-settings__form__footer__row">
            <div class="ep-settings__form__meta">
              <span class="ep-settings__form__meta__label">{{
                $t("entity.label.ID", "ID")
              }}</span>
              <span class="ep-settings__form__meta__value">{{
                entity.entity_id
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="ep-settings__no-settings panel-col panel-col--60">
      <p>{{ $t("entity.no_other_settings") }}</p>
    </div>
  </div>
</template>
