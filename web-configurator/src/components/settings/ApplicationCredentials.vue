<script setup lang="ts">
import { ref, watch, computed, onMounted } from "vue";
import type { SelectOption } from "@/types/ui";

import type {
  ExternalSystem,
  ApplicationCredentialNewData,
} from "@/types/externalToken";

import { authExternalStore } from "@/stores/authExternal";
import { addErrorBottom } from "@/stores/messages";

import { getErrorMessage, asError } from "@/composables/error";

import UCInput from "@/components/ui/UCInput.vue";
import UCSelect from "@/components/ui/UCSelect.vue";
import AppModal from "@/components/elements/AppModal.vue";
import ListApplicationCredentials from "@/components/elements/ListApplicationCredentials.vue";
import ErrorBox from "@/components/ui/ErrorBox.vue";
import { deepClone } from "@/composables/dataHelper";

const authExternalStorage = authExternalStore();

const availableExternalSystems = ref<ExternalSystem[]>([]);
const oAuthExternalSystems = ref<ExternalSystem[]>([]);
const showAddModal = ref(false);
const name = ref("");
const clientID = ref("");
const clientSecret = ref("");
const creating = ref(false);
const selectedExternalSystem = ref({ label: "", value: "" });
const errorMessage = ref("");
const fieldErrors = ref<any>({});

watch(showAddModal, (val) => {
  if (
    val &&
    availableExternalSystemOptions.value &&
    availableExternalSystemOptions.value.length === 1
  ) {
    changeSelectedExternalSystem(availableExternalSystemOptions.value[0]);
  }
});

const availableExternalSystemOptions = computed(() => {
  return availableExternalSystems.value.map((s) => ({
    label: s.name,
    value: s.system,
  }));
});

async function createCredential() {
  if (selectedExternalSystem.value.value.length < 1) return;

  creating.value = true;
  const message = {
    name: name.value,
    token_id: clientID.value,
    token: clientSecret.value,
    token_type: "OAUTH2_APP",
  } as ApplicationCredentialNewData;

  try {
    await authExternalStorage.createNewApplicationCredential(
      message,
      selectedExternalSystem.value.value,
    );
    fetchLists(true);
    closedModal();
  } catch (e) {
    const err = asError(e);
    if (
      err.response?.data?.code != "VALIDATION_ERROR" &&
      err.response?.status != 400
    ) {
      errorMessage.value =
        getErrorMessage(e)?.message ?? err.response?.data?.message;
    } else if (
      err.response?.data?.errors &&
      err.response?.data?.errors.length > 0
    ) {
      setFieldErrors(err.response?.data?.errors);
    } else {
      errorMessage.value =
        err.response?.data?.message ?? getErrorMessage(e)?.message;
    }
  }
  creating.value = false;
}

function changeSelectedExternalSystem(value: SelectOption<string>) {
  selectedExternalSystem.value = value;

  if (selectedExternalSystem.value.label) {
    name.value = deepClone(selectedExternalSystem.value.label);
  }
}

function closedModal() {
  showAddModal.value = false;
  selectedExternalSystem.value = { label: "", value: "" };
  name.value = "";
  clientID.value = "";
  clientSecret.value = "";
  clearErrors();
}

function setFieldErrors(errors: any[]) {
  errors.forEach((e) => {
    fieldErrors.value[e.field] = e.field_errors[0];
  });
}

function getFieldError(fieldId: string) {
  if (fieldId && fieldErrors.value[fieldId]?.message !== undefined) {
    return fieldErrors.value[fieldId].message ?? "";
  }

  return "";
}

function clearErrors() {
  if (errorMessage.value.length > 0) {
    errorMessage.value = "";
  }
  fieldErrors.value = {};
}

async function fetchOAuthSystemList(reload = false) {
  try {
    oAuthExternalSystems.value =
      await authExternalStorage.getOAuthExternals(reload);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function fetchSystemList(reload = false) {
  try {
    availableExternalSystems.value =
      await authExternalStorage.getIntegrationExternalsWithoutCredentials(
        reload,
      );
  } catch (e) {
    addErrorBottom(e);
  }
}

async function deleteCredential(id: string) {
  try {
    await authExternalStorage.deleteAccessTokens(id);
    fetchLists(true);
  } catch (e) {
    addErrorBottom(e);
  }
}

function fetchLists(reload = false) {
  fetchOAuthSystemList(reload);
  fetchSystemList(reload);
}

onMounted(() => {
  fetchLists();
});
</script>
<template>
  <div
    class="page-settings-section page-settings-section--application-credentials"
  >
    <h1 class="page-settings-section__title">
      {{ $t("page.application_credentials") }}
    </h1>
    <div class="page-settings-section__main">
      <button class="button button--secondary" @click="showAddModal = true">
        {{ $t("application_credentials.add.title") }}
      </button>

      <div class="page-settings-section__main__info">
        {{ $t("settings.application_credentials.description") }}
        <a href="https://support.unfoldedcircle.com/" target="_blank">{{
          $t("application_credentials.add.learn_more")
        }}</a>
      </div>

      <ListApplicationCredentials
        :credentials="oAuthExternalSystems"
        @delete="deleteCredential"
      />

      <Teleport to="body">
        <AppModal
          :show="showAddModal"
          :name="'add-application-credential'"
          class="modal--add-application-credential"
          @close="closedModal"
        >
          <template #header>
            {{ $t("application_credentials.add.title") }}
          </template>
          <p>
            {{ $t("application_credentials.add.description") }}
            <a href="https://support.unfoldedcircle.com/" target="_blank">{{
              $t("application_credentials.add.learn_more")
            }}</a>
          </p>

          <div class="select-extra">
            <div class="select-extra__text">
              <span class="select-extra__label">
                {{ $t("application_credentials.add.integration") }}
              </span>
            </div>
            <UCSelect
              v-model="selectedExternalSystem"
              :options="availableExternalSystemOptions"
              :dynamic-width="true"
              :dynamic-position="true"
              :light="true"
              @select="changeSelectedExternalSystem"
            />
          </div>

          <UCInput
            v-model="name"
            :label="$t('application_credentials.add.name')"
            :type="'text'"
            :disable-blur="true"
            :error-message="getFieldError('name')"
            @click="clearErrors"
          />

          <UCInput
            v-model="clientID"
            :label="$t('application_credentials.add.client_id.label')"
            :description="
              $t('application_credentials.add.client_id.description')
            "
            :type="'text'"
            :disable-blur="true"
            :error-message="getFieldError('token_id')"
            @click="clearErrors"
          />

          <UCInput
            v-model="clientSecret"
            :label="$t('application_credentials.add.client_secret.label')"
            :description="
              $t('application_credentials.add.client_secret.description')
            "
            :type="'password'"
            :disable-blur="true"
            :error-message="getFieldError('token')"
            @click="clearErrors"
          />
          <ErrorBox v-if="errorMessage" :message="errorMessage" />

          <template #footer>
            <button
              :disabled="
                creating ||
                name.length < 1 ||
                clientID.length < 1 ||
                clientSecret.length < 1 ||
                errorMessage?.length > 0 ||
                selectedExternalSystem?.value.length < 1
              "
              class="button button--primary button--min-w"
              @click="createCredential"
            >
              {{ $t("ui.add") }}
            </button>
          </template>
        </AppModal>
      </Teleport>
    </div>
  </div>
</template>
