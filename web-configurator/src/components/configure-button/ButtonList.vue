<script setup lang="ts">
import { ref, watch, computed, onMounted, useTemplateRef } from "vue";
import { useTranslation } from "i18next-vue";

import { ButtonMappingPressType, EntityType } from "@/types/enums";
import type {
  Activity,
  DeviceButton,
  DeviceButtonMapping,
  DeviceButtonMappingChange,
  IncludedEntity,
  EntityCommand,
} from "@/types/activity";
import type { ClipboardParamEntityType } from "@/types/app";
import type { ConfiguredEntity } from "@/types/integrationInstance";
import type { DropdownItem } from "@/types/ui";
import type { DeviceMeta } from "@/types/config";

import { configStore } from "@/stores/config";
import { appStateStore } from "@/stores/appState";
import { activitiesStore } from "@/stores/activities";
import { remotesStore } from "@/stores/remotes";
import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import { useWindowDimension } from "@/composables/windowDimension";
import translatedProperty from "@/composables/translatedProperty";
import { useEditorKeyboardEvents } from "@/composables/remote/editor";
import { useRemoteProperties } from "@/composables/remote/properties";

import ButtonListItem from "@/components/configure-button/ButtonListItem.vue";
import EditButtonListItem from "@/components/configure-button/EditButtonListItem.vue";
import ButtonPress from "@/components/configure-button/ButtonPress.vue";
import ModalMinimal from "@/components/elements/ModalMinimal.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import ConfigTouchSlider from "@/components/touch-slider/ConfigTouchSlider.vue";
import DropdownMenu from "@/components/ui/DropdownMenu.vue";

type ButtonPressType = typeof ButtonMappingPressType;

const { t } = useTranslation();

defineExpose({
  changePhysicalButtonEdit,
  isSaving,
});

const config = configStore();
const appState = appStateStore();
const activitiesStorage = activitiesStore();
const remotesStorage = remotesStore();
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
  textInstruction: {
    type: String,
    default: "",
  },
});
const emit = defineEmits([
  "changeButton",
  "resetButton",
  "resetAllButtons",
  "highlightButton",
  "hideHighlightedButton",
  "update",
]);

const pasteDropdownItems = [
  {
    icon: "fa-light fa-paste",
    label: "ui.paste",
    value: "paste",
  },
  {
    icon: "fa-light fa-code-merge",
    label: "ui.merge",
    value: "merge",
  },
] as DropdownItem[];

const {
  closeButtonEdit,
  editPhysicalButton,
  physicalPopupOpen,
  popupLeft,
  onPhysicalPopupAfterLeave,
  startPhysicalButtonEdit,
  updatePhysicalButtonEdit,
} = useEditorKeyboardEvents(t);

const { getTouchSliderProps } = useRemoteProperties();
const deviceMeta = ref<DeviceMeta | null>(null);
const physButtonToEdit = ref<DeviceButton | null>(null);

const { isSmallScreen } = useWindowDimension();
const buttonLayouts = ref<DeviceButton[]>([]);
const itemToModify = ref<DeviceButton | null>(null);
const itemToReset = ref<DeviceButton | null>(null);

const expanded = ref(true);
const dialogConfirmReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogConfirmReset");
const dialogConfirmResetAll = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogConfirmResetAll",
);
const dialogMissingEntity = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogMissingEntity",
);

const doMerging = ref(false);
const itemsToPaste = ref<DeviceButtonMapping[]>([]);

const allEntities = ref<ConfiguredEntity[]>([]);
const missingEntitiesIDs = ref<string[]>([]);

const saving = ref(false);

watch(
  () => appState.editButton,
  (val) => {
    if (val && val != null && val.button && val.button != "TOUCH_SLIDER") {
      itemToModify.value = val as DeviceButton;
    }
  },
);

watch(itemToModify, (val) => {
  if (val == null) {
    appState.clearEditButton();
  }
});

watch(editPhysicalButton, (val) => {
  if (val == null) {
    itemToModify.value = null;
  }
});

const danglingEntities = computed(() => {
  if (!props.entity || props.entityType != EntityType.activity) return [];
  return (props.entity.options?.included_entities ?? [])
    .filter((e: IncludedEntity) => e.available === false)
    .map((e: IncludedEntity) => {
      return e.entity_id;
    });
});

