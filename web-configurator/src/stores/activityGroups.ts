import { defineStore } from "pinia";
import ApiConnection from "@/api";
import type {
  ActivityGroup,
  ActivityGroupNewData,
  ActivityGroupUpdate,
} from "@/types/activityGroup";

import { mergeEventPayload } from "@/composables/dataHelper";
import { createCoalescer } from "@/composables/requestCoalescer";
import { replaceListContents } from "@/composables/storeCache";
import { paginationCount } from "@/composables/listing";
import type { Headers } from "@/types/rest";
import { eventRouter } from "@/api/eventRouter";
import type { NormalizedEvent } from "@/api/eventRouter";
import type { WsEntityState, WsMsgData } from "@/types/websocket";
import { appStateStore } from "@/stores/appState";

const API = ApiConnection.activityGroups;

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

export const activityGroupsStore = defineStore("activityGroups", {
  state: () => ({
    inited: false,
    activityGroups: [] as ActivityGroup[],
    activityGroupsByPage: {
      activityGroups: [] as ActivityGroup[],
      // the server's total, echoed from the response headers (#685)
      count: 0,
      limit: 20,
      page: 1,
    },
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }
      this.$state.inited = true;
      eventRouter.route(
        "activity_group_change",
        undefined,
        (e) => {
          if (e.eventType === "change" && e.entityId && e.newState) {
            this.applyChange(e.entityId, e.newState);
          } else if (e.eventType === "change" && e.entityId) {
            void this.reloadupdateActivityGroupData(e.entityId).catch((err) =>
              console.error("Failed to reload activity group:", err),
            );
          } else if (e.eventType === "new" && e.entityId && e.newState) {
            this.applyNew(e.entityId, e.newState as ActivityGroup);
          } else if (e.eventType === "delete" && e.entityId) {
            this.applyDelete(e.entityId);
          } else {
            coalesce("activityGroups:full", () =>
              Promise.all([
                this.getAll(),
                this.getActivityGroupsByPageByLimit(
                  this.activityGroupsByPage.page,
                  this.activityGroupsByPage.limit,
                ),
              ]),
            );
          }
          this.socketUpdate(e.msgData, e);
        },
        { name: "activityGroups" },
      );
      appStateStore().registerResyncHandler("activityGroups", () => {
        if (this.$state.activityGroups.length > 0) {
          coalesce("activityGroups:full", () => this.getAll());
        }
        if (this.$state.activityGroupsByPage.activityGroups.length > 0) {
          coalesce("activityGroups:page", () =>
            this.getActivityGroupsByPageByLimit(
              this.activityGroupsByPage.page,
              this.activityGroupsByPage.limit,
            ),
          );
        }
      });
    },

    async getAll(): Promise<ActivityGroup[]> {
      this.init();
      // Rejections propagate to the caller (P1-3): a failed refresh keeps
      // the cached list instead of masquerading as an empty result.
      const items = await API.getAll();
      this.$state.activityGroups = items ?? [];
      return this.$state.activityGroups;
    },

    async getActivityGroupsByPageByLimit(
      page = 1,
      limit = 100,
    ): Promise<{
      data: { activityGroups: ActivityGroup[]; limit: number; page: number };
      headers: object;
    }> {
      this.init();
      let newActivityGroups = <{ data: ActivityGroup[]; headers?: object }>{};
      newActivityGroups = await API.getActivityGroupsByPageByLimit(page, limit);
      // in place — views hold this array (#683)
      replaceListContents(
        this.$state.activityGroupsByPage.activityGroups,
        newActivityGroups.data ?? [],
      );

      // the server's total, so a refetch the view did not make updates it (#685)
      this.$state.activityGroupsByPage.count = paginationCount(
        newActivityGroups.headers as Headers,
      );
      this.$state.activityGroupsByPage.limit = limit;
      this.$state.activityGroupsByPage.page = page;
      return {
        data: this.$state.activityGroupsByPage,
        headers: newActivityGroups.headers || {},
      };
    },

    async getActivityGroup(groupId: string): Promise<ActivityGroup> {
      this.init();
      return await API.getActivityGroup(groupId);
    },

    /** Store contract (004-ws-event-handling-rework.md §4.2): in-place merge,
     *  cache miss updates nothing. */
    applyChange(groupId: string, patch: WsEntityState) {
      if (patch.group_id && patch.group_id !== groupId) {
        return;
      }
      // WS payload → typed-entity merge boundary (ADR 0002).
      const groupPatch = patch as Partial<ActivityGroup>;
      const inFull = this.$state.activityGroups.find(
        (g) => g.group_id === groupId,
      );
      if (inFull) {
        mergeEventPayload(inFull, groupPatch);
      }
      const inPage = this.$state.activityGroupsByPage.activityGroups.find(
        (g) => g.group_id === groupId,
      );
      if (inPage) {
        mergeEventPayload(inPage, groupPatch);
      }
    },

    /** NEW events carry the complete entity (core guarantee, task doc OQ-2). */
    applyNew(groupId: string, group: ActivityGroup) {
      if (!this.$state.activityGroups.some((g) => g.group_id === groupId)) {
        this.$state.activityGroups.push(group);
      }
      coalesce("activityGroups:page", () =>
        this.getActivityGroupsByPageByLimit(
          this.activityGroupsByPage.page,
          this.activityGroupsByPage.limit,
        ),
      );
    },

    /** Targeted removal — no full reloads on delete (task doc P1-3). */
    applyDelete(groupId: string) {
      const fullIndex = this.$state.activityGroups.findIndex(
        (g) => g.group_id === groupId,
      );
      if (fullIndex > -1) {
        this.$state.activityGroups.splice(fullIndex, 1);
      }
      const pageIndex =
        this.$state.activityGroupsByPage.activityGroups.findIndex(
          (g) => g.group_id === groupId,
        );
      if (pageIndex > -1) {
        this.$state.activityGroupsByPage.activityGroups.splice(pageIndex, 1);
      }
      if (
        this.$state.activityGroupsByPage.activityGroups.length > 0 ||
        pageIndex > -1
      ) {
        coalesce("activityGroups:page", () =>
          this.getActivityGroupsByPageByLimit(
            this.activityGroupsByPage.page,
            this.activityGroupsByPage.limit,
          ),
        );
      }
    },

    /** Change event without payload: reload the single entity via REST. */
    async reloadupdateActivityGroupData(group_id: string) {
      const updatedActivityGroup = await API.getActivityGroup(group_id);
      this.applyChange(updatedActivityGroup.group_id, updatedActivityGroup);
    },

    socketUpdate(msg_data: WsMsgData, event?: NormalizedEvent) {
      // Placeholder action for $onAction subscribers (edit screens).
      void event;
    },

    async create(
      activityGroupData: ActivityGroupNewData,
    ): Promise<ActivityGroup> {
      return await API.createNewActivityGroup(activityGroupData);
    },

    async update(
      group_id: string,
      activityGroup: ActivityGroupUpdate,
    ): Promise<ActivityGroup> {
      return await API.update(group_id, activityGroup);
    },

    async delete(activityGroup: ActivityGroup): Promise<ActivityGroup[]> {
      await API.delete(activityGroup);
      return this.getAll();
    },
  },
});
