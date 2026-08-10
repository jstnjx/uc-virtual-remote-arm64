<script setup lang="ts">
import { ref, watch, getCurrentInstance, useTemplateRef } from "vue";
import { asyncComputed } from "@vueuse/core";

import type { IncludedEntity } from "@/types/activity";
import type { ConfiguredEntity } from "@/types/integrationInstance";

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import { deepClone, useDataHelper } from "@/composables/dataHelper";
import { getIconName } from "@/composables/icon";

import Draggable from "vuedraggable";
import EntityListItem from "@/components/elements/entity/EntityListItem.vue";
import QuickEditModal from "@/components/elements/QuickEditModal.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const props = defineProps({
  entities: {
    type: Array,
    required: true,
  },
  danglingEntities: {
    type: Array,
    default: () => [],
  },
  instances: {
    type: Array,
    required: true,
  },
  dragGroup: {
    type: String,
    required: true,
  },
  showButtonAdd: {
    type: Boolean,
    default: true,
  },
  title: {
    type: String,
    default: "",
  },
  loading: {
    type: Boolean,
    default: false,
  },
  dragButton: {
    type: Boolean,
    default: false,
  },
  textAddFirstTitle: {
    type: String,
    default: "",
  },
  textAddFirstDescr: {
    type: String,
    default: "",
  },
});

const integrationStorage = integrationsStore();
const emit = defineEmits([
  "entityListChanged",
  "removeEntity",
  "reloadEntities",
  "clickAdd",
]);
const { updateExistingObjectKeys } = useDataHelper();

const selectedEntities = ref<IncludedEntity[]>(getSelectedEntities());
const assignedEntities = ref<IncludedEntity[]>([]);
const itemToEdit = ref<IncludedEntity | null>(null);

const instance = getCurrentInstance() || {
  uid: Math.floor(Math.random() * (999999 - 100000 + 1)) + 100000,
};

const dialogConfirmRemove = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogConfirmRemove",
);

const fetching = ref(false);

integrationStorage.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }
  after(() => {
    const { entity_id, event_type } = args[0];
    const entIndex = selectedEntities.value.findIndex(
      (e: IncludedEntity) => e.entity_id == entity_id,
    );

    if (
      entIndex > -1 &&
      selectedEntities.value[entIndex] &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      const updEntity = updateExistingObjectKeys(
        deepClone(selectedEntities.value[entIndex]),
        args[0].new_state,
      );
      selectedEntities.value[entIndex] = updEntity;
    }
  });
});

watch(props, (_val) => {
  fetching.value = true;
  selectedEntities.value = getSelectedEntities();
  fetching.value = false;
});

const iconDrag = asyncComputed(async () => {
  return await getIconName("fa-grip-vertical");
});

function getSelectedEntities() {
  return (props.entities as IncludedEntity[]).map((item: IncludedEntity) => {
    if (!item?.integration && item.integration_id) {
      item.integration = integrationStorage.$state.instances.find((inst) => {
        return inst.integration_id === item.integration_id;
      });
    }
    return item;
  });
}

async function onEntityListChanged(ev: CustomEvent & { added?: any }) {
  const { added } = ev;
  if (added && selectedEntities.value[added.newIndex]) {
    const item = selectedEntities.value[added.newIndex] as any;
    if (!item?.integration && item.integration_id) {
      try {
        const inst = await integrationStorage.getIntegration(
          item.integration_id,
        );
        if (inst.inst) {
          selectedEntities.value[added.newIndex].integration = inst.inst as any;
        }
      } catch (e) {
        addErrorBottom(e);
      }
    }
  }
  emit("entityListChanged", selectedEntities.value);
}

async function editEntity(entity: IncludedEntity) {
  let editEnt = entity;
  try {
    editEnt = await integrationStorage.getConfiguredEntity(entity.entity_id);
  } catch (e) {
    console.error(e);
  }
  itemToEdit.value = editEnt;
}

function removeEntitiesFromGroup() {
  if (!assignedEntities.value || assignedEntities.value.length < 1) {
    return false;
  }

  const newList = selectedEntities.value.filter(
    (item) => !assignedEntities.value.includes(item),
  );
  selectedEntities.value = newList;
  emit("entityListChanged", selectedEntities.value);
  assignedEntities.value = [];
}

function toggleItemCheckbox(entity: IncludedEntity) {
  const itemIndex = assignedEntities.value.findIndex(
    (item: IncludedEntity) => item.entity_id === entity.entity_id,
  );
  if (itemIndex > -1) {
    assignedEntities.value.splice(itemIndex, 1);
  } else {
    assignedEntities.value.push(entity);
  }
}

function updateSelected(list: IncludedEntity[]) {
  selectedEntities.value = list;
}

function isAssignedItem(entity: IncludedEntity) {
  return (
    assignedEntities.value.findIndex(
      (item: IncludedEntity) => item.entity_id === entity.entity_id,
    ) > -1
  );
}

function assignAllEntities(array: IncludedEntity[]) {
  assignedEntities.value = [];
  array.forEach((obj) => {
    assignedEntities.value.push(obj);
  });
}

function deAssignAllEntities() {
  assignedEntities.value = [];
}

function reloadEntities() {
  emit("reloadEntities");
}

function startRemoveEntitiesFromGroup() {
  dialogConfirmRemove.value?.open();
}

function isDangling(id: string) {
  return props.danglingEntities.includes(id);
}

