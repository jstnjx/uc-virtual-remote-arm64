import { defineStore } from "pinia";
import ApiConnection from "@/api";

import type {
  ExternalSystem,
  ExternalSystemQueryParams,
  ApplicationCredentialNewData,
} from "@/types/externalToken";

const API = ApiConnection.authExternal;

export const authExternalStore = defineStore("authExternal", {
  state: () => ({
    error: null as string | null,
    externals: [] as ExternalSystem[],
    intgExternalsWithoutCred: [] as ExternalSystem[],
    oAuthExternals: [] as ExternalSystem[],
  }),

  actions: {
    async getExternals(reload = false): Promise<ExternalSystem[] | []> {
      if (this.$state.externals.length == 0 || reload) {
        this.$state.externals = await API.getExternalSystems();
      }
      return this.$state.externals;
    },

    async getOAuthExternals(reload = false): Promise<ExternalSystem[] | []> {
      if (this.$state.oAuthExternals.length == 0 || reload) {
        const params = { type: "OAUTH2_APP" } as ExternalSystemQueryParams;

        this.$state.oAuthExternals = await API.getExternalSystems(params);
      }
      return this.$state.oAuthExternals;
    },

    async getIntegrationExternalsWithoutCredentials(
      reload = false,
    ): Promise<ExternalSystem[] | []> {
      if (this.$state.intgExternalsWithoutCred.length == 0 || reload) {
        const params = {
          state: "NEW",
          intg: true,
        } as ExternalSystemQueryParams;

        this.$state.intgExternalsWithoutCred =
          await API.getExternalSystems(params);
      }
      return this.$state.intgExternalsWithoutCred;
    },

    async createNewApplicationCredential(
      data: ApplicationCredentialNewData,
      systemId: string,
    ): Promise<boolean> {
      return await API.createNewApplicationCredential(data, systemId);
    },

    async deleteAccessTokens(systemId: string): Promise<boolean> {
      return await API.deleteAccessTokens(systemId);
    },
  },
});
