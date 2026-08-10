<script setup lang="ts">
import { computed, onBeforeMount, ref, useTemplateRef, watch } from "vue";
import type { Ref } from "vue";
import { useTranslation } from "i18next-vue";

import type { Headers, PaginationMeta } from "@/types/rest";
import type {
  ConfiguredEntity,
  IntegrationDriver,
  IntegrationInstance,
  IntegrationStatus,
  IntegrationSetupChangeMessage,
  IntegrationSetupData,
  IntegrationSetupRequiredUserAction,
  IntegrationSetupWaitingMessage,
  EntityFilterData,
  AvailableEntity,
} from "@/types/integrationInstance";

import {
  IntegrationSetupScreen,
  IntegrationSetupState,
  IntegrationState,
  DriverState,
  DriverChangeSetupState,
} from "@/types/enums";

import { integrationsStore } from "@/stores/integrations";
import { addErrorBottom } from "@/stores/messages";
import { setConfigurationValue } from "@/composables/setupFieldType";
import translatedProperty from "@/composables/translatedProperty";
import { asError } from "@/composables/error";
import { focusInput } from "@/composables/device";
import {
  getPaginationLimit,
  savePaginationLimit,
  readPaginationMeta,
} from "@/composables/listing";

import ConfigurationForm from "@/components/integration/add/form/ConfigurationForm.vue";
import ConfirmationForm from "@/components/integration/add/form/ConfirmationForm.vue";
import EntityListFiltered from "@/components/elements/entity/EntityListFiltered.vue";

const { t } = useTranslation();

const props = defineProps({
  driver: {
    type: Object,
    required: true,
  },
  parentEl: {
    type: String,
    default: "",
  },
  reconfigure: {
    type: Boolean,
    default: false,
  },
  instanceId: {
    type: String,
    default: "",
  },
  configured: {
    type: Boolean,
    default: false,
  },
});
defineExpose({
  clickCancel,
});

const emit = defineEmits(["cancel", "done", "error"]);
const store = integrationsStore();

const driver = ref<IntegrationDriver>(props.driver as IntegrationDriver);
const integration = ref<IntegrationInstance | null>(null);
const integrationStatus = ref<IntegrationStatus | null>(null);
const valuesToSetup = ref<Record<string, any>>({});
const valuesToConfig = ref<Record<string, any>>({});
const loading = ref(false);
const loadingEntityList = ref(true);
const formStep = ref(1);
const msg = ref<IntegrationSetupChangeMessage | undefined>(undefined);
const configuredDriver = ref<IntegrationDriver | null>(null);
const configuredInstanceId = ref<string | null>(null);

const msgError = ref("");
const errorsConfigurationForm = ref<any>({});

const entityListAddIntegration = useTemplateRef<
  InstanceType<typeof EntityListFiltered>
>("entityListAddIntegration");
const filteredEntities = ref<AvailableEntity[]>([]);
const entitiesAdded = ref(false);

const entityListFilter = ref(<EntityFilterData>{
  searchText: "",
  entityTypes: "",
  instances: "",
});

const pagination = ref<PaginationMeta>({
  limit: getPaginationLimit() ?? 20,
  page: 1,
});

/**
 * What `ListPaging` renders: the view owns page and limit, the store owns the
 * server's total — so a refetch the view never made (the WS-event reloads)
 * still moves the footer (#685).
 */
const paging = computed<PaginationMeta>(() => ({
  ...pagination.value,
  count: store.availableEntitiesByPage.count,
}));

const assignedEntities = ref<ConfiguredEntity[]>([]);

const errorAvailableList = ref("");

const changeSetupState = ref<DriverChangeSetupState>(
  DriverChangeSetupState.START,
);
const baseStep = ref<IntegrationSetupScreen | undefined>(undefined);
const fetchedIntegrationData = ref(false);

