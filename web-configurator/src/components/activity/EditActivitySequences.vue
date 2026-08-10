<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import { useTranslation } from "i18next-vue";
import { storeToRefs } from "pinia";

import ApiConnection from "@/api";

import { SequenceType, ActiveSequenceState } from "@/types/enums";
import type {
  Activity,
  ActivityFull,
  CommandSequenceListItem,
} from "@/types/activity";

import type {
  CommandSequence,
  CommandSequenceDelay,
  MsgRunningSequence,
} from "@/types/command";

import { activitiesStore } from "@/stores/activities";
import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";
import {
  createSequenceForUpdate,
  sequencesToListItems,
} from "@/composables/activities";

import { deepClone, useDataHelper } from "@/composables/dataHelper";
import { useWindowDimension } from "@/composables/windowDimension";
import { useSequenceHandler } from "@/composables/sequence";

import Draggable from "vuedraggable";
import UCSelect from "@/components/ui/UCSelect.vue";
import SequenceItem from "@/components/sequence/SequenceItem.vue";
import AddCommand from "@/components/sequence/AddCommand.vue";

const integrationsApi = ApiConnection.integrations;

const initialActiveSequence = {
  type: null,
  state: "",
  steps: [],
  totalSteps: 0,
};

const { t } = useTranslation();
const { updateExistingObjectKeys, isNonEmptyObject } = useDataHelper();
const { isSmallScreen } = useWindowDimension();

const storage = activitiesStore();
const integrationStorage = integrationsStore();

const {
  activeSequence,
  updateActiveSequence,
  clearActiveSequence,
  hasActiveSequence,
  getSequenceItemStatus,
} = useSequenceHandler(initialActiveSequence);

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

const { configuredEntities: allEntities, commands: commandMetadata } =
  storeToRefs(integrationStorage);

const activity = ref<Activity | null>(null);

const sequenceOn = ref<CommandSequenceListItem[]>(getSequenceCommandsOn());
const sequenceOff = ref<CommandSequenceListItem[]>(getSequenceCommandsOff());

const assignedSequenceOn = ref<CommandSequenceListItem[]>([]);
const assignedSequenceOff = ref<CommandSequenceListItem[]>([]);

const loading = ref(false);
const saving = ref(false);

const addCommandTo = ref("on");

const elAddCommand =
  useTemplateRef<InstanceType<typeof AddCommand>>("elAddCommand");
const seqOnListBody = useTemplateRef<HTMLDivElement>("seqOnListBody");
const seqOffListBody = useTemplateRef<HTMLDivElement>("seqOffListBody");

const settingActivity = ref(false);

// computed, not a ref: t() only re-runs on a language change when it is read
// inside a tracked scope. The selected entry keeps its own (frozen) label, but
// UCSelect displays the one from `options`.
const menuItems = computed(() => [
  { value: "on_sequence", label: t("sequence.on_sequence.title") },
  { value: "off_sequence", label: t("sequence.off_sequence.title") },
]);

const activeMobileList = ref({
  value: "on_sequence",
  label: t("sequence.on_sequence.title"),
});

storage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    const { entity_id, event_type } = args[0];
    if (entity_id !== props.activityId) {
      return;
    }
    if (
      entity_id === props.activityId &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      if (saving.value) return false;

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
        return false;

      if (props.active) {
        settingActivity.value = true;
        const updActivity = updateExistingObjectKeys(
          deepClone(activity.value!),
          newState,
        );
        setActivity(updActivity);
        settingActivity.value = false;
      }
    }
  });
});

watch(
  () => props.active,
  (newVal, oldVal) => {
    if (newVal == true && oldVal == false) {
      loadActivity();
    }
  },
);

async function setActivity(newValue: Activity | undefined, onInit = false) {
  if (!newValue || !isNonEmptyObject(newValue)) {
    return false;
  }

  settingActivity.value = true;
  activity.value = newValue as Activity;

  if (onInit) {
    try {
      await integrationStorage.getConfiguredEntities(null, true);
      await integrationStorage.getCommandMetadata();
    } catch (e) {
      addErrorBottom(e);
    }
  }

  sequenceOn.value = getSequenceCommandsOn();
  sequenceOff.value = getSequenceCommandsOff();

  if (elAddCommand.value) {
    elAddCommand.value.updateEntity(activity.value as ActivityFull);
    elAddCommand.value.close();
  }

  settingActivity.value = false;
}

function getSequenceCommandsOn() {
  if (!activity.value) {
    return [];
  }
  const sequences = activity.value.options?.sequences?.on || [];
  return getSequenceCommands(sequences, "on");
}

function getSequenceCommandsOff() {
  if (!activity.value) {
    return [];
  }
  const sequences = activity.value.options?.sequences?.off || [];
  return getSequenceCommands(sequences, "off");
}

