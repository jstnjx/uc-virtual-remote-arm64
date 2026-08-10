<script setup lang="ts">
import EditDock from "@/components/dock/EditDock.vue";

defineProps({
  dock_id: {
    type: String,
    required: true,
  },
});
</script>
<template>
  <Suspense>
    <div class="page-edit-dock">
      <div class="page-edit-dock__main">
        <EditDock :dock-id="dock_id" />
      </div>
    </div>
  </Suspense>
</template>