/**
 * `included_entities` of an activity/macro are entity *references*: no
 * `attributes`, hence no state for `EntityListItem` to render the state line
 * and the unavailable marker from. Fill that in from the cached entity, the
 * same data the integration detail view lists — read in the render, so a WS
 * `entity_change` merged into the cache shows up here too.
 *
 * Only for rows that bring no state of their own: the group and activity-group
 * lists pass whole entities, and for an `activity` the cache is the staler
 * copy — that type is owned by the activities store, so `entity_change` never
 * reaches the lists this reads (INTEGRATION_ENTITY_TYPES).
 */
function withEntityState(entity: IncludedEntity) {
  const item = entity as IncludedEntity & Partial<ConfiguredEntity>;
  if (item.attributes) {
    return entity;
  }

  const cached = integrationStorage.findCachedEntity(entity.entity_id);
  if (!cached) {
    return entity;
  }
  return {
    ...entity,
    attributes: cached.attributes,
    device_class: cached.device_class,
    options: cached.options,
  };
}

function clickAdd() {
  emit("clickAdd");
}

defineExpose({
  updateSelected,
});
</script>
<template>
  <div class="included-entity-list__header">
    <span>
      <template v-if="title && title.length > 0">{{ title }}</template>
      <template v-else>{{ $t("entity.included_entities.title") }}</template>
    </span>
    <div class="included-entity-list__header__options">
      <Transition name="opacity-fast">
        <button
          v-show="showButtonAdd"
          class="button button--secondary button--icon button--icon--medium"
          @click="clickAdd"
        >
          <i class="fa-light fa-plus"></i>
        </button>
      </Transition>
      <button
        v-if="assignedEntities.length < selectedEntities.length"
        class="button button--secondary button--icon button--icon--medium button-assign"
        @click="assignAllEntities(selectedEntities)"
      >
        <i class="fa-light fa-check"></i>
      </button>
      <button
        v-else-if="selectedEntities.length > 0"
        class="button button--secondary button--icon button--icon--medium button-assign"
        @click="deAssignAllEntities()"
      >
        <i class="fa-light fa-xmark"></i>
      </button>
      <button
        :disabled="!assignedEntities || assignedEntities.length < 1"
        class="button button--secondary button--icon button--icon--medium"
        @click="startRemoveEntitiesFromGroup"
      >
        <i class="fa-light fa-trash"></i>
      </button>
    </div>
  </div>
  <Draggable
    v-model="selectedEntities"
    v-overflow-indicator
    class="included-entity-list__items"
    :class="{ empty: selectedEntities.length === 0 }"
    :group="dragGroup"
    :force-fallback="true"
    item-key="entity_id"
    handle=".entity-item__drag"
    @change="onEntityListChanged"
  >
    <template #item="{ element }">
      <div
        class="entity-item"
        :class="{
          'entity-item--selected': isAssignedItem(element) === true,
          'entity-item--dangling': isDangling(element.entity_id),
        }"
      >
        <EntityListItem
          :list-item="withEntityState(element)"
          :instances="instances"
          :integration-info="true"
          :inactive="true"
          :dangling="isDangling(element.entity_id)"
          :edit-button="true"
          @edit="editEntity"
        >
          <template #checkbox>
            <div
              class="form-item form-item--checkbox-tick entity-item__checkbox-tick"
            >
              <input
                :id="`${instance.uid}-${element.entity_id}-checkbox-tick`"
                type="checkbox"
                :checked="isAssignedItem(element)"
              />
              <label
                class="toggle"
                :for="`${instance.uid}-${element.entity_id}-checkbox-tick`"
              />
              <button
                class="button--toggle-tick"
                @click="toggleItemCheckbox(element)"
              ></button>
            </div>
          </template>
        </EntityListItem>
        <span
          v-if="dragGroup.length > 0 && dragButton"
          class="entity-item__drag"
        >
          <i v-if="iconDrag" class="fa-regular" :class="iconDrag"></i>
        </span>
      </div>
    </template>
  </Draggable>
  <Transition name="opacity-fast">
    <div
      v-show="
        !loading &&
        showButtonAdd &&
        selectedEntities &&
        selectedEntities.length < 1
      "
      class="included-entity-list__no-items"
    >
      <h3>
        <template v-if="textAddFirstTitle && textAddFirstTitle.length > 0">{{
          textAddFirstTitle
        }}</template>
        <template v-else>{{ $t("entity.add_first") }}</template>
      </h3>
      <p v-if="textAddFirstDescr && textAddFirstDescr.length > 0">
        {{ textAddFirstDescr }}
      </p>
      <button
        class="button button--primary button--hybrid button--hybrid--reversed"
        @click="clickAdd"
      >
        {{ $t("ui.add") }}
        <i class="fa-light fa-plus"></i>
      </button>
    </div>
  </Transition>
  <QuickEditModal
    v-if="itemToEdit != null"
    :item="itemToEdit"
    :show-by-parent="true"
    @saved="reloadEntities"
    @closed="itemToEdit = null"
  />

  <AppDialog
    ref="dialogConfirmRemove"
    :title="
      assignedEntities.length > 1
        ? $t('entity.remove_entities.title')
        : $t('entity.remove_entity.title')
    "
    :text="
      assignedEntities.length > 1
        ? $t('entity.remove_entities.question')
        : $t('entity.remove_entity.question')
    "
    :submit-text="$t('ui.accept')"
    :cancel-text="$t('ui.cancel')"
    @submit="removeEntitiesFromGroup"
  />
</template>
