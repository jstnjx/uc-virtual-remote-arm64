import { defineStore } from "pinia";
import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import type { NormalizedEvent } from "@/api/eventRouter";
import type { WsMsgData } from "@/types/websocket";

import type {
  SystemInfo,
  WifiStatus,
  PowerStatus,
  BatteryStatus,
  StandbyInhibitor,
  NewStandbyInhibitor,
  CustomWebConfiguratorStatus,
} from "@/types/systemBase";

const API = ApiConnection.system;

export const systemBaseStore = defineStore("systemBase", {
  state: () => ({
    inited: false,
    systemInfo: {} as SystemInfo,
    wifiStatus: {} as WifiStatus,
    powerStatus: {} as PowerStatus,
    batteryStatus: {} as BatteryStatus,
    standbyInhibitors: [] as StandbyInhibitor[],
    customWebConfigStatus: {} as CustomWebConfiguratorStatus,
    error: null as string | null,
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }
      this.$state.inited = true;
      eventRouter.route(
        "battery_status",
        undefined,
        (e) => {
          if (
            e.msgData.capacity &&
            typeof e.msgData.power_supply != "undefined" &&
            e.msgData.status
          ) {
            this.$state.batteryStatus = e.msgData as BatteryStatus;
          }
          this.socketUpdate(e.msgData, e);
        },
        { name: "systemBase" },
      );
    },

    socketUpdate(msg_data: WsMsgData, event?: NormalizedEvent) {
      // Placeholder action for $onAction subscribers.
      void event;
    },

    async getSystemInfo(): Promise<SystemInfo | null> {
      this.init();
      if (Object.keys(this.$state.systemInfo).length === 0) {
        this.$state.systemInfo =
          (await API.getSystemInfo()) ?? this.$state.systemInfo;
      }
      return this.$state.systemInfo;
    },

    async getWifiStatus(): Promise<WifiStatus | null> {
      this.init();
      if (Object.keys(this.$state.wifiStatus).length === 0) {
        this.$state.wifiStatus =
          (await API.getWifiStatus()) ?? this.$state.wifiStatus;
      }
      return this.$state.wifiStatus;
    },

    async getPowerStatus(reload = false): Promise<PowerStatus | null> {
      this.init();
      if (Object.keys(this.$state.powerStatus).length === 0 || reload) {
        this.$state.powerStatus =
          (await API.getPowerStatus()) ?? this.$state.powerStatus;
      }
      return this.$state.powerStatus;
    },

    async getBatteryStatus(reload = false): Promise<BatteryStatus | null> {
      this.init();

      if (reload || Object.keys(this.$state.batteryStatus).length === 0) {
        this.$state.batteryStatus =
          (await API.getBatteryStatus()) ?? this.$state.batteryStatus;
      }
      return this.$state.batteryStatus;
    },

    async getCustomWebConfigStatus(): Promise<CustomWebConfiguratorStatus | null> {
      this.init();
      if (Object.keys(this.$state.customWebConfigStatus).length === 0) {
        this.$state.customWebConfigStatus =
          (await API.getCustomWebConfigStatus()) ??
          this.$state.customWebConfigStatus;
      }
      return this.$state.customWebConfigStatus;
    },

    async getStandbyInhibitors(
      reload = false,
    ): Promise<StandbyInhibitor[] | []> {
      this.init();
      if (Object.keys(this.$state.standbyInhibitors).length === 0 || reload) {
        this.$state.standbyInhibitors =
          (await API.getStandbyInhibitors()) ?? [];
      }
      return this.$state.standbyInhibitors || [];
    },

    async updateStandbyInhibitors(
      data: NewStandbyInhibitor,
    ): Promise<StandbyInhibitor[] | []> {
      this.$state.standbyInhibitors =
        (await API.updateStandbyInhibitors(data)) ?? [];
      return this.$state.standbyInhibitors || [];
    },

    async removeStandbyInhibitor(id: string): Promise<StandbyInhibitor[] | []> {
      const hasInhibitor = this.$state.standbyInhibitors.some(
        (i) => i.id === id,
      );
      if (!hasInhibitor) return this.$state.standbyInhibitors;
      await API.removeStandbyInhibitor(id);
      return await this.getStandbyInhibitors(true);
    },
  },
});
