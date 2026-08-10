<script setup lang="ts">
import { ref, watch, computed, onBeforeMount } from "vue";
import { storeToRefs } from "pinia";
import { useTranslation } from "i18next-vue";

import type {
  IntegrationDriver,
  IntegrationDriverInfo,
} from "@/types/integrationInstance";

import { DriverType, RemoteKind } from "@/types/enums";

import { useTiming } from "@/composables/timing";

import translatedProperty, {
  searchLanguageText,
} from "@/composables/translatedProperty";

import { integrationsStore } from "@/stores/integrations";

import UCSearch from "@/components/ui/UCSearch.vue";
import UCToggle from "@/components/ui/UCToggle.vue";
import AppModal from "@/components/elements/AppModal.vue";
import SelectedIcon from "@/components/elements/icon/SelectedIcon.vue";
import { addErrorBottom } from "@/stores/messages";

const { t } = useTranslation();
const { sleep } = useTiming();
const integrationsStorage = integrationsStore();

defineProps({
  onlyIntegrations: {
    type: Boolean,
    default: false,
  },
});

defineExpose({
  open,
});

const { discoverActive, enabledDrivers, discovered } =
  storeToRefs(integrationsStorage);

const emit = defineEmits([
  "close",
  "startAdd",
  "startDriverSetup",
  "startDriverRegister",
  "changeModeAdvanced",
]);

const showModal = ref(false);
const searchText = ref("");

const modeAdvanced = ref(false);
const discoverIntervalId = <any>ref(-1);

// computed, not a ref: t() only re-runs on a language change when it is read
// inside a tracked scope.
const deviceMenu = computed(() => [
  {
    type: RemoteKind.IR,
    icon: "fa-tower-broadcast",
    title: t("device.add_device.menu_list.infrared.title"),
    description: t("device.add_device.menu_list.infrared.description"),
  },
  {
    type: RemoteKind.BT,
    icon: "fa-bluetooth",
    title: "Bluetooth",
    description: t("device.add_device.menu_list.bluetooth.description"),
  },
  {
    type: "dock",
    icon: "fa-square",
    title: t("device.add_device.menu_list.dock.title"),
    description: t("device.add_device.menu_list.dock.description"),
  },
]);

watch(showModal, async (val) => {
  if (val) {
    await startDiscover();
    searchText.value = "";
    discoverIntervalId.value = setInterval(() => {
      void startDiscover();
    }, 40000); // 40 sec
  } else {
    clearInterval(discoverIntervalId.value);
    await stopDiscover();
    searchText.value = "";
  }
});

const driversFiltered = computed<IntegrationDriverInfo[]>(() => {
  const search = searchText.value.toLowerCase();
  const processedDriverIds = new Set();

  return enabledDrivers.value.concat(discovered.value).filter((item) => {
    const driverId = item.driver_id.toLowerCase();

    if (processedDriverIds.has(driverId)) {
      return false;
    }

    const matchesSearch =
      searchLanguageText(item.name, search) || driverId.includes(search);

    if (matchesSearch) {
      processedDriverIds.add(driverId);
    }

    return matchesSearch;
  });
});

const discoveredExternalsNumber = computed<number>(() => {
  return enabledDrivers.value.concat(discovered.value).filter((item) => {
    return item.driver_type.toLowerCase().includes("external");
  }).length;
});

const filteredDeviceMenu = computed(() => {
  return deviceMenu.value.filter((item) => {
    return item.title.toLowerCase().includes(searchText.value.toLowerCase());
  });
});

async function doSelect(type: string) {
  emit("startAdd", type);
  await sleep(1000);
  closeModal();
}

async function doSelectDriver(driver: IntegrationDriverInfo) {
  await stopDiscover();
  if (
    driver.driver_type === DriverType.LOCAL ||
    (!driver.discovered && (driver as any).instance_count === 0)
  ) {
    try {
      const driverData = await integrationsStorage.getDriver(driver.driver_id);
      emit("startDriverSetup", driverData);
      await sleep(1000);
      closeModal();
    } catch (e) {
      addErrorBottom(e);
    }
  } else if (driver.driver_type === DriverType.EXTERNAL) {
    emit("startDriverRegister", driver);
    await sleep(1000);
    closeModal();
  }
}

