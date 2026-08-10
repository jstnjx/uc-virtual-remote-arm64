<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";

import type { IncludedEntity } from "@/types/activity";

import translatedProperty, {
  searchLanguageText,
} from "@/composables/translatedProperty";
import { isTouchEnabled } from "@/composables/device";

import UCSearch from "@/components/ui/UCSearch.vue";

import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";

const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  activity: {
    type: Object,
    required: true,
  },
  entityList: {
    type: Array,
    default: () => [],
  },
});

defineExpose({
  open,
});

const emit = defineEmits(["select"]);

const showAssignEntity = ref();

const searchEntity = ref("");
const elEntitySelect = useTemplateRef<HTMLDivElement>("elEntitySelect");

watch(showAssignEntity, (val) => {
  if (val == false) {
    searchEntity.value = "";
  }
});

const availableEntities = computed(() => {
  const filter = searchEntity.value.toLowerCase();
  return (props.entityList as IncludedEntity[]).filter((entity) => {
    return (
      (entity.integration &&
        searchLanguageText(entity.integration.name, filter)) ||
      searchLanguageText(entity.name, filter) ||
      (entity.entity_id || "").toLowerCase().includes(filter)
    );
  });
});

function doSelect(entity: IncludedEntity | undefined) {
  if (entity == undefined) {
    return;
  }

  emit("select", entity);
  showAssignEntity.value = false;
}

function focusSearch() {
  if (!elEntitySelect.value) return false;
  const searchField = elEntitySelect.value.querySelector("input");
  if (!isTouchEnabled() && searchField) {
    searchField.focus();
  }
}

async function open() {
  showAssignEntity.value = true;
  focusSearch();
}
</script>
<template>
  <Teleport to="body">
    <ModalSecondary
      :show="showAssignEntity == true"
      :width="'26.25rem'"
      :name="'modal-assign-entity'"
      class="modal-secondary--assign-entity"
      @close="showAssignEntity = false"
    >
      <template #header>
        <div class="modal-secondary__header__content">
          <h2>{{ $t("entity.assign.title") }}</h2>
        </div>
      </template>
      <hr />
      <div
        ref="elEntitySelect"
        :class="{
          'entity-select--empty-list': entityList && entityList.length < 1,
        }"
        class="entity-select entity-select--extended"
      >
        <ListWithFilter>
          <template #form>
            <UCSearch
              v-if="entityList && entityList.length > 0"
              v-model="searchEntity"
              :small="true"
              :gray="true"
            />
          </template>
          <template #items>
            <template v-if="availableEntities && availableEntities.length > 0">
              <div
                v-for="(entity, index) in availableEntities"
                :key="index"
                class="entity-select__item"
                @click="doSelect(entity)"
              >
                <SelectedIcon
                  v-if="entity.integration?.icon"
                  :key="`${entity?.entity_id}-${index}`"
                  class="entity-select__item__icon"
                  :icon="entity.integration.icon"
                />
                <h4 v-if="entity.name && translatedProperty(entity.name)">
                  {{ translatedProperty(entity.name) }}
                  <template v-if="translatedProperty(entity.integration?.name)">
                    <span class="entity-select__item__entity-name">{{
                      translatedProperty(entity.integration?.name)
                    }}</span>
                  </template>
                </h4>
              </div>
            </template>
            <span v-else>{{ $t("entity.no_entities_found") }}</span>
          </template>
        </ListWithFilter>
      </div>
    </ModalSecondary>
  </Teleport>
</template>
