import { defineStore } from "pinia";
import type {
  BluetoothRemote,
  BluetoothProfile,
  BluetoothRemoteNewData,
  BluetoothPairing,
  BluetoothPairingMessage,
  BluetoothPairingEvent,
  BluetoothInfo,
} from "@/types/bluetooth";

import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import type { WsMsgData } from "@/types/websocket";

const API = ApiConnection.bluetooth;

export const bluetoothStore = defineStore("bluetooth", {
  state: () => ({
    inited: false,
    profiles: [] as BluetoothProfile[] | [],
    remote: null as BluetoothRemote | null,
    pairing: null as BluetoothPairing | null,
    baseInfo: null as BluetoothInfo | null,
    pairingEvent: null as BluetoothPairingEvent | null,
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }

      for (const msg of [
        "bt_pairing_started",
        "bt_pairing_auth_request",
        "bt_pairing_complete",
      ]) {
        eventRouter.route(
          msg,
          undefined,
          (e) => {
            if (e.raw.cat === "DEVICE") {
              this.$state.pairingEvent = e.raw as BluetoothPairingEvent;
            }
          },
          { name: "bluetooth" },
        );
      }
      this.$state.inited = true;
    },

    async getProfiles(): Promise<BluetoothProfile[]> {
      if (this.$state.profiles && this.$state.profiles.length > 0) {
        return this.$state.profiles;
      }

      this.init();
      const items = await API.getProfiles();
      this.$state.profiles = items ?? [];
      return items;
    },

    async create(btData: BluetoothRemoteNewData): Promise<BluetoothRemote> {
      return await API.createBluetoothRemote(btData);
    },

    async getBtInfo(remoteId: string): Promise<BluetoothInfo> {
      this.init();
      const message = await API.getBtInfo(remoteId);
      this.$state.baseInfo = message ?? null;
      return message;
    },

    async getBtPairing(remoteId: string): Promise<BluetoothPairing> {
      this.init();
      const message = await API.getBtPairing(remoteId);
      this.$state.pairing = message ?? null;
      return message;
    },

    async changeBtPairing(
      remoteId: string,
      enabled = false,
    ): Promise<BluetoothPairing> {
      const message = await API.changeBtPairing(remoteId, enabled);
      this.$state.pairing = message ?? null;
      return message;
    },

    async updateBtPairing(
      remoteId: string,
      data: BluetoothPairingMessage,
    ): Promise<BluetoothPairing> {
      const message = await API.updateBtPairing(remoteId, data);
      this.$state.pairing = message ?? null;
      return message;
    },

    async removeBtPairing(remoteId: string): Promise<boolean> {
      return await API.removeBtPairing(remoteId);
    },

    resetPairingEvent() {
      this.$state.pairingEvent = null;
    },

    socketUpdate(_msg_data: WsMsgData) {
      // This is only a placeholder action to make possible to subscribe on.
    },
  },
});
