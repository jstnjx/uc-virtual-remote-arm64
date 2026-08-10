<script setup lang="ts">
import {
  getCurrentInstance,
  nextTick,
  onBeforeMount,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import type { ResourceItem } from "@/types/resources";

import { useTiming } from "@/composables/timing";
import { useModalToggle } from "@/composables/modal";
import { isTouchEnabled } from "@/composables/device";

import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import IconList from "@/components/elements/resources/IconList.vue";

const instanceUid =
  getCurrentInstance()?.uid || Math.floor(Math.random() * 1000);
const { sleep } = useTiming();
const props = defineProps({
  value: {
    type: String,
    default: null,
  },
  title: {
    type: String,
    default: "",
  },
  changeCallback: {
    type: Function,
    default: null,
  },
  embedded: {
    type: Boolean,
    default: false,
  },
  circle: {
    type: Boolean,
    default: false,
  },
  fallback: {
    type: String,
    default: "fa-light fa-user",
  },
  hasTvChannel: {
    type: Boolean,
    default: false,
  },
});

const showModal = ref(false);

useModalToggle(showModal, { id: instanceUid });

const selectedIcon = ref<string | null>(null);

const showItemsGroupNumber = ref(1);

const filter = ref("");
const selectedList = ref("uc");

const imageCropping = ref(false);
const showModalContainer = ref(false);

const iconSelectPopup = useTemplateRef<HTMLDivElement>("iconSelectPopup");
const elIconList = useTemplateRef<InstanceType<typeof IconList>>("elIconList");

defineExpose({
  openSelectModal,
});

watch(props, async () => {
  if (props.value != selectedIcon.value) {
    selectedIcon.value = props.value;
  }
});

watch([filter, selectedList], () => {
  showItemsGroupNumber.value = 1;
});

watch(showModal, async (val) => {
  if (val == true) {
    showModalContainer.value = true;
    elIconList.value && elIconList.value.reset();

    nextTick(() => {
      const container = iconSelectPopup.value as HTMLElement;
      if (!isTouchEnabled() && container) {
        const firstInput = container.querySelector("input") as HTMLElement;
        firstInput?.focus();
      }
    });
  } else {
    await sleep(600);
    showModalContainer.value = false;
  }
});

function checkIconAvailability(option: ResourceItem) {
  if (
    option.id === selectedIcon.value?.replace("custom:", "").replace("ctv:", "")
  ) {
    // Fallback icon
    iconChangeCallback("uc:user");
  }
}

function iconChangeCallback(value: any) {
  if (props.changeCallback) {
    props.changeCallback({ value: value });
  }
  showModal.value = false;
}

function iconDelete(option: ResourceItem) {
  checkIconAvailability(option);
}

function openSelectModal() {
  showModal.value = true;
}

onBeforeMount(async () => {
  selectedIcon.value = props.value;
});
</script>
<template>
  <SelectedIcon
    v-if="embedded == false"
    class="icon-container icon-container--huge"
    :class="{ 'icon-container--huge--circle': circle }"
    :icon="selectedIcon || ''"
    :editable="true"
    :fallback-icon="fallback"
    @click="showModal = true"
  />

  <Teleport to="body" :disabled="embedded">
    <div
      v-show="showModal || showModalContainer || embedded"
      ref="iconSelectPopup"
      class="icon-select"
      :class="{ 'icon-select--hidden': imageCropping }"
    >
      <Transition name="opacity">
        <div
          v-show="showModal || embedded"
          class="icon-select__background"
        ></div>
      </Transition>
      <Transition name="slide-from-bottom">
        <div v-show="showModal || embedded" class="icon-select__container">
          <div class="icon-select__body">
            <IconList
              ref="elIconList"
              :change-callback="iconChangeCallback"
              :title="title && title.length > 0 ? title : $t('icons.title')"
              :has-tv-channel="hasTvChannel"
              :active="showModal || embedded"
              @icon-delete="iconDelete"
            />
          </div>
          <button
            class="button button--secondary button--icon button--icon--medium button-close"
            @click="showModal = false"
          >
            <i class="fa-regular fa-close"></i>
          </button>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>
