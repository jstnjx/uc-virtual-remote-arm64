import { defineStore } from "pinia";

import { RemoteKind } from "@/types/enums";
import type {
  Remote,
  RemoteBasic,
  RemoteFull,
  RemoteNewData,
  RemoteUpdate,
  RemoteUpdateCheck,
} from "@/types/remote";
import type { BluetoothRemote } from "@/types/bluetooth";
import type {
  ActivityUserInterfacePage,
  NewActivityUserInterfacePage,
  ActivityUserInterfacePageUpdate,
  DeviceButtonMapping,
} from "@/types/activity";
import type { IrCodeDefinition, RemoteDataSet, RemoteIrCode } from "@/types/ir";
import type { ButtonMappingPressType } from "@/types/enums";

import ApiConnection from "@/api";

import { mergeEventPayload, useDataHelper } from "@/composables/dataHelper";
import { createCoalescer } from "@/composables/requestCoalescer";
import { replaceListContents } from "@/composables/storeCache";
import { paginationCount } from "@/composables/listing";
import type { Headers } from "@/types/rest";
import { eventRouter } from "@/api/eventRouter";
import type { NormalizedEvent } from "@/api/eventRouter";
import type { WsEntityState, WsMsgData } from "@/types/websocket";
import { appStateStore } from "@/stores/appState";

const API = ApiConnection.remotes;
const { isNonEmptyObject } = useDataHelper();

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

