<script setup lang="ts">
import EditIntegration from "@/components/integration/EditIntegration.vue";

defineProps({
  integration_id: {
    type: String,
    required: true,
  },
});
</script>
<template>
  <Suspense>
    <div class="page-edit-integration">
      <div class="page-edit-integration__main">
        <EditIntegration :integration-id="integration_id" />
      </div>
    </div>
  </Suspense>
</template>
