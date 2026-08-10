<script setup lang="ts">
import EditEntity from "@/components/elements/entity/EditEntity.vue";

defineProps({
  entity_id: {
    type: String,
    required: true,
  },
});
</script>
<template>
  <Suspense>
    <div class="page-edit-entity">
      <div class="page-edit-entity__main">
        <EditEntity :entity-id="entity_id" />
      </div>
    </div>
  </Suspense>
</template>
