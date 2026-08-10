<script setup lang="ts">
import { ref, watch, computed, onMounted, nextTick, useTemplateRef } from "vue";
import { asyncComputed } from "@vueuse/core";
import { useTranslation } from "i18next-vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import {
  EntityType,
  IntegrationState,
  DriverState,
  DriverType,
} from "@/types/enums";
import type { ChangeCallbackParams } from "@/types/config";
import type {
  AvailableEntity,
  ConfiguredEntity,
  IntegrationDriver,
  IntegrationInstance,
  IntegrationRequest,
  IntegrationStatus,
  EntityFilterData,
  IntegrationUpdateStatus,
} from "@/types/integrationInstance";
import type { IncludedEntity } from "@/types/activity";
import type { DraggableChangeEvent } from "@/types/draggable";

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";

import translatedProperty, {
  getCurrentLocale,
  getValueByLang,
} from "@/composables/translatedProperty";
import { deepClone, useDataHelper } from "@/composables/dataHelper";
import { getIconName } from "@/composables/icon";
import {
  getPaginationLimit,
  readPaginationMeta,
  savePaginationLimit,
} from "@/composables/listing";
import { isTouchEnabled } from "@/composables/device";

import UCInput from "@/components/ui/UCInput.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import EditDriverConnection from "@/components/driver/EditDriverConnection.vue";

import Draggable from "vuedraggable";

import FilterTabs from "@/components/ui/FilterTabs.vue";
import FilterDropdown from "@/components/elements/FilterDropdown.vue";

import UCSearch from "@/components/ui/UCSearch.vue";
import EntityListItem from "@/components/elements/entity/EntityListItem.vue";
import ListWithFilter from "@/components/elements/ListWithFilter.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";
import QuickEditModal from "@/components/elements/QuickEditModal.vue";
import AddIntegration from "@/components/integration/AddIntegration.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import ListPaging from "@/components/ui/ListPaging.vue";

const { t } = useTranslation();
const { updateExistingObjectKeys, standardizeLangTexts } = useDataHelper();

const store = integrationsStore();

const props = defineProps({
  integrationId: {
    type: String,
    required: true,
  },
});

const integration = ref<IntegrationInstance | null>(null);
const integrationValues = ref<Record<string, any>>({});

const integrationStatus = ref<IntegrationStatus | null>(null);
const driverData = ref<IntegrationDriver | null>(null);

const entities = ref<AvailableEntity[]>([]);
const configured = ref<ConfiguredEntity[]>([]);

const configuredEntitiesFilter = ref("");

const assignedConfiguredEntities = ref<ConfiguredEntity[]>([]);
const itemToEdit = ref<IncludedEntity | null>(null);

const showAvailableEntities = ref(false);
const loading = ref(false);
const integrationUpdate = ref<IntegrationUpdateStatus | null>(null);
const updatingIntegration = ref(false);
const managementBasePath = String(
  (window as Window & { __UCVR_BASE_PATH__?: string }).__UCVR_BASE_PATH__ || "",
).replace(/\/$/, "");

const dialogConfirmRemove = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogConfirmRemove",
);
const elAddIntegration =
  useTemplateRef<InstanceType<typeof AddIntegration>>("elAddIntegration");
const integrationAvailableEntities = useTemplateRef<HTMLDivElement>(
  "integrationAvailableEntities",
);

const entityListFilter = ref(<EntityFilterData>{
  searchText: "",
  entityTypes: "",
  instances: "",
});

const togglingConnection = ref(false);
const formWrapper = useTemplateRef<HTMLDivElement>("formWrapper");

const configuredEntitiesPagination = ref<PaginationMeta>({
  limit: getPaginationLimit() ?? 20,
  page: 1,
});

const availableEntitiesPagination = ref<PaginationMeta>({
  limit: getPaginationLimit() ?? 20,
  page: 1,
});