watch(
  [
    () => props.configured,
    () => props.driver.driver_id,
    () => props.reconfigure,
    () => props.instanceId,
    changeSetupState,
    entitiesAdded,
    msg,
  ],
  async () => {
    if (
      props.configured &&
      changeSetupState.value === DriverChangeSetupState.START
    ) {
      fetchedIntegrationData.value = false;
      formStep.value = 0;
      configuredInstanceId.value = `${props.driver.driver_id}.main`;
      await getIntegrationData();
      baseStep.value = IntegrationSetupScreen.ALREADY_CONFIGURED;
      return;
    }

    if (
      props.configured &&
      changeSetupState.value === DriverChangeSetupState.ADD_ELEMENTS &&
      entitiesAdded.value === true &&
      (!msg.value || msg.value.state !== IntegrationSetupState.ERROR)
    ) {
      formStep.value = 2;
      baseStep.value = IntegrationSetupScreen.RESULT_SUCCESS;
      return;
    }

    if (
      props.configured &&
      changeSetupState.value === DriverChangeSetupState.ADD_ELEMENTS
    ) {
      baseStep.value =
        filteredEntities.value.length < 1
          ? IntegrationSetupScreen.RESULT_SUCCESS
          : IntegrationSetupScreen.ADD_ELEMENTS;
      return;
    }

    if (msg.value) {
      if (
        msg.value.state === IntegrationSetupState.OK &&
        entitiesAdded.value === false
      ) {
        if (fetchedIntegrationData.value == false) {
          if (props.reconfigure && props.instanceId) {
            configuredInstanceId.value = props.instanceId;
          } else if (configuredInstanceId.value === null) {
            await waitForValidValue(configuredInstanceId);
          }

          await getIntegrationData(true);
          fetchedIntegrationData.value = true;
          loading.value = false;
        }

        baseStep.value =
          filteredEntities.value.length < 1
            ? IntegrationSetupScreen.RESULT_SUCCESS
            : IntegrationSetupScreen.ADD_ELEMENTS;
        return;
      }

      if (
        msg.value.state === IntegrationSetupState.OK &&
        entitiesAdded.value === true
      ) {
        baseStep.value = IntegrationSetupScreen.RESULT_SUCCESS;
        return;
      }

      if (msg.value.state === IntegrationSetupState.ERROR) {
        if (msg.value.error) {
          msgError.value = msg.value.error;
        }
        baseStep.value = IntegrationSetupScreen.RESULT_ERROR;
        return;
      }
    }

    baseStep.value = undefined;
  },
  { immediate: true },
);

watch(baseStep, () => {
  const modalIntegrationSetup = document.querySelector(
    ".modal__body--integration-setup-screen",
  ) as HTMLElement;
  if (modalIntegrationSetup) {
    focusInput(modalIntegrationSetup, true);
  }
});

watch(
  () => pagination.value.limit,
  (val) => {
    savePaginationLimit(val);
  },
);

const requireUserAction = computed<
  IntegrationSetupRequiredUserAction | undefined
>(() => {
  if (!msg.value) {
    return undefined;
  }
  return (msg.value as IntegrationSetupWaitingMessage).require_user_action;
});

const isActiveIntegration = computed(() => {
  return (
    (integrationStatus.value as IntegrationStatus).state ==
      IntegrationState.ACTIVE ||
    (integrationStatus.value as IntegrationStatus).state ==
      IntegrationState.CONNECTED
  );
});

const isActiveDriver = computed(() => {
  return (driver.value as IntegrationDriver).driver_state == DriverState.ACTIVE;
});

onBeforeMount(async () => {
  if (driver.value.setup_data_schema) {
    return;
  }
  try {
    driver.value = await store.getDriver(driver.value.driver_id);
  } catch (e) {
    addErrorBottom(e);
  }
});

store.$onAction(({ name, args, after }) => {
  if (name === "integrationSetupChange") {
    after(() => {
      void (async () => {
        msg.value = args[0];
        if (
          msg.value &&
          msg.value.state &&
          (msg.value.state === IntegrationSetupState.OK ||
            msg.value.state === IntegrationSetupState.ERROR)
        ) {
          try {
            configuredDriver.value = await store.getDriver(
              driver.value.driver_id,
            );
          } catch (e) {
            addErrorBottom(e);
          }

          if (
            msg.value &&
            msg.value.state &&
            (msg.value.state === IntegrationSetupState.ERROR ||
              (msg.value.state === IntegrationSetupState.OK &&
                configuredInstanceId.value != null))
          ) {
            loading.value = false;
          }
        } else if (msg.value.state === IntegrationSetupState.SETUP) {
          loading.value = true;
        } else if (msg.value.state === IntegrationSetupState.WAIT_USER_ACTION) {
          loading.value = false;
        }
      })();
    });
  } else if (name === "socketUpdate") {
    // args[0] is narrowed to the typed WsMsgData envelope by Pinia $onAction.
    const msg_data = args[0];
    if (
      msg_data.driver_id === driver.value.driver_id &&
      msg_data.event_type === "NEW" &&
      msg_data.integration_id
    ) {
      configuredInstanceId.value = msg_data.integration_id;
    }
  }
});

