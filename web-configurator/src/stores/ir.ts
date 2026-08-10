import { defineStore } from "pinia";
import type {
  IrCodeDefinition,
  IrEmitter,
  IrEmitterLearnStatus,
  IrLearnEventData,
  RemoteIrCode,
} from "@/types/ir";

import ApiConnection from "@/api";
import { IrLearningEventType, RemoteIrCodeFormat } from "@/types/enums";
import { createCoalescer } from "@/composables/requestCoalescer";
import { eventRouter } from "@/api/eventRouter";
import type { NormalizedEvent } from "@/api/eventRouter";
import type { WsMsgData } from "@/types/websocket";
import { appStateStore } from "@/stores/appState";

const API = ApiConnection.ir;

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

export const irStore = defineStore("ir", {
  state: () => ({
    inited: false,
    irs: [] as IrEmitter[] | [],
    learnStatus: {} as Record<string, boolean>,
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }
      this.$state.inited = true;
      eventRouter.route(
        "entity_change",
        "emitter",
        (e) => {
          coalesce("ir:emitters", () => this.getAll());
          this.socketUpdate(e.msgData, e);
        },
        { name: "ir" },
      );
      eventRouter.route(
        "ir_learning",
        undefined,
        (e) => {
          this.irLearningEvent(e.msgData as IrLearnEventData);
          this.socketUpdate(e.msgData, e);
        },
        { name: "ir" },
      );
      appStateStore().registerResyncHandler("ir", () => {
        if (this.$state.irs.length > 0) {
          coalesce("ir:emitters", () => this.getAll());
        }
      });
    },

    async getAll(): Promise<IrEmitter[]> {
      this.init();
      const items = await API.getEmitters();
      this.$state.irs = items ?? [];
      return items;
    },

    socketUpdate(msg_data: WsMsgData, event?: NormalizedEvent) {
      void event;
      // This is only a placeholder action to make possible to subscribe on.
    },

    async getLearnedCodes(emitter_id: string): Promise<IrEmitterLearnStatus> {
      const status = await API.getLearnedCodes(emitter_id);
      this.$state.learnStatus[emitter_id] = status.learning_active;
      return status;
    },

    async startLearning(
      emitter_id: string,
      timeout = 60,
    ): Promise<{ result: boolean; error?: any }> {
      const result = await API.startLearning(emitter_id, timeout);
      this.$state.learnStatus[emitter_id] = result;
      return { result: result };
    },

    async stopLearning(emitter_id: string): Promise<IrEmitterLearnStatus> {
      const status = await API.stopLearning(emitter_id);
      this.$state.learnStatus[emitter_id] = status.learning_active;
      return status;
    },

    irLearningEvent(data: IrLearnEventData) {
      const emitter_id = data.device_id;
      if (
        !this.$state.learnStatus[emitter_id] &&
        data.event_type === IrLearningEventType.START
      ) {
        this.$state.learnStatus[emitter_id] = true;
      }

      if (
        this.$state.learnStatus[emitter_id] &&
        data.event_type === IrLearningEventType.STOP
      ) {
        this.$state.learnStatus[emitter_id] = false;
      }
    },

    async testCode(
      device_id: string,
      port_id: string,
      format: RemoteIrCodeFormat | "",
      value: string,
    ): Promise<boolean> {
      return await API.testCode(device_id, port_id, format, value);
    },

    async saveIrCode(
      modify: boolean,
      remote_id: string,
      ir_code: string,
      code: IrCodeDefinition,
    ): Promise<RemoteIrCode> {
      return await API.saveIrCode(modify, remote_id, ir_code, code);
    },
  },
});
