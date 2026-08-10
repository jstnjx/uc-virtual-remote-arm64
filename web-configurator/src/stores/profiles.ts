import { defineStore } from "pinia";
import type { Profile, ProfileNewData, ProfileUpdate } from "@/types/profile";
import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import type { NormalizedEvent } from "@/api/eventRouter";
import type { WsMsgData } from "@/types/websocket";
import { createCoalescer } from "@/composables/requestCoalescer";

const API = ApiConnection.profiles;

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

export const profilesStore = defineStore("profiles", {
  state: () => ({
    inited: false,
    profiles: [] as Profile[],
    activeProfiles: [] as Profile[] | [],
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }
      this.$state.inited = true;
      // profile events are also consumed by the single-profile store →
      // deliberate dual-owner routes (task doc §4.1)
      eventRouter.route(
        "profile_change",
        undefined,
        async (e) => {
          if (
            this.$state.profiles &&
            e.entityId &&
            e.eventType === "change" &&
            e.newState?.profile
          ) {
            // WS new_state.profile is an open leaf → narrow here (ADR 0002).
            void this.storeUpdateProfile(e.newState.profile as Profile).catch(
              (err) =>
                console.error("Failed to update profile from event:", err),
            );
          } else if (
            this.$state.profiles &&
            e.entityId &&
            e.eventType === "change" &&
            e.newState?.page
          ) {
            this.activeProfiles = await this.storeUpdateProfilePage();
          } else if (
            this.$state.profiles &&
            e.entityId &&
            e.eventType === "new" &&
            e.newState?.profile
          ) {
            this.addProfile(e.newState.profile as Profile);
          } else if (
            this.$state.profiles &&
            e.entityId &&
            e.eventType === "delete"
          ) {
            this.deleteProfile(e.entityId);
          }
          this.socketUpdate(e.msgData, e);
        },
        { name: "profiles", shared: true },
      );
      eventRouter.route(
        "active_profile_change",
        undefined,
        (e) => {
          coalesce("profiles:active", () => this.getAllActive(true));
          this.socketUpdate(e.msgData, e);
        },
        { name: "profiles", shared: true },
      );
    },
    socketUpdate(msg_data: WsMsgData, event?: NormalizedEvent) {
      // Placeholder action for $onAction subscribers.
      void event;
    },
    async getAll(fetchFromApi = false): Promise<Profile[]> {
      this.init();
      if (fetchFromApi || this.$state.profiles.length < 1) {
        const items = await API.getAll();
        this.$state.profiles = items ?? [];
        return items;
      } else {
        return this.$state.profiles;
      }
    },

    async getAllActive(fetchFromApi = false): Promise<Profile[]> {
      if (fetchFromApi || this.$state.activeProfiles.length < 1) {
        const items = await API.getAll(true);
        this.$state.activeProfiles = items ?? [];
        return items;
      } else {
        return this.$state.activeProfiles;
      }
    },

    async update(profileId: string, profileData: ProfileUpdate) {
      if (profileId) {
        return await API.update(profileId, profileData);
      }
      return false;
    },

    async create(profileData: ProfileNewData): Promise<Profile> {
      return await API.createNewProfile(profileData);
    },

    async switch(profile_id: string, pin = ""): Promise<Profile[]> {
      await API.switchActiveProfile(profile_id, pin);
      return this.getAllActive(true);
    },

    async delete(profile: Profile): Promise<Profile[]> {
      await API.delete(profile);
      return this.getAll(true);
    },

    async storeUpdateProfile(updatedProfile: Profile) {
      const profileIndex = this.$state.profiles.findIndex(
        (e) => e.profile_id === updatedProfile.profile_id,
      );
      if (profileIndex > -1) {
        this.$state.profiles[profileIndex] = updatedProfile;
      } else {
        const newProfile = await API.getProfile(updatedProfile.profile_id);
        this.$state.profiles.push(newProfile);
      }
    },

    async storeUpdateProfilePage() {
      await this.getAll(true);
      return await this.getAllActive(true);
    },

    addProfile(newProfile: Profile) {
      const profileIndex = this.$state.profiles.findIndex(
        (e) => e.profile_id === newProfile.profile_id,
      );
      if (profileIndex < 0) {
        this.$state.profiles.push(newProfile);
      }
    },

    deleteProfile(profileId: string) {
      const profileIndex = this.$state.profiles.findIndex(
        (e) => e.profile_id === profileId,
      );
      if (profileIndex > -1) {
        this.$state.profiles.splice(profileIndex, 1);
      }
    },
  },
});