watch(
  () => [store.statuses, store.instances],
  () => {
    if (
      baseStep.value === IntegrationSetupScreen.RESULT_SUCCESS &&
      integration.value &&
      integration.value.integration_id
    ) {
      const currentIntegrationStatus = store.statuses.find(
        (item) => item.integration_id === integration.value!.integration_id,
      );
      const currentIntegrationInstance = store.instances.find(
        (item) => item.integration_id === integration.value!.integration_id,
      );

      if (currentIntegrationStatus) {
        setIntegrationStatus(currentIntegrationStatus as IntegrationStatus);
      }

      if (currentIntegrationInstance) {
        setIntegration(currentIntegrationInstance as IntegrationInstance);
      }
    }
  },
  // statuses/instances entries are mutated in place (WS status updates) as
  // well as replaced, so watch their contents deeply.
  { deep: true },
);

function waitForValidValue<T>(
  refValue: Ref<T | null | undefined>,
  timeoutMs = 20000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (refValue.value != null) {
      resolve(refValue.value);
      return;
    }

    const stop = watch(refValue, (newVal) => {
      if (newVal != null) {
        cleanup();
        resolve(newVal);
      }
    });

    const timeoutId = setTimeout(() => {
      cleanup();
      msgError.value = t("error.TIMEOUT");
      baseStep.value = IntegrationSetupScreen.RESULT_ERROR;
      reject(new Error("waitForValidValue timeout"));
      loading.value = false;
    }, timeoutMs);

    function cleanup() {
      stop();
      clearTimeout(timeoutId);
    }
  });
}