const isDanglingEditPhysicalButton = computed(() => {
  if (
    !props.entity ||
    props.entityType != EntityType.activity ||
    editPhysicalButton.value == null
  )
    return false;
  const prType =
    "pressType" in editPhysicalButton.value
      ? (editPhysicalButton.value.pressType as ButtonMappingPressType)
      : undefined;
  return (
    prType &&
    editPhysicalButton.value &&
    "element" in editPhysicalButton.value &&
    isDangling(
      (editPhysicalButton.value.element as DeviceButtonMapping)[prType],
    )
  );
});

const isActivity = computed(() => {
  return props.entity && props.entity.entity_type == EntityType.activity;
});

const showFixedWrapper = computed(() => {
  return (
    appState.editButton != null && appState.editButton.button != "TOUCH_SLIDER"
  );
});

const isModel3 = computed(() => {
  return deviceMeta.value?.model?.toLowerCase() != "ucr2";
});

const isActivePaste = computed(() => {
  return (
    (props.entityType == EntityType.activity &&
      appState.$state.clipboard.activity.buttonMappingItems &&
      appState.$state.clipboard.activity.buttonMappingItems.length > 0) ||
    (props.entityType == EntityType.remote &&
      appState.$state.clipboard.remote.buttonMappingItems &&
      appState.$state.clipboard.remote.buttonMappingItems.length > 0)
  );
});

const hasConfiguredButton = computed(() => {
  return props.entity.options?.button_mapping?.some(
    (item: DeviceButtonMapping) =>
      item.short_press || item.double_press || item.long_press,
  );
});

const questionMissingEntity = computed(() => {
  let names = "";
  missingEntitiesIDs.value.forEach((id) => {
    const entData = allEntities.value.find((e) => e.entity_id === id);
    if (names.length > 2) {
      names += ", ";
    }

    names += translatedProperty(entData?.name) || "";
  });

  return t("entity.missing_entity.question_page", {
    entities: `${names.replace(/[,\s]+$/g, "")}`,
    count: missingEntitiesIDs.value.length,
  });
});

function isDangling(command?: EntityCommand) {
  if (props.entityType != EntityType.activity || !command) return false;
  return danglingEntities.value.includes(command.entity_id);
}

function getButtonValue(button: DeviceButton | null) {
  if (button == null) {
    return null;
  }

  if (
    props.entityType == EntityType.activity ||
    props.entityType == EntityType.remote
  ) {
    return (
      (props.entity.options?.button_mapping as DeviceButtonMapping[]) || []
    ).find((btn) => {
      return btn.button === button.button;
    });
  }
}

function setButtonList() {
  buttonLayouts.value = config.$state.list.buttonLayout[0]?.buttons || [];
}

function toggleExpand() {
  expanded.value = !expanded.value;
}

function handleStartButtonEdit(
  data: DeviceButtonMapping,
  button: DeviceButton,
  pressType: ButtonPressType,
  ev?: MouseEvent,
) {
  physButtonToEdit.value = button;
  startPhysicalButtonEdit(data, pressType, isSmallScreen.value, ev);
}

function buttonClick(button: DeviceButton) {
  if (isSmallScreen.value) {
    itemToModify.value = button;
  }
}

function editPressType(
  button: DeviceButton,
  data: DeviceButtonMapping,
  pressType: any,
  ev?: MouseEvent,
) {
  handleStartButtonEdit(data, button, pressType as ButtonPressType, ev);
}

function changePhysicalButtonEdit(msg: DeviceButtonMappingChange) {
  updatePhysicalButtonEdit(msg);
}

function startResetAllButtons() {
  dialogConfirmResetAll.value?.open();
}

function resetButtonAll(btn: DeviceButtonMapping | null = null) {
  if (btn != null && btn) {
    resetButton({ button: btn } as DeviceButtonMappingChange);
  }
}

function startResetButtonAll(item: DeviceButton) {
  itemToReset.value = item;
  dialogConfirmReset.value?.open();
}

function changeButton(msg: DeviceButtonMappingChange) {
  emit("changeButton", msg);
}

// Reset config for one button
function resetButton(msg: DeviceButtonMappingChange) {
  emit("resetButton", msg);
  itemToModify.value = null;
}

// Reset config for all buttons
function resetAllButtons() {
  emit("resetAllButtons");
}

function copy() {
  const entType = props.entityType as ClipboardParamEntityType;
  appState.setClipboard(
    props.entity.options.button_mapping,
    entType,
    "buttonMappingItems",
  );
}

