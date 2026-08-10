import { ResourceTypeEnum } from "@/types/enums";
import type { ResourceItem, ResourceType } from "@/types/resources";
import type { ProfileUpdate } from "@/types/profile";

import { profileStore } from "@/stores/profile";
import { profilesStore } from "@/stores/profiles";
import { addErrorBottom } from "@/stores/messages";
import { integrationsStore } from "@/stores/integrations";
import { activitiesStore } from "@/stores/activities";
import { macrosStore } from "@/stores/macros";
import { activityGroupsStore } from "@/stores/activityGroups";
import { remotesStore } from "@/stores/remotes";

export function useResources() {
  function cleanDeletedResourceItem(t: ResourceType, item: ResourceItem) {
    if (t == ResourceTypeEnum.ICON) {
      cleanIcon(item);
    } else if (t == ResourceTypeEnum.BACKGROUND_IMAGE) {
      cleanBackground(item);
    }
  }

  // Remove deleted icon data from profiles, entities, groups
  // TODO: groups of all profiles
  async function cleanIcon(item: ResourceItem) {
    try {
      await cleanIconFromProfiles(item);
      await cleanIconFromEntities(item);
      await cleanIconFromGroups(item);
      await cleanIconFromActivities(item);
      await cleanIconFromMacros(item);
      await cleanIconFromActivityGroups(item);
      await cleanIconFromRemotes(item);
    } catch (error) {
      console.error(error);
    }
  }

  async function cleanIconFromProfiles(item: ResourceItem) {
    const profilesStorage = profilesStore();
    const profiles = await profilesStorage.getAll(false);
    let hasReset = false;
    const dataReset = {
      update_pin: false,
      icon: "",
    };
    for (let index = 0; index < profiles.length; index++) {
      if (
        profiles[index].icon?.replace("custom:", "").replace("ctv:", "") ===
        item.id
      ) {
        hasReset = true;
        await updateProfile(profiles[index].profile_id, dataReset);
      }
    }

    if (hasReset == true) {
      await profilesStorage.getAll(true);
    }
  }

  async function cleanIconFromEntities(item: ResourceItem) {
    const integrationStorage = integrationsStore();
    const entities = await integrationStorage.getConfiguredEntities(null, true);
    let hasReset = false;

    for (let index = 0; index < entities.length; index++) {
      if (
        entities[index].icon?.replace("custom:", "").replace("ctv:", "") ===
        item.id
      ) {
        hasReset = true;
        const message = entities[index];
        message.icon = "";
        await integrationStorage.updateEntity(message.entity_id, message);
      }
    }

    if (hasReset == true) {
      await integrationStorage.getConfiguredEntities(null, true);
    }
  }

  async function cleanIconFromGroups(item: ResourceItem) {
    const profileStorage = profileStore();
    const groups = await profileStorage.getGroups();
    let hasReset = false;

    for (let index = 0; index < groups.length; index++) {
      if (
        groups[index].icon?.replace("custom:", "").replace("ctv:", "") ===
        item.id
      ) {
        hasReset = true;
        const message = groups[index];
        message.icon = "";
        await profileStorage.updateGroup(message);
      }
    }

    if (hasReset == true) {
      await profileStorage.getGroups();
    }
  }

  async function cleanIconFromActivities(item: ResourceItem) {
    const storage = activitiesStore();
    const activities = await storage.getAll();
    let hasReset = false;

    for (let index = 0; index < activities.length; index++) {
      if (
        activities[index].icon?.replace("custom:", "").replace("ctv:", "") ===
        item.id
      ) {
        hasReset = true;
        const message = activities[index];
        message.icon = "";
        storage.applyChange(message.entity_id, message);
      }
    }

    if (hasReset == true) {
      await storage.getAll();
    }
  }

  async function cleanIconFromMacros(item: ResourceItem) {
    const storage = macrosStore();
    const macros = await storage.getAll();
    let hasReset = false;

    for (let index = 0; index < macros.length; index++) {
      if (
        macros[index].icon?.replace("custom:", "").replace("ctv:", "") ===
        item.id
      ) {
        hasReset = true;
        const message = macros[index];
        message.icon = "";
        await storage.update(message.entity_id, message);
      }
    }

    if (hasReset == true) {
      await storage.getAll();
    }
  }

  async function cleanIconFromActivityGroups(item: ResourceItem) {
    const storage = activityGroupsStore();
    const activityGroups = await storage.getAll();
    let hasReset = false;

    for (let index = 0; index < activityGroups.length; index++) {
      if (
        activityGroups[index].icon
          ?.replace("custom:", "")
          .replace("ctv:", "") === item.id
      ) {
        hasReset = true;
        const message = activityGroups[index];
        message.icon = "";
        await storage.update(message.group_id, message);
      }
    }

    if (hasReset == true) {
      await storage.getAll();
    }
  }

  async function cleanIconFromRemotes(item: ResourceItem) {
    const storage = remotesStore();
    const remotes = await storage.getAll();
    let hasReset = false;

    for (let index = 0; index < remotes.length; index++) {
      if (
        remotes[index].icon?.replace("custom:", "").replace("ctv:", "") ===
        item.id
      ) {
        hasReset = true;
        const message = remotes[index];
        await storage.update(message.entity_id, { icon: "" });
      }
    }

    if (hasReset == true) {
      await storage.getAll();
    }
  }

  async function updateProfile(profileId: string, changes: ProfileUpdate) {
    const profilesStorage = profilesStore();

    try {
      await profilesStorage.update(profileId, changes);
    } catch (e) {
      addErrorBottom(e);
    }
  }

  // Remove deleted background data from pages
  // TODO: pages of all profiles
  async function cleanBackground(item: ResourceItem) {
    const profileStorage = profileStore();
    const pages = await profileStorage.getPages();

    for (let index = 0; index < pages.length; index++) {
      if (
        pages[index].image?.replace("custom:", "").replace("ctv:", "") ===
        item.id
      ) {
        const modifiedPage = pages[index];

        if (modifiedPage) {
          modifiedPage.image = "";

          try {
            await profileStorage.updatePage(modifiedPage);
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
  }

  return {
    cleanDeletedResourceItem,
  };
}
