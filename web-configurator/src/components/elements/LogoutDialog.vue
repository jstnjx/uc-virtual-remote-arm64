<script setup lang="ts">
import { useTemplateRef } from "vue";
import { useRouter } from "vue-router";

import { authStorage } from "@/stores/auth";
import { systemBaseStore } from "@/stores/systemBase";

const router = useRouter();
const auth = authStorage();
const systemBaseStorage = systemBaseStore();

import AppDialog from "@/components/elements/AppDialog.vue";

defineExpose({
  startLogout,
});

const emit = defineEmits(["logout"]);

const dialogLogout =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogLogout");

function startLogout() {
  if (dialogLogout.value) {
    dialogLogout.value?.open();
  }
}

async function logout() {
  // Logout must be local-first and unconditional: with the device asleep the
  // inhibitor call rejects, but the user still expects to be logged out
  // (REVIEW-Claude-login-flow.md P2-2).
  try {
    await systemBaseStorage.removeStandbyInhibitor("web-configurator");
  } catch {
    // best effort — device may be unreachable
  }
  await auth.logout(); // clears PIN/state first; tolerates REST failure internally
  router.push({ name: "login" });
  emit("logout");
}
</script>
<template>
  <AppDialog
    ref="dialogLogout"
    :title="$t('logout.title')"
    :text="$t('logout.question')"
    :submit-text="$t('ui.logout')"
    :cancel-text="$t('ui.cancel')"
    @submit="logout"
  />
</template>
