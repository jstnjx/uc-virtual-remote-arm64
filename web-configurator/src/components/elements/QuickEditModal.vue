<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { storeToRefs } from "pinia";

import { EntityType, BinarySensorUnit } from "@/types/enums";
import type {
  ConfiguredEntity,
  IntegrationInstance,
} from "@/types/integrationInstance";
import type { ChangeCallbackParams } from "@/types/config";
import type { Activity } from "@/types/activity";
import type { Macro } from "@/types/macro";
import type { Remote } from "@/types/remote";
import type { ErrorTexts } from "@/types/flashMessages";

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
import { getErrorMessage } from "@/composables/error";
import { useDataHelper } from "@/composables/dataHelper";
import { useTiming } from "@/composables/timing";
import { getBinarySensorState } from "@/composables/activities";
import { normalizeState } from "@/utils/state";

import UCInput from "@/components/ui/UCInput.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import ErrorBox from "@/components/ui/ErrorBox.vue";
import { useTranslation } from "i18next-vue";

const { t } = useTranslation();
const { sleep } = useTiming();

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  showByParent: {
    type: Boolean,
    default: false,
  },
});

const integrationsApi = ApiConnection.integrations;

const { updateExistingObjectKeys, standardizeLangTexts } = useDataHelper();

const storage = integrationsStore();
const configStorage = configStore();

const { config } = storeToRefs(configStorage);

const instances = ref<IntegrationInstance[]>([]);

const editedItem = ref<null | ConfiguredEntity | Activity | Macro | Remote>(
  null,
);
const values = ref<Record<string, any>>({});
const errorUpdate = ref<ErrorTexts | null>(null);

defineExpose({
  openModal,
});
const emit = defineEmits(["saved", "closed"]);

storage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    void (async () => {
      const { entity_id, event_type } = args[0];
      if (entity_id !== props.item?.entity_id) {
        return;
      }
      if (
        entity_id === props.item?.entity_id &&
        event_type === "CHANGE" &&
        args[0].new_state
      ) {
        await sleep(200);
        // Keep JSON clone: `editedItem` is a wider union than `setEditedItem`
        // accepts; `structuredClone`'s precise return surfaces that pre-existing
        // gap, out of scope for this cloning sweep.
        const updatedItem = updateExistingObjectKeys(
          JSON.parse(JSON.stringify(editedItem.value)),
          args[0].new_state,
        );
        setEditedItem(updatedItem);
      }
    })();
  });
});

const timeFormat24h = computed(() => {
  return config.value?.localization?.time_format_24h ?? true;
});

const modalTitle = computed(() => {
  if (props.item.entity_id) {
    return "entity";
  }
  return "";
});

const showCommandButton = computed(() => {
  const itemToCheck = (editedItem.value as ConfiguredEntity) || props.item;
  const entityTypeList = Object.values(EntityType);

  try {
    if (
      getPrimaryCommandByEntityState(itemToCheck) == null ||
      !entityTypeList.includes(itemToCheck?.entity_type)
    ) {
      return false;
    }
  } catch {
    return false;
  }

  if (itemToCheck?.entity_type === EntityType.select) {
    return true;
  }

  return props.item && props.item.features && props.item.features.length > 0;
});

function setEditedItem(
  newValue: ConfiguredEntity | Activity | null,
  onInit = false,
) {
  editedItem.value = newValue;

  if (newValue) {
    const nameLang = values.value.name?.langCode ?? getCurrentLocale();
    const descLang = values.value.description?.langCode ?? getCurrentLocale();

    const itemName = getValueByLang(newValue.name, nameLang, !onInit);
    const itemDescr = getValueByLang(newValue.description, descLang, !onInit);

    values.value = {
      icon: newValue.icon || getDefaultEntityIcon(newValue),
      name: {
        value: itemName.value,
        langCode: itemName.lang,
      },
      description: {
        value: itemDescr.value,
        langCode: itemDescr.lang,
      },
    };
  } else {
    values.value = {
      icon: "",
      name: "",
      description: "",
    };
  }
}

function openModal() {
  setEditedItem(props.item as ConfiguredEntity | Activity, true);
}

