<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { storeToRefs } from "pinia";

import ApiConnection from "@/api";

import { SeverityLevel } from "@/types/enums";
import type { LogsParamsDownload, LogsServices, LogsBoots } from "@/types/logs";

import { logsStore } from "@/stores/logs";
import { addErrorBottom } from "@/stores/messages";
import { configStore } from "@/stores/config";

import { useDownloadFile } from "@/composables/downloadFile";
import { formatDate } from "@/composables/date";

import UCInput from "@/components/ui/UCInput.vue";
import SettingsOptionButton from "@/components/settings/SettingsOptionButton.vue";
import DatePicker from "@/components/ui/DatePicker.vue";

const logsStorage = logsStore();
const configStorage = configStore();

const { config } = storeToRefs(configStorage);

const logsApi = ApiConnection.logs;
const { getFile } = useDownloadFile();

interface SelectOption {
  label: string;
  value: string;
}

const selectedServices = ref<SelectOption[]>([]);
const priority = ref<SelectOption>({ label: "DEBUG", value: "7" });
const selectedBoots = ref<SelectOption[]>([]);

const dateFrom = ref<Date | null>(null);
const dateTo = ref<Date | null>(null);

const entriesLimit = ref(1000);
const entriesLimitMin = 1;
const entriesLimitMax = 10000;

const searchText = ref("");
const processing = ref(false);

const emit = defineEmits(["clickBack"]);

const timeFormat24h = computed(() => {
  return config.value?.localization?.time_format_24h ?? true;
});

const serviceList = computed(() =>
  setServiceList(logsStorage.logs?.services ?? []),
);
const bootList = computed(() => setBootList(logsStorage.logs?.boots ?? []));

const priorityList = computed(() => {
  const objLength = Object.keys(SeverityLevel).length;
  return Object.keys(SeverityLevel)
    .slice(objLength / 2)
    .map((key) => {
      return {
        label: key,
        value: SeverityLevel[key as keyof typeof SeverityLevel],
      };
    });
});

async function downloadLogs() {
  processing.value = true;
  const params = {
    limit: entriesLimit.value,
  } as LogsParamsDownload;

  if (selectedServices.value.length > 0) {
    params.s = selectedServices.value
      .map((item) => encodeURIComponent(item.value))
      .join(",");
  }

  if (priority.value && Number(priority.value?.value) > -1) {
    params.p = Number(priority.value?.value);
  }

  if (selectedBoots.value.length > 0) {
    params.boot_ids = selectedBoots.value.map((item) => item.value).join(",");
  }

  if (dateFrom.value) {
    params.from = dateFrom.value.toISOString();
  }

  if (dateTo.value) {
    params.to = dateTo.value.toISOString();
  }

  if (searchText.value.length > 0) {
    params.q = encodeURIComponent(searchText.value);
  }

  try {
    const result = await logsApi.downloadLogs(params);

    if (result && result.data && result.headers) {
      const fileName = result.headers["content-disposition"]
        ? result.headers["content-disposition"]
            .split("filename=")[1]
            .split(";")[0]
            .replaceAll('"', "")
        : "logs.txt"; // with fallback
      getFile(result.data, "text/plain", fileName);
    }
  } catch (e) {
    addErrorBottom(e);
  }

  processing.value = false;
}

function setServiceList(services: LogsServices[]) {
  if (services) {
    return services.map((service) => {
      return {
        label: service.name,
        value: service.service,
      };
    });
  } else {
    return [];
  }
}

function setBootList(boots: LogsBoots[]) {
  if (boots) {
    return boots.map((boot) => {
      return {
        label: `${boot.index}: ${formatDate(
          boot.first_entry,
          timeFormat24h.value,
        )} - ${formatDate(boot.last_entry, timeFormat24h.value)}`,
        value: boot.boot_id,
      };
    });
  } else {
    return [];
  }
}