/**
 * What `ListPaging` renders: the view owns page and limit, the store owns the
 * server's total — so a refetch the view never made (the WS-event reloads)
 * still moves the footer (#685).
 */
const configuredEntitiesPaging = computed<PaginationMeta>(() => ({
  ...configuredEntitiesPagination.value,
  count: store.configuredEntitiesByPage.count,
}));

const availableEntitiesPaging = computed<PaginationMeta>(() => ({
  ...availableEntitiesPagination.value,
  count: store.availableEntitiesByPage.count,
}));

const filterConfiguredEntityTypes = ref(
  Object.keys(EntityType).reduce((obj: { [key: string]: any }, key: string) => {
    obj[key as keyof typeof EntityType] = { selected: false };
    return obj;
  }, {}),
);

store.$onAction(({ name, args, after }) => {
  if (name !== "socketUpdate") {
    return;
  }

  after(() => {
    const { entity_id, integration_id, event_type } = args[0];
    if (
      integration_id &&
      props.integrationId == integration_id &&
      event_type === "CHANGE" &&
      args[0] &&
      args[0].new_state
    ) {
      const updateInt = updateExistingObjectKeys(
        deepClone(integration.value!),
        args[0].new_state,
      );
      setIntegration(updateInt);
    }

    // An entity CHANGE needs nothing here: the store merged `new_state` into
    // the cached entity in place before calling `socketUpdate`, and
    // `configured` holds those cached objects, so the rendered row is already
    // current (spec `websocket-events` § "The render path preserves the
    // in-place merge"). Merging again — and worse, writing a clone back into
    // the cached array — is redundant and detaches the shared object (#681).
    //
    // A DELETE does need work: `applyEntityDelete` only splices the
    // *configured* lists, and a removed configured entity becomes available
    // again, so the "Add entities" picker would stay stale. It cannot be
    // narrowed to "was in my list" — the store already spliced the entity out
    // of the very array `configured` points at by the time this runs.
    // `entity_id` is unset on integration_change, which shares this action.
    if (entity_id && event_type === "DELETE") {
      reloadEntities();
    }
  });
});

watch(
  () => store.statuses,
  (newVal) => {
    const currentIntegrationStatus = newVal.find(
      (item) => item.integration_id === integration.value?.integration_id,
    );
    if (currentIntegrationStatus) {
      setStatus(currentIntegrationStatus);
    }
  },
  // statuses entries are mutated in place (WS status updates) as well as
  // replaced, so watch their contents deeply.
  { deep: true },
);

watch(
  () => store.instances,
  (newVal) => {
    const currentIntegrationInstance = newVal.find(
      (item) => item.integration_id === integration.value?.integration_id,
    );
    if (currentIntegrationInstance) {
      setIntegration(currentIntegrationInstance);
    }
  },
  // instances entries are mutated in place (WS updates) as well as replaced,
  // so watch their contents deeply.
  { deep: true },
);

watch(
  () => configuredEntitiesPagination.value.limit,
  (val) => {
    savePaginationLimit(val);

    if (!showAvailableEntities.value) {
      availableEntitiesPagination.value.limit = val;
      fetchAvailableList(true);
    }
  },
);

watch(
  () => availableEntitiesPagination.value.limit,
  (val) => {
    savePaginationLimit(val);
  },
);

const iconPuzzle = asyncComputed(async () => {
  return await getIconName("fa-puzzle-piece");
});

const isActive = computed(() => {
  return (
    (integrationStatus.value as IntegrationStatus).state ==
      IntegrationState.ACTIVE ||
    (integrationStatus.value as IntegrationStatus).state ==
      IntegrationState.CONNECTED
  );
});

const isEnabled = computed(() => {
  return (
    integrationStatus.value?.state == IntegrationState.ACTIVE ||
    integrationStatus.value?.state == IntegrationState.CONNECTING ||
    integrationStatus.value?.state == IntegrationState.CONNECTED ||
    integrationStatus.value?.state == IntegrationState.RECONNECTING
  );
});

