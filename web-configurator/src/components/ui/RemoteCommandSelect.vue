<script setup lang="ts">
import { ref, watch, useTemplateRef } from "vue";

import type { RemoteFull } from "@/types/remote";

import { isTouchEnabled } from "@/composables/device";

import UCSearch from "@/components/ui/UCSearch.vue";

import AppDialog from "@/components/elements/AppDialog.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";

const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  remote: {
    type: Object,
    required: true,
  },
  label: {
    type: Boolean,
    default: true,
  },
  button: {
    type: Object,
    default: null,
  },
});

defineExpose({
  focusSearch,
});

const emit = defineEmits(["select"]);

const allCommands = (props.remote as RemoteFull).options?.simple_commands || [];
const availableCommands = ref<string[]>(allCommands as string[]);

const searchCommand = ref("");

const commandToSelect = ref<string>();

const dialogConfirmSelect = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogConfirmSelect",
);

const elCommandSelect = useTemplateRef<HTMLDivElement>("elCommandSelect");

watch(searchCommand, () => {
  const filter = searchCommand.value.toLowerCase();
  availableCommands.value = allCommands.filter((command) => {
    return command.toLowerCase().includes(filter);
  });
});

function doCommandSelect(command: string | undefined) {
  if (command == undefined) {
    return;
  }

  emit("select", command);
  searchCommand.value = "";
}

function startCommandSelect(command: string) {
  if (props.button?.button == "BACK" || props.button?.button == "HOME") {
    commandToSelect.value = command;
    dialogConfirmSelect.value?.open();
    return;
  }

  doCommandSelect(command);
}

function focusSearch() {
  const searchField = elCommandSelect.value?.querySelector("input");
  if (!isTouchEnabled() && searchField) {
    searchField.focus();
  }
}
</script>
<template>
  <div ref="elCommandSelect" class="command-select">
    <ListWithFilter>
      <template #form>
        <UCSearch v-model="searchCommand" :small="true" :focus="false" />
      </template>
      <template #items>
        <div
          v-for="(command, index) in availableCommands"
          :key="`${command}-${index}`"
          class="command-select__item"
          @click="startCommandSelect(command)"
        >
          <h4>
            {{ command }}
          </h4>
        </div>
      </template>
    </ListWithFilter>
    <AppDialog
      ref="dialogConfirmSelect"
      :title="$t('button_mapping.command.remap.title')"
      :text="$t('button_mapping.command.remap.question')"
      :submit-text="$t('ui.accept')"
      :cancel-text="$t('ui.cancel')"
      :class="'dialog--confirm-command-select'"
      @submit="doCommandSelect(commandToSelect)"
    />
  </div>
</template>