function updateDateFrom(value: Date) {
  dateFrom.value = value;
}

function updateDateTo(value: Date) {
  dateTo.value = value;
}

function clickBack() {
  emit("clickBack");
}

onMounted(async () => {
  try {
    await logsStorage.getAll(true);
  } catch (e) {
    addErrorBottom(e);
  }
});
</script>
<template>
  <button
    class="button button--secondary button--icon button--icon--medium"
    @click="clickBack"
  >
    <i class="fas fa-arrow-left"></i>
  </button>
  <span class="page-settings-section__page-name">
    {{ $t("settings.development.logs.label") }}
  </span>

  <div class="page-settings-section__logs">
    <div class="page-settings-section__main">
      <SettingsOptionButton
        :select="true"
        :select-multiple="true"
        :select-update="
          (m: SelectOption[]) => {
            selectedServices = m;
          }
        "
        :active-option-item="selectedServices"
        :select-items="serviceList"
        :label="$t('settings.development.logs.services.label')"
        :description="$t('settings.development.logs.services.description')"
        :select-small-screen-position="'left'"
        :disabled="processing"
      />
      <SettingsOptionButton
        :select="true"
        :select-update="
          (m: SelectOption) => {
            priority = m;
          }
        "
        :active-option-item="priority"
        :select-items="priorityList"
        :label="$t('settings.development.logs.priority.label')"
        :description="$t('settings.development.logs.priority.description')"
        :select-small-screen-position="'left'"
        :disabled="processing"
      />
      <SettingsOptionButton
        :select="true"
        :select-multiple="true"
        :select-update="
          (m: SelectOption[]) => {
            selectedBoots = m;
          }
        "
        :active-option-item="selectedBoots"
        :select-items="bootList"
        :label="$t('settings.development.logs.boot_id.label')"
        :description="$t('settings.development.logs.boot_id.description')"
        :select-small-screen-position="'left'"
        :disabled="processing"
      />
      <SettingsOptionButton
        :label="$t('settings.development.logs.date_range.label')"
        :description="$t('settings.development.logs.date_range.description')"
        :type="'date-range'"
      >
        <template #customFields>
          <div class="settings-option-button--date-range__datepicker">
            <DatePicker
              :range="false"
              :max-date="dateTo == null ? '' : dateTo"
              :disabled="processing"
              @change="updateDateFrom"
            />
            <div class="datepicker-spacer">
              <span class="fa-thin fa-arrow-right"></span>
            </div>
            <DatePicker
              :range="false"
              :min-date="dateFrom == null ? '' : dateFrom"
              :disabled="processing"
              @change="updateDateTo"
            />
          </div>
        </template>
      </SettingsOptionButton>
      <SettingsOptionButton
        :label="$t('settings.development.logs.log_entries.label')"
        :description="$t('settings.development.logs.log_entries.description')"
        :type="'number-of-log-entries'"
      >
        <template #customFields>
          <UCInput
            v-model="entriesLimit"
            :number-min="entriesLimitMin"
            :number-max="entriesLimitMax"
            :type="'number'"
            :disabled="processing"
          />
        </template>
      </SettingsOptionButton>
      <SettingsOptionButton
        :label="$t('settings.development.logs.search_string.label')"
        :description="$t('settings.development.logs.search_string.description')"
        :type="'search-string'"
      >
        <template #customFields>
          <UCInput
            v-model="searchText"
            :label="$t('settings.development.logs.search_string.label')"
            :disabled="processing"
          />
        </template>
      </SettingsOptionButton>
      <div class="page-settings-section__main__footer">
        <button
          :disabled="processing"
          class="button button--primary button--min-w"
          @click="downloadLogs"
        >
          {{ $t("ui.download") }}
        </button>
        <img
          v-if="processing"
          src="/images/loading-indicator.png"
          alt="Loading"
          class="img-loading img-loading--base"
        />
      </div>
    </div>
  </div>
</template>
