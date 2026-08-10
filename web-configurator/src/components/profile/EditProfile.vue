<script setup lang="ts">
import { ref, watch, computed, useTemplateRef } from "vue";
import { useTranslation } from "i18next-vue";
import { FlashMessageInfoStatus } from "@/types/enums";

import type { Profile, ProfileNewData } from "@/types/profile";
import type { ChangeCallbackParams } from "@/types/config";
import type { ErrorTexts } from "@/types/flashMessages";

import { getErrorMessage } from "@/composables/error";
import { useTiming } from "@/composables/timing";

import { profilesStore } from "@/stores/profiles";
import { addInfoFull, addErrorFull, addErrorBottom } from "@/stores/messages";

import AppModal from "@/components/elements/AppModal.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import IconSelect from "@/components/elements/icon/IconSelect.vue";
import UCInput from "@/components/ui/UCInput.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import ErrorBox from "@/components/ui/ErrorBox.vue";
import { deepClone } from "@/composables/dataHelper";

const { t } = useTranslation();
const { sleep } = useTiming();

defineExpose({
  open,
});
defineEmits(["close"]);

const profileSkeleton = {
  name: "",
  icon: null,
  restricted: false,
};

const dialogDelete =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogDelete");
const profilesStorage = profilesStore();
const profileId = ref<string | null>(null);
const profile = ref<Profile | null>();
const showModal = ref(false);
const errorMessage = ref("");
const deleting = ref(false);
const allProfiles = ref<Profile[]>([]);
const activeProfiles = ref<Profile[]>([]);
const errorProfile = ref<ErrorTexts | null>(null);

/** Gates the add button. Same predicate as `addProfile`, so the two cannot disagree. */
const isNameValid = computed(
  () => (profile.value?.name ?? "").trim().length > 0,
);

watch(showModal, async (val) => {
  if (val) {
    if (profileId.value == null) {
      // Keep JSON clone: the skeleton omits `profile_id` and types `icon` as
      // `null`, so it does not overlap `Profile`; conversion is out of scope for
      // this cloning sweep.
      profile.value = JSON.parse(JSON.stringify(profileSkeleton));
    } else {
      try {
        allProfiles.value = await profilesStorage.getAll();
        activeProfiles.value = await profilesStorage.getAllActive();
        setProfile(allProfiles.value);
      } catch (e) {
        addErrorBottom(e);
      }
    }
  }
});

watch(
  () => [profilesStorage.profiles, profilesStorage.activeProfiles],
  () => {
    if (profilesStorage.profiles && showModal.value == true) {
      setProfile(profilesStorage.profiles);
      activeProfiles.value = profilesStorage.activeProfiles;
      allProfiles.value = profilesStorage.profiles;
    }
  },
  // Switching the active profile replaces only activeProfiles, so it must be
  // watched too. Both arrays are also mutated in place (push/splice), so watch
  // their contents deeply.
  { deep: true },
);

const isActiveProfile = computed(() => {
  return activeProfiles.value.some((p) => p.profile_id === profileId.value);
});

const newProfile = computed(() => {
  return profileId.value == null;
});

const questionDeleteProfile = computed(() => {
  return t("profile.delete_profile.question", {
    name: profile.value ? profile.value.name : "",
  });
});

function open(id: string | null = null) {
  profileId.value = id;
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  profileId.value = null;
  profile.value = null;
}

async function setProfile(allProfiles: Profile[]) {
  const profileToEdit = allProfiles.find(
    (p) => p.profile_id == profileId.value,
  );
  if (profileToEdit && profileToEdit != null) {
    profile.value = deepClone(profileToEdit);
  }
}

async function getProfiles() {
  try {
    await profilesStorage.getAll(true);
    await profilesStorage.getAllActive(true);
  } catch (e) {
    addErrorBottom(e);
  }
}

async function addProfile() {
  // The add button is disabled while this holds; kept for the paths that reach
  // here without it.
  if (!isNameValid.value) {
    errorMessage.value = t("ui.required_field");
    return false;
  }
  const profileData: ProfileNewData = {
    name: profile.value?.name || "",
    icon: profile.value?.icon,
    restricted: profile.value?.restricted,
  };

  try {
    addInfoFull(
      FlashMessageInfoStatus.SAVING,
      t("profile.message.adding_profile"),
    );
    await profilesStorage.create(profileData);
    addInfoFull(
      FlashMessageInfoStatus.SUCCESS,
      t("profile.message.profile_added"),
    );
    await sleep(2000);
    closeModal();
  } catch (e) {
    addErrorFull(e, "profile.add");
  }
  getProfiles();
}

