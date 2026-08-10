<script setup lang="ts">
import EditActivityGroupSettings from "@/components/activity-group/EditActivityGroupSettings.vue";

defineProps({
  group_id: {
    type: String,
    required: true,
  },
});
</script>
<template>
  <Suspense>
    <div class="page-edit-activity-group">
      <div class="page-edit-activity-group__main">
        <EditActivityGroupSettings :group-id="group_id" />
      </div>
    </div>
  </Suspense>
</template>
