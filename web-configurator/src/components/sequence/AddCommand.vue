<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";

import type {
  ActivityFull,
  CommandItem,
  EntityCommandListItem,
  EntityCommandMetadata,
  IncludedEntity,
  IncludedEntityFull,
} from "@/types/activity";
import type { MacroFull } from "@/types/macro";

import { SequenceType } from "@/types/enums";
import type { IntegrationInstance } from "@/types/integrationInstance";

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import { getAvailableEntityCommands } from "@/composables/activities";
import { isTouchEnabled } from "@/composables/device";
import translatedProperty from "@/composables/translatedProperty";
import { searchLanguageText } from "@/composables/translatedProperty";
import { getDefaultEntityIcon } from "@/composables/entity";
import { useTiming } from "@/composables/timing";

import ModalSecondary from "@/components/elements/ModalSecondary.vue";
import UCSearch from "@/components/ui/UCSearch.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import EntityListItem from "@/components/elements/entity/EntityListItem.vue";

const { sleep } = useTiming();

const props = defineProps({
  entity: {
    type: Object,
    required: true,
  },
  commandMetadata: {
    type: Array,
    required: true,
  },
  setting: {
    type: Boolean,
    default: false,
  },
});

defineExpose({
  updateEntity,
  open,
  close,
});

const integrationStorage = integrationsStore();

const instances = computed<IntegrationInstance[]>(
  () => integrationStorage.instances,
);
const entity = ref<ActivityFull | MacroFull>(
  props.entity as ActivityFull | MacroFull,
);
const commandListFilter = ref("");

const searchEntity = ref("");
const filteredEntity = ref<IncludedEntityFull | null>(null);

const showAddCommands = ref(false);
const showFilterEntity = ref(false);

const elCommandEntitySelect = useTemplateRef<HTMLDivElement>(
  "elCommandEntitySelect",
);
const direction = ref("slide-item-left");

const emit = defineEmits(["addCommand"]);

watch(showAddCommands, (val) => {
  if (val == false) {
    showFilterEntity.value = false;
    filteredEntity.value = null;
    commandListFilter.value = "";
    searchEntity.value = "";
  }
});

const reducedList = computed(() => {
  const commands: CommandItem[] = [
    {
      command_type: "delay",
      type: SequenceType.delay,
      cmd: {
        type: SequenceType.delay,
        delay: 200,
      },
    },
  ];

  const availableEntities =
    filteredEntity.value != null
      ? [filteredEntity.value]
      : (entity.value.options?.included_entities ?? []);

  availableEntities.forEach((entity: IncludedEntityFull) => {
    commands.push(
      ...getAvailableEntityCommands(
        entity,
        props.commandMetadata as EntityCommandMetadata[],
      ),
    );
  });

  // When changing filter properties, keep them in sync with the filter in CommandSelect.vue
  const filter = commandListFilter.value.toLowerCase();
  return commands.filter((cmd: CommandItem) => {
    if (!cmd || !cmd.cmd || !cmd.type) {
      return false;
    }
    try {
      const entityCmd = cmd as EntityCommandListItem;

      return (
        entityCmd.type.toLowerCase().includes(filter) ||
        searchLanguageText(entityCmd.cmd?.name, filter) ||
        (filteredEntity.value == null &&
          (searchLanguageText(entityCmd.entity?.name, filter) ||
            (entityCmd.entity?.entity_type || "")
              .toLowerCase()
              .includes(filter) ||
            (entityCmd.entity?.entity_id || "").toLowerCase().includes(filter)))
      );
    } catch {
      return false;
    }
  });
});

const availableEntities = computed(() => {
  return (entity.value.options?.included_entities ?? []).filter(
    (e: IncludedEntity) => {
      return (
        (e && e.name && searchLanguageText(e.name, searchEntity.value)) ||
        ((e && e.entity_id) || "").toLowerCase().includes(searchEntity.value)
      );
    },
  );
});

function updateEntity(newValue: ActivityFull | MacroFull) {
  entity.value = newValue;
}

function clickCommand(item: CommandItem) {
  emit("addCommand", item);
}

function isEntityCommandListItem(item: CommandItem) {
  return item.type === "command";
}

function isDelayCommandListItem(item: CommandItem) {
  return item.type === "delay";
}

function openFilterEntity() {
  direction.value = "slide-item-left";
  showFilterEntity.value = true;
  focusEntitySearch();
}

function closeFilterEntity() {
  direction.value = "slide-item-right";
  showFilterEntity.value = false;
  searchEntity.value = "";
}

