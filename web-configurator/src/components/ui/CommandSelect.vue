<script setup lang="ts">
import { ref, computed, watch, useTemplateRef } from "vue";

import type { IntegrationInstance } from "@/types/integrationInstance";

import type {
  ActivityFull,
  EntityCommandListItem,
  CommandParameter,
  IncludedEntity,
} from "@/types/activity";

import { getAvailableCommandsForActivity } from "@/composables/activities";
import { isTouchEnabled } from "@/composables/device";
import { getDefaultEntityIcon } from "@/composables/entity";
import { useTiming } from "@/composables/timing";

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import translatedProperty, {
  searchLanguageText,
} from "@/composables/translatedProperty";

import UCSearch from "@/components/ui/UCSearch.vue";

import AppDialog from "@/components/elements/AppDialog.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import EntityListItem from "@/components/elements/entity/EntityListItem.vue";
import { deepClone } from "@/composables/dataHelper";

const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  activity: {
    type: Object,
    required: true,
  },
  labelText: {
    type: String,
    default: "",
  },
  labelIcon: {
    type: String,
    default: "",
  },
  button: {
    type: Object,
    default: null,
  },
});

defineExpose({
  open,
});

const integrationStorage = integrationsStore();
const { sleep } = useTiming();

const emit = defineEmits(["select"]);

const instances = computed<IntegrationInstance[]>(
  () => integrationStorage.instances,
);
const commandMetadata = ref();
const allCommands = ref<EntityCommandListItem[]>([]);

const searchCommand = ref("");
const searchEntity = ref("");

const commandToSelect = ref<EntityCommandListItem>();

// const showCommandSelect = ref(false);
const dialogConfirmSelect = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogConfirmSelect",
);

const elCommandSelect = useTemplateRef<HTMLDivElement>("elCommandSelect");
const elCommandEntitySelect = useTemplateRef<HTMLDivElement>(
  "elCommandEntitySelect",
);
const showAssignCommand = ref();

const showFilterEntity = ref(false);
const filteredEntity = ref<IncludedEntity | null>(null);
const direction = ref("slide-item-left");

watch(showAssignCommand, (val) => {
  if (val == false) {
    showFilterEntity.value = false;
    filteredEntity.value = null;
    searchCommand.value = "";
    searchEntity.value = "";
  }
});

const availableCommands = computed(() => {
  const filter = searchCommand.value.toLowerCase();

  return allCommands.value.filter((command: EntityCommandListItem) => {
    if (filteredEntity.value) {
      if (
        !command.entity ||
        command.entity.entity_id !== filteredEntity.value.entity_id
      ) {
        return false;
      }
    }

    // When changing filter properties, keep them in sync with the filter in sequence/AddCommand.vue
    return (
      command.type?.toLowerCase().includes(filter) ||
      (command.cmd?.name && searchLanguageText(command.cmd.name, filter)) ||
      (filteredEntity.value == null &&
        ((command.entity?.name &&
          searchLanguageText(command.entity?.name, filter)) ||
          (command.entity?.entity_type ?? "").toLowerCase().includes(filter) ||
          (command.entity?.entity_id ?? "").toLowerCase().includes(filter)))
    );
  });
});

const availableEntities = computed(() => {
  const entities = allCommands.value
    .map((cmd) => cmd.entity)
    .filter((e): e is IncludedEntity => !!e);

  const unique = new Map(entities.map((entity) => [entity.entity_id, entity]));
  const uniqueEntities = Array.from(unique.values());
  return uniqueEntities.filter((e: IncludedEntity) => {
    return (
      (e && e.name && searchLanguageText(e.name, searchEntity.value)) ||
      ((e && e.entity_id) || "").toLowerCase().includes(searchEntity.value)
    );
  });
});

async function loadData() {
  try {
    commandMetadata.value = await integrationStorage.getCommandMetadata();
  } catch (e) {
    addErrorBottom(e);
  }
  allCommands.value = getAvailableCommandsForActivity(
    props.activity as ActivityFull,
    commandMetadata.value,
  ) as EntityCommandListItem[];
}

function doCommandSelect(command: EntityCommandListItem | undefined) {
  if (command == undefined) {
    return;
  }

  const newCommand: EntityCommandListItem = deepClone(command);

  //Convert array -> object to solve issue: https://github.com/unfoldedcircle/web-configurator/issues/114
  if (command.cmd && command.cmd.params && command.cmd.params.length > 0) {
    const objParams: CommandParameter = {};
    command.cmd.params.forEach((p: CommandParameter) => {
      objParams[p.param] = p;
    });
    newCommand.cmd.params = objParams;
  } else if (
    command.cmd &&
    command.cmd.params &&
    typeof command.cmd.params === "object" &&
    command.cmd.params !== null
  ) {
    newCommand.cmd.params = command.cmd.params;
  }

  emit("select", newCommand);
  // showCommandSelect.value = false;
  searchCommand.value = "";
}

// function showCommandSelectOption(button: null | Record<string, any>) {
//   if (button?.button == "BACK" || button?.button == "HOME") {
//     confirmModal.value = true;
//     return;
//   }

//   showCommandSelect.value = true;
// }

function startCommandSelect(command: EntityCommandListItem) {
  if (
    (props.button?.button == "BACK" || props.button?.button == "HOME") &&
    props.value.length < 1
  ) {
    commandToSelect.value = command;
    dialogConfirmSelect.value?.open();
    return;
  }

  doCommandSelect(command);
}

