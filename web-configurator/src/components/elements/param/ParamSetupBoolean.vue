<!-- Entity command parameter `type: boolean` -->
<script setup lang="ts">
import { ref, watch } from "vue";
import UCToggle from "@/components/ui/UCToggle.vue";

const props = defineProps({
  paramName: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    default: "",
  },
  value: {
    type: Boolean,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["change"]);
const value = ref(props.value);

watch(props, () => {
  value.value = props.value;
});

function doChange() {
  emitChange(value.value);
}

function emitChange(value: boolean) {
  emit("change", value);
}
</script>
<template>
  <div class="param-setup param-setup--boolean">
    <UCToggle
      v-model="value"
      :label="label"
      :full-w="true"
      :disabled="disabled"
      @change="doChange"
    />
  </div>
</template>
