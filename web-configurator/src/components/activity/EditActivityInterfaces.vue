<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";

import { FlashMessageInfoStatus } from "@/types/enums";

import type {
  Activity,
  DeviceButton,
  DeviceButtonMappingChange,
} from "@/types/activity";

import { activitiesStore } from "@/stores/activities";
import { addInfoFull, addErrorBottom } from "@/stores/messages";

import { deepClone, useDataHelper } from "@/composables/dataHelper";
import { useWindowDimension } from "@/composables/windowDimension";

import PageList from "@/components/page/PageList.vue";
import ButtonList from "@/components/configure-button/ButtonList.vue";

import ActivityRemote from "@/components/activity/ActivityRemote.vue";

const { updateExistingObjectKeys, isNonEmptyObject } = useDataHelper();
const { isSmallScreen } = useWindowDimension();

const storage = activitiesStore();

const props = defineProps({
  activityId: {
    type: String,
    required: true,
  },
  activeTab: {
    type: String,
    required: true,
  },
});

const activity = ref<Activity | null>(null);

const elButtonList =
  useTemplateRef<InstanceType<typeof ButtonList>>("elButtonList");
const elActivityRemote =
  useTemplateRef<InstanceType<typeof ActivityRemote>>("elActivityRemote");

const highlightedRemoteButton = ref<DeviceButton | object>({});

const remoteItemDragging = ref(false);

const enableRemote = ref(false);
const showPages = ref(false);
const loading = ref(true);
const saving = ref(false);

const elActiPageList =
  useTemplateRef<InstanceType<typeof PageList>>("elActiPageList");

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
      if (progressSaving.value) return false;

      if (isActive.value) {
        const updActivity = updateExistingObjectKeys(
          deepClone(activity.value!),
          args[0].new_state,
        );
        setActivity(updActivity);
      }
    }
  });
});

watch(props, (val) => {
  if (
    !enableRemote.value &&
    (val.activeTab == "user-interface" || val.activeTab == "button-mapping")
  ) {
    enableRemote.value = true;
  }
});

const isActive = computed(() => {
  return (
    props.activeTab == "user-interface" || props.activeTab == "button-mapping"
  );
});

watch(isActive, (val, oldVal) => {
  if (val == true && oldVal == false) {
    loadActivity();
  }
});

const progressSaving = computed(() => {
  return (
    saving.value ||
    (elActivityRemote.value && elActivityRemote.value.isSaving()) ||
    (elActiPageList.value && elActiPageList.value.isSaving()) ||
    (elButtonList.value && elButtonList.value.isSaving())
  );
});

const tabTransition = computed(() => {
  return props.activeTab == "user-interface"
    ? "slide-tab-right"
    : "slide-tab-left";
});

const interfaceContainerTransition = computed(() => {
  if (!isSmallScreen.value || props.activeTab == "button-mapping") {
    return "none";
  }

  return showPages.value ? "slide-tab-right" : "slide-tab-left";
});

function setActivity(newValue: Activity | undefined) {
  if (!newValue || !isNonEmptyObject(newValue)) {
    return false;
  }

  activity.value = newValue as Activity;
}

function editPage(pageId: string) {
  elActivityRemote.value?.setActivePageById(pageId);
}

async function updateButton(msg: DeviceButtonMappingChange) {
  if (msg.cmd == undefined) {
    throw new Error("Property 'msg.cmd' is required.");
  }

  if (msg.pressType == undefined) {
    throw new Error("Property 'msg.pressType' is required.");
  }

  saving.value = true;
  try {
    const newValue = await storage.buttonUpdate(
      props.activityId,
      msg.button.button,
      msg.cmd,
      msg.pressType,
    );
    if (newValue && isNonEmptyObject(newValue)) {
      setActivity(newValue as Activity);
    }

    if (msg.cmd) {
      const data: DeviceButtonMappingChange = deepClone(msg);

      if (msg.pressType) {
        data.button[msg.pressType] = msg.cmd;
        elButtonList.value?.changePhysicalButtonEdit(data);
      }
    }
  } catch (e) {
    addErrorBottom(e);
  }

  saving.value = false;
}

async function resetButton(msg: DeviceButtonMappingChange) {
  saving.value = true;
  try {
    const newValue = await storage.buttonReset(
      props.activityId,
      msg.button.button,
      msg.pressType,
    );
    setActivity(newValue);

    const data: DeviceButtonMappingChange = deepClone(msg);

    if (msg.pressType) {
      delete data.button[msg.pressType];
      elButtonList.value?.changePhysicalButtonEdit(data);
    }
  } catch (e) {
    addErrorBottom(e);
  }

  saving.value = false;
}

async function resetAllButtons() {
  saving.value = true;
  try {
    addInfoFull(FlashMessageInfoStatus.SAVING);
    const newValue = await storage.allButtonsReset(props.activityId);
    setActivity(newValue);
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
  } catch (e) {
    addErrorBottom(e);
  }

  saving.value = false;
}

function addPage() {
  elActiPageList.value?.setAddPage(true);
}

async function loadActivity() {
  loading.value = true;
  try {
    const newValue = await storage.getActivity(props.activityId);
    setActivity(newValue);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
}

async function updateActivity() {
  try {
    const newValue = await storage.getActivity(props.activityId, false);
    setActivity(newValue);
  } catch (e) {
    addErrorBottom(e);
  }
}

onMounted(() => {
  if (isActive.value) {
    loadActivity();
  }
});
</script>
<template>
  <div class="ea-interfaces" :class="`ea-interfaces--${activeTab}`">
    <div
      v-if="enableRemote"
      :class="{
        'ea-interfaces__remote--overflow-hidden': remoteItemDragging,
      }"
      class="ea-interfaces__remote panel-col panel-col--60"
    >
      <ActivityRemote
        v-if="activity"
        ref="elActivityRemote"
        :activity="activity || {}"
        :edit-button-mapping="activeTab == 'button-mapping'"
        :highlighted-remote-button="highlightedRemoteButton"
        @add-page="addPage"
        @show-page-list="showPages = true"
        @update="updateActivity"
        @item-dragging="(dragging: boolean) => (remoteItemDragging = dragging)"
      />
    </div>
    <Transition :name="interfaceContainerTransition">
      <div
        v-show="!isSmallScreen || activeTab == 'button-mapping' || showPages"
        class="ea-interfaces__list panel-col panel-col--40"
      >
        <div class="ea-interfaces__list__wrapper">
          <Transition :name="tabTransition">
            <div
              v-show="activeTab != 'button-mapping'"
              class="ea-interfaces__list__tab"
            >
              <PageList
                ref="elActiPageList"
                :entity="activity || {}"
                :entity-type="'activity'"
                :loading="loading"
                @edit-page="editPage"
                @update="updateActivity"
                @hide="showPages = false"
              />
            </div>
          </Transition>
          <Transition :name="tabTransition">
            <div
              v-show="activeTab != 'user-interface'"
              class="ea-interfaces__list__tab"
            >
              <ButtonList
                v-if="activity"
                ref="elButtonList"
                :entity="activity"
                :entity-type="'activity'"
                :text-instruction="$t('activity.button_mapping.instruction')"
                @change-button="updateButton"
                @reset-button="resetButton"
                @reset-all-buttons="resetAllButtons"
                @highlight-button="
                  (btn: DeviceButton) => {
                    highlightedRemoteButton = btn;
                  }
                "
                @hide-highlighted-button="highlightedRemoteButton = {}"
                @update="updateActivity"
              />
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </div>
</template>
