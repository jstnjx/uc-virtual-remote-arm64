<script setup lang="ts">
import { onMounted, ref, useTemplateRef, watch } from "vue";
import { storeToRefs } from "pinia";

import ApiConnection from "@/api";

import { SequenceType, ActiveSequenceState } from "@/types/enums";

import type { Macro, MacroFull } from "@/types/macro";
import type { CommandSequenceListItem } from "@/types/activity";

import type { CommandSequenceDelay, MsgRunningSequence } from "@/types/command";

import { macrosStore } from "@/stores/macros";
import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";
import {
  createSequenceForUpdate,
  sequencesToListItems,
} from "@/composables/activities";

import { useSequenceHandler } from "@/composables/sequence";

import Draggable from "vuedraggable";
import SequenceItem from "@/components/sequence/SequenceItem.vue";
import AddCommand from "@/components/sequence/AddCommand.vue";
import { deepClone } from "@/composables/dataHelper";

const integrationsApi = ApiConnection.integrations;

const initialActiveSequence = {
  state: "",
  steps: [],
  totalSteps: 0,
};

const storage = macrosStore();
const integrationStorage = integrationsStore();

const {
  activeSequence,
  updateActiveSequence,
  clearActiveSequence,
  hasActiveSequence,
  getSequenceItemStatus,
} = useSequenceHandler(initialActiveSequence);

const props = defineProps({
  macroId: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
});

const { configuredEntities: allEntities, commands: commandMetadata } =
  storeToRefs(integrationStorage);

const macro = ref<Macro | null>(null);

const sequence = ref<CommandSequenceListItem[]>(getSequenceCommands());

const assignedSequence = ref<CommandSequenceListItem[]>([]);

const loading = ref(false);
const saving = ref(false);

const elAddCommand =
  useTemplateRef<InstanceType<typeof AddCommand>>("elAddCommand");
const seqListBody = useTemplateRef<HTMLDivElement>("seqListBody");

const settingMacro = ref(false);

storage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    void (async () => {
      const { entity_id, event_type } = args[0];
      if (entity_id !== props.macroId) {
        return;
      }
      if (
        entity_id === props.macroId &&
        event_type === "CHANGE" &&
        args[0] &&
        args[0].new_state
      ) {
        if (saving.value) return;

        const newState = args[0].new_state;

        if (
          activeSequence.value.state === ActiveSequenceState.RUNNING &&
          newState.attributes &&
          newState.attributes.state
        ) {
          updateActiveSequence(newState.attributes as MsgRunningSequence);
        }

        if (
          activeSequence.value.state === ActiveSequenceState.RUNNING ||
          activeSequence.value.state === ActiveSequenceState.ERROR
        )
          return;

        if (props.active) {
          settingMacro.value = true;
          try {
            const newValue = await storage.getMacro(props.macroId);
            await setMacro(newValue);
          } catch (e) {
            addErrorBottom(e);
          }
          settingMacro.value = false;
        }
      }
    })();
  });
});

watch(
  () => props.active,
  (newVal, oldVal) => {
    if (newVal == true && oldVal == false) {
      loadMacro();
    }
  },
);

async function setMacro(newValue: Macro, onInit = false) {
  settingMacro.value = true;
  macro.value = newValue;

  if (onInit) {
    try {
      allEntities.value = await integrationStorage.getConfiguredEntities(
        null,
        true,
      );
      commandMetadata.value = await integrationStorage.getCommandMetadata();
    } catch (e) {
      addErrorBottom(e);
    }
  }

  sequence.value = getSequenceCommands();

  if (elAddCommand.value) {
    elAddCommand.value.updateEntity(macro.value as MacroFull);
  }

  settingMacro.value = false;
}

function getSequenceCommands() {
  if (!macro.value) {
    return [];
  }
  return sequencesToListItems(
    macro.value.options?.sequence || [],
    allEntities.value,
    commandMetadata.value,
  );
}

