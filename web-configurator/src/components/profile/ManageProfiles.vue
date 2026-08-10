<script setup lang="ts">
import { ref } from "vue";
import type { Profile } from "@/types/profile";

import AppModal from "@/components/elements/AppModal.vue";
import ProfileAvatar from "@/components/ui/ProfileAvatar.vue";

const props = defineProps({
  profiles: {
    type: Array<Profile>,
    default: [],
  },
  activeProfiles: {
    type: Array<Profile>,
    default: [],
  },
});

const emit = defineEmits(["addProfile", "editProfile", "closed"]);
const showModal = ref(false);

function addProfile() {
  emit("addProfile");
}

function editProfile(id: string) {
  emit("editProfile", id);
}

function isActive(profile: Profile) {
  return props.activeProfiles.some((p) => p.profile_id === profile.profile_id);
}

function closeModal() {
  emit("closed");
  showModal.value = false;
}
</script>
<template>
  <button class="button button--primary" @click="showModal = true">
    {{ $t("profile.manage_profiles") }}
  </button>
  <Teleport to="body">
    <AppModal
      :show="showModal"
      :width="'33rem'"
      name="manage-profiles"
      class="modal--manage-profiles"
      @close="closeModal"
    >
      <template #header>
        {{ $t("profile.your_profiles") }}
      </template>
      <div>
        <ul class="modal--manage-profiles__list">
          <li>
            <button class="button-add-profile" @click="addProfile">
              <i
                class="icon-container icon-container--large fa-light fa-plus"
              ></i>
              <span>{{ $t("profile.add_profile") }}</span>
            </button>
          </li>
          <li v-for="profile in props.profiles" :key="profile.profile_id">
            <ProfileAvatar
              :name="profile.name"
              :icon="profile.icon"
              :restricted="profile.restricted"
              :active="isActive(profile)"
              :simple="true"
              :small="false"
              @click="editProfile(profile.profile_id)"
            />
          </li>
        </ul>
      </div>
      <template #footer>
        <p class="modal--manage-profiles__description">
          {{ $t("profile.click_on_the_profile") }}
        </p>
      </template>
    </AppModal>
  </Teleport>
</template>