async function doSaveProfile(changes: any) {
  errorProfile.value = null;
  if (!profile.value || profile.value == null) {
    return false;
  }

  try {
    await profilesStorage.update(profile.value?.profile_id, changes);
  } catch (e) {
    errorProfile.value = getErrorMessage(e, "profile.update");
  }
  await getProfiles();
}

async function deleteProfile() {
  deleting.value = true;
  try {
    addInfoFull(
      FlashMessageInfoStatus.SAVING,
      t("profile.message.deleting_profile"),
    );
    await profilesStorage.delete(profile.value as Profile);
    await getProfiles();
    addInfoFull(
      FlashMessageInfoStatus.SUCCESS,
      t("profile.message.profile_deleted"),
    );
    await sleep(2000);
    closeModal();
  } catch (e) {
    addErrorFull(e, "profile.delete");
  }
  deleting.value = false;
}

function openDeleteDialog() {
  dialogDelete.value?.open();
}

async function changeProfileIcon(params: ChangeCallbackParams) {
  const { value } = params;
  if (newProfile.value) {
    if (profile.value) {
      profile.value.icon = value as string;
    }
  } else {
    await doSaveProfile({
      update_pin: false,
      icon: value as string,
    });
  }
}

async function changeName() {
  if (
    newProfile.value ||
    profile.value?.name == null ||
    typeof profile.value?.name == "undefined"
  ) {
    return false;
  }

  await doSaveProfile({
    update_pin: false,
    name: profile.value?.name as string,
  });
}

async function changeRestricted() {
  if (
    newProfile.value ||
    profile.value?.restricted == null ||
    typeof profile.value?.restricted == "undefined"
  ) {
    return false;
  }

  await doSaveProfile({
    update_pin: false,
    restricted: profile.value?.restricted as boolean,
  });
}

function clearErrors() {
  if (errorMessage.value.length > 0) {
    errorMessage.value = "";
  }
}
</script>
<template>
  <Teleport to="body">
    <AppModal
      :show="showModal"
      :width="'25rem'"
      :button-back="true"
      name="edit-profile"
      class="modal--edit-profile"
      @close="closeModal"
    >
      <template #header>
        <template v-if="newProfile">{{ $t("profile.add_profile") }}</template>
        <template v-else>{{ $t("profile.edit_profile") }}</template>
      </template>
      <template v-if="profile != null">
        <ErrorBox
          v-if="errorProfile"
          :message="errorProfile"
          :margin-bottom="true"
        />
        <div class="modal--edit-profile__icon">
          <IconSelect
            :key="profile.icon ? profile.icon : 'fa-regular fa-user'"
            :value="profile.icon ? profile.icon : 'fa-regular fa-user'"
            :change-callback="changeProfileIcon"
            :circle="true"
            :title="$t('profile.select_an_icon')"
          />
          <i
            v-if="isActiveProfile"
            class="modal--edit-profile__active fa-light fa-check"
          ></i>
        </div>
        <UCInput
          v-model="profile.name"
          :label="$t('profile.name')"
          :error-message="errorMessage ? $t(errorMessage) : ''"
          :full-w="true"
          :focus="newProfile"
          @submit="changeName"
          @click="clearErrors"
        />
        <UCToggle
          v-model="profile.restricted"
          :label="$t('profile.restricted_profile')"
          :full-w="true"
          :description="$t('profile.restricted_profile_description')"
          @change="changeRestricted"
        />
      </template>
      <template #footer>
        <button
          v-if="newProfile"
          :disabled="!isNameValid"
          class="button button--primary button--min-w-grow"
          @click="addProfile"
        >
          {{ $t("profile.add_profile") }}
        </button>
        <div v-else class="modal--edit-profile__delete">
          <button
            class="button button--danger button--min-w-grow"
            :disabled="isActiveProfile"
            @click="openDeleteDialog"
          >
            {{ $t("ui.delete") }}
          </button>
          <p v-if="isActiveProfile" class="modal--edit-profile__delete-info">
            {{ $t("profile.delete_profile.active_not_allowed") }}
          </p>
        </div>
      </template>
    </AppModal>
  </Teleport>
  <AppDialog
    ref="dialogDelete"
    :title="$t('profile.delete_profile.title')"
    :text="questionDeleteProfile"
    :submit-text="$t('ui.delete')"
    :cancel-text="$t('ui.cancel')"
    :disable-buttons="deleting"
    @submit="deleteProfile"
  />
</template>