export const remotesStore = defineStore("remotes", {
  state: () => ({
    inited: false,
    remotes: [] as RemoteBasic[],
    remotesIr: [] as RemoteBasic[],
    remotesBt: [] as RemoteBasic[],
    remotesExternal: [] as RemoteBasic[],
    remoteUpdateList: [] as RemoteUpdateCheck[],
    pages: [] as ActivityUserInterfacePage[] | [],
    remotesByPage: {
      remotes: [] as RemoteBasic[],
      // the server's total, echoed from the response headers (#685)
      count: 0,
      limit: 20,
      page: 1,
      searchText: "",
      kind: "",
      entityTypes: "",
    },
    // Detail slot: the full entity from the dedicated fetch (ADR 0009).
    remote: {} as RemoteFull,
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }
      this.$state.inited = true;
      // remote entities are also configured entities → deliberate dual-owner
      // route with the integrations store (task doc §4.1)
      eventRouter.route(
        "entity_change",
        "remote",
        (e) => {
          if (e.eventType === "change" && e.entityId && e.newState) {
            this.applyChange(e.entityId, e.newState);
            void this.updateRemote(e.entityId, e.newState);
          } else if (e.eventType === "change" && e.entityId) {
            this.reloadRemoteData(e.entityId);
          } else if (e.eventType === "new" && e.entityId && e.newState) {
            this.applyNew(e.entityId, e.newState as RemoteBasic);
          } else if (e.eventType === "delete" && e.entityId) {
            this.applyDelete(e.entityId);
          } else {
            coalesce("remotes:full", () => {
              const requests: Promise<unknown>[] = [this.getAll()];
              if (
                this.remotesByPage.kind &&
                this.remotesByPage.kind.length > 0
              ) {
                requests.push(this.reloadPage());
              }
              return Promise.all(requests);
            });
          }
          this.socketUpdate(e.msgData, e);
        },
        { name: "remotes", shared: true },
      );
      appStateStore().registerResyncHandler("remotes", () => {
        if (
          this.$state.remotes.length > 0 ||
          this.$state.remotesIr.length > 0 ||
          this.$state.remotesBt.length > 0 ||
          this.$state.remotesExternal.length > 0
        ) {
          coalesce("remotes:full", () => this.getAll());
        }
        if (this.remotesByPage.kind && this.remotesByPage.kind.length > 0) {
          coalesce("remotes:page", () => this.reloadPage());
        }
      });
    },

    /** Refresh the current page view with its stored filter arguments. */
    reloadPage() {
      return this.getRemotesByPageByLimit(
        this.remotesByPage.kind,
        false,
        this.remotesByPage.page,
        this.remotesByPage.limit,
        this.remotesByPage.searchText,
      );
    },

    socketUpdate(msg_data: WsMsgData, event?: NormalizedEvent) {
      // Placeholder action for $onAction subscribers (edit screens).
      void event;
    },

    async getAll(kind?: RemoteKind): Promise<Remote[]> {
      this.init();

      if (kind) {
        const items = await API.getAll(kind);

        if (kind == RemoteKind.IR) {
          this.$state.remotesIr = items ?? [];
        } else if (kind == RemoteKind.BT) {
          this.$state.remotesBt = items ?? [];
        } else if (kind == RemoteKind.EXTERNAL) {
          this.$state.remotesExternal = items ?? [];
        }

        return items;
      } else {
        const items = await API.getAll();
        this.$state.remotes = items ?? [];
        return items;
      }
    },

    async getRemotesByPageByLimit(
      kind = "",
      update = false,
      page = 1,
      limit = 100,
      searchText = "",
    ): Promise<{
      data: { remotes: Remote[]; limit: number; page: number };
      headers: object;
    }> {
      this.init();
      let newEntities = <{ data: Remote[]; headers?: object }>{};
      newEntities = await API.getRemotesByPageByLimit(
        kind,
        update,
        page,
        limit,
        searchText,
      );
      // in place — views hold this array (#683)
      replaceListContents(
        this.$state.remotesByPage.remotes,
        newEntities.data ?? [],
      );

      // the server's total, so a refetch the view did not make updates it (#685)
      this.$state.remotesByPage.count = paginationCount(
        newEntities.headers as Headers,
      );
      this.$state.remotesByPage.limit = limit;
      this.$state.remotesByPage.page = page;
      this.$state.remotesByPage.searchText = searchText;
      this.$state.remotesByPage.kind = kind;
      return {
        data: this.$state.remotesByPage,
        headers: newEntities.headers || {},
      };
    },

    async getRemote(
      entityId: string,
      reload = true,
    ): Promise<RemoteFull | undefined> {
      this.init();
      if (
        reload ||
        !isNonEmptyObject(this.remote) ||
        this.remote.entity_id != entityId
      ) {
        const res = await API.getRemote(entityId);

        if (res) {
          this.remote = res;
        }
      }

      if (this.remote.entity_id != entityId) return undefined;
      return this.remote;
    },

    /** All lists that can cache a remote. */
    cachedRemoteLists(): RemoteBasic[][] {
      return [
        this.$state.remotes,
        this.$state.remotesIr,
        this.$state.remotesBt,
        this.$state.remotesExternal,
        this.$state.remotesByPage.remotes,
      ];
    },

    /** Store contract (004-ws-event-handling-rework.md §4.2): in-place merge,
     *  cache miss updates nothing. */
    applyChange(entityId: string, patch: WsEntityState) {
      if (patch.entity_id && patch.entity_id !== entityId) {
        return;
      }
      // WS payload → typed-entity merge boundary (ADR 0002).
      const remotePatch = patch as Partial<RemoteBasic>;
      for (const list of this.cachedRemoteLists()) {
        const cached = list.find((r) => r.entity_id === entityId);
        if (cached) {
          mergeEventPayload(cached, remotePatch);
        }
      }
    },

    /** NEW events carry the complete entity (core guarantee, task doc OQ-2). */
    applyNew(entityId: string, remote: RemoteBasic) {
      const kind = remote.options?.kind;
      const kindList =
        kind == RemoteKind.BT
          ? this.$state.remotesBt
          : kind == RemoteKind.EXTERNAL
            ? this.$state.remotesExternal
            : this.$state.remotesIr;
      if (!kindList.some((r) => r.entity_id === entityId)) {
        kindList.push(remote);
      }
      if (!this.$state.remotes.some((r) => r.entity_id === entityId)) {
        this.$state.remotes.push(remote);
      }
      if (this.remotesByPage.kind && this.remotesByPage.kind.length > 0) {
        coalesce("remotes:page", () => this.reloadPage());
      }
    },

    /** Targeted removal — no full reloads on delete (task doc P1-3). */
    applyDelete(entityId: string) {
      for (const list of this.cachedRemoteLists()) {
        const index = list.findIndex((r) => r.entity_id === entityId);
        if (index > -1) {
          list.splice(index, 1);
        }
      }
      if (this.remotesByPage.kind && this.remotesByPage.kind.length > 0) {
        coalesce("remotes:page", () => this.reloadPage());
      }
    },

    /** Keeps the currently opened remote in sync (edit views read it). The
     *  event payload is a basic patch merged into the full detail slot. */
    async updateRemote(entityId: string, remoteData: WsEntityState) {
      if (this.remote != null && this.remote.entity_id == entityId) {
        // WS payload → typed-entity merge boundary (ADR 0002).
        mergeEventPayload(this.remote, remoteData as Partial<RemoteFull>);
      }
    },

    /** Change event without payload: reload the single entity via REST. */
    async reloadRemoteData(entity_id: string) {
      const updatedEntity = await API.getRemote(entity_id);
      this.applyChange(updatedEntity.entity_id, updatedEntity);
    },

    async getRemoteIrCodes(entity_id: string): Promise<RemoteDataSet> {
      return await API.getRemoteIrCodes(entity_id);
    },

    async addCustomCodeToSet(
      entity_id: string,
      cmd_id: string,
      code: IrCodeDefinition,
    ): Promise<RemoteIrCode> {
      return await API.addCustomCodeToSet(entity_id, cmd_id, code);
    },

    async getCustomCode(
      entity_id: string,
      cmd_id: string,
    ): Promise<RemoteIrCode> {
      return await API.getCustomCode(entity_id, cmd_id);
    },

    async removeCustomCodeFromSet(
      entity_id: string,
      cmd_id: string,
    ): Promise<boolean> {
      return await API.removeCustomCodeFromSet(entity_id, cmd_id);
    },

    async create(remoteData: RemoteNewData): Promise<Remote> {
      return await API.createNewRemote(remoteData);
    },

    async update(
      entity_id: string,
      data: RemoteUpdate,
    ): Promise<Remote | undefined> {
      const msg = await API.update(entity_id, data);
      if (msg && msg.entity_id) {
        return msg;
      } else {
        return this.getRemote(entity_id);
      }
    },

    async delete(remote: Remote | BluetoothRemote): Promise<Remote[]> {
      await API.delete(remote);
      return this.getAll();
    },

    async addUiPage(remote: Remote, newItem: NewActivityUserInterfacePage) {
      await API.addUiPage(remote, newItem);
      return this.getRemote(remote.entity_id);
    },

    async deleteUiPage(remote_id: string, page_id: string) {
      await API.deleteUiPage(remote_id, page_id);
      return this.getRemote(remote_id);
    },

    async updateUiPage(
      remote_id: string,
      page: ActivityUserInterfacePageUpdate,
    ) {
      await API.updateUiPage(remote_id, page);
      return this.getRemote(remote_id);
    },

    async allUiReset(remote_id: string): Promise<Remote | undefined> {
      await API.allUiReset(remote_id);
      return this.getRemote(remote_id);
    },

    async updatePagesOrder(
      remote: Remote,
      pageValues: ActivityUserInterfacePage[],
    ) {
      const pages: string[] = Array.from(pageValues).map((page) => {
        return page.page_id;
      });
      await API.updateUiPageOrder(remote, pages);

      return this.getPages(remote);
    },

    async getPages(remote: Remote) {
      this.$state.pages = (await API.getPages(remote)) ?? [];
      return this.$state.pages;
    },

    async buttonUpdate(
      remote_id: string,
      button: string,
      command: string,
      pressType: ButtonMappingPressType,
    ): Promise<Remote | undefined> {
      await API.buttonUpdate(remote_id, button, command, pressType);
      return this.getRemote(remote_id);
    },

    async buttonReset(
      remote_id: string,
      button: string,
      pressType?: ButtonMappingPressType,
    ): Promise<Remote | undefined> {
      await API.buttonReset(remote_id, button, pressType);
      return this.getRemote(remote_id);
    },

    async allButtonsMerge(
      remote_id: string,
      data: DeviceButtonMapping[],
    ): Promise<Remote | undefined> {
      await API.allButtonsMerge(remote_id, data);
      return this.getRemote(remote_id);
    },

    async allButtonsUpdate(
      remote_id: string,
      data: DeviceButtonMapping[],
    ): Promise<Remote | undefined> {
      await API.allButtonsUpdate(remote_id, data);
      return this.getRemote(remote_id);
    },

    async allButtonsReset(remote_id: string): Promise<Remote | undefined> {
      await API.allButtonsReset(remote_id);
      return this.getRemote(remote_id);
    },

    async getRemoteUpdateList(): Promise<RemoteUpdateCheck[]> {
      const updates = <RemoteUpdateCheck[]>[];
      let availableRemotes = this.$state.remotes;

      if (availableRemotes.length < 1) {
        availableRemotes = await API.getAll();
      }

      // Per-remote error tolerance (P3-7): one failing update check must not
      // reject the whole list — keep the successes, log the failures.
      for (const remote of availableRemotes) {
        try {
          const statusData = await this.getUpdateStatus(remote.entity_id, true);
          if (statusData.update_available === true) {
            updates.push({
              ...statusData,
              remote_configuration: remote,
            });
          }
        } catch (error) {
          console.error(
            `Failed to check update status for remote ${remote.entity_id}:`,
            error,
          );
        }
      }
      this.$state.remoteUpdateList = updates;
      return this.$state.remoteUpdateList;
    },

    async getUpdateStatus(
      remote_id: string,
      forcedCheck = false,
    ): Promise<RemoteUpdateCheck> {
      return API.getUpdateStatus(remote_id, forcedCheck);
    },
  },
});