const isExternalIntegration = computed(() => {
  return (
    driverData.value && driverData.value.driver_type === DriverType.EXTERNAL
  );
});

const instructionText = computed(() => {
  const integrName = translatedProperty(integration.value?.name);
  if (!integrName) {
    return "";
  }

  return t("integration.instruction", { name: integrName });
});

const paramConfiguredEntityTypes = computed(() => {
  return Object.entries(filterConfiguredEntityTypes.value)
    .filter(([_key, value]) => value.selected === true)
    .map(([key, _value]) => key)
    .join(",");
});

const updateSupported = computed(() =>
  Boolean(integrationUpdate.value?.supported),
);

const enabledExtendedEdit = computed(() => {
  // FIXME quick fix to make sure local integrations can always be setup!
  //       Not sure if driverData.driver_state is working here
  if (
    driverData.value?.driver_state == DriverState.ACTIVE ||
    integrationStatus.value?.driver_type == DriverType.LOCAL ||
    integrationStatus.value?.driver_type == DriverType.CUSTOM
  ) {
    return true;
  }
  // TODO do NOT use integration instance state! This is not correct: an integration driver might be active,
  //      but the device state could be disconnected! --> we are setting up the driver and not the instance!
  //      --> use IntegrationDriver.state == DriverType.ACTIVE (or `driver_state` from /api/intg)
  return (
    integrationStatus.value?.state == IntegrationState.CONNECTED ||
    integrationStatus.value?.state == IntegrationState.ACTIVE
  );
});

watch(
  entityListFilter,
  () => {
    fetchAvailableList(true);
  },
  // entityListFilter is replaced from the child's filter emit; keep deep so a
  // reused/in-place-mutated filter object still triggers a refetch.
  { deep: true },
);

watch([configuredEntitiesFilter, paramConfiguredEntityTypes], () => {
  fetchConfiguredList(true);
});

watch(showAvailableEntities, (newVal) => {
  if (newVal) {
    nextTick(() => {
      const container = integrationAvailableEntities.value as HTMLElement;
      if (!isTouchEnabled() && container) {
        const firstInput = container.querySelector("input") as HTMLElement;
        firstInput?.focus();
      }
    });
  }
});

async function fetchAvailableList(
  fetchFirstPage: boolean = false,
  reload: boolean = false,
) {
  if (fetchFirstPage === true) {
    availableEntitiesPagination.value.page = 1;
  }

  const searchText = entityListFilter.value.searchText || "";
  const entTypes = entityListFilter.value.entityTypes || "";

  try {
    const entList = await store.getAvailableEntitiesByPageByLimit(
      props.integrationId,
      reload,
      availableEntitiesPagination.value.page,
      availableEntitiesPagination.value.limit,
      searchText,
      entTypes,
    );
    entities.value = entList.data.availableEntities as AvailableEntity[];

    const listHeaders = entList.headers as Headers;
    if (listHeaders) {
      availableEntitiesPagination.value = readPaginationMeta(
        listHeaders,
        availableEntitiesPagination.value.limit,
      );
    }
  } catch (e) {
    addErrorBottom(e);
  }
}

async function fetchConfiguredList(userFetchFirstPage: boolean = false) {
  if (userFetchFirstPage === true) {
    configuredEntitiesPagination.value.page = 1;
  }

  const searchText = configuredEntitiesFilter.value;

  try {
    const entList = await store.getConfiguredEntitiesByPageByLimit(
      props.integrationId,
      false,
      configuredEntitiesPagination.value.page,
      configuredEntitiesPagination.value.limit,
      searchText,
      paramConfiguredEntityTypes.value,
    );
    configured.value = entList.data.configuredEntities as ConfiguredEntity[];

    const listHeaders = entList.headers as Headers;
    if (listHeaders) {
      configuredEntitiesPagination.value = readPaginationMeta(
        listHeaders,
        configuredEntitiesPagination.value.limit,
      );
    }
  } catch (e) {
    addErrorBottom(e);
  }
}