async function startPaste(merging = false) {
  doMerging.value = merging;

  // In Activity
  if (props.entityType == EntityType.activity) {
    itemsToPaste.value = JSON.parse(
      JSON.stringify(appState.$state.clipboard.activity.buttonMappingItems),
    );

    // Check entities availability
    const entitiesIDsFromMapping = (itemsToPaste.value ?? [])
      .flatMap((item: DeviceButtonMapping) => [
        item.short_press?.entity_id,
        item.double_press?.entity_id,
        item.long_press?.entity_id,
      ])
      .filter((id: string | undefined): id is string => !!id);

    const uniqueEntitiesIDsFromMapping = [
      ...new Set(entitiesIDsFromMapping),
    ] as string[];
    const includedEntitiesIDs = (
      props.entity.options.included_entities ?? []
    ).map((item: IncludedEntity) => item.entity_id);
    missingEntitiesIDs.value = uniqueEntitiesIDsFromMapping.filter(
      (id) => !includedEntitiesIDs.includes(id),
    );

    if (missingEntitiesIDs.value.length > 0 && dialogMissingEntity.value) {
      try {
        allEntities.value = await integrationsStorage.getConfiguredEntities(
          null,
          false,
        );
        dialogMissingEntity.value?.open();
      } catch (e) {
        addErrorBottom(e);
      }
    } else {
      paste();
    }
  }
  // In Remote
  else if (props.entityType == EntityType.remote) {
    itemsToPaste.value = JSON.parse(
      JSON.stringify(appState.$state.clipboard.remote.buttonMappingItems),
    );

    // Check commands availability
    const commandsIDsFromMapping = getCommandIDs(itemsToPaste.value);

    const uniqueCommandsIDsFromMapping = [
      ...new Set(commandsIDsFromMapping),
    ] as string[];
    const includedCommandsIDs = (
      props.entity.options.simple_commands ?? []
    ).map((cmd: string) => cmd);
    const missingCommandsIDs =
      uniqueCommandsIDsFromMapping.filter(
        (id) => !includedCommandsIDs.includes(id),
      ) || [];

    const itemsAvailableCommands = filterOutMissingCommands(
      itemsToPaste.value,
      missingCommandsIDs,
    );
    const availableCommandsIDs = getCommandIDs(itemsAvailableCommands);

    itemsToPaste.value = itemsAvailableCommands;

    if (commandsIDsFromMapping.length > availableCommandsIDs.length) {
      const errMessage = {
        entType: EntityType.remote,
        noItems: availableCommandsIDs.length < 1,
        message:
          availableCommandsIDs.length < 1
            ? t(
                `customise_remote.pages.${
                  merging ? "merge" : "paste"
                }.errors.no_available_command`,
              )
            : t(
                `customise_remote.pages.${
                  merging ? "merge" : "paste"
                }.errors.not_fully_completed`,
              ),
      };

      paste(errMessage);
    } else {
      paste();
    }
  }
}

function getCommandIDs(items?: DeviceButtonMapping[]) {
  return (items ?? [])
    .flatMap((item: DeviceButtonMapping) => [
      item.short_press?.cmd_id,
      item.double_press?.cmd_id,
      item.long_press?.cmd_id,
    ])
    .filter((id: string | undefined): id is string => !!id);
}

async function paste(msg?: any) {
  if (!props.entity) {
    return;
  }

  saving.value = true;
  if (props.entityType == EntityType.activity) {
    if (doMerging.value) {
      try {
        (await activitiesStorage.allButtonsMerge(
          props.entity.entity_id,
          itemsToPaste.value,
        )) as Activity;

        emit("update");
      } catch (e) {
        addErrorBottom(e);
      }
    } else {
      try {
        (await activitiesStorage.allButtonsUpdate(
          props.entity.entity_id,
          itemsToPaste.value,
        )) as Activity;

        emit("update");
      } catch (e) {
        addErrorBottom(e);
      }
    }
  } else if (props.entityType == EntityType.remote) {
    if (msg && msg.noItems) {
      addErrorBottom(msg.message);
      return false;
    }

    if (doMerging.value) {
      try {
        await remotesStorage.allButtonsMerge(
          props.entity.entity_id,
          itemsToPaste.value,
        );

        emit("update");
      } catch (e) {
        addErrorBottom(e);
      }
    } else {
      try {
        await remotesStorage.allButtonsUpdate(
          props.entity.entity_id,
          itemsToPaste.value,
        );

        emit("update");
      } catch (e) {
        addErrorBottom(e);
      }
    }

    if (msg && msg.message) {
      addErrorBottom(msg.message);
    }
  }

  saving.value = false;
}

