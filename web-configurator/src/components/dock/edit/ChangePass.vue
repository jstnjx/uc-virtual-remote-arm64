<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";

import type { DockConfiguration } from "@/types/dock";

import { docksStore } from "@/stores/docks";
import { addErrorBottom } from "@/stores/messages";

import { useTiming } from "@/composables/timing";
import { isTouchEnabled } from "@/composables/device";
import { canChangePassword, isDockActive } from "@/composables/dockValidation";

import UCInput from "@/components/ui/UCInput.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import ModalSecondary from "@/components/elements/ModalSecondary.vue";

const { sleep } = useTiming();

const props = defineProps({
  dock: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["closed"]);

const dockStorage = docksStore();

const dock = ref<DockConfiguration>(props.dock as DockConfiguration);
const showModal = ref(false);
const modalChangePass =
  useTemplateRef<InstanceType<typeof ModalSecondary>>("modalChangePass");

const pass1 = ref("");
const pass2 = ref("");
const changeDockToken = ref(true);

const isActive = computed(() => {
  return isDockActive(props.dock.state);
});

const validForSubmit = computed(() => {
  return canChangePassword(
    props.dock.state,
    pass1.value,
    pass2.value,
    changeDockToken.value,
  );
});

watch(showModal, async (val) => {
  if (val) {
    await sleep(100);
    const firstInput = document.querySelector(
      ".dock-change-password-modal input",
    ) as HTMLElement | undefined;
    if (!isTouchEnabled() && firstInput) {
      firstInput?.focus();
    }
  }
});

// Methods.
function closedModal() {
  showModal.value = false;
  pass1.value = "";
  pass2.value = "";
  emit("closed");
}

const pass2Valid = computed(() => {
  if (pass1.value || pass2.value) {
    return pass1.value === pass2.value;
  }
  return undefined;
});

async function savePass() {
  try {
    await dockStorage.changePass(
      dock.value.dock_id,
      pass2.value,
      changeDockToken.value,
    );
    modalChangePass.value?.triggerClose();
  } catch (e) {
    addErrorBottom(e);
  }
}
</script>
<template>
  <button class="button button--tertiary" @click="showModal = true">
    {{ $t("dock.change_password.trigger") }}
  </button>

  <Teleport to="body">
    <ModalSecondary
      ref="modalChangePass"
      :show="showModal"
      :width="'24.25rem'"
      :button-close="false"
      :name="'dock-change-password'"
      class="dock-change-password-modal"
      @close="closedModal"
    >
      <template #header>
        {{ $t("dock.change_password.title") }}
      </template>
      <UCInput
        v-model="pass1"
        :full-w="true"
        :label="$t('ui.new_password')"
        type="password"
      />
      <UCInput
        v-model="pass2"
        :full-w="true"
        :label="$t('ui.repeat_new_password')"
        :error-message="
          pass2Valid === false ? $t('dock.change_password.pass_not_match') : ''
        "
        type="password"
      />
      <UCToggle
        v-model="changeDockToken"
        :label="$t('dock.change_password.change_dock_token')"
        :full-w="true"
      />
      <p
        v-if="!isActive"
        class="form-item__hint"
        style="
          margin-top: 0.5rem;
          color: var(--color-text-secondary);
          font-size: 0.875rem;
        "
      >
        {{ $t("dock.change_password.connection_required_hint") }}
      </p>
      <template #footer>
        <button
          class="button button--tertiary"
          @click="modalChangePass?.triggerClose()"
        >
          {{ $t("ui.cancel") }}
        </button>
        <button
          class="button button--secondary"
          :disabled="!validForSubmit"
          @click="savePass"
        >
          {{ $t("ui.save") }}
        </button>
      </template>
    </ModalSecondary>
  </Teleport>
</template>
