<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRouter } from "vue-router";

import type { Profile } from "@/types/profile";
import type { Page } from "@/types/page";
import { LoginState } from "@/types/enums";

import type { ProfileStore } from "@/stores/profile";
import { addErrorBottom } from "@/stores/messages";

import { useWindowDimension } from "@/composables/windowDimension";
import { asError } from "@/composables/error";

import { authStorage } from "@/stores/auth";
import { profileStore } from "@/stores/profile";
import { profilesStore } from "@/stores/profiles";

import RemoteController from "@/components/remote-controller/RemoteController.vue";
import CustomiseRemotePageList from "@/components/customise-remote/CustomiseRemotePageList.vue";
import CustomiseRemoteOptions from "@/components/customise-remote/CustomiseRemoteOptions.vue";
import { deepClone } from "@/composables/dataHelper";

const props = defineProps({
  folded: {
    type: Boolean,
    default: false,
  },
});
const auth = authStorage();
const storage = profileStore();
const profilesStorage = profilesStore();
const { isSmallScreen } = useWindowDimension();
const router = useRouter();

const profileId = ref<string>("");
const activeProfile = ref<Profile | null>(null);
const pages = ref<Page[]>([]);
const pageIdToPreview = ref<string>("");
const pageIdToEdit = ref<string>("");
const activeOption = ref("");
const sectionRemote = useTemplateRef<HTMLDivElement>("sectionRemote");
const elCustomiseRemoteOptions = useTemplateRef<
  InstanceType<typeof CustomiseRemoteOptions>
>("elCustomiseRemoteOptions");

const displayListScrollTop = ref(0);

const loading = ref(false);

const emit = defineEmits(["editPage"]);

watch(props, (val) => {
  if (val.folded) {
    sectionRemote.value && sectionRemote.value.scrollTo({ top: 0, left: 0 });
    pageIdToPreview.value = "";
    pageIdToEdit.value = "";
  }
});

watch(pageIdToEdit, (val) => {
  emit("editPage", val);
});

watch(
  () => auth.authenticated,
  async (authenticated) => {
    if (authenticated == LoginState.AUTHORISED && activeProfile.value == null) {
      await fetchData();
    }
  },
);

watch(
  () => storage.profile,
  (profile) => {
    if (profile) {
      activeProfile.value = profile;
    }
  },
);

watch(
  () => storage.pages,
  () => {
    setProfile(storage);
  },
);

watch(
  () => profilesStorage.activeProfiles,
  (activeProfiles) => {
    if (activeProfiles && activeProfiles.length > 0) {
      profileId.value = activeProfiles[0].profile_id;
    }
  },
);

const editView = computed(() => {
  return pageIdToEdit.value && pageIdToEdit.value != null ? true : false;
});

async function fetchData(fetchFromApi = false) {
  loading.value = true;

  try {
    const activeProfiles = await profilesStorage.getAllActive(fetchFromApi);
    profileId.value = activeProfiles[0].profile_id;
  } catch (e) {
    const err = asError(e);
    if (err.status && err.status == 404) {
      console.error(e);
    } else {
      addErrorBottom(e);
    }
  }

  try {
    await getProfile();
  } catch (e) {
    addErrorBottom(e);
  }
  loading.value = false;
}

async function getProfile() {
  try {
    activeProfile.value = await storage.setProfile(profileId.value);
    setProfile(storage);
  } catch (e) {
    console.error(e);
  }
}

async function setProfile(store: ProfileStore) {
  displayListScrollTop.value = 0;
  pages.value = deepClone(store.$state.pages);
}

function showPage(id: string) {
  if (id) {
    pageIdToPreview.value = id;
  }
}

function editPage(id: string) {
  if (id || id == null) {
    pageIdToEdit.value = id;
    pageIdToPreview.value = id;
  }
}

function setActiveOption(message: string) {
  activeOption.value = message;
}

function reloadEntityList() {
  if (elCustomiseRemoteOptions.value) {
    elCustomiseRemoteOptions.value.reloadEntityList();
  }
}

router.beforeEach((to, from) => {
  if (
    to.path &&
    from.path &&
    ((to.path == "/" && from.path != "/customise-remote") ||
      (to.path == "/customise-remote" && from.path != "/"))
  ) {
    fetchData(true);
  }
});

onMounted(async () => {
  if (auth.authenticated == LoginState.AUTHORISED) {
    await fetchData(true);
  }
});
</script>
<template>
  <div
    class="custom-remote-pages"
    :class="{
      'custom-remote-pages--active-option':
        activeOption && activeOption.length > 0,
    }"
  >
    <Transition>
      <div v-show="folded == false" class="custom-remote-pages__lists">
        <div v-show="editView == false">
          <CustomiseRemotePageList
            v-if="activeProfile"
            :active-profile="activeProfile"
            :loading="loading"
            @show-page="showPage"
            @edit-page="editPage"
          />
        </div>
        <div v-show="editView == true">
          <CustomiseRemoteOptions
            v-if="activeProfile"
            ref="elCustomiseRemoteOptions"
            :active-page-id="pageIdToEdit || ''"
            :active-profile="activeProfile"
            @edit-page="editPage"
            @edit-option="setActiveOption"
          />
        </div>
      </div>
    </Transition>
    <Transition name="opacity">
      <div
        v-show="activeOption.length < 1 || !isSmallScreen"
        ref="sectionRemote"
        class="custom-remote-pages__remote"
        :class="{ 'custom-remote-pages__remote--page-edit': pageIdToEdit }"
      >
        <Transition name="opacity">
          <div
            v-show="folded == false"
            class="custom-remote-pages__remote__header"
          >
            <p
              v-show="editView == false"
              class="custom-remote-pages__remote__descr"
            >
              {{ $t("customise_remote.pages.remote.description") }}
            </p>
          </div>
        </Transition>
        <div class="custom-remote-pages__remote__body">
          <RemoteController
            :active-profile="activeProfile || {}"
            :page-id="pageIdToEdit || pageIdToPreview"
            :edit-view="editView"
            :pages="pages"
            :folded="folded"
            @deleted-entity="reloadEntityList"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>
