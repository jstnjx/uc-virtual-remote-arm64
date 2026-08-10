import { defineStore } from "pinia";
import ApiConnection from "@/api";
import type {
  Activity,
  ActivityBasic,
  ActivityFull,
  ActivityNewData,
  ActivityUpdate,
  ActivityUserInterfacePage,
  NewActivityUserInterfacePage,
  ActivityUserInterfacePageUpdate,
  EntityCommand,
  DeviceButtonMapping,
} from "@/types/activity";
import type { ButtonMappingPressType } from "@/types/enums";

import {
  deepClone,
  mergeEventPayload,
  useDataHelper,
} from "@/composables/dataHelper";
import { createCoalescer } from "@/composables/requestCoalescer";
import { replaceListContents } from "@/composables/storeCache";
import { paginationCount } from "@/composables/listing";
import type { Headers } from "@/types/rest";
import { eventRouter } from "@/api/eventRouter";
import type { NormalizedEvent } from "@/api/eventRouter";
import type { WsEntityState, WsMsgData } from "@/types/websocket";
import { appStateStore } from "@/stores/appState";

const API = ApiConnection.activities;
const { isNonEmptyObject } = useDataHelper();

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

export const activitiesStore = defineStore("activities", {
  state: () => ({
    inited: false,
    activities: [] as ActivityBasic[],
    activitiesByPage: {
      activities: [] as ActivityBasic[],
      // the server's total, echoed from the response headers (#685)
      count: 0,
      limit: 20,
      page: 1,
      searchText: "",
    },
    availableActivities: [] as ActivityBasic[],
    pages: [] as ActivityUserInterfacePage[] | [],
    // Detail slot: the full entity from the dedicated fetch (ADR 0009).
    activity: {} as ActivityFull,
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }
      this.$state.inited = true;
      eventRouter.route(
        "entity_change",
        "activity",
        (e) => {
          // Running-sequence noise is excluded from ALL overview (store list)
          // handling (004-ws-event-handling-rework.md OQ-3); socketUpdate below
          // still fires so edit screens can show sequence progress.
          if (!e.isRunningNoise) {
            if (e.eventType === "change" && e.entityId && e.newState) {
              this.applyChange(e.entityId, e.newState);
            } else if (e.eventType === "change" && e.entityId) {
              // change without payload → single-entity REST reload
              this.reloadActivityData(e.entityId);
            } else if (e.eventType === "new" && e.entityId && e.newState) {
              this.applyNew(e.entityId, e.newState as ActivityBasic);
            } else if (e.eventType === "delete" && e.entityId) {
              this.applyDelete(e.entityId);
            } else {
              // truly unclassifiable — last-resort full reload, coalesced
              coalesce("activities:full", () =>
                Promise.all([
                  this.getAll(),
                  this.getActivitiesByPageByLimit(
                    this.activitiesByPage.page,
                    this.activitiesByPage.limit,
                    this.activitiesByPage.searchText,
                  ),
                ]),
              );
            }
          }
          this.socketUpdate(e.msgData, e);
        },
        { name: "activities" },
      );
      // Reconnect resync: WS events missed while the device slept cannot be
      // replayed — refresh what is already loaded (task doc §4.5, OQ-4).
      appStateStore().registerResyncHandler("activities", () => {
        if (this.$state.activities.length > 0) {
          coalesce("activities:full", () => this.getAll());
        }
        if (this.$state.activitiesByPage.activities.length > 0) {
          coalesce("activities:page", () =>
            this.getActivitiesByPageByLimit(
              this.activitiesByPage.page,
              this.activitiesByPage.limit,
              this.activitiesByPage.searchText,
            ),
          );
        }
      });
    },

    socketUpdate(msg_data: WsMsgData, event?: NormalizedEvent) {
      // Placeholder action for $onAction subscribers (edit screens).
      // msg_data is the raw payload (original event_type casing);
      // `event` additionally provides the normalized view.
      void event;
    },

    async getAll(): Promise<Activity[]> {
      this.init();
      // Rejections propagate to the caller (P1-3): a failed refresh keeps
      // the cached list instead of masquerading as an empty result.
      const items = await API.getAll();
      this.$state.activities = items ?? [];
      return this.$state.activities;
    },

    async getActivitiesByPageByLimit(
      page = 1,
      limit = 100,
      searchText = "",
      in_group: boolean | undefined = undefined,
    ): Promise<{
      data: { activities: Activity[]; limit: number; page: number };
      headers: object;
    }> {
      this.init();
      let newActivities = <{ data: Activity[]; headers?: object }>{};
      newActivities = await API.getActivitiesByPageByLimit(
        page,
        limit,
        searchText,
        in_group,
      );
      // in place — views hold this array (#683)
      replaceListContents(
        this.$state.activitiesByPage.activities,
        newActivities.data ?? [],
      );

      // the server's total, so a refetch the view did not make updates it (#685)
      this.$state.activitiesByPage.count = paginationCount(
        newActivities.headers as Headers,
      );
      this.$state.activitiesByPage.limit = limit;
      this.$state.activitiesByPage.page = page;
      this.$state.activitiesByPage.searchText = searchText;
      return {
        data: this.$state.activitiesByPage,
        headers: newActivities.headers || {},
      };
    },

    /**
     * A page of activities that are not in an activity group, for the activity
     * group pickers.
     *
     * Deliberately not routed through `activitiesByPage`: that slot holds the
     * overview list's own query, and the views render its array by reference
     * (#683). Writing a differently-filtered result into it empties the
     * activity list behind the picker until the view remounts.
     */
    async getUngroupedActivities(
      page = 1,
      limit = 100,
      searchText = "",
    ): Promise<{ data: Activity[]; headers: Headers }> {
      this.init();
      const response = await API.getActivitiesByPageByLimit(
        page,
        limit,
        searchText,
        false,
      );
      return {
        data: response.data ?? [],
        headers: (response.headers ?? {}) as Headers,
      };
    },

    async getActivitiesByPage(
      user_fetch_first_page = false,
      page = 1,
      searchText = "",
      in_group: boolean | undefined = undefined,
    ): Promise<{ data: Activity[]; headers: object }> {
      let newActivities = <{ data: Activity[]; headers?: object }>{};
      if (user_fetch_first_page == true) {
        newActivities = await API.getActivitiesByPage(
          page,
          searchText,
          in_group,
        );
        this.$state.availableActivities = newActivities.data ?? [];
      } else {
        newActivities = await API.getActivitiesByPage(
          page,
          searchText,
          in_group,
        );
        this.$state.availableActivities =
          this.$state.availableActivities.concat(newActivities.data ?? []);
      }
      return {
        data: this.$state.availableActivities,
        headers: newActivities.headers || {},
      };
    },

    async pagedUpdateAvailableActivitiesLists(
      user_fetch_first_page = false,
      page = 1,
      searchText = "",
      in_group: boolean | undefined = undefined,
    ): Promise<{ data: Activity[]; headers: any }> {
      const available = await this.getActivitiesByPage(
        user_fetch_first_page,
        page,
        searchText,
        in_group,
      );
      return available;
    },

    async getActivity(
      activity_id: string,
      reload = true,
    ): Promise<ActivityFull | undefined> {
      this.init();
      if (
        reload ||
        !isNonEmptyObject(this.activity) ||
        this.activity.entity_id != activity_id
      ) {
        const res = await API.getActivity(activity_id);

        if (res) {
          this.activity = res;
        }
      }

      if (this.activity.entity_id != activity_id) return undefined;
      return this.activity;
    },

    /**
     * Store contract (004-ws-event-handling-rework.md §4.2): merge a possibly
     * partial payload into every cached list entry, in place. Cache miss
     * updates nothing — overview pages render cached data, edit screens
     * fetch fresh via REST.
     */
    applyChange(entityId: string, patch: WsEntityState) {
      if (patch.entity_id && patch.entity_id !== entityId) {
        return;
      }
      // WS payload → typed-entity merge boundary (ADR 0002): the open read
      // model narrows to a partial of the cached entity here.
      const entityPatch = patch as Partial<ActivityBasic>;
      const inFull = this.$state.activities.find(
        (a) => a.entity_id === entityId,
      );
      if (inFull) {
        mergeEventPayload(inFull, entityPatch);
      }
      const inPage = this.$state.activitiesByPage.activities.find(
        (a) => a.entity_id === entityId,
      );
      if (inPage) {
        mergeEventPayload(inPage, entityPatch);
      }
    },

    /** NEW events carry the complete entity (core guarantee, task doc OQ-2). */
    applyNew(entityId: string, entity: ActivityBasic) {
      if (!this.$state.activities.some((a) => a.entity_id === entityId)) {
        this.$state.activities.push(entity);
      }
      // pagination counts/sort come from the server — refresh the page view
      coalesce("activities:page", () =>
        this.getActivitiesByPageByLimit(
          this.activitiesByPage.page,
          this.activitiesByPage.limit,
          this.activitiesByPage.searchText,
        ),
      );
    },

    /** Targeted removal — no full reloads on delete (task doc P1-3). */
    applyDelete(entityId: string) {
      const fullIndex = this.$state.activities.findIndex(
        (a) => a.entity_id === entityId,
      );
      if (fullIndex > -1) {
        this.$state.activities.splice(fullIndex, 1);
      }
      const pageIndex = this.$state.activitiesByPage.activities.findIndex(
        (a) => a.entity_id === entityId,
      );
      if (pageIndex > -1) {
        this.$state.activitiesByPage.activities.splice(pageIndex, 1);
      }
      if (
        this.$state.activitiesByPage.activities.length > 0 ||
        pageIndex > -1
      ) {
        // total count changed → refresh pagination, coalesced
        coalesce("activities:page", () =>
          this.getActivitiesByPageByLimit(
            this.activitiesByPage.page,
            this.activitiesByPage.limit,
            this.activitiesByPage.searchText,
          ),
        );
      }
    },

    /** Used by the CRUD update() action only (the former WS-event path was
     *  dead code — REVIEW-Claude-ws-events.md P3). */
    async updateActivity(
      entityId: string,
      activityData: Activity,
      reload = false,
    ) {
      void entityId;
      if (reload) {
        this.activity = deepClone(activityData) as ActivityFull;
      }
    },

    /** Change event without payload: reload the single entity via REST. */
    async reloadActivityData(entityId: string) {
      const updatedEntity = await API.getActivity(entityId);
      this.applyChange(updatedEntity.entity_id, updatedEntity);
    },

    async create(activityData: ActivityNewData): Promise<Activity> {
      return await API.createNewActivity(activityData);
    },

    async clone(
      newActivity: ActivityNewData,
      clone_from: string,
    ): Promise<Activity> {
      return await API.cloneFrom(newActivity, clone_from);
    },

    async update(
      activity_id: string,
      activity: ActivityUpdate,
      reload = false,
    ): Promise<Activity> {
      const response = await API.update(activity_id, activity);
      await this.updateActivity(activity_id, response, reload);
      return response;
    },

    async delete(activity: Activity): Promise<Activity[]> {
      await API.delete(activity);
      return this.getAll();
    },

    async addUiPage(
      activity: Activity,
      newItem: NewActivityUserInterfacePage,
    ): Promise<Activity | undefined> {
      await API.addUiPage(activity, newItem);
      return this.getActivity(activity.entity_id);
    },

    async deleteUiPage(
      activity_id: string,
      page_id: string,
    ): Promise<Activity | undefined> {
      await API.deleteUiPage(activity_id, page_id);
      return this.getActivity(activity_id);
    },

    async updateUiPage(
      activity_id: string,
      page: ActivityUserInterfacePageUpdate,
    ): Promise<Activity | undefined> {
      await API.updateUiPage(activity_id, page);
      return this.getActivity(activity_id);
    },

    async allUiReset(activity_id: string): Promise<Activity | undefined> {
      await API.allUiReset(activity_id);
      return this.getActivity(activity_id);
    },

    async updatePagesOrder(
      activity: Activity,
      pageValues: ActivityUserInterfacePage[],
    ) {
      const pages: string[] = Array.from(pageValues).map((page) => {
        return page.page_id;
      });
      await API.updateUiPageOrder(activity, pages);

      return this.getPages(activity);
    },

    async getPages(activity: Activity) {
      this.$state.pages = (await API.getPages(activity)) ?? [];
      return this.$state.pages;
    },

    async buttonUpdate(
      activity_id: string,
      button: string,
      command: EntityCommand,
      pressType: ButtonMappingPressType,
    ): Promise<Activity | undefined> {
      await API.buttonUpdate(activity_id, button, command, pressType);
      return this.getActivity(activity_id);
    },

    async buttonReset(
      activity_id: string,
      button: string,
      pressType?: ButtonMappingPressType,
    ): Promise<Activity | undefined> {
      await API.buttonReset(activity_id, button, pressType);
      return this.getActivity(activity_id);
    },

    async allButtonsMerge(
      activity_id: string,
      data: DeviceButtonMapping[],
    ): Promise<Activity | undefined> {
      await API.allButtonsMerge(activity_id, data);
      return this.getActivity(activity_id);
    },

    async allButtonsUpdate(
      activity_id: string,
      data: DeviceButtonMapping[],
    ): Promise<Activity | undefined> {
      await API.allButtonsUpdate(activity_id, data);
      return this.getActivity(activity_id);
    },

    async allButtonsReset(activity_id: string): Promise<Activity | undefined> {
      await API.allButtonsReset(activity_id);
      return this.getActivity(activity_id);
    },
  },
});