function focusCommandSearch() {
  const searchField = elCommandSelect.value?.querySelector("input");
  if (!isTouchEnabled() && searchField) {
    searchField.focus();
  }
}

async function focusEntitySearch() {
  await sleep(800);
  const searchField = elCommandEntitySelect.value?.querySelector("input");
  if (!isTouchEnabled() && searchField) {
    searchField.focus();
  }
}

function filterEntity(e: IncludedEntity) {
  filteredEntity.value = e;
  closeFilterEntity();
}

function openFilterEntity() {
  direction.value = "slide-item-left";
  showFilterEntity.value = true;
  focusEntitySearch();
}

function closeFilterEntity() {
  direction.value = "slide-item-right";
  showFilterEntity.value = false;
  searchEntity.value = "";
}

async function open() {
  loadData();
  showAssignCommand.value = true;
  focusCommandSearch();

  try {
    await integrationStorage.getInstances();
  } catch (e) {
    addErrorBottom(e);
  }
}
</script>
<template>
  <Teleport to="body">
    <ModalSecondary
      :show="showAssignCommand == true"
      :width="'26.25rem'"
      :name="'modal-assign-command'"
      class="modal-secondary--assign-command"
      @close="showAssignCommand = false"
    >
      <template #header>
        <div class="modal-secondary__header__content">
          <h2>{{ $t("command.assign.title") }}</h2>
          <span v-if="labelText.length > 0">{{ labelText }}</span>
          <SelectedIcon
            v-else-if="labelIcon.length > 0"
            :icon="labelIcon"
            :thin="true"
          />
        </div>
      </template>
      <hr />
      <Transition :name="direction">
        <div
          v-show="showFilterEntity == false"
          ref="elCommandSelect"
          class="command-select command-select--extended"
          :class="{
            'command-select--extended--filtered-entity': filteredEntity != null,
          }"
        >
          <div class="command-select__header">
            <template v-if="filteredEntity != null">
              <div class="command-select__header__content">
                <SelectedIcon
                  :icon="getDefaultEntityIcon(filteredEntity)"
                  :thin="true"
                />
                <span>{{ translatedProperty(filteredEntity.name) }}</span>
              </div>
              <button
                class="button button--secondary button--icon button--icon--medium"
                @click="filteredEntity = null"
              >
                <i class="fa-light fa-filter-circle-xmark"></i>
              </button>
            </template>
            <template v-else>
              <span>{{ $t("command.assign.showing_all_commands") }}</span>
              <button
                class="button button--secondary button--icon button--icon--medium"
                @click="openFilterEntity"
              >
                <i class="fa-light fa-filter"></i>
              </button>
            </template>
          </div>
          <ListWithFilter>
            <template #form>
              <UCSearch
                v-model="searchCommand"
                :small="true"
                :focus="true"
                :gray="true"
              />
            </template>
            <template #items>
              <div
                v-for="(command, index) in availableCommands"
                :key="`${command.cmd?.id}-${command.cmd?.cmd_id}-${index}`"
                class="command-select__item"
                @click="startCommandSelect(command)"
              >
                <SelectedIcon
                  v-if="command.entity?.integration?.icon"
                  :key="`${command.entity?.entity_id}-${command.cmd?.cmd_id}-${index}`"
                  class="command-select__item__icon"
                  :icon="command.entity.integration.icon"
                />
                <h4 v-if="command.cmd && translatedProperty(command.cmd?.name)">
                  {{ translatedProperty(command.cmd.name) }}
                  <template v-if="translatedProperty(command.entity?.name)">
                    <span class="command-select__item__entity-name">{{
                      translatedProperty(command.entity?.name)
                    }}</span>
                  </template>
                </h4>
                <span class="command-select__item__arrow">
                  <i class="fa-light fa-arrow-right"></i>
                </span>
              </div>
            </template>
          </ListWithFilter>
        </div>
      </Transition>

      <Transition :name="direction">
        <div
          v-show="showFilterEntity == true"
          ref="elCommandEntitySelect"
          class="command-entity-select"
        >
          <div class="command-entity-select__header">
            <button
              class="button button--secondary button--icon button--icon--medium"
              @click="closeFilterEntity"
            >
              <i class="fa-light fa-arrow-left"></i>
            </button>
            <span>{{ $t("command.assign.select_an_entity") }}</span>
          </div>

          <ListWithFilter>
            <template #form>
              <UCSearch
                v-model="searchEntity"
                :small="true"
                :focus="true"
                :gray="true"
              />
            </template>
            <template #items>
              <div
                v-for="(ent, index) in availableEntities"
                :key="index"
                class="entity-item"
                @click="filterEntity(ent)"
              >
                <EntityListItem
                  :list-item="ent"
                  :integration-info="true"
                  :inactive="true"
                  :instances="instances"
                />
              </div>
            </template>
          </ListWithFilter>
        </div>
      </Transition>
    </ModalSecondary>
  </Teleport>
  <AppDialog
    ref="dialogConfirmSelect"
    :title="$t('button_mapping.command.remap.title')"
    :text="$t('button_mapping.command.remap.question')"
    :submit-text="$t('ui.accept')"
    :cancel-text="$t('ui.cancel')"
    :class="'dialog--confirm-command-select'"
    @submit="doCommandSelect(commandToSelect)"
  />
</template>
