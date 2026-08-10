<script setup lang="ts">
const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  fieldId: {
    type: String,
    required: true,
  },
  label: {
    type: Object,
    required: true,
  },
  field: {
    type: Object,
    required: true,
  },
});
</script>
<template>
  <div>
    Broken Field
    <pre>{{ props }}</pre>
  </div>
</template>
