import { defineStore } from "pinia";
import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";

import type { SystemUpdateCheck, SystemUpdateMessage } from "@/types/update";

const API = ApiConnection.systemUpdate;

export const systemUpdateStore = defineStore("systemUpdate", {
  state: () => ({
    inited: false,
    error: null as string | null,
    updateCheck: null as SystemUpdateCheck | null,
    updateMessage: null as SystemUpdateMessage | null,
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }

      eventRouter.route(
        "software_update",
        undefined,
        (e) => {
          if (e.raw.cat === "REMOTE") {
            this.$state.updateMessage = e.msgData as SystemUpdateMessage;
          }
        },
        { name: "systemUpdate" },
      );

      this.$state.inited = true;
    },

    async getUpdates(
      forcedCheck = false,
      reload = false,
    ): Promise<SystemUpdateCheck | null> {
      this.init();
      if (this.$state.updateCheck == null || forcedCheck || reload) {
        this.$state.updateCheck =
          (await API.getUpdateStatus(forcedCheck)) ?? null;
      }
      return this.$state.updateCheck;
    },

    async doUpdate(update_id: string): Promise<any> {
      const response = await API.doUpdate(update_id);
      return response;
    },
  },
});
