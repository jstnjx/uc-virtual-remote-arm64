<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";

import type { Activity, IncludedEntity } from "@/types/activity";
import { EntityType } from "@/types/enums";

type WidgetEntity =
  IncludedEntity | ({ integration: IntegrationInstance } & ConfiguredEntity);

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import { getAvailableEntitesForActivityByType } from "@/composables/activities";
import translatedProperty, {
  searchLanguageText,
} from "@/composables/translatedProperty";
import { isTouchEnabled } from "@/composables/device";

import UCSearch from "@/components/ui/UCSearch.vue";

import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import type {
  IntegrationInstance,
  ConfiguredEntity,
} from "@/types/integrationInstance";

const integrationsStorage = integrationsStore();

const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  activity: {
    type: Object,
    required: true,
  },
  entityType: {
    type: String,
    required: true,
    validator: (val: string) =>
      [EntityType.media_player, EntityType.sensor, EntityType.select].includes(
        val as EntityType,
      ),
  },
});

defineExpose({
  open,
});

const emit = defineEmits(["select"]);

const instances = computed<IntegrationInstance[]>(
  () => integrationsStorage.instances,
);

const showAssignEntity = ref();

const widgetEntities = ref<WidgetEntity[]>([]);

const searchEntity = ref("");
const elEntitySelect = useTemplateRef<HTMLDivElement>("elEntitySelect");

watch(showAssignEntity, (val) => {
  if (val == false) {
    searchEntity.value = "";
  }
});

const availableEntities = computed(() => {
  const filter = searchEntity.value.toLowerCase();
  return widgetEntities.value.filter((entity) => {
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

function findWidgetEntities(list: ConfiguredEntity[]) {
  return list.map((e) => {
    const integration = instances.value.find(
      (i) => i.integration_id === e.integration_id,
    );
    return {
      ...e,
      integration,
    };
  });
}

async function setWidgetEntities() {
  if (
    props.entityType == EntityType.sensor ||
    props.entityType == EntityType.select
  ) {
    try {
      await integrationsStorage.getInstances();
    } catch (e) {
      addErrorBottom(e);
    }

    try {
      let res = null;

      if (props.entityType == EntityType.sensor) {
        res = await integrationsStorage.getConfiguredSensorEntities(true);
      } else if (props.entityType == EntityType.select) {
        res = await integrationsStorage.getConfiguredSelectEntities(true);
      }

      if (res != null) {
        widgetEntities.value = findWidgetEntities(res);
      }
    } catch (e) {
      addErrorBottom(e);
    }
  } else {
    widgetEntities.value = getAvailableEntitesForActivityByType(
      props.activity as Activity,
      props.entityType as EntityType,
    ) as IncludedEntity[];
  }
}

async function open() {
  setWidgetEntities();
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
          <span v-if="entityType">{{
            $t(`entity.entity_type.${entityType}`)
          }}</span>
        </div>
      </template>
      <hr />
      <div ref="elEntitySelect" class="command-select command-select--extended">
        <ListWithFilter>
          <template #form>
            <UCSearch v-model="searchEntity" :small="true" :gray="true" />
          </template>
          <template #items>
            <div
              v-for="(entity, index) in availableEntities"
              :key="index"
              class="command-select__item"
              @click="doSelect(entity)"
            >
              <SelectedIcon
                v-if="entity.integration?.icon"
                :key="`${entity?.entity_id}-${index}`"
                class="command-select__item__icon"
                :icon="entity.integration.icon"
              />
              <h4 v-if="entity.name && translatedProperty(entity.name)">
                {{ translatedProperty(entity.name) }}
                <template v-if="translatedProperty(entity.integration?.name)">
                  <span class="command-select__item__entity-name">{{
                    translatedProperty(entity.integration?.name)
                  }}</span>
                </template>
              </h4>
            </div>
          </template>
        </ListWithFilter>
      </div>
    </ModalSecondary>
  </Teleport>
</template>
