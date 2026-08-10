import { defineStore } from "pinia";
import type { Store } from "pinia";
import type { Group, NewGroupData } from "@/types/group";
import type { Profile, ProfileUpdate } from "@/types/profile";
import type { NewPageData, Page } from "@/types/page";
import ApiConnection from "@/api";
import { createCoalescer } from "@/composables/requestCoalescer";
import { eventRouter } from "@/api/eventRouter";
import type { WsMsgData } from "@/types/websocket";

const API = ApiConnection.profiles;

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

async function fetchAll(profile_id: string, _data: any) {
  const result: any = {
    profile: await API.getProfile(profile_id),
  };
  result.pages = await API.getPages(result.profile);
  result.groups = await API.getGroups(result.profile);
  return result;
}

export interface ProfileState {
  inited: boolean;
  profile: Profile | null;
  pages: Page[];
  groups: Group[];
}
export type ProfileStore = Store<"profile", ProfileState>;

export const profileStore = defineStore("profile", {
  state: (): ProfileState => {
    return {
      inited: false,
      profile: null as Profile | null,
      pages: [] as Page[] | [],
      groups: [] as Group[] | [],
    };
  },

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }
      this.$state.inited = true;
      // dual-owner routes with the profiles (list) store — task doc §4.1
      eventRouter.route(
        "profile_change",
        undefined,
        (e) => {
          if (
            this.$state.profile &&
            e.entityId &&
            e.entityId === this.$state.profile?.profile_id
          ) {
            // fetchAll is 3 REST calls — a burst of profile events must cost
            // one round, not N (004-ws-event-handling-rework.md §3.2)
            const profileId = e.entityId;
            coalesce("profile:fetchAll", () =>
              fetchAll(profileId, e.msgData).then((newValues) => {
                this.socketUpdate(newValues, profileId, e.msgData);
              }),
            );
          }
        },
        { name: "profile", shared: true },
      );
      eventRouter.route(
        "active_profile_change",
        undefined,
        (e) => {
          if (e.entityId) {
            void this.setProfile(e.entityId).catch((err) =>
              console.error("Failed to load switched profile:", err),
            );
          }
        },
        { name: "profile", shared: true },
      );
    },

    socketUpdate(newValues: any, _profile_id: string, _msg_data: WsMsgData) {
      this.$state = {
        ...this.$state,
        ...newValues,
      };
      return this.$state.profile;
    },

    async setProfile(profile_id: string): Promise<Profile> {
      this.init();
      const profile = await API.getProfile(profile_id);
      this.$state.profile = profile ?? null;
      await this.getPages();
      await this.getGroups();
      return profile;
    },

    async updateProfile(profileData: ProfileUpdate) {
      if (this.$state.profile) {
        const profile = await API.update(
          this.$state.profile.profile_id,
          profileData,
        );
        return this.setProfile(profile.profile_id);
      }
      return this.$state.profile;
    },

    async getPages(): Promise<Page[]> {
      this.$state.pages =
        (await API.getPages(this.$state.profile as Profile)) ?? [];
      return this.$state.pages;
    },
    async createPage(page: NewPageData): Promise<Page[]> {
      await API.createNewPage(this.$state.profile as Profile, page);
      return this.getPages();
    },
    async updatePage(pageData: Page): Promise<Page> {
      return await API.updatePage(this.$state.profile as Profile, pageData);
    },
    async updatePagesOrder(pageValues: Page[]) {
      if (!this.$state.profile) {
        return this.$state.pages;
      }
      const pages: string[] = Array.from(pageValues).map((page) => {
        return page.page_id;
      });
      await this.updateProfile({
        name: this.$state.profile.name,
        icon: this.$state.profile.icon,
        restricted: this.$state.profile.restricted,
        update_pin: false,
        pages,
      });
      return this.getPages();
    },
    async deletePage(page: Page): Promise<Page[]> {
      await API.deletePage(this.$state.profile as Profile, page);
      return this.getPages();
    },

    async getGroups(): Promise<Group[]> {
      this.$state.groups =
        (await API.getGroups(this.$state.profile as Profile)) ?? [];
      return this.$state.groups;
    },
    async createGroup(group: NewGroupData): Promise<Group> {
      return await API.createNewGroup(this.$state.profile as Profile, group);
    },
    async updateGroup(groupData: Group) {
      await API.updateGroup(this.$state.profile as Profile, groupData);
      return this.getGroups();
    },
    async deleteGroup(group: Group): Promise<Group[]> {
      await API.deleteGroup(this.$state.profile as Profile, group);
      return this.getGroups();
    },
  },
});
