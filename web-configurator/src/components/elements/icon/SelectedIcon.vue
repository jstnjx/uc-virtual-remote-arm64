<script setup lang="ts">
import { computed } from "vue";
import { asyncComputed } from "@vueuse/core";

import { getNewIconName } from "@/composables/icon";
import IconImage from "@/components/elements/icon/IconImage.vue";

const props = defineProps({
  icon: {
    type: String,
    required: true,
  },
  fallbackIcon: {
    type: String,
    default: "",
  },
  editable: {
    type: Boolean,
    default: false,
  },
  thin: {
    type: Boolean,
    default: false,
  },
  square: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["click"]);

const custom = computed(() => {
  const patternCustom = /^custom:/;
  const patternCtv = /^ctv:/;
  if (!patternCustom.test(props.icon) && !patternCtv.test(props.icon)) {
    return "";
  }

  return props.icon;
});

const weight = computed(() => {
  if (props.thin) {
    return "fa-thin";
  }

  return "fa-light";
});

const uc = asyncComputed(async () => {
  const pattern = /^uc:/;
  if (!pattern.test(props.icon)) {
    return "";
  }

  const iconName = props.icon.split("uc:")[1];
  const newIconName = await getNewIconName(iconName);

  if (
    iconName &&
    iconName.length > 0 &&
    newIconName &&
    newIconName.length > 0
  ) {
    return props.icon.replace(pattern, "fa-").replace(iconName, newIconName);
  } else {
    return props.icon.replace(pattern, "fa-");
  }
});

const fa = computed(() => {
  const pattern = /^fa-/;
  if (!pattern.test(props.icon)) {
    return "";
  }

  return props.icon;
});

function onClick(ev: MouseEvent) {
  emit("click", ev);
}
</script>
<template>
  <div
    class="selected-icon"
    :class="{
      'selected-icon--editable': editable,
      'selected-icon--custom': custom,
      'selected-icon--custom--square': custom && square,
    }"
  >
    <IconImage
      v-if="custom"
      :icon-id="custom"
      :fallback-icon="props.fallbackIcon"
    />
    <i v-else-if="uc" :class="weight + ' ' + uc" />
    <i v-else-if="fa" :class="weight + ' ' + fa" />
    <i v-else :class="props.fallbackIcon" />
    <button
      v-if="editable"
      class="selected-icon__edit"
      :class="{ 'selected-icon__edit--image': custom }"
      @click="onClick"
    >
      <i class="fa-regular fa-edit"></i>
    </button>
  </div>
</template>