async function addMissingEntities() {
  if (!props.entity) {
    return;
  }

  const includedEntitiesIDs = (
    props.entity.options.included_entities ?? []
  ).map((item: IncludedEntity) => item.entity_id);
  const newValues = {
    options: {
      entity_ids: JSON.parse(
        JSON.stringify(includedEntitiesIDs.concat(missingEntitiesIDs.value)),
      ),
    },
  };

  saving.value = true;
  try {
    (await activitiesStorage.update(
      props.entity.entity_id,
      newValues,
    )) as Activity;

    emit("update");
    await paste();
  } catch (e) {
    addErrorBottom(e);
  }
  saving.value = false;
}

function filterOutMissingCommands(
  items: DeviceButtonMapping[],
  missingCommandsIDs: string[],
): DeviceButtonMapping[] {
  return items.map((item) => {
    const filteredItem: DeviceButtonMapping = { button: item.button };

    (Object.values(ButtonMappingPressType) as ButtonMappingPressType[]).forEach(
      (key) => {
        const cmdID = item[key]?.cmd_id;
        if (!cmdID || !missingCommandsIDs.includes(cmdID)) {
          filteredItem[key] = item[key];
        }
      },
    );

    return filteredItem;
  });
}

function goToPaste(item: DropdownItem) {
  if (item.value == "paste") {
    startPaste();
  }

  if (item.value == "merge") {
    startPaste(true);
  }
}

function isSaving() {
  return saving.value;
}

