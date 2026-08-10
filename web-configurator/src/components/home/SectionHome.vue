<script setup lang="ts">
import {
  computed,
  onBeforeMount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import { useTranslation } from "i18next-vue";
import { storeToRefs } from "pinia";

import type { DropdownItem } from "@/types/ui";
import {
  SystemUpdateProgressState,
  BatteryStatusValue,
  RemoteKind,
} from "@/types/enums";
import type { BatteryStatus } from "@/types/systemBase";
import type { IntegrationDriver } from "@/types/integrationInstance";
import type { DockUpdateCheck } from "@/types/dock";

import { useTiming } from "@/composables/timing";
import { useWindowDimension } from "@/composables/windowDimension";

import { configStore } from "@/stores/config";
import { profilesStore } from "@/stores/profiles";
import { systemBaseStore } from "@/stores/systemBase";
import { systemUpdateStore } from "@/stores/systemUpdate";
import { docksStore } from "@/stores/docks";
import { addErrorBottom } from "@/stores/messages";

import DropdownMenu from "@/components/ui/DropdownMenu.vue";
import AddActivity from "@/components/activity/AddActivity.vue";
import AddDevice from "@/components/elements/entity/AddDevice.vue";
import AddRemoteIr from "@/components/remote-controller/AddRemoteIr.vue";
import AddRemoteBt from "@/components/remote-controller/AddRemoteBt.vue";
import AddDock from "@/components/dock/AddDock.vue";
import AddIntegration from "@/components/integration/AddIntegration.vue";
import QuickTips from "@/components/home/QuickTips.vue";

const { t } = useTranslation();
const router = useRouter();
const { sleep } = useTiming();
const { isSmallScreen } = useWindowDimension();

defineProps({
  active: {
    type: Boolean,
    default: false,
  },
});

const profilesStorage = profilesStore();
const systemBaseStorage = systemBaseStore();
const systemUpdateStorage = systemUpdateStore();
const dockStorage = docksStore();
const config = configStore();

const { updateCheck } = storeToRefs(systemUpdateStorage);
const { docks, dockUpdateList } = storeToRefs(dockStorage);
const { activeProfiles } = storeToRefs(profilesStorage);
const batteryStatus = ref<BatteryStatus | null>(null);
const modeAdvanced = ref(false);
const deviceName = ref("");

const elAddActivity =
  useTemplateRef<InstanceType<typeof AddActivity>>("elAddActivity");
const elAddDevice =
  useTemplateRef<InstanceType<typeof AddDevice>>("elAddDevice");
const elAddRemoteIr =
  useTemplateRef<InstanceType<typeof AddRemoteIr>>("elAddRemoteIr");
const elAddRemoteBt =
  useTemplateRef<InstanceType<typeof AddRemoteBt>>("elAddRemoteBt");
const elAddDock = useTemplateRef<InstanceType<typeof AddDock>>("elAddDock");
const elAddIntegration =
  useTemplateRef<InstanceType<typeof AddIntegration>>("elAddIntegration");

watch(
  () => config.config?.device?.name,
  (name) => {
    if (name) {
      deviceName.value = name;
    }
  },
);

watch(
  () => systemBaseStorage.batteryStatus,
  (status) => {
    if (status) {
      batteryStatus.value = status;
    }
  },
);

watch(
  () => systemUpdateStorage.updateMessage?.progress?.state,
  (state) => {
    if (state == SystemUpdateProgressState.DONE) {
      checkForRemoteUpdate();
    }
  },
);

const hasRemoteUpdate = computed(() => {
  return (
    updateCheck.value != null &&
    updateCheck.value?.available &&
    updateCheck.value?.available.length > 0
  );
});

const hasDockUpdate = computed(() => {
  return dockUpdateList.value && dockUpdateList.value.length > 0;
});

const batteryClasses = computed(() => {
  let classList = "";
  classList +=
    batteryStatus.value?.status == BatteryStatusValue.FULL ||
    batteryStatus.value?.status == BatteryStatusValue.CHARGING
      ? "section-home__option--battery--green "
      : "";
  classList +=
    batteryStatus.value?.status == BatteryStatusValue.LOW_BATTERY
      ? "section-home__option--battery--red "
      : "";
  return classList;
});

const updateList = computed(() => {
  const fallbackDockName = t("dock.dock", "Dock");
  let links = [
    {
      label:
        deviceName.value && deviceName.value.length > 0
          ? deviceName.value
          : t("entity.entity_type.remote", "Remote"),
      value: hasRemoteUpdate.value ? "software-update" : "",
    },
  ];

  const dockLinks = dockUpdateList.value.map((item: DockUpdateCheck) => {
    return {
      label:
        item.dock_configuration?.name || docks.value.length < 2
          ? fallbackDockName
          : item.dock_configuration?.dock_id || fallbackDockName,
      value: item.dock_id || "",
    };
  });

  links = links.concat(dockLinks);

  return links.filter((link) => link.value !== "") as DropdownItem[];
});

async function getProfilesData() {
  try {
    await profilesStorage.getAllActive(true);
  } catch (e) {
    console.error(e);
  }
}

async function fetchBatteryStatus() {
  try {
    const status = await systemBaseStorage.getBatteryStatus();
    if (status) {
      batteryStatus.value = status;
    }
  } catch (e) {
    console.error(e);
  }
}

async function checkForRemoteUpdate() {
  try {
    await systemUpdateStorage.getUpdates(false);
  } catch (error) {
    console.error(error);
  }
}

async function checkForDockUpdate() {
  try {
    await dockStorage.getDockUpdateList();
  } catch (e) {
    console.error(e);
  }
}

function addActivity() {
  elAddActivity.value?.open();
}

function startAdd(type: string) {
  if (type == RemoteKind.IR) {
    elAddRemoteIr.value?.open();
  }

  if (type == RemoteKind.BT) {
    elAddRemoteBt.value?.open();
  }

  if (type == "dock") {
    elAddDock.value?.open();
  }
}

function startDriverSetup(driver: IntegrationDriver) {
  elAddIntegration.value?.startSetup(driver);
}

function startDriverRegister(driver: IntegrationDriver) {
  elAddIntegration.value?.doStartRegisterExternal(driver);
}

function goToUpdate(item: DropdownItem | null = null) {
  if (item != null) {
    if (item.value == "software-update") {
      router.push({
        name: "settings",
        query: {
          action: "software-update",
        },
      });
    } else if (item.value.length > 0) {
      router.push({
        name: "dock",
        params: { dock_id: item.value },
      });
    }
  } else if (hasRemoteUpdate.value) {
    router.push({
      name: "settings",
      query: {
        action: "software-update",
      },
    });
  } else if (hasDockUpdate.value && dockUpdateList.value[0].dock_id) {
    router.push({
      name: "dock",
      params: { dock_id: dockUpdateList.value[0].dock_id },
    });
  }
}

onBeforeMount(async () => {
  getProfilesData();
  fetchBatteryStatus();

  try {
    deviceName.value = await config.getDeviceName();
  } catch (e) {
    addErrorBottom(e);
  }
  await sleep(1000);
});

onMounted(() => {
  checkForRemoteUpdate();
  checkForDockUpdate();
});
</script>
<template>
  <div
    class="section-home"
    :class="{ 'section-home--inactive': active == false }"
  >
    <div
      class="section-home__welcome"
      :class="{ 'section-home__welcome--hidden': active == false }"
    >
      <h1>
        <span>{{ $t("home.welcome") }},&nbsp;</span>
        <span>
          <template v-if="activeProfiles && activeProfiles.length > 0">
            {{ activeProfiles[0].name }}
          </template>
          &ensp;
        </span>
      </h1>
      <p>{{ $t("home.lets_get") }}</p>
    </div>
    <div class="section-home__options">
      <div class="section-home__options__group">
        <div
          class="section-home__option section-home__option--add-device"
          @click="elAddDevice?.open()"
        >
          <div class="section-home__option__row">
            <span
              class="button button--tertiary button--icon button--icon--large"
            >
              <i class="fa-regular fa-plus"></i>
            </span>
          </div>
          <h2>{{ $t("home.add_device") }}</h2>
        </div>
        <div
          class="section-home__option section-home__option--add-activity"
          @click="addActivity"
        >
          <div class="section-home__option__row">
            <span
              class="button button--tertiary button--icon button--icon--large"
            >
              <i class="fa-regular fa-plus"></i>
            </span>
          </div>
          <h2>{{ $t("home.add_activity") }}</h2>
        </div>
        <div
          v-if="batteryStatus"
          class="section-home__option section-home__option--battery"
          :class="batteryClasses"
        >
          <span
            class="button button--tertiary button--icon button--icon--large"
          >
            <i
              v-if="
                batteryStatus.status &&
                (batteryStatus.status == BatteryStatusValue.FULL ||
                  batteryStatus.status == BatteryStatusValue.CHARGING)
              "
              class="fa-regular fa-bolt"
            ></i>
            <i
              v-else-if="
                batteryStatus.status &&
                batteryStatus.status == BatteryStatusValue.LOW_BATTERY
              "
              class="fa-regular battery-low"
            ></i>
            <i v-else class="fa-regular fa-battery-half"></i>
          </span>
          <div>
            <span v-if="batteryStatus.capacity"
              >{{ batteryStatus.capacity }}<span>%</span></span
            >
            <p>
              <template v-if="batteryStatus.status">
                {{ $t(`battery_status.value.${batteryStatus.status}`) }}
              </template>
            </p>
          </div>
        </div>
        <DropdownMenu
          v-if="
            (hasRemoteUpdate || hasDockUpdate) &&
            updateList &&
            updateList.length > 1
          "
          :list-data="updateList"
          :on-right="isSmallScreen"
          @item-click="goToUpdate"
        >
          <template #trigger>
            <div
              class="section-home__option section-home__option--software-update has-update"
            >
              <div class="section-home__option__row">
                <span
                  class="button button--tertiary button--icon button--icon--large"
                >
                  <i class="fa-regular fa-cloud-arrow-down"></i>
                </span>
              </div>
              <h2>{{ $t("software_update.state.available_softwares") }}</h2>
            </div>
          </template>
        </DropdownMenu>
        <div
          v-else
          class="section-home__option section-home__option--software-update"
          :class="{ 'has-update': hasRemoteUpdate || hasDockUpdate }"
          @click="() => goToUpdate()"
        >
          <div class="section-home__option__row">
            <span
              class="button button--tertiary button--icon button--icon--large"
            >
              <i
                v-if="hasRemoteUpdate || hasDockUpdate"
                class="fa-regular fa-cloud-arrow-down"
              ></i>
              <i v-else class="fa-regular fa-check"></i>
            </span>
          </div>
          <h2>
            <template v-if="hasRemoteUpdate">{{
              $t("software_update.state.available_software")
            }}</template>
            <template v-else-if="hasDockUpdate">{{
              $t("software_update.state.available_dock_firmware")
            }}</template>
            <template v-else>{{
              $t("software_update.state.up_to_date")
            }}</template>
          </h2>
        </div>
      </div>

      <QuickTips class="quick-tips--desktop" />
    </div>
  </div>
  <AddActivity ref="elAddActivity" />
  <AddDevice
    ref="elAddDevice"
    @start-add="startAdd"
    @start-driver-setup="startDriverSetup"
    @start-driver-register="startDriverRegister"
    @change-mode-advanced="
      (mode: boolean) => {
        modeAdvanced = mode;
      }
    "
  />
  <AddRemoteIr ref="elAddRemoteIr" />
  <AddRemoteBt ref="elAddRemoteBt" />
  <AddDock ref="elAddDock" />
  <AddIntegration ref="elAddIntegration" :mode-advanced="modeAdvanced" />
</template>