function getSequenceCommands(
  sequences: CommandSequence[],
  list: string,
): CommandSequenceListItem[] {
  return sequencesToListItems(
    sequences,
    allEntities.value,
    commandMetadata.value,
  ).map((item) => {
    return {
      ...item,
      list,
    };
  });
}

async function updateSequence(
  sequence: CommandSequenceListItem,
  data: any,
  paramsExcluded: string[] = [],
) {
  const list = (sequence.list === "on" ? sequenceOn : sequenceOff).value;
  const item = list[sequence.pos];

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
      cmd_id: sequence.cmd?.id,
      entity_id: sequence.entity?.entity_id,
      params,
    };
  }

  await saveActivity();
}

function showAvSequences(type: string) {
  addCommandTo.value = type;
  elAddCommand.value?.open();
}

async function saveActivity() {
  if (!activity.value) {
    return;
  }
  saving.value = true;

  const entity_ids = (activity.value.options?.included_entities ?? []).map(
    (entity) => {
      return entity.entity_id;
    },
  );

  const modifiedOptions = {
    ...activity.value.options,
    sequences: {
      on: createSequenceForUpdate(sequenceOn.value, entity_ids || []),
      off: createSequenceForUpdate(sequenceOff.value, entity_ids || []),
    },
  };

  const modifiedActivity = {
    ...activity.value,
    options: modifiedOptions,
  };
  try {
    await storage.update(activity.value.entity_id, modifiedActivity);
  } catch (e) {
    addErrorBottom(e, "activity.sequences.update");
    await loadActivity();
  }

  try {
    const newValue = await storage.getActivity(props.activityId);
    await setActivity(newValue);
  } catch (e) {
    addErrorBottom(e);
    await loadActivity();
  }

  saving.value = false;
}

async function saveSequences() {
  saveActivity();
}

function assignAllItems(array: CommandSequenceListItem[], isOn = true) {
  if (isOn) {
    assignedSequenceOn.value = [];
    array.forEach((obj) => {
      assignedSequenceOn.value.push(obj);
    });
  } else {
    assignedSequenceOff.value = [];
    array.forEach((obj) => {
      assignedSequenceOff.value.push(obj);
    });
  }
}

function deAssignAllItems(isOn = true) {
  if (isOn) {
    assignedSequenceOn.value = [];
  } else {
    assignedSequenceOff.value = [];
  }
}

function isAssignedItem(sequence: CommandSequenceListItem, isOn = true) {
  if (isOn) {
    return (
      assignedSequenceOn.value.findIndex(
        (s: CommandSequenceListItem) => s.pos === sequence.pos,
      ) > -1
    );
  } else {
    return (
      assignedSequenceOff.value.findIndex(
        (s: CommandSequenceListItem) => s.pos === sequence.pos,
      ) > -1
    );
  }
}

function toggleItemCheckbox(sequence: CommandSequenceListItem, isOn = true) {
  if (isOn) {
    const itemIndex = assignedSequenceOn.value.findIndex(
      (s: CommandSequenceListItem) => s.pos === sequence.pos,
    );
    if (itemIndex > -1) {
      assignedSequenceOn.value.splice(itemIndex, 1);
    } else {
      assignedSequenceOn.value.push(sequence);
    }
  } else {
    const itemIndex = assignedSequenceOff.value.findIndex(
      (s: CommandSequenceListItem) => s.pos === sequence.pos,
    );
    if (itemIndex > -1) {
      assignedSequenceOff.value.splice(itemIndex, 1);
    } else {
      assignedSequenceOff.value.push(sequence);
    }
  }
}

function deleteItem(seq: CommandSequenceListItem, isOn = true) {
  let filteredArray = [];

  if (isOn) {
    filteredArray = sequenceOn.value.filter((obj1) => obj1.pos != seq.pos);
    sequenceOn.value = filteredArray;
    assignedSequenceOn.value = [];
  } else {
    filteredArray = sequenceOff.value.filter((obj1) => obj1.pos != seq.pos);
    sequenceOff.value = filteredArray;
    assignedSequenceOff.value = [];
  }
  saveSequences();
}

function deleteItems(isOn = true) {
  let filteredArray = [];
  if (isOn) {
    filteredArray = sequenceOn.value.filter(
      (obj1) => !assignedSequenceOn.value.some((obj2) => obj2.pos === obj1.pos),
    );
    sequenceOn.value = filteredArray;
    assignedSequenceOn.value = [];
  } else {
    filteredArray = sequenceOff.value.filter(
      (obj1) =>
        !assignedSequenceOff.value.some((obj2) => obj2.pos === obj1.pos),
    );
    sequenceOff.value = filteredArray;
    assignedSequenceOff.value = [];
  }
  saveSequences();
}

