import { defineStore } from "pinia";
import type {
  DockConfiguration,
  DockDiscovery,
  DockDiscoveryChangeMessage,
  DockDiscoveryList,
  DockSetup,
  DockSetupChangeMessage,
  DockStateMessage,
  DockSetupInfo,
  DockUpdateCheck,
  DockUpdateProgressMessage,
  DockPort,
  DockPortChange,
} from "@/types/dock";
import {
  DockDiscoveryChangeEventType,
  DockState,
  DockSetupState,
  DockUpdateProgressEventState,
} from "@/types/enums";
import ApiConnection from "@/api";

import { mergeEventPayload } from "@/composables/dataHelper";
import { createCoalescer } from "@/composables/requestCoalescer";
import { asError } from "@/composables/error";
import { eventRouter } from "@/api/eventRouter";
import type { NormalizedEvent } from "@/api/eventRouter";
import type { WsMsgData } from "@/types/websocket";
import { appStateStore } from "@/stores/appState";

const API = ApiConnection.docks;

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

export const docksStore = defineStore("docks", {
  state: () => ({
    inited: false,
    docks: [] as DockConfiguration[],
    dockUpdateList: [] as DockUpdateCheck[],
    discoverActive: false,
    discovered: {} as DockDiscoveryList,
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }

      eventRouter.route(
        "dock_update_change",
        undefined,
        (e) => this.dockUpdateChange(e.msgData as DockUpdateProgressMessage),
        { name: "docks" },
      );
      eventRouter.route(
        "dock_discovery",
        undefined,
        (e) => this.discoveryChange(e.msgData as DockDiscoveryChangeMessage),
        { name: "docks" },
      );
      eventRouter.route(
        "dock_setup_change",
        undefined,
        (e) => this.setupChange(e.msgData as DockSetupChangeMessage),
        { name: "docks" },
      );
      eventRouter.route(
        "dock_port_mode",
        undefined,
        (e) => {
          if (e.entityId && "port" in e.msgData) {
            // dock port payload → typed merge boundary (ADR 0002).
            void this.updateDock(
              e.entityId,
              e.msgData.port as DockConfiguration,
            );
            this.socketUpdate(e.msgData, e);
          }
        },
        { name: "docks" },
      );
      eventRouter.route(
        "dock_change",
        undefined,
        (e) => {
          if (e.eventType === "change" && e.entityId) {
            // WS new_state → typed merge boundary (ADR 0002).
            void this.updateDock(
              e.entityId,
              e.msgData.new_state as DockConfiguration,
            );
            this.socketUpdate(e.msgData, e);
          } else if (e.eventType === "new") {
            coalesce("docks:list", () => this.getDockList(true));
            this.socketUpdate(e.msgData, e);
          }
        },
        { name: "docks" },
      );
      eventRouter.route(
        "dock_state",
        undefined,
        (e) => {
          if (e.msgData.state && e.msgData.state == "ACTIVE") {
            coalesce("docks:list", () => this.getDockList(true));
            this.socketUpdate(e.msgData, e);
          } else {
            this.stateChange(e.msgData as DockStateMessage);
          }
        },
        { name: "docks" },
      );
      appStateStore().registerResyncHandler("docks", () => {
        if (this.$state.docks.length > 0) {
          coalesce("docks:list", () => this.getDockList(true));
        }
      });

      this.$state.inited = true;
    },

    socketUpdate(msg_data: WsMsgData, event?: NormalizedEvent) {
      void event;
    },

    async getDockList(update = false): Promise<DockConfiguration[]> {
      this.init();
      if (!this.$state.docks.length || update) {
        const docks = (await API.getDockList()) ?? {};
        this.$state.docks = Object.keys(docks).map((dock_id) => {
          return docks[dock_id];
        });
      }
      return this.$state.docks;
    },

    async getDockUpdateList(): Promise<DockUpdateCheck[]> {
      const updates = <DockUpdateCheck[]>[];
      const docks = await this.getDockList();

      for (const dock of docks) {
        try {
          const statusData = await this.getUpdateStatus(dock.dock_id, true);
          if (statusData.update_available === true) {
            updates.push({
              ...statusData,
              dock_configuration: dock,
            });
          }
        } catch (error) {
          console.error(error);
        }
      }
      this.$state.dockUpdateList = updates;
      return this.$state.dockUpdateList;
    },

    async getDock(dockId: string): Promise<DockConfiguration> {
      this.init();
      return await API.getDock(dockId);
    },

    async updateDock(dockId: string, dockData: DockConfiguration) {
      const cached = this.$state.docks.find((e) => e.dock_id === dockId);
      if (cached) {
        // in-place, partial-safe merge (004-ws-event-handling-rework.md §4.3)
        mergeEventPayload(cached, dockData);
      } else {
        coalesce("docks:list", () => this.getDockList(true));
      }
    },

    async updateDockPort(dockId: string, port: DockPort) {
      const dockIndex = this.$state.docks.findIndex(
        (e) => e.dock_id === dockId,
      );
      if (dockIndex > -1) {
        const portIndex = (this.$state.docks[dockIndex].ports || []).findIndex(
          (o) => port.port && o.port == port.port,
        );
        if (
          portIndex > -1 &&
          this.$state.docks[dockIndex].ports &&
          this.$state.docks[dockIndex].ports[portIndex]
        ) {
          this.$state.docks[dockIndex].ports[portIndex] = port;
        } else {
          await this.getDockList(true);
        }
      } else {
        await this.getDockList(true);
      }
    },

    async setDockBrightness(dock_id: string, value: number): Promise<boolean> {
      return API.setDockBrightness(dock_id, value);
    },

    async changeDockName(
      dock_id: string,
      name: string,
    ): Promise<DockConfiguration> {
      const dock = await API.updateDock(dock_id, {
        name,
      });
      const index = this.$state.docks.findIndex((item) => {
        return item.dock_id === dock.dock_id;
      });
      this.$state.docks[index] = dock;
      return dock;
    },

    async changeDockUrl(
      dock_id: string,
      url: string,
    ): Promise<DockConfiguration> {
      const dock = await API.updateDock(dock_id, {
        custom_ws_url: url,
      });
      const index = this.$state.docks.findIndex((item) => {
        return item.dock_id === dock.dock_id;
      });
      this.$state.docks[index] = dock;
      return dock;
    },

    async changeDockPort(
      dock_id: string,
      port_id: number,
      data: DockPortChange,
    ): Promise<DockPort> {
      const port = await API.updateDockPort(dock_id, port_id, data);
      const dockIndex = this.$state.docks.findIndex((item) => {
        return item.dock_id === dock_id;
      });
      const dock = this.$state.docks[dockIndex];
      const portIndex = (dock.ports || []).findIndex((item) => {
        return item.port === port_id;
      });

      if (portIndex > -1 && dock.ports) {
        dock.ports[portIndex] = port;
      }

      return port;
    },

    async identifyDock(dock_id: string): Promise<boolean> {
      return API.identifyDock(dock_id);
    },

    async changePass(dock_id: string, newPass: string, changeDockToken = true) {
      const dock = await API.updateDock(dock_id, {
        token: newPass,
        change_dock_token: changeDockToken,
      });
      const index = this.$state.docks.findIndex((item) => {
        return item.dock_id === dock.dock_id;
      });
      this.$state.docks[index] = dock;
    },

    async changeWifi(dock_id: string, ssid: string, password: string) {
      const dock = await API.updateDock(dock_id, {
        wifi: {
          ssid,
          password,
        },
      });
      const index = this.$state.docks.findIndex((item) => {
        return item.dock_id === dock.dock_id;
      });
      this.$state.docks[index] = dock;
    },

    async factoryReset(dock_id: string): Promise<boolean> {
      const resp = await API.factoryReset(dock_id);
      await this.getDockList(true);
      return resp;
    },

    async removeDock(dock_id: string): Promise<DockConfiguration[]> {
      await API.removeDock(dock_id);
      return this.getDockList(true);
    },

    async getUpdateStatus(
      dock_id: string,
      forcedCheck = false,
    ): Promise<DockUpdateCheck> {
      return API.getUpdateStatus(dock_id, forcedCheck);
    },

    async startUpgrade(dock_id: string): Promise<boolean> {
      this.init();
      return API.startUpgrade(dock_id);
    },

    async abortUpgrade(dock_id: string): Promise<boolean> {
      return API.abortUpgrade(dock_id);
    },

    async dockUpdateChange(msg_data: DockUpdateProgressMessage) {
      // This is also a placeholder action to make possible to subscribe on.
      if (
        msg_data.state === DockUpdateProgressEventState.OK ||
        msg_data.state === DockUpdateProgressEventState.ERROR
      ) {
        this.getDockList(true);
      }
      return true;
    },

    async startDiscovery(): Promise<boolean> {
      if (this.$state.discoverActive) {
        return true;
      }

      try {
        const result = await API.startDiscovery();
        this.$state.discoverActive = true;
        this.$state.discovered = {};
        return result;
      } catch (e) {
        throw new Error(asError(e).message || String(e));
      }
    },

    async stopDiscovery(): Promise<boolean> {
      try {
        this.$state.discoverActive = false;
        this.$state.discovered = {};
        return API.stopDiscovery();
      } catch (e) {
        throw new Error(asError(e).message || String(e));
      }
    },

    async discoveryChange(msg_data: DockDiscoveryChangeMessage) {
      if (msg_data.event_type === DockDiscoveryChangeEventType.START) {
        await this.getDiscoveryStatus();
      }
      if (msg_data.event_type === DockDiscoveryChangeEventType.STOP) {
        this.$state.discoverActive = false;
      }
      if (
        this.$state.discoverActive &&
        msg_data.event_type === DockDiscoveryChangeEventType.DISCOVERY &&
        msg_data.dock
      ) {
        this.$state.discovered[msg_data.dock.id] = msg_data.dock;
      }
      return {
        active: this.$state.discoverActive,
        discovered: this.$state.discovered,
      };
    },

    async getDiscoveryStatus() {
      const result = await API.getDiscoveryStatus();
      this.$state.discoverActive = result.active;
      this.$state.discovered = result.discovered;
      return {
        active: this.$state.discoverActive,
        discovered: this.$state.discovered,
      };
    },

    async startSetupDiscoveredSetup(
      discovery: DockDiscovery,
      dock_setup: DockSetup,
    ): Promise<DockSetupInfo> {
      const result = await API.startSetupDiscoveredSetup(discovery);
      await this.startSetupProcess(discovery.id, dock_setup);
      return result;
    },

    async startSetupManualSetup(dock: DockSetup): Promise<DockSetupInfo> {
      return API.startSetupManualSetup(dock);
    },

    async setupChange(msg_data: DockSetupChangeMessage) {
      if (
        msg_data.state === DockSetupState.OK ||
        msg_data.state === DockSetupState.ERROR
      ) {
        await this.getDockList(true);
      }

      return true;
    },

    async stateChange(msg_data: DockStateMessage) {
      const index = this.$state.docks.findIndex((item) => {
        return item.dock_id === msg_data.dock_id;
      });

      if (index > -1 && msg_data.state) {
        this.$state.docks[index].state = msg_data.state as DockState;
      }

      return true;
    },

    async startSetupProcess(
      dock_id: string,
      dock_setup: DockSetup,
    ): Promise<DockSetupInfo> {
      return API.startSetupProcess(dock_id, dock_setup);
    },

    async cancelSetup(dock_id: string): Promise<boolean> {
      return API.cancelSetup(dock_id);
    },
  },
});