async function focusEntitySearch() {
  await sleep(800);
  const searchField = elCommandEntitySelect.value?.querySelector("input");
  if (!isTouchEnabled() && searchField) {
    searchField.focus();
  }
}

function filterEntity(e: IncludedEntityFull) {
  filteredEntity.value = e;
  closeFilterEntity();
}

async function open() {
  showAddCommands.value = true;
  try {
    await integrationStorage.getInstances();
  } catch (e) {
    addErrorBottom(e);
  }
}

function close() {
  showAddCommands.value = false;
}
</script>
<template>
  <Teleport to="body">
    <ModalSecondary
      :show="showAddCommands == true"
      :width="'26.25rem'"
      :name="'modal-add-commands'"
      class="modal-secondary--add-commands"
      @close="showAddCommands = false"
    >
      <template #header>
        {{ $t("sequence.add_commands") }}
      </template>
      <hr />

      <Transition :name="direction">
        <ListWithFilter
          v-show="showFilterEntity == false"
          v-if="!setting"
          :class="{
            'list-with-filter--filtered-entity': filteredEntity != null,
          }"
          form-class="lwf-entity-list"
        >
          <template #form>
            <div class="command-select__header">
              <template v-if="filteredEntity != null">
                <div class="command-select__header__content">
                  <SelectedIcon
                    :icon="getDefaultEntityIcon(filteredEntity)"
                    :thin="true"
                  />
                  <span>{{ translatedProperty(filteredEntity.name) }}</span>
                </div>
                <button
                  class="button button--secondary button--icon button--icon--medium"
                  @click="filteredEntity = null"
                >
                  <i class="fa-light fa-filter-circle-xmark"></i>
                </button>
              </template>
              <template v-else>
                <span>{{ $t("command.assign.showing_all_commands") }}</span>
                <button
                  class="button button--secondary button--icon button--icon--medium"
                  @click="openFilterEntity"
                >
                  <i class="fa-light fa-filter"></i>
                </button>
              </template>
            </div>
            <UCSearch
              v-model="commandListFilter"
              :small="true"
              :has-sibling="false"
              :gray="true"
            />
          </template>
          <template #items>
            <div
              v-for="(item, index) in reducedList"
              :key="index"
              class="command-item"
              :class="{ 'command-item--delay': isDelayCommandListItem(item) }"
              @click="clickCommand(item)"
            >
              <SelectedIcon
                v-if="(item as EntityCommandListItem).entity?.integration?.icon"
                class="command-item__icon"
                :icon="
                  (item as EntityCommandListItem).entity?.integration?.icon ||
                  ''
                "
              />
              <div class="command-item__text">
                <div
                  v-if="isEntityCommandListItem(item)"
                  class="command-item__title"
                >
                  {{
                    translatedProperty(
                      (item as EntityCommandListItem).cmd?.name,
                    )
                  }}
                </div>
                <div
                  v-else-if="isDelayCommandListItem(item)"
                  class="command-item__title"
                >
                  {{ $t("command.delay") }}
                </div>
                <span
                  v-if="
                    isEntityCommandListItem(item) &&
                    (item as EntityCommandListItem).entity?.name
                  "
                  class="command-item__entity"
                  >{{
                    translatedProperty(
                      (item as EntityCommandListItem).entity?.name,
                    )
                  }}</span
                >
              </div>
            </div>
          </template>
        </ListWithFilter>
      </Transition>
      <Transition :name="direction">
        <div
          v-show="showFilterEntity == true"
          ref="elCommandEntitySelect"
          class="command-entity-select"
        >
          <div class="command-entity-select__header">
            <button
              class="button button--secondary button--icon button--icon--medium"
              @click="closeFilterEntity"
            >
              <i class="fa-light fa-arrow-left"></i>
            </button>
            <span>{{ $t("command.assign.select_an_entity") }}</span>
          </div>

          <ListWithFilter>
            <template #form>
              <UCSearch
                v-model="searchEntity"
                :small="true"
                :focus="true"
                :gray="true"
              />
            </template>
            <template #items>
              <div
                v-for="(ent, index) in availableEntities"
                :key="index"
                class="entity-item"
                @click="filterEntity(ent)"
              >
                <EntityListItem
                  :list-item="ent"
                  :integration-info="true"
                  :inactive="true"
                  :instances="instances"
                />
              </div>
            </template>
          </ListWithFilter>
        </div>
      </Transition>
    </ModalSecondary>
  </Teleport>
</template>