function setIntegration(
  newValue: IntegrationInstance,
  onInit: boolean = false,
) {
  const nameLang = integrationValues.value.name?.langCode ?? getCurrentLocale();

  integration.value = newValue;

  const integrationName = getValueByLang(newValue.name, nameLang, !onInit);

  integrationValues.value = {
    icon: newValue.icon,
    name: {
      value: integrationName.value,
      langCode: integrationName.lang,
    },
  };
}

function setStatus(instStatus: IntegrationStatus) {
  integrationStatus.value = { ...instStatus };
}

function changeFilter(data: EntityFilterData) {
  entityListFilter.value = data;
}

function changeItemIcon(change: ChangeCallbackParams) {
  integrationValues.value.icon = change.value as string;

  if (!integration.value || integration.value == null) {
    return;
  }

  const newValues = {
    name: integration.value.name,
    icon: integrationValues.value.icon,
  } as IntegrationRequest;

  submitChange(newValues);
}

function changeItemName(message: any) {
  if (!integration.value || integration.value == null) {
    return;
  }

  const name = standardizeLangTexts(
    {
      ...(integration.value.name || {}),
      [message.langCode]: message.value,
    },
    message.langCode,
  );

  const newValues = {
    name: name,
    icon: integration.value.icon,
  } as IntegrationRequest;

  submitChange(newValues);
}

async function submitChange(message: IntegrationRequest) {
  if (!integration.value) {
    return;
  }

  try {
    const newValue = await store.updateIntegration(
      integration.value.integration_id,
      message,
    );
    setIntegration(newValue);
  } catch (e) {
    addErrorBottom(e, "integration.update");
  }
}

function changeItemNameLang(lang: string) {
  integrationValues.value.name.langCode = lang;

  if (integration.value) {
    integrationValues.value.name.value = getValueByLang(
      integration.value.name,
      lang,
      true,
    ).value;
  }
}

async function onConfiguredListChange(ev: DraggableChangeEvent) {
  if (!integration.value) {
    return;
  }

  if (ev.added) {
    const { element } = ev.added;
    try {
      await store.addInstanceEntity(integration.value, element);
    } catch (e) {
      addErrorBottom(e, "integration.update");
    }

    try {
      await fetchAvailableList(true);
      await fetchConfiguredList(true);
    } catch (e) {
      console.error(e);
    }
  }
}

