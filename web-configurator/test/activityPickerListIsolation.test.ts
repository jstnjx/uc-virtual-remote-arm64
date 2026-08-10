// @vitest-environment jsdom
/**
 * The activity pickers in the activity-group screens must not write the
 * overview list's page state.
 *
 * They query a *different* set — `in_group=false`, only activities not yet in
 * a group — with their own page, limit and search text. Routed through
 * `getActivitiesByPageByLimit` that result landed in `activitiesByPage`, whose
 * array `ActivityList` renders by reference (#683): opening "+ Add new →
 * Activity group" over a populated Activities tab emptied the list behind the
 * modal, and cancelling left it empty until the view remounted.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";
import { toRaw } from "vue";
import type { Router } from "vue-router";

import ApiConnection from "@/api";
import { eventRouter } from "@/api/eventRouter";
import { activitiesStore } from "@/stores/activities";
import type { Activity } from "@/types/activity";

vi.mock("i18next-vue", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18next: { language: "en_US", exists: () => false },
  }),
}));

// Partial: src/composables/router.ts builds the real router at import time, so
// the module's other exports have to stay intact. The modal only ever pushes,
// and only after a successful save — which this file never reaches.
vi.mock(import("vue-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => ({ push: vi.fn() }) as unknown as Router,
}));

import AddActivityGroup from "@/components/activity-group/AddActivityGroup.vue";

const LISTED = [
  { entity_id: "act.1" },
  { entity_id: "act.2" },
] as unknown as Activity[];

beforeEach(() => {
  // A fresh Pinia re-runs the store's init(), which re-registers its WS routes
  // on the singleton router; clear them so that does not throw.
  (eventRouter as unknown as { routes: Map<string, unknown> }).routes.clear();
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe("activity group picker vs. the activities list", () => {
  it("leaves the list's page state untouched when the picker opens", async () => {
    const fetchPage = vi
      .spyOn(ApiConnection.activities, "getActivitiesByPageByLimit")
      // What the Activities tab loaded.
      .mockResolvedValueOnce({
        data: LISTED,
        headers: { "pagination-count": "2" },
      })
      // What the picker gets: on a device where every activity already sits in
      // the default group, `in_group=false` is empty.
      .mockResolvedValue({ data: [], headers: { "pagination-count": "0" } });

    const store = activitiesStore();
    // ActivityList holds the store's array, not a copy.
    const held = (await store.getActivitiesByPageByLimit(1, 20)).data
      .activities;

    const wrapper = mount(AddActivityGroup, {
      global: {
        stubs: { Teleport: true },
        mocks: { $t: (key: string) => key },
        directives: { "overflow-indicator": {}, "click-outside": {} },
      },
    });
    (wrapper.vm as unknown as { open: () => void }).open();
    await flushPromises();

    // The picker did fetch — and only ungrouped activities.
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1]?.[3]).toBe(false);

    // …without disturbing what the list behind it renders.
    expect(toRaw(held)).toBe(toRaw(store.$state.activitiesByPage.activities));
    expect(held.map((a) => a.entity_id)).toEqual(["act.1", "act.2"]);
    expect(store.$state.activitiesByPage.count).toBe(2);

    wrapper.unmount();
  });

  it("getUngroupedActivities returns the page without caching it", async () => {
    vi.spyOn(ApiConnection.activities, "getActivitiesByPageByLimit")
      .mockResolvedValueOnce({
        data: LISTED,
        headers: { "pagination-count": "2" },
      })
      .mockResolvedValue({
        data: [{ entity_id: "act.3" }] as unknown as Activity[],
        headers: { "pagination-count": "1" },
      });

    const store = activitiesStore();
    await store.getActivitiesByPageByLimit(1, 20);

    const ungrouped = await store.getUngroupedActivities(1, 20, "tv");

    expect(ungrouped.data.map((a) => a.entity_id)).toEqual(["act.3"]);
    expect(ungrouped.headers["pagination-count"]).toBe("1");
    expect(
      store.$state.activitiesByPage.activities.map((a) => a.entity_id),
    ).toEqual(["act.1", "act.2"]);
    expect(store.$state.activitiesByPage.searchText).toBe("");
  });
});