function addCommand(item: CommandSequenceListItem) {
  if (addCommandTo.value == "on") {
    sequenceOn.value.push(item);
  } else {
    sequenceOff.value.push(item);
  }
  saveSequences();
  elAddCommand.value?.close();
}

async function runSequence(type: "on" | "off") {
  if (!type) return;
  try {
    activeSequence.value = deepClone(initialActiveSequence);
    activeSequence.value.state = ActiveSequenceState.RUNNING;
    activeSequence.value.type = type;
    await integrationsApi.executeEntityCommand(props.activityId, type);
  } catch (e) {
    addErrorBottom(e);
    activeSequence.value.state = ActiveSequenceState.ERROR;
  }
}

async function loadActivity() {
  loading.value = true;
  try {
    const newValue = await storage.getActivity(props.activityId);
    await setActivity(newValue, true);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
}

onMounted(async () => {
  if (props.active) {
    loadActivity();
  }
});
</script>
<template>
  <div class="ep-sequences ep-sequences--activity">
    <div class="ep-sequences__selector">
      <UCSelect
        v-model="activeMobileList"
        :options="menuItems"
        :position="'center'"
        :light="true"
        :disabled="hasActiveSequence()"
      />
      <template
        v-if="
          activeSequence.type ===
          (activeMobileList.value == 'on_sequence' ? 'on' : 'off')
        "
      >
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
            class="button button--secondary button--small sequence-list__button"
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
        :disabled="
          activeMobileList.value == 'on_sequence'
            ? sequenceOn.length < 1
            : sequenceOff.length < 1
        "
        class="button button--secondary button--icon"
        @click="
          runSequence(activeMobileList.value == 'on_sequence' ? 'on' : 'off')
        "
      >
        <i class="fa-regular fa-play"></i>
      </button>
    </div>
    <div
      v-if="!isSmallScreen || activeMobileList.value == 'on_sequence'"
      class="ep-sequences__list panel-col"
    >
      <div class="sequence-list">
        <div class="sequence-list__header">
          <div
            class="sequence-list__header__row sequence-list__header__row--descr-mobile"
          >
            <p class="sequence-list__header__description">
              {{ $t("sequence.on_sequence.description") }}
            </p>
          </div>
          <div
            class="sequence-list__header__row sequence-list__header__row--title"
          >
            <div class="sequence-list__header__base-items">
              <h2>{{ $t("sequence.on_sequence.title") }}</h2>
              <template v-if="activeSequence.type === 'on'">
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
                :disabled="sequenceOn.length < 1 || hasActiveSequence()"
                class="button button--secondary button--icon"
                @click="runSequence('on')"
              >
                <i class="fa-regular fa-play"></i>
              </button>
            </div>
            <div class="sequence-list__header__triggers">
              <button
                :disabled="hasActiveSequence('on')"
                class="button button--secondary button--icon"
                @click="showAvSequences('on')"
              >
                <i class="fa-light fa-plus"></i>
              </button>
              <button
                v-if="
                  sequenceOn.length === assignedSequenceOn.length &&
                  assignedSequenceOn.length > 0
                "
                :disabled="hasActiveSequence('on')"
                class="button button--secondary button--icon button-assign"
                @click="deAssignAllItems(true)"
              >
                <i class="fa-light fa-xmark"></i>
              </button>
              <button
                v-else-if="sequenceOn.length > 0"
                :disabled="hasActiveSequence('on')"
                class="button button--secondary button--icon button-assign"
                @click="assignAllItems(sequenceOn, true)"
              >
                <i class="fa-light fa-check"></i>
              </button>
              <button
                :disabled="
                  assignedSequenceOn.length < 1 || hasActiveSequence('on')
                "
                class="button button--secondary button--icon"
                @click="deleteItems(true)"
              >
                <i class="fa-light fa-trash"></i>
              </button>
            </div>
          </div>
          <div
            class="sequence-list__header__row sequence-list__header__row--descr-desktop"
          >
            <p class="sequence-list__header__description">
              {{ $t("sequence.on_sequence.description") }}
            </p>
          </div>
        </div>
        <div ref="seqOnListBody" class="sequence-list__body">
          <Draggable
            v-if="!loading && sequenceOn.length > 0"
            v-model="sequenceOn"
            v-overflow-indicator
            class="sequence-list__items"
            :group="'sequence-on'"
            :force-fallback="true"
            item-key="id"
            handle=".sequence-item__drag"
            @change="saveSequences"
          >
            <template #item="{ element, index }">
              <SequenceItem
                :item="element"
                :selected="isAssignedItem(element, true)"
                :status="getSequenceItemStatus(index, 'on')"
                @toggle-checkbox="
                  (msg: CommandSequenceListItem) =>
                    toggleItemCheckbox(msg, true)
                "
                @change="updateSequence"
                @delete="
                  (msg: CommandSequenceListItem) => deleteItem(msg, true)
                "
              />
            </template>
          </Draggable>
          <Transition name="opacity-fast">
            <div
              v-show="sequenceOn.length < 1 && !loading"
              class="sequence-list__no-command"
            >
              <h3>{{ $t("sequence.add_first") }}</h3>
              <p>
                {{ $t("sequence.on_sequence.empty") }}
                {{ $t("sequence.add_first_btn_below") }}
              </p>
              <button
                class="button button--primary button--hybrid button--hybrid--reversed"
                @click="showAvSequences('on')"
              >
                {{ $t("ui.add") }}
                <i class="fa-light fa-plus"></i>
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>
    <div
      v-if="!isSmallScreen || activeMobileList.value == 'off_sequence'"
      class="ep-sequences__list panel-col"
    >
      <div class="sequence-list">
        <div class="sequence-list__header">
          <div
            class="sequence-list__header__row sequence-list__header__row--descr-mobile"
          >
            <p class="sequence-list__header__description">
              {{ $t("sequence.off_sequence.description") }}
            </p>
          </div>
          <div
            class="sequence-list__header__row sequence-list__header__row--title"
          >
            <div class="sequence-list__header__base-items">
              <h2>{{ $t("sequence.off_sequence.title") }}</h2>
              <template v-if="activeSequence.type === 'off'">
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
                :disabled="sequenceOff.length < 1 || hasActiveSequence()"
                class="button button--secondary button--icon"
                @click="runSequence('off')"
              >
                <i class="fa-regular fa-play"></i>
              </button>
            </div>
            <div class="sequence-list__header__triggers">
              <button
                :disabled="hasActiveSequence('off')"
                class="button button--secondary button--icon"
                @click="showAvSequences('off')"
              >
                <i class="fa-light fa-plus"></i>
              </button>
              <button
                v-if="
                  sequenceOff.length === assignedSequenceOff.length &&
                  assignedSequenceOff.length > 0
                "
                :disabled="hasActiveSequence('off')"
                class="button button--secondary button--icon button-assign"
                @click="deAssignAllItems(false)"
              >
                <i class="fa-light fa-xmark"></i>
              </button>
              <button
                v-else-if="sequenceOff.length > 0"
                :disabled="hasActiveSequence('off')"
                class="button button--secondary button--icon button-assign"
                @click="assignAllItems(sequenceOff, false)"
              >
                <i class="fa-light fa-check"></i>
              </button>
              <button
                :disabled="
                  assignedSequenceOff.length < 1 || hasActiveSequence('off')
                "
                class="button button--secondary button--icon"
                @click="deleteItems(false)"
              >
                <i class="fa-light fa-trash"></i>
              </button>
            </div>
          </div>
          <div
            class="sequence-list__header__row sequence-list__header__row--descr-desktop"
          >
            <p class="sequence-list__header__description">
              {{ $t("sequence.off_sequence.description") }}
            </p>
          </div>
        </div>
        <div ref="seqOffListBody" class="sequence-list__body">
          <Draggable
            v-if="!loading && sequenceOff.length > 0"
            v-model="sequenceOff"
            v-overflow-indicator
            class="sequence-list__items"
            :group="'sequence-off'"
            :force-fallback="true"
            item-key="id"
            handle=".sequence-item__drag"
            @change="saveSequences"
          >
            <template #item="{ element, index }">
              <SequenceItem
                :item="element"
                :selected="isAssignedItem(element, false)"
                :status="getSequenceItemStatus(index, 'off')"
                @toggle-checkbox="
                  (msg: CommandSequenceListItem) =>
                    toggleItemCheckbox(msg, false)
                "
                @change="updateSequence"
                @delete="
                  (msg: CommandSequenceListItem) => deleteItem(msg, false)
                "
              />
            </template>
          </Draggable>
          <Transition name="opacity-fast">
            <div
              v-show="sequenceOff.length < 1 && !loading"
              class="sequence-list__no-command"
            >
              <h3>{{ $t("sequence.add_first") }}</h3>
              <p>
                {{ $t("sequence.off_sequence.empty") }}
                {{ $t("sequence.add_first_btn_below") }}
              </p>
              <button
                class="button button--primary button--hybrid button--hybrid--reversed"
                @click="showAvSequences('off')"
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
      v-if="activity"
      ref="elAddCommand"
      :entity="activity"
      :command-metadata="commandMetadata"
      :setting="settingActivity"
      @add-command="addCommand"
    />
  </div>
</template>
