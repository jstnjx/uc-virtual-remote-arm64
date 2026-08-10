import { defineStore } from "pinia";
import type { LogData, LogsServices } from "@/types/logs";
import ApiConnection from "@/api";

const API = ApiConnection.logs;

export const logsStore = defineStore("logs", {
  state: () => ({
    logs: {} as LogData,
  }),

  actions: {
    async getAll(update = false): Promise<LogData> {
      if (
        update == false &&
        this.$state.logs &&
        this.$state.logs.boots &&
        this.$state.logs.boots.length > 0 &&
        this.$state.logs.services &&
        this.$state.logs.services.length > 0
      ) {
        return this.$state.logs;
      }

      const boots = await API.getBoots();
      const services = await API.getServices();
      const newData = {
        boots: boots,
        services: services,
      } as LogData;
      this.$state.logs = newData;
      return newData;
    },

    async getBoots(): Promise<any[]> {
      return await API.getBoots();
    },

    async getServices(): Promise<LogsServices[]> {
      return await API.getServices();
    },
  },
});