function getIntegrationIcon(inst_id: string) {
  const inst = instances.value.find((inst) => {
    return inst.integration_id === inst_id;
  });
  return inst?.icon || "";
}

function getIntegrationName(inst_id: string) {
  const inst = instances.value.find((inst) => {
    return inst.integration_id === inst_id;
  });
  return translatedProperty(inst?.name) || "";
}

function getItemIcon(icon: string) {
  return icon.replace("uc:macro", "uc:clapperboard");
}

function closeAll() {
  emit("closed");
  setEditedItem(null);
}

function changeItemIcon(change: ChangeCallbackParams) {
  values.value.icon = change.value as string;

  if (!editedItem.value || editedItem.value == null) {
    return;
  }

  const newValues = {
    ...editedItem.value,
    icon: values.value.icon,
  } as ConfiguredEntity;

  submitChange(newValues);
}

function changeItemName(message: any) {
  if (!editedItem.value || editedItem.value == null) {
    return;
  }

  const name = standardizeLangTexts(
    {
      ...(editedItem.value.name || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    ...editedItem.value,
    name: name,
  } as ConfiguredEntity;

  submitChange(newValues);
}

function changeItemDescription(message: any) {
  if (!editedItem.value || editedItem.value == null) {
    return;
  }

  const description = standardizeLangTexts(
    {
      ...(editedItem.value.description || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    ...editedItem.value,
    description: description,
  } as ConfiguredEntity;

  submitChange(newValues);
}

async function submitChange(message: ConfiguredEntity) {
  errorUpdate.value = null;
  if (!editedItem.value) {
    return;
  }

  try {
    const newValue = await storage.updateEntity(
      editedItem.value.entity_id,
      message,
    );
    setEditedItem(newValue);
    emit("saved", newValue);
  } catch (e) {
    errorUpdate.value = getErrorMessage(e, "entity.update");
  }
}

function changeItemNameLang(lang: string) {
  values.value.name.langCode = lang;
  if (editedItem.value) {
    values.value.name.value = getValueByLang(
      editedItem.value.name,
      lang,
      true,
    ).value;
  }
}

function changeItemDescriptionLang(lang: string) {
  values.value.description.langCode = lang;
  if (editedItem.value) {
    values.value.description.value = getValueByLang(
      editedItem.value.description,
      lang,
      true,
    ).value;
  }
}

async function executeCommand() {
  if (!props.item.entity_id) {
    return;
  }

  const command = getPrimaryCommandByEntityState(
    (editedItem.value as ConfiguredEntity) || props.item,
  );
  if (command != null) {
    try {
      await integrationsApi.executeEntityCommand(
        editedItem.value?.entity_id || props.item.entity_id,
        command,
      );
    } catch (e) {
      addErrorBottom(e);
    }
  }
}

function getCustomUnit(item: typeof editedItem.value): string | null {
  if (
    item &&
    item.entity_type === EntityType.sensor &&
    item.options &&
    typeof item.options === "object" &&
    "custom_unit" in item.options
  ) {
    return (item.options as { custom_unit: string }).custom_unit;
  }
  return null;
}

function getDecimals(item: typeof editedItem.value): number | undefined {
  if (
    item &&
    item.options &&
    typeof item.options === "object" &&
    "decimals" in item.options
  ) {
    return (item.options as { decimals: number }).decimals;
  }
  return undefined;
}

onMounted(async () => {
  try {
    instances.value = await storage.getInstances(true);
  } catch (e) {
    addErrorBottom(e);
  }

  if (props.showByParent == true) {
    openModal();
  }
});
</script>
<template>
  <Teleport to="body">
    <ModalSecondary
      :show="editedItem !== null"
      :width="'28.75rem'"
      :name="'quick-edit-modal'"
      class="quick-edit-modal"
      @close="closeAll"
    >
      <template #header>
        {{ $t(`edit.${modalTitle}`) }}
      </template>

      <div class="quick-edit-modal__body">
        <IconSelect
          :key="getItemIcon(values.icon)"
          :value="getItemIcon(values.icon)"
          :change-callback="changeItemIcon"
        />
        <UCInput
          v-model="values.name"
          :translations="editedItem?.name"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.name')"
          @submit="changeItemName"
          @change-lang="changeItemNameLang"
        />
        <UCInput
          v-model="values.description"
          :translations="editedItem?.description"
          :type="'textarea'"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.description')"
          @submit="changeItemDescription"
          @change-lang="changeItemDescriptionLang"
        />
        <button
          v-if="showCommandButton && editedItem != null"
          class="button button--secondary button--min-w quick-edit-modal__body__execute-command"
          @click="executeCommand"
        >
          {{
            getPrimaryCommandLabel(
              (editedItem as ConfiguredEntity) || props.item,
            )
          }}
        </button>
        <p
          v-if="
            editedItem && editedItem.name && translatedProperty(editedItem.name)
          "
          class="quick-edit-modal__info"
        >
          <!-- check if binary sensor entity: show specific state -->
          <template
            v-if="
              editedItem.attributes?.unit &&
              editedItem.attributes?.value &&
              editedItem.device_class &&
              editedItem.device_class === 'binary'
            "
          >
            {{
              $t(
                `entity.state.${getBinarySensorState(
                  editedItem.attributes.unit as BinarySensorUnit,
                  editedItem.attributes.value,
                )}`,
              )
            }}
          </template>
          <!-- check if sensor entity: show sensor optional value and unit/custom_unit -->
          <template
            v-else-if="
              editedItem.attributes?.value ||
              editedItem.attributes?.unit ||
              (editedItem.options && 'custom_unit' in editedItem.options)
            "
          >
            {{ translatedProperty(editedItem.name) }}:
            {{
              getItemAttrValue(
                editedItem.attributes?.value,
                timeFormat24h,
                getDecimals(editedItem),
              )
            }}
            <template
              v-if="editedItem.attributes?.unit || getCustomUnit(editedItem)"
            >
              {{ editedItem.attributes?.unit ?? getCustomUnit(editedItem) }}
            </template>
          </template>
          <!-- show select entity current option -->
          <template
            v-else-if="
              editedItem.entity_type === EntityType.select &&
              (editedItem as ConfiguredEntity).attributes?.current_option
            "
          >
            {{ translatedProperty(editedItem.name) }}:
            {{ (editedItem as ConfiguredEntity).attributes?.current_option }}
          </template>
          <!-- show entity state -->
          <template
            v-else-if="
              editedItem.attributes?.state &&
              normalizeState(editedItem.attributes?.state) != 'error'
            "
          >
            {{
              t("form.entity_state", {
                entity: translatedProperty(editedItem.name),
                state: t(
                  `entity.state.${normalizeState(editedItem.attributes?.state)}`,
                ),
              })
            }}
          </template>
          <template v-else-if="editedItem.attributes?.state">
            {{
              $t(`entity.state.${normalizeState(editedItem.attributes?.state)}`)
            }}
          </template>
        </p>
        <div
          v-if="
            editedItem &&
            editedItem.integration_id &&
            getIntegrationName(editedItem.integration_id)
          "
          class="quick-edit-modal__footer"
          :class="{
            'quick-edit-modal__footer--rows':
              (getIntegrationName(editedItem?.integration_id || '')?.length ||
                0) +
                (editedItem?.entity_id?.length || 0) >
              40,
          }"
        >
          <div class="quick-edit-modal__footer__col">
            <SelectedIcon
              v-if="editedItem.integration_id"
              :icon="getIntegrationIcon(editedItem.integration_id)"
              fallback-icon="icon-integration"
            />
            <span class="quick-edit-modal__footer__value">
              {{ $t("form.provided_by") }}
              {{ getIntegrationName(editedItem.integration_id) }}
            </span>
          </div>
          <div class="quick-edit-modal__footer__col">
            <span class="quick-edit-modal__footer__label">
              {{ $t("entity.label.ID", "ID") }}
            </span>
            <span class="quick-edit-modal__footer__value">
              {{ editedItem.entity_id }}
            </span>
          </div>
        </div>
        <ErrorBox
          v-if="errorUpdate"
          :message="errorUpdate"
          :border-top="true"
          :left="true"
        />
      </div>
    </ModalSecondary>
  </Teleport>
</template>
