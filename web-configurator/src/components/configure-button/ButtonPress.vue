<script setup lang="ts">
import { ref, computed, watch, onMounted, useTemplateRef } from "vue";

import ApiConnection from "@/api";

import type {
  ActivityFull,
  EntityCommandListItem,
  EntityCommandMetadata,
} from "@/types/activity";
import { EntityType } from "@/types/enums";

import translatedProperty from "@/composables/translatedProperty";
import { getAvailableCommandsForActivity } from "@/composables/activities";

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import AppDialog from "@/components/elements/AppDialog.vue";

const integrationsApi = ApiConnection.integrations;

const props = defineProps({
  type: {
    type: String,
    default: "short",
  },
  expanded: {
    type: Boolean,
    default: false,
  },
  mini: {
    type: Boolean,
    default: false,
  },
  data: {
    type: Object,
    default: null,
  },
  entity: {
    type: Object,
    default: null,
  },
  dangling: {
    type: Boolean,
    default: false,
  },
  testing: {
    type: Boolean,
    default: false,
  },
  inModal: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: "",
  },
  onlyIndicator: {
    type: Boolean,
    default: false,
  },
  buttonId: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["edit"]);

const integrationStorage = integrationsStore();
const commandMetadata = ref<EntityCommandMetadata[]>([]);
const allCommands = ref();
const dialogConfirmSelect = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogConfirmSelect",
);
const buttonPressMouseEvent = ref<MouseEvent | null>(null);

watch(
  () => props.entity,
  () => {
    setAllCommands();
  },
  // props.entity references a store entity that is updated in place by WS
  // events, so rebuild the command list on nested changes, not just replacement.
  { deep: true },
);

watch(
  () => integrationStorage.commands,
  (newVal) => {
    commandMetadata.value = newVal;
    setAllCommands();
  },
);

const isActive = computed(() => {
  return props.data != null;
});

const isActivity = computed(() => {
  return props.entity && props.entity.entity_type == EntityType.activity;
});

const hasTitle = computed(() => {
  return props.title.length > 0;
});

const mainClasses = computed(() => {
  let classList = "";

  classList += props.expanded ? `button-press--expanded-mode ` : "";
  classList += props.mini ? `button-press--mini-mode ` : "";
  classList +=
    props.type && props.type.length > 0 ? `button-press--${props.type} ` : "";
  classList += isActive.value ? `button-press--active ` : "";
  classList +=
    props.dangling && !props.expanded ? `button-press--dangling ` : "";
  classList += hasTitle.value ? `button-press--has-title ` : "";
  classList += props.onlyIndicator ? `button-press--indicator ` : "";

  return classList;
});

const showTesting = computed(() => {
  return (
    isActivity.value && (props.inModal || props.expanded) && isActive.value
  );
});

const showDangling = computed(() => {
  return props.dangling && ((!props.mini && props.expanded) || props.inModal);
});

function getCommandName(command_id: string | Record<string, any>) {
  const nameById = getCommandNameById(command_id);

  if (nameById) {
    return nameById;
  }

  return command_id;
}

function getCommandNameById(command_id: string | Record<string, any>) {
  const selected_command = commandMetadata.value.find((command) => {
    return command.id === command_id;
  });
  return translatedProperty(selected_command?.name);
}

function getEntityNameById(entity_id: string | Record<string, any>) {
  if (!allCommands.value || allCommands.value.length < 0) {
    return "";
  }

  const selected_command = allCommands.value.find(
    (command: EntityCommandListItem) => {
      return command.entity?.entity_id === entity_id;
    },
  );
  return translatedProperty(selected_command?.entity?.name);
}

async function executeCommand() {
  if (!props.data) {
    return;
  }

  try {
    await integrationsApi.executeEntityCommand(
      props.data.entity_id,
      props.data.cmd_id,
      props.data.params,
    );
  } catch (e) {
    addErrorBottom(e, "entity.execute_command");
  }
}

function setAllCommands() {
  if (props.entity == null) return false;

  allCommands.value = getAvailableCommandsForActivity(
    props.entity as ActivityFull,
    commandMetadata.value,
  ) as EntityCommandListItem[];
}

function edit(event: MouseEvent) {
  if (props.buttonId === "VOICE" && !props.mini && dialogConfirmSelect.value) {
    dialogConfirmSelect.value?.open();
    buttonPressMouseEvent.value = event;
    return;
  }

  emit("edit", event);
}

function doEdit() {
  if (buttonPressMouseEvent.value) {
    emit("edit", buttonPressMouseEvent.value);
  }
}

onMounted(async () => {
  if (props.entity != null) {
    try {
      commandMetadata.value = await integrationStorage.getCommandMetadata();
    } catch (e) {
      addErrorBottom(e);
    }

    setAllCommands();
  }
});
</script>
<template>
  <div class="button-press" :class="mainClasses" @click="edit">
    <div class="button-press__main">
      <span class="button-press__symbol"></span>
      <span v-if="expanded == true" class="button-press__command">
        <span v-if="data && data.cmd_id">{{
          getCommandName(data.cmd_id)
        }}</span>
        <template v-else>{{ $t("ui.none") }}</template>
        <span
          v-if="isActivity && data && data.entity_id && data.cmd_id"
          class="button-press__command__entity"
          >{{ getEntityNameById(data.entity_id) }}</span
        >
      </span>
    </div>
    <div v-if="hasTitle" class="button-press__title">{{ title }}</div>
    <div v-if="showDangling" class="button-press__dangling">
      <i class="fa-thin fa-skull-crossbones"></i>
    </div>
    <div v-else-if="showTesting" class="button-press__testing">
      <button
        class="button button--blank button--blank--focus button--icon"
        @click.stop="executeCommand"
      >
        <i class="fa-light fa-play"></i>
      </button>
    </div>
  </div>
  <AppDialog
    ref="dialogConfirmSelect"
    :title="$t('button_mapping.command.remap.title')"
    :text="$t('button_mapping.command.remap.question_voice')"
    :submit-text="$t('ui.accept')"
    :cancel-text="$t('ui.cancel')"
    :class="'dialog--confirm-command-select'"
    @submit="doEdit"
  />
</template>