async function updateSequence(
  seq: CommandSequenceListItem,
  data: any,
  paramsExcluded: string[] = [],
) {
  const item = sequence.value[seq.pos];

  if (item.type === SequenceType.delay) {
    (item.sequence as CommandSequenceDelay).delay = data;
  } else {
    const params = JSON.parse(
      JSON.stringify((item.sequence as any).command.params ?? {}),
    );

    const dataArray = Array.isArray(data) ? data : [data];

    dataArray.forEach((param) => {
      if (param?.paramName) {
        params[param.paramName] = param.paramValue;
      }
    });

    if (paramsExcluded.length > 0) {
      paramsExcluded.forEach((key) => {
        delete params[key];
      });
    }

    (item.sequence as any).command = {
      cmd_id: seq.cmd?.id,
      entity_id: seq.entity?.entity_id,
      params,
    };
  }

  await saveMacro();
}

function showAvSequences() {
  elAddCommand.value?.open();
}

async function saveMacro() {
  if (!macro.value) {
    return;
  }

  saving.value = true;

  const entity_ids =
    (macro.value.options?.included_entities ?? []).map((entity) => {
      return entity.entity_id;
    }) ?? [];

  const modifiedOptions = {
    ...macro.value.options,
    sequence: createSequenceForUpdate(sequence.value, entity_ids || []),
  };

  const modifiedMacro = {
    ...macro.value,
    options: modifiedOptions,
  };

  try {
    await storage.update(macro.value.entity_id, modifiedMacro);
  } catch (e) {
    addErrorBottom(e, "macro.sequence.update");
    await loadMacro();
  }

  try {
    const newValue = await storage.getMacro(props.macroId);
    await setMacro(newValue);
  } catch (e) {
    addErrorBottom(e);
    await loadMacro();
  }

  saving.value = false;
}

async function saveSequences() {
  saveMacro();
}

function assignAllItems(array: CommandSequenceListItem[]) {
  assignedSequence.value = [];
  array.forEach((obj) => {
    assignedSequence.value.push(obj);
  });
}

function deAssignAllItems() {
  assignedSequence.value = [];
}

function isAssignedItem(sequence: CommandSequenceListItem) {
  return (
    assignedSequence.value.findIndex(
      (s: CommandSequenceListItem) => s.pos === sequence.pos,
    ) > -1
  );
}

function toggleItemCheckbox(sequence: CommandSequenceListItem) {
  const itemIndex = assignedSequence.value.findIndex(
    (s: CommandSequenceListItem) => s.pos === sequence.pos,
  );
  if (itemIndex > -1) {
    assignedSequence.value.splice(itemIndex, 1);
  } else {
    assignedSequence.value.push(sequence);
  }
}

function deleteItem(seq: CommandSequenceListItem) {
  let filteredArray = [];

  filteredArray = sequence.value.filter((obj1) => obj1.pos != seq.pos);
  sequence.value = filteredArray;
  assignedSequence.value = [];

  saveSequences();
}

function deleteItems() {
  let filteredArray = [];

  filteredArray = sequence.value.filter(
    (obj1) => !assignedSequence.value.some((obj2) => obj2.pos === obj1.pos),
  );
  sequence.value = filteredArray;
  assignedSequence.value = [];
  saveSequences();
}

function addCommand(item: CommandSequenceListItem) {
  sequence.value.push(item);

  saveSequences();
  elAddCommand.value?.close();
}

async function runSequence(type: "run") {
  if (!type) return;
  try {
    activeSequence.value = deepClone(initialActiveSequence);
    activeSequence.value.state = ActiveSequenceState.RUNNING;
    activeSequence.value.type = type;
    await integrationsApi.executeEntityCommand(props.macroId, "run");
  } catch (e) {
    addErrorBottom(e);
    activeSequence.value.state = ActiveSequenceState.ERROR;
  }
}

async function loadMacro() {
  try {
    loading.value = true;
    const newValue = await storage.getMacro(props.macroId);
    await setMacro(newValue, true);
    loading.value = false;
  } catch (e) {
    addErrorBottom(e);
  }
}

