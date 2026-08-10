<script setup lang="ts">
import { ref, watch } from "vue";
import { useTranslation } from "i18next-vue";

import { CfgGroups } from "@/types/enums";
import type { ErrorTexts } from "@/types/flashMessages";

import { configStore } from "@/stores/config";

import { getErrorMessage } from "@/composables/error";

import UCInput from "@/components/ui/UCInput.vue";
import ErrorBox from "@/components/ui/ErrorBox.vue";

const { t } = useTranslation();

const config = configStore();

const password = ref("");
const repeatPassword = ref("");
const errorMessage = ref("");
const errorUpdate = ref<ErrorTexts | null>(null);

watch([password, repeatPassword], () => {
  if (password.value.length == 0 && repeatPassword.value.length == 0) {
    errorMessage.value = "";
    return;
  }

  checkPwd();
});

async function savePwd() {
  clearErrors();

  if (password.value !== repeatPassword.value) {
    return (errorMessage.value = t("settings.admin_password.pass_not_match"));
  }

  try {
    await config.update(
      CfgGroups.profile as string,
      "admin_pin" as string,
      repeatPassword.value,
    );
    password.value = "";
    repeatPassword.value = "";
  } catch (e) {
    errorUpdate.value = getErrorMessage(e, "settings.admin_password.update");
  }
}

function checkPwd() {
  if (password.value !== repeatPassword.value) {
    errorMessage.value = t("settings.admin_password.pass_not_match");
  } else {
    errorMessage.value = "";
  }
}

function clearErrors() {
  if (errorMessage.value.length > 0) {
    errorMessage.value = "";
    errorUpdate.value = null;
  }
}
</script>
<template>
  <div class="page-settings-section page-settings-section--admin-password">
    <h1 class="page-settings-section__title">
      {{ $t("page.admin_password") }}
    </h1>
    <div class="page-settings-section__main">
      <div class="page-settings-section__main__info">
        {{ $t("settings.admin_password.description") }}
      </div>

      <UCInput
        v-model="password"
        :label="$t('form.password')"
        :invalid="errorMessage.length > 0"
        :type="'password'"
        :disable-blur="true"
        @click="clearErrors"
      />

      <UCInput
        v-model="repeatPassword"
        :label="$t('form.repeat_password')"
        :error-message="
          errorMessage && errorMessage.length > 0 ? errorMessage : ''
        "
        :type="'password'"
        :disable-blur="true"
        @submit="savePwd"
        @click="clearErrors"
      />

      <button
        :disabled="
          password.length < 4 ||
          repeatPassword.length < 4 ||
          errorMessage?.length > 0
        "
        class="button button--primary button--min-w"
        @click="savePwd"
      >
        {{ $t("ui.save") }}
      </button>

      <ErrorBox v-if="errorUpdate" :message="errorUpdate" :margin-top="true" />
    </div>
  </div>
</template>