async function startDiscover() {
  try {
    await integrationsStorage.startDiscovery();
  } catch (e) {
    addErrorBottom(e);
  }
  discoverActive.value = true;
}

async function stopDiscover() {
  discoverActive.value = false;
  try {
    await integrationsStorage.stopDiscovery();
  } catch (e) {
    addErrorBottom(e);
  }
}

function updateModeAdvanced() {
  emit("changeModeAdvanced", modeAdvanced.value);
}

function open() {
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

onBeforeMount(async () => {
  try {
    await integrationsStorage.getEnabledDrivers(true);
  } catch (e) {
    addErrorBottom(e);
  }
});
</script>
<template>
  <Teleport to="body">
    <AppModal
      :show="showModal"
      :width="'32.5rem'"
      name="add-device"
      class="add-device"
      @close="closeModal"
    >
      <template #header>
        {{
          onlyIntegrations
            ? $t("integration.add.title")
            : $t("device.add_device.title")
        }}
      </template>

      <div class="add-device__discover">
        <div v-if="discoverActive" class="add-device__discover__discovering">
          <img
            src="/images/loading-indicator.png"
            alt="Loading"
            class="img-loading"
          />
          <span>{{ $t("device.add_device.discover.discovering") }}</span>
        </div>
        <div
          v-else-if="discoveredExternalsNumber > 0"
          class="add-device__discover__idle"
        >
          <i class="fa-light fa-circle-check"></i>
          <span>
            {{
              $t("device.add_device.discover.discovered_integration", {
                count: discoveredExternalsNumber,
              })
            }}
          </span>
        </div>
        <div v-else class="add-device__discover__idle">
          <span>{{
            $t("device.add_device.discover.no_integration_discovered")
          }}</span>
        </div>
      </div>

      <UCSearch v-model="searchText" :gray="true" />

      <div v-overflow-indicator class="add-device__list">
        <template v-if="!onlyIntegrations">
          <div
            v-for="option in filteredDeviceMenu"
            :key="option.type"
            class="add-device__item"
            @click="doSelect(option.type)"
          >
            <div class="add-device__item__icon">
              <i :class="`fa-thin ${option.icon}`"></i>
            </div>
            <div class="add-device__item__text">
              <h4 class="add-device__item__title">
                {{ option.title }}
              </h4>
              <p class="add-device__item__description">
                {{ option.description }}
              </p>
            </div>
            <div class="add-device__item__button">
              <i class="fa-regular fa-chevron-right"></i>
            </div>
          </div>
        </template>
        <div
          v-for="option in driversFiltered"
          :key="option.driver_id"
          class="add-device__item"
          @click="doSelectDriver(option)"
        >
          <div class="add-device__item__icon">
            <SelectedIcon :icon="option.icon || 'uc:puzzle'" :thin="true" />
          </div>
          <div class="add-device__item__text">
            <h4 class="add-device__item__title">
              {{ translatedProperty(option.name) }}
              <span
                v-if="option.driver_type == DriverType.EXTERNAL"
                class="add-device__item__badge"
              >
                {{ $t("integration.driver_type.external") }}
              </span>
            </h4>
            <p
              v-if="
                option.developer_name ||
                (option as IntegrationDriver).developer?.name
              "
              class="add-device__item__description"
            >
              {{
                $t("integration.new_integration.developer", {
                  dev:
                    option.developer_name ||
                    (option as IntegrationDriver).developer?.name,
                })
              }}
            </p>
            <p v-else class="add-device__item__description">
              {{ $t("integration.new_integration.unknown_developer") }}
            </p>
          </div>
          <div class="add-device__item__button">
            <i class="fa-regular fa-chevron-right"></i>
          </div>
        </div>
      </div>
      <div class="add-device__options">
        <UCToggle
          v-model="modeAdvanced"
          :label="$t('integration.new_integration.advanced_mode.title')"
          :description="
            $t('integration.new_integration.advanced_mode.description')
          "
          :full-w="true"
          @change="updateModeAdvanced"
        />
      </div>
    </AppModal>
  </Teleport>
</template>
