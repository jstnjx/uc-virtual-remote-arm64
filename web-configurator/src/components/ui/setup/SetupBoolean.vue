<!-- Entity command parameter `type: boolean` -->
<script setup lang="ts">
import { ref, watch } from "vue";
import UCToggle from "@/components/ui/UCToggle.vue";

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  paramName: {
    type: String,
    required: true,
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
const value = ref(props.value);

const emit = defineEmits(["change"]);

watch(props, () => {
  value.value = props.value;
});

function emitChange() {
  const args = {
    paramValue: value.value,
    paramName: props.paramName,
  };
  emit("change", args);
}
</script>
<template>
  <div class="setup-item setup-item--boolean">
    <div class="setup-item__body">
      <UCToggle
        v-model="value"
        :inactive-label="true"
        :disabled="disabled"
        @change="emitChange"
      />
    </div>
  </div>
</template>