async function addAvailableEntities(entList: AvailableEntity[]) {
  if (!integration.value || entList.length < 1) {
    return;
  }

  const entity_ids = entList.map((entity) => {
    return entity.entity_id;
  });

  try {
    await store.addInstanceEntities(integration.value, entity_ids);
    await fetchAvailableList(true);
    await fetchConfiguredList(true);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function removeConfiguredEntities() {
  if (assignedConfiguredEntities.value.length < 1) {
    return;
  }

  const entity_ids = assignedConfiguredEntities.value.map((entity) => {
    return entity.entity_id;
  });

  try {
    await store.removeEntities(entity_ids);
    await fetchAvailableList(true);
    await fetchConfiguredList(true);
  } catch (e) {
    addErrorBottom(e);
  }
}

function startRemoveConfiguredEntities() {
  dialogConfirmRemove.value?.open();
}

function isAssignedItem(
  entity: ConfiguredEntity,
  entities: ConfiguredEntity[],
) {
  return (
    entities.findIndex(
      (item: ConfiguredEntity) => item.entity_id === entity.entity_id,
    ) > -1
  );
}

function toggleConfiguredItemCheckbox(entity: ConfiguredEntity) {
  const itemIndex = assignedConfiguredEntities.value.findIndex(
    (item: ConfiguredEntity) => item.entity_id === entity.entity_id,
  );
  if (itemIndex > -1) {
    assignedConfiguredEntities.value.splice(itemIndex, 1);
  } else {
    assignedConfiguredEntities.value.push(entity);
  }
}

function assignConfiguredEntities(array: ConfiguredEntity[]) {
  assignedConfiguredEntities.value = [];
  array.forEach((obj) => {
    assignedConfiguredEntities.value.push(obj);
  });
}

function deAssignConfiguredEntities() {
  assignedConfiguredEntities.value = [];
}

function disableEntityType(
  keyEntityType: string,
  collection: { [key: string]: any },
) {
  if (collection) {
    collection[keyEntityType].selected = false;
  }
}

async function reloadEntities() {
  fetchAvailableList(true);
  fetchConfiguredList();
}

async function managementRequest(path = "", options: RequestInit = {}) {
  const response = await fetch(
    `${managementBasePath}/management/installed-integrations${path}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    },
  );
  const payload = response.status === 204
    ? null
    : await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? String(payload.error || payload.message || "")
      : "";
    throw new Error(message || `Request returned HTTP ${response.status}`);
  }
  return payload;
}

async function loadIntegrationUpdate() {
  try {
    const item = (await managementRequest(
      `/${encodeURIComponent(props.integrationId)}`,
    )) as { update?: IntegrationUpdateStatus | null } | null;
    integrationUpdate.value = item?.update || null;
  } catch (error) {
    integrationUpdate.value = null;
    console.error(error);
  }
}

async function updateInstalledIntegration() {
  if (!integrationUpdate.value?.available || updatingIntegration.value) {
    return;
  }
  updatingIntegration.value = true;
  try {
    await managementRequest(
      `/${encodeURIComponent(props.integrationId)}/update`,
      { method: "POST", body: "{}" },
    );
    await getIntegrationData(true);
  } catch (error) {
    addErrorBottom(error);
  } finally {
    updatingIntegration.value = false;
  }
}

async function getIntegrationData(forceReload: boolean = false) {
  try {
    const integData = await store.getIntegration(props.integrationId, true);
    setIntegration(integData.inst as IntegrationInstance, true);
    setStatus(integData.status as IntegrationStatus);
    driverData.value = integData.driver;
    await loadIntegrationUpdate();

    if (
      integData.status &&
      integData.status.state === IntegrationState.ACTIVE
    ) {
      await fetchAvailableList(true, forceReload);
    }

    await fetchConfiguredList(true);
  } catch (e) {
    addErrorBottom(e);
  }
}

function editEntity(entity: IncludedEntity) {
  itemToEdit.value = entity;
}

function startSetup(driver: IntegrationDriver) {
  elAddIntegration.value?.startSetup(driver, true, props.integrationId);
}

async function restartIntegrationSetup() {
  if (integrationStatus.value) {
    if (driverData.value) {
      try {
        const newDriverData = await store.getDriver(driverData.value.driver_id);
        startSetup(newDriverData);
      } catch (e) {
        addErrorBottom(e);
      }
    }
  }
}

async function toggleIntegrationConnection() {
  togglingConnection.value = true;
  if (integration.value) {
    try {
      if (isEnabled.value) {
        await store.disconnectInst(integration.value.integration_id);
      } else {
        await store.connectInst(integration.value.integration_id);
      }
    } catch (e) {
      addErrorBottom(
        e,
        "integration.change_connection_status",
        formWrapper.value ?? undefined,
      );
    }
  }
  togglingConnection.value = false;
}

function configuredEntitiesChangePage(value: number) {
  configuredEntitiesPagination.value.page = value;
  fetchConfiguredList();
}

function configuredEntitiesChangePerPage(value: number) {
  configuredEntitiesPagination.value.page = 1;
  configuredEntitiesPagination.value.limit = value;
  fetchConfiguredList();
}

function availableEntitiesChangePage(value: number) {
  availableEntitiesPagination.value.page = value;
  fetchAvailableList();
}

function availableEntitiesChangePerPage(value: number) {
  availableEntitiesPagination.value.page = 1;
  availableEntitiesPagination.value.limit = value;
  fetchAvailableList();
}

onMounted(async () => {
  try {
    loading.value = true;
    await getIntegrationData(true);
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
});
</script>
<template>
  <div class="ep-settings">
    <div v-overflow-indicator class="ep-settings__form panel-col panel-col--40">
      <div ref="formWrapper" class="ep-settings__form__wrapper">
        <div class="ep-settings__form__header">
          <IconSelect
            :key="
              integrationValues && integrationValues.icon
                ? integrationValues.icon
                : `fa-light ${iconPuzzle}`
            "
            :value="
              integrationValues && integrationValues.icon
                ? integrationValues.icon
                : `fa-light ${iconPuzzle}`
            "
            :fallback="`fa-light ${iconPuzzle}`"
            :change-callback="changeItemIcon"
          />
        </div>
        <UCInput
          v-if="integrationValues.name"
          v-model="integrationValues.name"
          :translations="integration?.name"
          :has-lang="true"
          :full-w="true"
          :label="$t('form.name')"
          @submit="changeItemName"
          @change-lang="changeItemNameLang"
        />
        <div
          v-if="isExternalIntegration && driverData"
          class="ep-settings__driver-connection"
        >
          <div class="ep-settings__driver-connection__header">
            <span>{{ $t("integration.driver_connection.title") }}</span>
            <EditDriverConnection
              :driver="driverData"
              @close="getIntegrationData"
            />
          </div>
          <div class="ep-settings__driver-connection__body">
            <div class="ep-settings__driver-connection__row">
              <div class="ep-settings__form__meta">
                <template v-if="driverData.driver_url">
                  <span class="ep-settings__form__meta__label">{{
                    $t("integration.driver_connection.URL", "URL")
                  }}</span>
                  <span
                    class="ep-settings__form__meta__value ep-settings__form__meta__value--url"
                    :title="driverData.driver_url"
                  >
                    {{ driverData.driver_url }}
                  </span>
                </template>
              </div>
              <div class="ep-settings__form__meta">
                <span class="ep-settings__form__meta__label">{{
                  $t("integration.driver_connection.token")
                }}</span>
                <span class="ep-settings__form__meta__value">
                  <template v-if="driverData.token">{{
                    driverData.token
                  }}</template>
                  <template v-else>{{
                    $t("integration.driver_connection.token_not_set")
                  }}</template>
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="ep-settings__start-setup">
          <button
            :disabled="!enabledExtendedEdit"
            class="button button--secondary"
            @click="restartIntegrationSetup"
          >
            {{ $t("ui.start_setup") }}
          </button>
          <button
            v-if="updateSupported"
            :disabled="!integrationUpdate?.available || updatingIntegration"
            class="button button--secondary"
            :title="
              integrationUpdate?.available_version
                ? `Update to ${integrationUpdate.available_version}`
                : $t('software_update.state.up_to_date')
            "
            @click="updateInstalledIntegration"
          >
            <i class="fa-regular fa-cloud-arrow-down"></i>
            <span>{{ $t("integration.update_integration", "Update integration") }}</span>
          </button>
          <p>{{ $t("integration.start_integration") }}</p>
        </div>
        <div class="ep-settings__form__footer">
          <div class="ep-settings__form__footer__row">
            <template v-if="integrationStatus">
              <div
                class="ep-settings__form__meta ep-settings__form__meta--item-status"
                :class="`ep-settings__form__meta--${isActive ? 'green' : 'red'}`"
              >
                <i
                  class="fa-light"
                  :class="isActive ? 'fa-circle-check' : 'fa-circle-xmark'"
                ></i>
                <span>{{
                  integrationStatus.state
                    ? $t(`integration.status.${integrationStatus.state}`)
                    : $t(`integration.status.NOT_CONFIGURED`)
                }}</span>
              </div>
            </template>
          </div>
          <div class="ep-settings__form__footer__row">
            <div class="ep-settings__form__meta">
              <template v-if="integration && integration.integration_id">
                <span class="ep-settings__form__meta__label">{{
                  $t("integration.label.ID", "ID")
                }}</span>
                <span class="ep-settings__form__meta__value">{{
                  integration.integration_id
                }}</span>
              </template>
            </div>
            <div class="ep-settings__form__meta">
              <template v-if="driverData && driverData.version">
                <span class="ep-settings__form__meta__label">{{
                  $t("integration.label.version")
                }}</span>
                <span class="ep-settings__form__meta__value">{{
                  driverData.version
                }}</span>
              </template>
            </div>
          </div>
          <div
            class="ep-settings__form__footer__row ep-settings__form__footer__row--integration-developer"
          >
            <div class="ep-settings__form__meta">
              <template v-if="driverData && driverData.developer?.name">
                <span class="ep-settings__form__meta__label">{{
                  $t("integration.label.developer")
                }}</span>
                <span class="ep-settings__form__meta__value">{{
                  driverData.developer?.name
                }}</span>
              </template>
            </div>
            <div
              v-if="driverData && driverData.developer?.url"
              class="ep-settings__form__meta"
            >
              <span class="ep-settings__form__meta__label">{{
                $t("integration.label.developer_website")
              }}</span>
              <a
                :href="driverData.home_page || driverData.developer?.url"
                :title="driverData.home_page || driverData.developer?.url"
                target="_blank"
                class="ep-settings__form__meta__value"
              >
                {{ driverData.home_page || driverData.developer?.url }}
              </a>
            </div>
          </div>
          <div
            v-if="
              driverData &&
              driverData.description &&
              translatedProperty(driverData.description).length > 0
            "
            class="ep-settings__form__footer__row ep-settings__form__footer__row--description-text"
          >
            {{ translatedProperty(driverData.description) }}
          </div>
          <div
            v-else-if="instructionText && instructionText.length > 0"
            class="ep-settings__form__footer__row ep-settings__form__footer__row--description-text"
          >
            {{ instructionText }}
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="enabledExtendedEdit || loading"
      class="ep-settings__configured-entities panel-col panel-col--60"
    >
      <div class="ep-settings__configured-entities__wrapper">
        <div class="configured-entity-list__header">
          <span>
            {{ $t("entity.configured_entities.title") }}
          </span>
          <div class="configured-entity-list__header__options">
            <Transition name="opacity-fast">
              <button
                v-show="!showAvailableEntities"
                class="button button--secondary button--icon"
                @click="showAvailableEntities = true"
              >
                <i class="fa-light fa-plus"></i>
              </button>
            </Transition>
            <button
              v-if="assignedConfiguredEntities.length < configured.length"
              class="button button--secondary button--icon button-assign"
              @click="assignConfiguredEntities(configured)"
            >
              <i class="fa-light fa-check"></i>
            </button>
            <button
              v-else-if="configured.length > 0"
              class="button button--secondary button--icon button-assign"
              @click="deAssignConfiguredEntities()"
            >
              <i class="fa-light fa-xmark"></i>
            </button>
            <Transition name="opacity-fast">
              <button
                v-show="
                  assignedConfiguredEntities &&
                  assignedConfiguredEntities.length > 0
                "
                class="button button--secondary button--icon"
                @click="startRemoveConfiguredEntities"
              >
                <i class="fa-light fa-trash"></i>
              </button>
            </Transition>
          </div>
        </div>
        <ListWithFilter class="lwf-entity-list">
          <template #form>
            <div
              class="list-with-filter__search list-with-filter__search--small"
            >
              <UCSearch
                v-model="configuredEntitiesFilter"
                :debouncing="true"
                :small="true"
                :has-sibling="true"
              />
              <FilterDropdown
                ref="filter-dropdown-configured"
                v-model:filter-entity-types="filterConfiguredEntityTypes"
              />
            </div>
            <div class="list-with-filter__tabs">
              <FilterTabs
                :list="filterConfiguredEntityTypes"
                @remove-element="
                  (el) => disableEntityType(el, filterConfiguredEntityTypes)
                "
              />
            </div>
          </template>
          <template #items>
            <Draggable
              ref="elConfiguredEntityList"
              v-model="configured"
              v-overflow-indicator
              :force-fallback="true"
              class="lwf-entity-list__items"
              group="intg-configured-entities"
              item-key="entity_id"
              handle=".entity-item__drag"
              @change="onConfiguredListChange"
            >
              <template #item="{ element }">
                <div
                  class="entity-item"
                  :class="{
                    'entity-item--selected':
                      isAssignedItem(element, assignedConfiguredEntities) ===
                      true,
                  }"
                >
                  <EntityListItem
                    :list-item="element"
                    :inactive="true"
                    :edit-button="true"
                    @edit="editEntity"
                  >
                    <template #checkbox>
                      <div
                        class="form-item form-item--checkbox-tick entity-item__checkbox-tick"
                      >
                        <input
                          :id="`${element.entity_id}-checkbox-tick`"
                          type="checkbox"
                          :checked="
                            isAssignedItem(element, assignedConfiguredEntities)
                          "
                        />
                        <label
                          class="toggle"
                          :for="`${element.entity_id}-checkbox-tick`"
                        />
                        <button
                          class="button--toggle-tick"
                          @click="toggleConfiguredItemCheckbox(element)"
                        ></button>
                      </div>
                    </template>
                  </EntityListItem>
                </div>
              </template>
            </Draggable>
          </template>
          <template #pagination>
            <ListPaging
              v-if="configured && configured.length > 0"
              :pagination="configuredEntitiesPaging"
              :length="configured.length"
              @change-page="configuredEntitiesChangePage"
              @change-per-page="configuredEntitiesChangePerPage"
            />
          </template>
        </ListWithFilter>
      </div>
      <Transition
        :name="
          showAvailableEntities == true ? 'slide-tab-right' : 'slide-tab-left'
        "
      >
        <div
          v-show="showAvailableEntities == true"
          ref="integrationAvailableEntities"
          class="ep-settings__available-entities panel-col panel-col--40"
        >
          <div class="ep-settings__available-entities__wrapper">
            <div class="ep-settings__available-entities__header">
              <button
                class="button button--blank button--icon"
                @click="showAvailableEntities = false"
              >
                <i class="fa-light fa-arrow-left"></i>
              </button>
              <span>{{ $t("activity.edit.add_entities") }}</span>
            </div>
            <EntityListFiltered
              ref="entityListEditIntegration"
              :pagination="availableEntitiesPaging"
              :all-entities="entities"
              :parent="'edit-integration'"
              :has-dropdown-menu="false"
              :integration-info="false"
              @add-entities="addAvailableEntities"
              @change-filter="changeFilter"
              @reload-entities="reloadEntities"
              @change-page="availableEntitiesChangePage"
              @change-per-page="availableEntitiesChangePerPage"
            />
          </div>
        </div>
      </Transition>
    </div>
    <div v-else class="ep-settings__no-settings panel-col panel-col--60">
      <p>{{ $t("integration.no_other_settings") }}</p>
    </div>
    <AppDialog
      ref="dialogConfirmRemove"
      :title="
        assignedConfiguredEntities.length > 1
          ? $t('entity.remove_entities.title')
          : $t('entity.remove_entity.title')
      "
      :text="
        assignedConfiguredEntities.length > 1
          ? $t('entity.remove_entities.question')
          : $t('entity.remove_entity.question')
      "
      :submit-text="$t('ui.accept')"
      :cancel-text="$t('ui.cancel')"
      @submit="removeConfiguredEntities"
    />
  </div>
  <QuickEditModal
    v-if="itemToEdit != null"
    :item="itemToEdit"
    :show-by-parent="true"
    @saved="reloadEntities"
    @closed="itemToEdit = null"
  />
  <AddIntegration ref="elAddIntegration" @close="getIntegrationData" />
</template>
