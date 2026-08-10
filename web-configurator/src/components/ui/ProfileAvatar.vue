<script setup lang="ts">
import { computed } from "vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  icon: {
    type: String,
    default: "fa-light fa-user",
  },
  active: {
    type: Boolean,
    default: false,
  },
  restricted: {
    type: Boolean,
    default: false,
  },
  simple: {
    type: Boolean,
    default: false,
  },
  small: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["click"]);

const avatarName = computed(() => {
  if (longNamePart.value) {
    return splitString(props.name);
  } else {
    return props.name;
  }
});

const smallName = computed(() => {
  let showSmall = false;
  const nameParts = props.name.split(" ");
  nameParts.forEach((p) => {
    if (p.length > 10) {
      showSmall = true;
    }
  });
  return showSmall;
});

const longNamePart = computed(() => {
  let isLong = false;
  const nameParts = props.name.split(" ");
  nameParts.forEach((p) => {
    if (p.length > 16) {
      isLong = true;
    }
  });
  return isLong;
});

const mainClasses = computed(() => {
  let classList = "";
  classList += props.small == true ? "avatar-element--small " : "";
  return classList;
});

function splitString(str: string) {
  const chunkSize = 16;
  const nameParts = props.name.split(" ");
  let result = "";

  for (let i = 0; i < nameParts.length; i += 1) {
    if (nameParts[i].length > chunkSize) {
      for (let j = 0; j < str.length; j += chunkSize) {
        result += str.substring(j, j + chunkSize) + " ";
      }
    } else {
      result += nameParts[i] + " ";
    }
  }
  return result;
}

function onClick() {
  emit("click");
}
</script>
<template>
  <div class="avatar-element" :class="mainClasses" @click="onClick">
    <SelectedIcon
      class="icon-container"
      :icon="icon"
      :fallback-icon="'fa-light fa-user'"
    />
    <span
      class="avatar-element__name"
      :class="{ 'avatar-element__name--small': smallName }"
      >{{ avatarName }}</span
    >
    <div v-if="active || restricted" class="avatar-element__state">
      <i
        v-if="active"
        class="avatar-element__icon avatar-element__icon--check fa-light fa-check"
      ></i>
      <i
        v-if="restricted"
        class="avatar-element__icon avatar-element__icon--lock fa-light fa-lock"
      ></i>
    </div>
    <button
      v-if="simple == false"
      class="button button--secondary avatar-element__action avatar-element__action--edit"
    >
      <i class="fa-regular fa-edit"></i>
    </button>
  </div>
</template>