onMounted(async () => {
  if (props.active) {
    await loadMacro();
  }
});
</script>
<template>
  <div class="ep-sequences">
    <div class="ep-sequences__list panel-col">
      <div class="sequence-list">
        <div class="sequence-list__header">
          <div
            class="sequence-list__header__row sequence-list__header__row--descr-mobile"
          >
            <p class="sequence-list__header__description">
              {{ $t("sequence.sequence.description") }}
            </p>
          </div>
          <div
            class="sequence-list__header__row sequence-list__header__row--title"
          >
            <div class="sequence-list__header__base-items">
              <h2>{{ $t("sequence.sequence.title") }}</h2>
              <template v-if="activeSequence.type === 'run'">
                <img
                  v-if="activeSequence.state === ActiveSequenceState.RUNNING"
                  src="/images/loading-indicator.png"
                  :alt="$t('entity.state.running')"
                  class="img-loading img-loading--base"
                />
                <template
                  v-else-if="activeSequence.state === ActiveSequenceState.ERROR"
                >
                  <i
                    class="fa-light fa-exclamation sequence-list__icon sequence-list__icon--error"
                  ></i>
                  <button
                    class="button button--secondary button--small"
                    @click="clearActiveSequence"
                  >
                    {{ $t("ui.back_to_edit") }}
                  </button>
                </template>
                <i
                  v-else-if="activeSequence.state === ActiveSequenceState.DONE"
                  class="fa-light fa-check sequence-list__icon"
                ></i>
              </template>
              <button
                v-else
                :disabled="sequence.length < 1 || hasActiveSequence()"
                class="button button--secondary button--icon"
                @click="runSequence('run')"
              >
                <i class="fa-regular fa-play"></i>
              </button>
            </div>
            <div class="sequence-list__header__triggers">
              <button
                :disabled="hasActiveSequence()"
                class="button button--secondary button--icon"
                @click="showAvSequences"
              >
                <i class="fa-light fa-plus"></i>
              </button>
              <button
                v-if="
                  sequence.length === assignedSequence.length &&
                  assignedSequence.length > 0
                "
                :disabled="hasActiveSequence()"
                class="button button--secondary button--icon button-assign"
                @click="deAssignAllItems"
              >
                <i class="fa-light fa-xmark"></i>
              </button>
              <button
                v-else-if="sequence.length > 0"
                :disabled="hasActiveSequence()"
                class="button button--secondary button--icon button-assign"
                @click="assignAllItems(sequence)"
              >
                <i class="fa-light fa-check"></i>
              </button>
              <button
                :disabled="assignedSequence.length < 1 || hasActiveSequence()"
                class="button button--secondary button--icon"
                @click="deleteItems"
              >
                <i class="fa-light fa-trash"></i>
              </button>
            </div>
          </div>
          <div
            class="sequence-list__header__row sequence-list__header__row--descr-desktop"
          >
            <p class="sequence-list__header__description">
              {{ $t("sequence.sequence.description") }}
            </p>
          </div>
        </div>
        <div ref="seqListBody" class="sequence-list__body">
          <Draggable
            v-if="!loading && sequence.length > 0"
            v-model="sequence"
            v-overflow-indicator
            class="sequence-list__items"
            :group="'sequence-macro'"
            :force-fallback="true"
            item-key="id"
            handle=".sequence-item__drag"
            @change="saveSequences"
          >
            <template #item="{ element, index }">
              <SequenceItem
                :item="element"
                :selected="isAssignedItem(element)"
                :status="getSequenceItemStatus(index)"
                @toggle-checkbox="
                  (msg: CommandSequenceListItem) => toggleItemCheckbox(msg)
                "
                @change="updateSequence"
                @delete="(msg: CommandSequenceListItem) => deleteItem(msg)"
              />
            </template>
          </Draggable>
          <Transition name="opacity-fast">
            <div
              v-show="sequence.length < 1 && !loading"
              class="sequence-list__no-command"
            >
              <h3>{{ $t("sequence.add_first") }}</h3>
              <p>
                {{ $t("sequence.sequence.empty") }}
                {{ $t("sequence.add_first_btn_below") }}
              </p>
              <button
                class="button button--primary button--hybrid button--hybrid--reversed"
                @click="showAvSequences"
              >
                {{ $t("ui.add") }}
                <i class="fa-light fa-plus"></i>
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>
    <AddCommand
      v-if="macro"
      ref="elAddCommand"
      :entity="macro"
      :command-metadata="commandMetadata"
      :setting="settingMacro"
      @add-command="addCommand"
    />
  </div>
</template>