onMounted(async () => {
  setButtonList();

  try {
    deviceMeta.value = await config.getDeviceMeta();
  } catch (e) {
    console.error(e);
  }
});
</script>
<template>
  <div class="button-list">
    <div v-if="textInstruction" class="button-list__header">
      <p v-if="textInstruction" class="button-list__header__instruction">
        {{ textInstruction }}
      </p>
      <div class="button-list__header__actions">
        <DropdownMenu
          v-if="isActivePaste && hasConfiguredButton"
          :list-data="pasteDropdownItems"
          :on-right="true"
          @item-click="goToPaste"
        >
          <template #trigger>
            <button class="button button--secondary button--icon">
              <i class="fa-light fa-paste"></i>
            </button>
          </template>
        </DropdownMenu>
        <button
          v-else-if="isActivePaste"
          :title="$t('ui.paste')"
          class="button button--secondary button--icon"
          @click="startPaste()"
        >
          <i class="fa-light fa-paste"></i>
        </button>
        <button
          v-if="
            entity.options.button_mapping &&
            entity.options.button_mapping.length > 0
          "
          :title="$t('ui.copy')"
          class="button button--secondary"
          @click="copy"
        >
          <i class="fa-light fa-copy"></i>
        </button>
      </div>
    </div>
    <div v-overflow-indicator class="button-list__body">
      <ConfigTouchSlider
        v-if="isModel3 && isActivity"
        :entity="entity"
        :dangling-entities="danglingEntities"
        @item-mouse-over="$emit('highlightButton', getTouchSliderProps())"
        @item-mouse-leave="$emit('hideHighlightedButton')"
        @update="$emit('update')"
      />
      <ButtonListItem
        v-for="(button, itemIndex) in buttonLayouts"
        :key="'button-list-item-' + itemIndex"
        :button="button"
        :selected="getButtonValue(button) as DeviceButtonMapping"
        :entity="entity"
        :expanded="expanded"
        :dangling-entities="danglingEntities"
        @click="buttonClick(button)"
        @edit-press-type="
          (d, p, e) => {
            editPressType(button, d, p, e);
          }
        "
        @reset="resetButtonAll(getButtonValue(button))"
        @mouseover="$emit('highlightButton', button)"
        @mouseleave="$emit('hideHighlightedButton')"
      />
    </div>
    <div class="button-list__footer">
      <div class="button-list__actions">
        <button
          class="button button--tertiary button-expand"
          @click="toggleExpand"
        >
          <template v-if="expanded">
            <i class="fa-thin fa-compress"></i>
            {{ $t("ui.contract") }}
          </template>
          <template v-else>
            <i class="fa-thin fa-expand"></i>
            {{ $t("ui.expand") }}
          </template>
        </button>
        <button class="button button--tertiary" @click="startResetAllButtons">
          <i class="fa-thin fa-arrow-rotate-left"></i>
          {{ $t("ui.reset") }}
        </button>
      </div>
    </div>
  </div>
  <Teleport to="body">
    <ModalMinimal
      :show="itemToModify != null"
      :name="'modal-button-list-item-options'"
      :title="
        itemToModify != null ? translatedProperty(itemToModify?.name) : ''
      "
      class="modal-minimal--button-mapping-options"
      @close="itemToModify = null"
    >
      <div v-if="itemToModify != null" class="modal-minimal__list">
        <ButtonPress
          :type="'short'"
          :data="getButtonValue(itemToModify)?.short_press"
          :dangling="isDangling(getButtonValue(itemToModify)?.short_press)"
          :entity="entity"
          :in-modal="true"
          :title="$t('button_mapping.press.short_press')"
          :button-id="itemToModify?.button ?? ''"
          @edit="
            itemToModify != null &&
            editPressType(
              itemToModify,
              getButtonValue(itemToModify) as DeviceButtonMapping,
              ButtonMappingPressType.short_press,
            )
          "
        />
        <!--<ButtonPress
          @edit="itemToModify != null && editPressType(itemToModify, getButtonValue(itemToModify) as DeviceButtonMapping, ButtonMappingPressType.double_press)"
          :type="'double'"
          :data="getButtonValue(itemToModify)?.double_press"
          :dangling="isDangling(getButtonValue(itemToModify)?.double_press)"
          :entity="entity"
          :in-modal="isActivity"
          :title="$t('button_mapping.press.double_press')"
          :button-id="itemToModify?.button ?? ''"
        />
        <span>{{ $t("button_mapping.press.double_press") }}</span>-->
        <ButtonPress
          :type="'long'"
          :data="getButtonValue(itemToModify)?.long_press"
          :dangling="isDangling(getButtonValue(itemToModify)?.long_press)"
          :entity="entity"
          :in-modal="true"
          :title="$t('button_mapping.press.long_press')"
          :button-id="itemToModify?.button ?? ''"
          @edit="
            itemToModify != null &&
            editPressType(
              itemToModify,
              getButtonValue(itemToModify) as DeviceButtonMapping,
              ButtonMappingPressType.long_press,
            )
          "
        />
        <button
          v-if="itemToModify != null"
          @click="itemToModify != null && startResetButtonAll(itemToModify)"
        >
          <i class="fa-light fa-arrow-rotate-left"></i>
          <span>{{ $t("ui.reset_to_defaults") }}</span>
        </button>
      </div>
    </ModalMinimal>
  </Teleport>
  <Teleport to="body">
    <Transition :name="'opacity-fast'">
      <div v-show="physicalPopupOpen" class="edit-button-li-bg"></div>
    </Transition>
    <Transition name="popup-grow" @after-leave="onPhysicalPopupAfterLeave">
      <div
        v-if="physicalPopupOpen"
        class="edit-button-li-wrapper"
        :class="[
          { 'edit-button-li-wrapper--fixed': showFixedWrapper },
          `edit-button-li-popup--${entityType}`,
        ]"
        :style="popupLeft != null ? { left: popupLeft + 'px' } : undefined"
      >
        <EditButtonListItem
          v-if="editPhysicalButton"
          :settings="editPhysicalButton"
          :entity="entity"
          :entity-type="entityType"
          :button="physButtonToEdit || {}"
          :dangling="isDanglingEditPhysicalButton"
          @change="changeButton"
          @reset="resetButton"
          @close="closeButtonEdit"
        >
        </EditButtonListItem>
      </div>
    </Transition>
  </Teleport>
  <AppDialog
    ref="dialogConfirmReset"
    :title="$t('button_mapping.reset_more.title')"
    :text="$t('button_mapping.reset_more.question')"
    :submit-text="$t('ui.accept')"
    :cancel-text="$t('ui.cancel')"
    @submit="resetButtonAll(getButtonValue(itemToReset))"
  />
  <AppDialog
    ref="dialogConfirmResetAll"
    :title="$t('button_mapping.resetAll.title')"
    :text="$t('button_mapping.resetAll.question')"
    :submit-text="$t('ui.accept')"
    :cancel-text="$t('ui.cancel')"
    @submit="resetAllButtons"
  />
  <AppDialog
    ref="dialogMissingEntity"
    :markdown="true"
    :title="
      $t('entity.missing_entity.title', { count: missingEntitiesIDs.length })
    "
    :text="questionMissingEntity"
    :submit-text="
      $t('entity.missing_entity.add', { count: missingEntitiesIDs.length })
    "
    :cancel-text="$t('ui.cancel')"
    @submit="addMissingEntities"
  />
</template>
