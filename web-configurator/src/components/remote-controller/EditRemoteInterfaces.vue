<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";

import { FlashMessageInfoStatus } from "@/types/enums";

import type {
  // Activity,
  DeviceButton,
  DeviceButtonMappingChange,
} from "@/types/activity";

import type { Remote } from "@/types/remote";

import { remotesStore } from "@/stores/remotes";
import { addInfoFull, addErrorBottom } from "@/stores/messages";

import router from "@/composables/router";
import { useWindowDimension } from "@/composables/windowDimension";
import { deepClone, useDataHelper } from "@/composables/dataHelper";

import DeviceRemote from "@/components/remote-controller/DeviceRemote.vue";
import PageList from "@/components/page/PageList.vue";
import ButtonList from "@/components/configure-button/ButtonList.vue";

const { isSmallScreen } = useWindowDimension();
const { updateExistingObjectKeys, isNonEmptyObject } = useDataHelper();

const storage = remotesStore();

const props = defineProps({
  remoteId: {
    type: String,
    required: true,
  },
  activeTab: {
    type: String,
    required: true,
  },
});

const remote = ref<Remote | null>(null);

const elButtonList =
  useTemplateRef<InstanceType<typeof ButtonList>>("elButtonList");
const elDeviceRemote =
  useTemplateRef<InstanceType<typeof DeviceRemote>>("elDeviceRemote");

const highlightedRemoteButton = ref<DeviceButton | object>({});

const remoteItemDragging = ref(false);

const enableRemote = ref(false);
const showPages = ref(false);
const loading = ref(true);
const saving = ref(false);

const elRemotePageList =
  useTemplateRef<InstanceType<typeof PageList>>("elRemotePageList");

storage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    const { entity_id, event_type } = args[0];
    if (entity_id !== props.remoteId) {
      return;
    }
    if (event_type === "DELETE") {
      router.push({
        name: "entities",
      });
    } else if (
      entity_id === props.remoteId &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      if (progressSaving.value || loading.value == false) return false;
      const updRemote = updateExistingObjectKeys(
        deepClone(remote.value!),
        args[0].new_state,
        true,
      );
      setRemote(updRemote);
    }
  });
});

const isActive = computed(() => {
  return (
    props.activeTab == "user-interface" || props.activeTab == "button-mapping"
  );
});

watch(isActive, async (val) => {
  if (val == true) {
    await fetchData();

    if (!enableRemote.value) {
      enableRemote.value = true;
    }
  }
});

const progressSaving = computed(() => {
  return (
    saving.value ||
    (elDeviceRemote.value && elDeviceRemote.value.isSaving()) ||
    (elRemotePageList.value && elRemotePageList.value.isSaving()) ||
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

function setRemote(newVal: Remote | undefined) {
  if (!newVal || !isNonEmptyObject(newVal)) {
    return false;
  }
  const newValue = newVal as Remote;
  remote.value = deepClone(newValue);
}

function editPage(pageId: string) {
  elDeviceRemote.value?.setActivePageById(pageId);
}

async function updateButton(msg: DeviceButtonMappingChange) {
  if (msg.cmd == undefined) {
    throw new Error("Property 'msg.cmd' is required.");
  }

  if (msg.cmd.cmd_id == undefined) {
    throw new Error("Property 'msg.cmd.cmd_id' is required.");
  }

  if (msg.pressType == undefined) {
    throw new Error("Property 'msg.pressType' is required.");
  }

  saving.value = true;
  try {
    const newValue = await storage.buttonUpdate(
      props.remoteId,
      msg.button.button,
      msg.cmd.cmd_id,
      msg.pressType,
    );
    setRemote(newValue);

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
      props.remoteId,
      msg.button.button,
      msg.pressType,
    );
    setRemote(newValue);

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
    const newValue = await storage.allButtonsReset(props.remoteId);
    setRemote(newValue);
    addInfoFull(FlashMessageInfoStatus.SUCCESS);
  } catch (e) {
    addErrorBottom(e);
  }

  saving.value = false;
}

function addPage() {
  elRemotePageList.value?.setAddPage(true);
}

async function updateRemote() {
  try {
    const newValue = await storage.getRemote(props.remoteId, false);
    setRemote(newValue);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function fetchData() {
  loading.value = true;
  try {
    const newValue = await storage.getRemote(props.remoteId);
    setRemote(newValue);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
}
</script>
<template>
  <div class="er-interfaces" :class="`er-interfaces--${activeTab}`">
    <div
      v-if="enableRemote"
      :class="{
        'er-interfaces__remote--overflow-hidden': remoteItemDragging,
      }"
      class="er-interfaces__remote panel-col panel-col--60"
    >
      <DeviceRemote
        v-if="remote"
        ref="elDeviceRemote"
        :remote="remote || {}"
        :edit-button-mapping="activeTab == 'button-mapping'"
        :highlighted-remote-button="highlightedRemoteButton"
        @add-page="addPage"
        @show-page-list="showPages = true"
        @update="updateRemote"
        @item-dragging="(dragging: boolean) => (remoteItemDragging = dragging)"
      />
    </div>
    <Transition :name="interfaceContainerTransition">
      <div
        v-show="!isSmallScreen || activeTab == 'button-mapping' || showPages"
        class="er-interfaces__list panel-col panel-col--40"
      >
        <div class="er-interfaces__list__wrapper">
          <Transition :name="tabTransition">
            <div
              v-show="activeTab != 'button-mapping'"
              class="er-interfaces__list__tab"
            >
              <PageList
                ref="elRemotePageList"
                :entity="remote || {}"
                :entity-type="'remote'"
                :loading="loading"
                @edit-page="editPage"
                @update="updateRemote"
                @hide="showPages = false"
              />
            </div>
          </Transition>
          <Transition :name="tabTransition">
            <div
              v-show="activeTab != 'user-interface'"
              class="er-interfaces__list__tab"
            >
              <ButtonList
                v-if="remote"
                ref="elButtonList"
                :entity="remote"
                :entity-type="'remote'"
                :text-instruction="$t('remote.button_mapping.instruction')"
                @change-button="updateButton"
                @reset-button="resetButton"
                @reset-all-buttons="resetAllButtons"
                @highlight-button="
                  (btn: DeviceButton) => {
                    highlightedRemoteButton = btn;
                  }
                "
                @hide-highlighted-button="highlightedRemoteButton = {}"
                @update="updateRemote"
              />
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </div>
</template>
