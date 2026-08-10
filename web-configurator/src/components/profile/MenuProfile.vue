<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  getCurrentInstance,
  useTemplateRef,
} from "vue";

import type { Profile } from "@/types/profile";
import { LoginState } from "@/types/enums";

import { getErrorMessage, asError } from "@/composables/error";
import { useTiming } from "@/composables/timing";
import { useModalToggle } from "@/composables/modal";

import { authStorage } from "@/stores/auth";
import { profileStore } from "@/stores/profile";
import { profilesStore } from "@/stores/profiles";
import { addErrorBottom } from "@/stores/messages";

import AppModal from "@/components/elements/AppModal.vue";
import ProfileAvatar from "@/components/ui/ProfileAvatar.vue";
import UCInput from "@/components/ui/UCInput.vue";
import AppDialog from "@/components/elements/AppDialog.vue";
import ManageProfiles from "@/components/profile/ManageProfiles.vue";
import EditProfile from "@/components/profile/EditProfile.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import LogoutDialog from "@/components/elements/LogoutDialog.vue";

const { sleep } = useTiming();

const props = defineProps({
  mobileView: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["logout"]);

const instanceUid =
  getCurrentInstance()?.uid || Math.floor(Math.random() * 1000);
const auth = authStorage();
const storage = profileStore();
const profilesStorage = profilesStore();

const dialogAlreadyActive = useTemplateRef<InstanceType<typeof AppDialog>>(
  "dialogAlreadyActive",
);
const dialogEnterPwd =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogEnterPwd");
const elLogout = useTemplateRef<InstanceType<typeof LogoutDialog>>("elLogout");
const profiles = ref<Profile[]>([]);
const activeProfiles = ref<Profile[]>([]);
const profileToSwitch = ref<Profile | null>(null);
const modalEdit = useTemplateRef<InstanceType<typeof EditProfile>>("modalEdit");
const open = ref(false);

useModalToggle(open, { id: instanceUid });
const pin = ref("");
const errorMessageEnterPin = ref("");
const menuProfilePopup = useTemplateRef<HTMLDivElement>("menuProfilePopup");
const showProfileChanged = ref(false);

watch(profiles, async () => {
  validateProfilesData();
});

watch(activeProfiles, async (val, oldVal) => {
  if (
    showProfileChanged.value == false &&
    props.mobileView == false &&
    val &&
    val.length > 0 &&
    oldVal &&
    oldVal.length > 0 &&
    val[0]?.profile_id != oldVal[0]?.profile_id
  ) {
    showProfileChanged.value = true;
    await sleep(3000);
    showProfileChanged.value = false;
  }
});

watch(
  () => auth.authenticated,
  async (authenticated) => {
    if (authenticated == LoginState.AUTHORISED && profiles.value.length < 1) {
      await getProfilesData();
    }
  },
);

watch(
  () => [profilesStorage.profiles, profilesStorage.activeProfiles],
  () => {
    if (profilesStorage.profiles) {
      profiles.value = profilesStorage.profiles;
      activeProfiles.value = profilesStorage.activeProfiles;
    }
  },
  // Switching the active profile replaces only activeProfiles, so it must be
  // watched too. Both arrays are also mutated in place (push/splice), so watch
  // their contents deeply.
  { deep: true },
);

const mainClasses = computed(() => {
  return props.mobileView == true
    ? "menu-profile--mobile"
    : "menu-profile--desktop";
});

function addProfile() {
  modalEdit.value?.open();
}

function editProfile(id: string) {
  modalEdit.value?.open(id);
}

async function getProfilesData() {
  try {
    profiles.value = await profilesStorage.getAll(true);
  } catch (e) {
    addErrorBottom(e);
  }
  try {
    activeProfiles.value = await profilesStorage.getAllActive(true);
  } catch (e) {
    const err = asError(e);
    if (err.status && err.status == 404) {
      console.error(e);
    } else {
      addErrorBottom(e);
    }
  }
}

// Validate array of profiles
async function validateProfilesData() {
  if (profiles.value.length > 1 && "profile_id" in profiles.value[0] == false) {
    await getProfilesData();
  }
}

async function switchProfile(profile: Profile | null, inputPin = "") {
  if (profile == null) {
    return false;
  }

  if (isActive(profile)) {
    return showAlreadyActive();
  }

  if (
    activeProfiles.value &&
    activeProfiles.value.length > 0 &&
    activeProfiles.value[0] &&
    activeProfiles.value[0].restricted === true &&
    inputPin.length < 4
  ) {
    return showEnterPassword(profile);
  }

  try {
    await profilesStorage.switch(profile.profile_id, inputPin);
    await storage.setProfile(profile.profile_id);
    dialogEnterPwd.value?.close();
    profileToSwitch.value = null;
    pin.value = "";
  } catch (e) {
    if (inputPin.length > 1) {
      errorMessageEnterPin.value = getErrorMessage(
        e,
        "profile.switch",
      )?.message;
    } else {
      addErrorBottom(e);
    }
  }
}

function isActive(profile: Profile) {
  return activeProfiles.value.some((p) => p.profile_id === profile.profile_id);
}

function showAlreadyActive() {
  dialogAlreadyActive.value?.open();
}

function showEnterPassword(profile: Profile) {
  errorMessageEnterPin.value = "";
  profileToSwitch.value = profile;
  pin.value = "";
  dialogEnterPwd.value?.open();
}

function clearInputError() {
  if (errorMessageEnterPin.value.length > 0) {
    errorMessageEnterPin.value = "";
  }
}

function startLogout() {
  if (elLogout.value) {
    elLogout.value.startLogout();
  }
}

async function logout() {
  emit("logout");
  open.value = false;
}

onMounted(async () => {
  if (auth.authenticated == LoginState.AUTHORISED) {
    await getProfilesData();
  }
});
</script>
<template>
  <div class="menu-profile" :class="mainClasses">
    <button
      class="button button--tertiary button--with-icon menu-profile__trigger"
      :class="{
        'menu-profile__trigger--no-profile':
          !activeProfiles || activeProfiles.length < 1,
      }"
      @click="open = true"
    >
      <template v-if="activeProfiles && activeProfiles.length > 0">
        <span>{{ activeProfiles[0].name }}</span>
        <SelectedIcon
          :icon="
            activeProfiles[0].icon ? activeProfiles[0].icon : 'fa-light fa-user'
          "
          :fallback-icon="'fa-light fa-user'"
        />
      </template>
      <SelectedIcon
        v-else
        :icon="'fa-light fa-user'"
        :fallback-icon="'fa-light fa-user'"
      />
    </button>
    <Transition name="grow">
      <div
        v-show="open || props.mobileView == true"
        ref="menuProfilePopup"
        :class="{ opened: open }"
        class="menu-profile__body"
      >
        <div class="menu-profile__body__title">
          {{ $t("profile.your_profiles") }}
        </div>
        <button
          class="button button--secondary button--icon button--icon--small button-close"
          @click="open = false"
        >
          <i class="fa-regular fa-close"></i>
        </button>
        <ul class="menu-profile__body__list">
          <li v-for="profile in profiles" :key="profile.profile_id">
            <ProfileAvatar
              :name="profile.name"
              :icon="profile.icon"
              :restricted="profile.restricted"
              :active="isActive(profile)"
              :simple="true"
              :small="true"
              @click="switchProfile(profile)"
            />
          </li>
          <li>
            <button class="button-add-profile" @click="addProfile">
              <i class="icon-container fa-light fa-plus"></i>
              <span>{{ $t("profile.add_profile") }}</span>
            </button>
          </li>
        </ul>
        <div class="menu-profile__body__footer">
          <p>{{ $t("profile.select_manage_profile") }}</p>
          <div class="menu-profile__body__footer__actions">
            <ManageProfiles
              :profiles="profiles"
              :active-profiles="activeProfiles"
              @add-profile="addProfile"
              @edit-profile="editProfile"
              @closed="open = false"
            />

            <button class="button button--secondary" @click="startLogout">
              {{ $t("ui.logout") }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
    <Transition name="opacity">
      <div
        v-show="open || props.mobileView == true"
        class="menu-profile__background"
        @click="open = false"
      ></div>
    </Transition>

    <Teleport
      v-if="!mobileView && activeProfiles && activeProfiles.length > 0"
      to="body"
    >
      <AppModal
        :show="showProfileChanged"
        :height="'100%'"
        :width="'32.5rem'"
        class="modal--profile-changed"
        name="profile-changed"
        :closeable="true"
      >
        <ProfileAvatar
          :name="activeProfiles[0]?.name"
          :icon="activeProfiles[0]?.icon"
          :active="true"
          :simple="true"
          :small="false"
        />
        <template #footer>
          <p class="modal--profile-changed__description">
            {{ $t("profile.profile_has_changed") }}
          </p>
        </template>
      </AppModal>
    </Teleport>

    <Teleport to="body">
      <EditProfile ref="modalEdit" />
    </Teleport>
    <AppDialog
      ref="dialogAlreadyActive"
      :title="$t('profile.already_active.title')"
      :text="$t('profile.already_active.info')"
      :submit-text="$t('ui.dismiss')"
      :text-center="true"
      :icon="'fa-thin fa-face-surprise'"
      :icon-type="'red'"
    />
    <AppDialog
      ref="dialogEnterPwd"
      :disable-close-on-submit="true"
      :title="$t('profile.enter_admin_pwd.title')"
      :text="$t('profile.enter_admin_pwd.info')"
      :submit-text="$t('ui.enter')"
      :cancel-text="$t('ui.cancel')"
      @submit="switchProfile(profileToSwitch, pin)"
    >
      <template #extra>
        <UCInput
          v-model="pin"
          :type="'password'"
          :label="$t('profile.password')"
          :full-w="true"
          :error-message="errorMessageEnterPin"
          :focus="true"
          @input="clearInputError"
          @submit="switchProfile(profileToSwitch, pin)"
        />
      </template>
    </AppDialog>

    <LogoutDialog ref="elLogout" @logout="logout" />
  </div>
</template>