async function getIntegrationData(forceReload: boolean = false) {
  if (configuredInstanceId.value === null) return false;

  try {
    const allData = await store.getIntegration(
      configuredInstanceId.value,
      true,
    );
    setIntegration(allData.inst as IntegrationInstance);
    setIntegrationStatus(allData.status as IntegrationStatus);
    await fetchFilteredEntities(true, forceReload);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function clickCancel() {
  try {
    await store.stopSetupIntegration(driver.value.driver_id);
  } catch (e) {
    const err = asError(e);
    if (err.response && err.response.status && err.response.status == 404) {
      console.error(e);
    } else {
      addErrorBottom(e);
    }
  }

  formStep.value = 1;
  msg.value = undefined;
  entitiesAdded.value = false;
  assignedEntities.value = [];
  errorsConfigurationForm.value = {};
  emit("cancel");
}

async function clickNext() {
  loading.value = true;
  errorsConfigurationForm.value = {};
  try {
    if (formStep.value === 1) {
      await store.startSetupIntegration(
        driver.value.driver_id,
        props.reconfigure || props.configured,
        { input_values: { ...valuesToSetup.value } },
      );
      formStep.value = 2;
    } else if (formStep.value === 2) {
      let data: Partial<IntegrationSetupData> = {};
      if (requireUserAction.value?.confirmation) {
        data = { confirm: true };
      } else if (requireUserAction.value?.input) {
        data = { input_values: { ...valuesToConfig.value } };
      }

      await store.continueSetupIntegration(
        driver.value.driver_id,
        data as IntegrationSetupData,
      );
    }
  } catch (e) {
    const err = asError(e);
    if (err.response && err.response.data && err.response.data.message) {
      setFormError(err.response.data.message);
    }
    loading.value = false;
  }
}

async function clickTryAgain() {
  try {
    await store.stopSetupIntegration(driver.value.driver_id);
  } catch (e) {
    const err = asError(e);
    if (err.response && err.response.status && err.response.status == 404) {
      console.error(e);
    } else {
      addErrorBottom(e);
    }
  }

  formStep.value = 1;
  msg.value = undefined;
  errorsConfigurationForm.value = {};
}

function clickRestart() {
  formStep.value = 1;
  msg.value = undefined;
  errorsConfigurationForm.value = {};
}

function shouldDelValue(value: any) {
  return typeof value === "undefined" || value === null;
}

function onSetupValueChange(id: string, value: any) {
  if (shouldDelValue(value)) {
    delete valuesToSetup.value[id];
  } else {
    valuesToSetup.value[id] = String(value);
  }

  setConfigurationValue(
    driver.value.setup_data_schema?.settings || [],
    id,
    value,
  );
}

function onConfigValueChange(id: string, value: any) {
  if (shouldDelValue(value)) {
    delete valuesToConfig.value[id];
  } else {
    valuesToConfig.value[id] = String(value);
  }
  setConfigurationValue(
    requireUserAction.value?.input?.settings || [],
    id,
    value,
  );
}

function setIntegration(instance: IntegrationInstance) {
  integration.value = { ...instance };
}

function setIntegrationStatus(instStatus: IntegrationStatus) {
  integrationStatus.value = { ...instStatus };
}

async function fetchFilteredEntities(
  fetchFirstPage: boolean = false,
  reload: boolean = false,
) {
  errorAvailableList.value = "";
  if (fetchFirstPage === true) {
    pagination.value.page = 1;
  }

  const searchText = entityListFilter.value.searchText || "";
  const entTypes = entityListFilter.value.entityTypes || "";

  try {
    const entList = await store.getAvailableEntitiesByPageByLimit(
      integration.value?.integration_id || "",
      reload,
      pagination.value.page,
      pagination.value.limit,
      searchText,
      entTypes,
    );
    filteredEntities.value = entList.data
      .availableEntities as AvailableEntity[];

    const listHeaders = entList.headers as Headers;
    if (listHeaders) {
      pagination.value = readPaginationMeta(
        listHeaders,
        pagination.value.limit,
      );
    }

    if (loadingEntityList.value === true) {
      loadingEntityList.value = false;
    }
  } catch (e) {
    if (loadingEntityList.value === true) {
      loadingEntityList.value = false;
    }

    const err = asError(e);
    if (
      err.response &&
      err.response.data &&
      (err.response.data.code || err.response.data.message)
    ) {
      errorAvailableList.value =
        t(`error.${err.response.data.code}`) || err.response.data.message || "";
    } else if (err.code || err.message) {
      errorAvailableList.value = t(`error.${err.code}`) || err.message || "";
    }
  }
}

function setFormError(msg: string) {
  errorsConfigurationForm.value = {};
  const fieldStartIndex = msg.indexOf("field") + 7;
  let fieldEndIndex = msg.indexOf("'", fieldStartIndex);
  if (fieldEndIndex < 1) {
    fieldEndIndex = msg.length;
  }
  const fieldName =
    fieldStartIndex > 6
      ? msg.substring(fieldStartIndex, fieldEndIndex)
      : "general";
  const fieldValue = msg;

  errorsConfigurationForm.value[fieldName] = fieldValue;
}

function reconfigureDriver() {
  formStep.value = 1;
  changeSetupState.value = DriverChangeSetupState.SETUP;
}

async function clickDone() {
  try {
    await store.stopSetupIntegration(driver.value.driver_id);
  } catch {
    // best-effort cleanup: ignore if the setup flow was already stopped
  }
  emit("done", configuredDriver.value);
}

async function addEntitiesToIntegration(addAll: boolean = false) {
  if (
    !integration.value ||
    typeof integration.value === "undefined" ||
    (addAll == false && assignedEntities.value.length < 1)
  ) {
    entitiesAdded.value = true;
    return;
  }

  const entityIds = addAll
    ? (
        entityListAddIntegration.value?.getEntityList() as ConfiguredEntity[]
      ).map((entity) => entity.entity_id)
    : assignedEntities.value.map((entity) => entity.entity_id);

  try {
    await store.addInstanceEntities(integration.value, entityIds);
    assignedEntities.value = [];
    entitiesAdded.value = true;
  } catch (e) {
    addErrorBottom(e);
  }
}

function startAddElements() {
  entitiesAdded.value = false;
  baseStep.value = IntegrationSetupScreen.ADD_ELEMENTS;
  fetchFilteredEntities(true);
}

function changeFilter(data: EntityFilterData) {
  entityListFilter.value = data;
  fetchFilteredEntities(true);
}

function reloadEntities() {
  fetchFilteredEntities(true);
}

function changeAssignedEntities(val: ConfiguredEntity[]) {
  assignedEntities.value = val;
}

function changePage(value: number) {
  pagination.value.page = value;
  fetchFilteredEntities();
}

function changePerPage(value: number) {
  pagination.value.page = 1;
  pagination.value.limit = value;
  fetchFilteredEntities();
}
</script>
<template>
  <div class="modal__body modal__body--integration-setup-screen">
    <!-- ALREADY CONFIGURED -->
    <Transition :name="'slide-tab-left'">
      <div
        v-if="baseStep === IntegrationSetupScreen.ALREADY_CONFIGURED"
        class="modal__body__step add-integration__step add-integration__step--setup__already-configured"
      >
        <div
          v-overflow-indicator
          class="modal__body__step__body modal--add__base-data"
        >
          <p class="add-integration__step__description">
            {{ $t("integration.add.already_configured.info") }}
          </p>

          <div v-if="driver" class="databoard">
            <div class="databoard__row">
              <div class="databoard__item">
                <span class="databoard__item__label">{{
                  $t("integration.add.label.state")
                }}</span>
              </div>
              <div
                v-if="integration && integrationStatus != null"
                class="databoard__item"
              >
                <span
                  class="databoard__item__value databoard__item__value--status"
                  :class="`databoard__item__value--${isActiveIntegration ? 'green' : 'red'}`"
                >
                  <i
                    class="fa-light"
                    :class="
                      isActiveIntegration
                        ? 'fa-circle-check'
                        : 'fa-circle-xmark'
                    "
                  ></i>
                  <span>{{
                    integrationStatus.state
                      ? $t(`integration.status.${integrationStatus.state}`)
                      : $t(`integration.status.NOT_CONFIGURED`)
                  }}</span>
                </span>
              </div>
              <div v-else class="databoard__item">
                <span
                  class="databoard__item__value databoard__item__value--status"
                  :class="`databoard__item__value--${isActiveDriver ? 'green' : 'red'}`"
                >
                  <i
                    class="fa-light"
                    :class="
                      isActiveDriver ? 'fa-circle-check' : 'fa-circle-xmark'
                    "
                  ></i>
                  <span v-if="driver.driver_state === DriverState.ACTIVE">{{
                    $t("integration.driver.state_active")
                  }}</span>
                  <span v-else>{{
                    $t("integration.driver.state_inactive")
                  }}</span>
                </span>
              </div>
            </div>
            <div class="databoard__row">
              <div class="databoard__item">
                <span class="databoard__item__label">{{
                  $t("integration.add.label.ID", "ID")
                }}</span>
                <span class="databoard__item__value">
                  <template v-if="integration && integration.integration_id">{{
                    integration.integration_id
                  }}</template>
                  <template v-else>{{ driver.driver_id }}</template>
                </span>
              </div>
              <div class="databoard__item">
                <span class="databoard__item__label">{{
                  $t("integration.add.label.version")
                }}</span>
                <span class="databoard__item__value">{{ driver.version }}</span>
              </div>
            </div>
            <div class="databoard__row databoard__row--developer">
              <div v-if="driver.developer?.name" class="databoard__item">
                <span class="databoard__item__label">{{
                  $t("integration.add.label.developer")
                }}</span>
                <span class="databoard__item__value">{{
                  driver.developer?.name
                }}</span>
              </div>
              <div
                v-if="driver.developer?.url || driver.home_page"
                class="databoard__item"
              >
                <span class="databoard__item__label">{{
                  $t("integration.add.label.developer_website")
                }}</span>
                <a
                  class="databoard__item__value databoard__item__value--url"
                  :href="driver.developer?.url || driver.home_page"
                  :title="driver.developer?.url || driver.home_page"
                  target="_blank"
                >
                  {{ driver.developer?.url || driver.home_page }}
                </a>
              </div>
            </div>
            <div
              v-if="
                driver &&
                driver?.description &&
                translatedProperty(driver?.description).length > 0
              "
              class="databoard__row"
            >
              <span class="databoard__text">{{
                translatedProperty(driver?.description)
              }}</span>
            </div>
            <div v-else-if="driver.name" class="databoard__row">
              <span class="databoard__text">
                {{
                  $t("integration.add.connect_external.instruction", {
                    name: translatedProperty(driver.name),
                  })
                }}
              </span>
            </div>
          </div>

          <div class="add-integration__step__option-list">
            <div
              class="add-integration__step__option-item"
              @click="startAddElements"
            >
              <div class="add-integration__step__option-item__icon">
                <i class="fa-thin fa-square-plus"></i>
              </div>
              <div class="add-integration__step__option-item__text">
                <span class="add-integration__step__option-item__title">{{
                  $t(
                    "integration.add.already_configured.options.add_entities.title",
                  )
                }}</span>
                <span class="add-integration__step__option-item__description">{{
                  $t(
                    "integration.add.already_configured.options.add_entities.description",
                  )
                }}</span>
              </div>
              <div class="add-integration__step__option-item__action">
                <i class="fa-regular fa-chevron-right"></i>
              </div>
            </div>
            <div
              class="add-integration__step__option-item"
              @click="reconfigureDriver"
            >
              <div class="add-integration__step__option-item__icon">
                <i class="fa-thin fa-gear"></i>
              </div>
              <div class="add-integration__step__option-item__text">
                <span class="add-integration__step__option-item__title">{{
                  $t(
                    "integration.add.already_configured.options.start_setup.title",
                  )
                }}</span>
                <span class="add-integration__step__option-item__description">{{
                  $t(
                    "integration.add.already_configured.options.start_setup.description",
                  )
                }}</span>
              </div>
              <div class="add-integration__step__option-item__action">
                <i class="fa-regular fa-chevron-right"></i>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
    <!-- ADD ELEMENTS -->
    <Transition :name="'slide-tab-left'">
      <div
        v-if="baseStep === IntegrationSetupScreen.ADD_ELEMENTS"
        class="modal__body__step add-integration__step add-integration__step--setup__add-elements"
      >
        <div
          class="modal__body__step__body modal__body__step__body--list modal--add__base-data"
        >
          <span class="add-integration__step__title">{{
            $t("integration.add.add_elements.title")
          }}</span>

          <p
            v-if="false && errorAvailableList && errorAvailableList.length > 0"
            class="add-integration__step__error"
          >
            {{ errorAvailableList }}
          </p>
          <EntityListFiltered
            v-if="loadingEntityList == false"
            ref="entityListAddIntegration"
            :pagination="paging"
            :all-entities="filteredEntities"
            :has-action-buttons="false"
            :has-form-action-buttons="true"
            :has-quick-options="false"
            :has-dropdown-menu="false"
            :integration-info="false"
            :parent="'add-integration'"
            @change-filter="changeFilter"
            @reload-entities="reloadEntities"
            @change-assigned-entities="changeAssignedEntities"
            @change-page="changePage"
            @change-per-page="changePerPage"
          />
        </div>
      </div>
    </Transition>

    <!-- FORM -->
    <Transition :name="'slide-tab-left'">
      <div
        v-if="formStep === 1"
        class="modal__body__step add-integration__step add-integration__step--setup__form"
      >
        <div class="modal__body__step__body modal--add__base-data">
          <ConfigurationForm
            :id-prefix="driver.driver_id"
            :settings="driver.setup_data_schema?.settings || []"
            :errors="errorsConfigurationForm"
            class-name="add-integration__configuration-form"
            @change="onSetupValueChange"
          />
        </div>
      </div>
    </Transition>

    <!-- FORM -->
    <Transition :name="'slide-tab-left'">
      <div
        v-if="formStep === 2 && !baseStep"
        class="modal__body__step add-integration__step add-integration__step--setup__form"
      >
        <div class="modal__body__step__body modal--add__base-data">
          <ConfigurationForm
            v-if="requireUserAction?.input?.settings"
            :id-prefix="driver.driver_id"
            :settings="requireUserAction?.input?.settings"
            :errors="errorsConfigurationForm"
            class-name="add-integration__configuration-form"
            @change="onConfigValueChange"
          />
          <ConfirmationForm
            v-if="requireUserAction?.confirmation"
            class-name="add-integration__confirmation-form"
            :confirmation="requireUserAction?.confirmation"
          />
        </div>
      </div>
    </Transition>

    <!-- SUCCESS -->
    <Transition :name="'slide-tab-left'">
      <div
        v-if="
          formStep === 2 &&
          baseStep &&
          baseStep === IntegrationSetupScreen.RESULT_SUCCESS &&
          driver
        "
        class="modal__body__step add-integration__step add-integration__step--setup__result-success"
      >
        <div
          v-overflow-indicator
          class="modal__body__step__body modal--add__base-data"
        >
          <div class="add-integration__message-form">
            <span
              class="add-integration__step__icon add-integration__step__icon--green"
            >
              <i class="fa-light fa-circle-check"></i>
            </span>
            <span class="add-integration__step__title">{{
              $t("integration.add.success.title")
            }}</span>
            <p class="add-integration__step__description">
              {{ $t("integration.add.success.description") }}
            </p>

            <div v-if="driver" class="databoard">
              <div class="databoard__row">
                <div class="databoard__item">
                  <span class="databoard__item__label">{{
                    $t("integration.add.label.state")
                  }}</span>
                </div>
                <div
                  v-if="integration && integrationStatus != null"
                  class="databoard__item"
                >
                  <span
                    class="databoard__item__value databoard__item__value--status"
                    :class="`databoard__item__value--${isActiveIntegration ? 'green' : 'red'}`"
                  >
                    <i
                      class="fa-light"
                      :class="
                        isActiveIntegration
                          ? 'fa-circle-check'
                          : 'fa-circle-xmark'
                      "
                    ></i>
                    <span>{{
                      integrationStatus.state
                        ? $t(`integration.status.${integrationStatus.state}`)
                        : $t(`integration.status.NOT_CONFIGURED`)
                    }}</span>
                  </span>
                </div>
                <div v-else class="databoard__item">
                  <span
                    class="databoard__item__value databoard__item__value--status"
                    :class="`databoard__item__value--${isActiveDriver ? 'green' : 'red'}`"
                  >
                    <i
                      class="fa-light"
                      :class="
                        isActiveDriver ? 'fa-circle-check' : 'fa-circle-xmark'
                      "
                    ></i>
                    <span v-if="driver.driver_state === DriverState.ACTIVE">{{
                      $t("integration.driver.state_active")
                    }}</span>
                    <span v-else>{{
                      $t("integration.driver.state_inactive")
                    }}</span>
                  </span>
                </div>
              </div>
              <div class="databoard__row">
                <div class="databoard__item">
                  <span class="databoard__item__label">{{
                    $t("integration.add.label.ID", "ID")
                  }}</span>
                  <span class="databoard__item__value">
                    <template
                      v-if="integration && integration.integration_id"
                      >{{ integration.integration_id }}</template
                    >
                    <template v-else>{{ driver.driver_id }}</template>
                  </span>
                </div>
                <div class="databoard__item">
                  <span class="databoard__item__label">{{
                    $t("integration.add.label.version")
                  }}</span>
                  <span class="databoard__item__value">{{
                    driver.version
                  }}</span>
                </div>
              </div>
              <div class="databoard__row databoard__row--developer">
                <div v-if="driver.developer?.name" class="databoard__item">
                  <span class="databoard__item__label">{{
                    $t("integration.add.label.developer")
                  }}</span>
                  <span class="databoard__item__value">{{
                    driver.developer?.name
                  }}</span>
                </div>
                <div
                  v-if="driver.developer?.url || driver.home_page"
                  class="databoard__item"
                >
                  <span class="databoard__item__label">{{
                    $t("integration.add.label.developer_website")
                  }}</span>
                  <a
                    class="databoard__item__value databoard__item__value--url"
                    :href="driver.developer?.url || driver.home_page"
                    :title="driver.developer?.url || driver.home_page"
                    target="_blank"
                  >
                    {{ driver.developer?.url || driver.home_page }}
                  </a>
                </div>
              </div>
              <div
                v-if="
                  driver &&
                  driver?.description &&
                  translatedProperty(driver?.description).length > 0
                "
                class="databoard__row"
              >
                <span class="databoard__text">{{
                  translatedProperty(driver?.description)
                }}</span>
              </div>
              <div v-else-if="driver.name" class="databoard__row">
                <span class="databoard__text">
                  {{
                    $t("integration.add.connect_external.instruction", {
                      name: translatedProperty(driver.name),
                    })
                  }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ERROR -->
    <Transition :name="'slide-tab-left'">
      <div
        v-if="
          formStep === 2 &&
          baseStep &&
          baseStep === IntegrationSetupScreen.RESULT_ERROR
        "
        class="modal__body__step add-integration__step add-integration__step--setup__result-error"
      >
        <div
          v-overflow-indicator
          class="modal__body__step__body modal--add__base-data"
        >
          <div class="add-integration__message-form">
            <span
              class="add-integration__step__icon add-integration__step__icon--red"
            >
              <i class="fa-light fa-warning"></i>
            </span>
            <span class="add-integration__step__title">{{
              $t("integration.add.fail.title")
            }}</span>
            <p class="add-integration__step__description">
              {{ $t("integration.add.fail.description") }}
            </p>
            <p
              v-if="msgError && msgError.length > 0"
              class="add-integration__step__error"
            >
              {{ msgError }}
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </div>
  <div
    v-if="
      baseStep === IntegrationSetupScreen.ADD_ELEMENTS ||
      formStep === 1 ||
      (formStep === 2 && !baseStep) ||
      (formStep === 2 &&
        baseStep &&
        baseStep === IntegrationSetupScreen.RESULT_SUCCESS &&
        driver) ||
      (formStep === 2 &&
        baseStep &&
        baseStep === IntegrationSetupScreen.RESULT_ERROR)
    "
    class="modal__footer"
    :class="{
      'modal__footer--rows':
        formStep === 2 &&
        !baseStep &&
        errorsConfigurationForm &&
        errorsConfigurationForm.general,
    }"
  >
    <template v-if="baseStep === IntegrationSetupScreen.ADD_ELEMENTS">
      <button
        v-if="assignedEntities.length > 0"
        class="button button--primary button--min-w"
        @click="() => addEntitiesToIntegration()"
      >
        {{ $t("ui.add") }}
      </button>
      <div
        v-else
        :class="{
          'add-integration__step__buttons': errorAvailableList.length < 1,
        }"
      >
        <button
          v-if="errorAvailableList.length < 1"
          class="button button--secondary button--min-w"
          @click="addEntitiesToIntegration(true)"
        >
          {{ $t("ui.add_all") }}
        </button>
        <button
          class="button button--primary button--min-w"
          @click="() => addEntitiesToIntegration()"
        >
          {{ $t("ui.skip") }}
        </button>
      </div>
    </template>
    <template v-else-if="formStep === 1">
      <p
        v-if="errorsConfigurationForm && errorsConfigurationForm.general"
        class="add-integration__step__error"
      >
        {{ errorsConfigurationForm.general }}
      </p>
      <div
        v-if="errorsConfigurationForm && errorsConfigurationForm.general"
        class="add-integration__step__buttons"
      >
        <button class="button button--tertiary" @click="clickCancel">
          {{ $t("ui.cancel") }}
        </button>
        <button class="button button--primary" @click="clickTryAgain">
          {{ $t("ui.try_again") }}
        </button>
      </div>
      <button
        v-else
        class="button button--primary button--min-w"
        @click="clickNext"
      >
        {{ $t("ui.next") }}
      </button>
    </template>
    <template v-else-if="formStep === 2 && !baseStep">
      <p
        v-if="errorsConfigurationForm && errorsConfigurationForm.general"
        class="add-integration__step__error"
      >
        {{ errorsConfigurationForm.general }}
      </p>
      <button class="button button--primary button--min-w" @click="clickNext">
        {{ $t("ui.next") }}
      </button>
    </template>
    <button
      v-else-if="
        formStep === 2 &&
        baseStep &&
        baseStep === IntegrationSetupScreen.RESULT_SUCCESS &&
        driver
      "
      class="button button--primary button--min-w"
      @click="clickDone"
    >
      {{ $t("ui.done") }}
    </button>
    <div
      v-else-if="
        formStep === 2 &&
        baseStep &&
        baseStep === IntegrationSetupScreen.RESULT_ERROR
      "
      class="add-integration__step__buttons"
    >
      <button class="button button--tertiary" @click="clickCancel">
        {{ $t("ui.cancel") }}
      </button>
      <button class="button button--primary" @click="clickTryAgain">
        {{ $t("ui.try_again") }}
      </button>
    </div>
  </div>

  <Transition :name="'opacity'">
    <div v-if="loading" class="modal__body__loading">
      <img
        src="/images/loading-indicator.png"
        alt="Loading"
        class="img-loading"
      />
      <span>{{ $t("integration.add.setting_up") }}</span>
    </div>
  </Transition>
</template>
