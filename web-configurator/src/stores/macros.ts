import { defineStore } from "pinia";
import ApiConnection from "@/api";
import type {
  Macro,
  MacroBasic,
  MacroFull,
  MacroNewData,
  MacroUpdate,
} from "@/types/macro";

import { mergeEventPayload } from "@/composables/dataHelper";
import { createCoalescer } from "@/composables/requestCoalescer";
import { replaceListContents } from "@/composables/storeCache";
import { paginationCount } from "@/composables/listing";
import type { Headers } from "@/types/rest";
import { eventRouter } from "@/api/eventRouter";
import type { NormalizedEvent } from "@/api/eventRouter";
import type { WsEntityState, WsMsgData } from "@/types/websocket";
import { appStateStore } from "@/stores/appState";

const API = ApiConnection.macros;

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

export const macrosStore = defineStore("macros", {
  state: () => ({
    inited: false,
    macros: [] as MacroBasic[],
    macrosByPage: {
      macros: [] as MacroBasic[],
      // the server's total, echoed from the response headers (#685)
      count: 0,
      limit: 20,
      page: 1,
      searchText: "",
    },
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }
      this.$state.inited = true;
      eventRouter.route(
        "entity_change",
        "macro",
        (e) => {
          // Running-sequence noise is excluded from ALL overview (store list)
          // handling (004-ws-event-handling-rework.md OQ-3); socketUpdate below
          // still fires so edit screens can show sequence progress.
          if (!e.isRunningNoise) {
            if (e.eventType === "change" && e.entityId && e.newState) {
              this.applyChange(e.entityId, e.newState);
            } else if (e.eventType === "change" && e.entityId) {
              this.reloadMacroData(e.entityId);
            } else if (e.eventType === "new" && e.entityId && e.newState) {
              this.applyNew(e.entityId, e.newState as MacroBasic);
            } else if (e.eventType === "delete" && e.entityId) {
              this.applyDelete(e.entityId);
            } else {
              coalesce("macros:full", () =>
                Promise.all([
                  this.getAll(),
                  this.getMacrosByPageByLimit(
                    this.macrosByPage.page,
                    this.macrosByPage.limit,
                    this.macrosByPage.searchText,
                  ),
                ]),
              );
            }
          }
          this.socketUpdate(e.msgData, e);
        },
        { name: "macros" },
      );
      appStateStore().registerResyncHandler("macros", () => {
        if (this.$state.macros.length > 0) {
          coalesce("macros:full", () => this.getAll());
        }
        if (this.$state.macrosByPage.macros.length > 0) {
          coalesce("macros:page", () =>
            this.getMacrosByPageByLimit(
              this.macrosByPage.page,
              this.macrosByPage.limit,
              this.macrosByPage.searchText,
            ),
          );
        }
      });
    },

    async getAll(): Promise<Macro[]> {
      this.init();
      // Rejections propagate to the caller (P1-3): a failed refresh keeps
      // the cached list instead of masquerading as an empty result.
      const items = await API.getAll();
      this.$state.macros = items ?? [];
      return this.$state.macros;
    },

    async getMacrosByPageByLimit(
      page = 1,
      limit = 100,
      searchText = "",
    ): Promise<{
      data: { macros: Macro[]; limit: number; page: number };
      headers: object;
    }> {
      this.init();
      let newMacros = <{ data: Macro[]; headers?: object }>{};
      newMacros = await API.getMacrosPaged({ page, limit, search: searchText });
      // in place — views hold this array (#683)
      replaceListContents(
        this.$state.macrosByPage.macros,
        newMacros.data ?? [],
      );

      // the server's total, so a refetch the view did not make updates it (#685)
      this.$state.macrosByPage.count = paginationCount(
        newMacros.headers as Headers,
      );
      this.$state.macrosByPage.limit = limit;
      this.$state.macrosByPage.page = page;
      this.$state.macrosByPage.searchText = searchText;
      return {
        data: this.$state.macrosByPage,
        headers: newMacros.headers || {},
      };
    },

    async getMacro(macroId: string): Promise<MacroFull> {
      this.init();
      return await API.getMacro(macroId);
    },

    /** Store contract (004-ws-event-handling-rework.md §4.2): in-place merge,
     *  cache miss updates nothing. */
    applyChange(entityId: string, patch: WsEntityState) {
      if (patch.entity_id && patch.entity_id !== entityId) {
        return;
      }
      // WS payload → typed-entity merge boundary (ADR 0002).
      const entityPatch = patch as Partial<MacroBasic>;
      const inFull = this.$state.macros.find((m) => m.entity_id === entityId);
      if (inFull) {
        mergeEventPayload(inFull, entityPatch);
      }
      const inPage = this.$state.macrosByPage.macros.find(
        (m) => m.entity_id === entityId,
      );
      if (inPage) {
        mergeEventPayload(inPage, entityPatch);
      }
    },

    /** NEW events carry the complete entity (core guarantee, task doc OQ-2). */
    applyNew(entityId: string, macro: MacroBasic) {
      if (!this.$state.macros.some((m) => m.entity_id === entityId)) {
        this.$state.macros.push(macro);
      }
      coalesce("macros:page", () =>
        this.getMacrosByPageByLimit(
          this.macrosByPage.page,
          this.macrosByPage.limit,
          this.macrosByPage.searchText,
        ),
      );
    },

    /** Targeted removal — no full reloads on delete (task doc P1-3). */
    applyDelete(entityId: string) {
      const fullIndex = this.$state.macros.findIndex(
        (m) => m.entity_id === entityId,
      );
      if (fullIndex > -1) {
        this.$state.macros.splice(fullIndex, 1);
      }
      const pageIndex = this.$state.macrosByPage.macros.findIndex(
        (m) => m.entity_id === entityId,
      );
      if (pageIndex > -1) {
        this.$state.macrosByPage.macros.splice(pageIndex, 1);
      }
      if (this.$state.macrosByPage.macros.length > 0 || pageIndex > -1) {
        coalesce("macros:page", () =>
          this.getMacrosByPageByLimit(
            this.macrosByPage.page,
            this.macrosByPage.limit,
            this.macrosByPage.searchText,
          ),
        );
      }
    },

    /** Change event without payload: reload the single entity via REST. */
    async reloadMacroData(entity_id: string) {
      const updatedEntity = await API.getMacro(entity_id);
      this.applyChange(updatedEntity.entity_id, updatedEntity);
    },

    socketUpdate(msg_data: WsMsgData, event?: NormalizedEvent) {
      // Placeholder action for $onAction subscribers (edit screens).
      void event;
    },

    async create(macroData: MacroNewData): Promise<Macro> {
      return await API.createNewMacro(macroData);
    },

    async clone(newMacro: MacroNewData, clone_from: string): Promise<Macro> {
      return await API.cloneFrom(newMacro, clone_from);
    },

    async update(macro_id: string, macro: MacroUpdate): Promise<Macro> {
      return await API.update(macro_id, macro);
    },

    async delete(macro: Macro): Promise<Macro[]> {
      await API.delete(macro);
      return this.getAll();
    },
  },
});
