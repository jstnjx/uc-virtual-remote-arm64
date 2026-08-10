import { coreGroup, corePage, coreProfile } from "../core/models.js";
import { logger } from "../shared/logger.js";
import {
  DEFAULT_DEMO_UPDATE_INTERVAL_MS,
  DEMO_DRIVER_ID,
  DEMO_FEATURE_ID,
  DEMO_INTEGRATION_ID,
  DEMO_PROFILE_ID,
  DEMO_PROFILE_PAGE_ENTERTAINMENT_ID,
  DEMO_PROFILE_PAGE_HOME_ID,
  createDemoEntityDefinitions,
  demoEntityId,
  translated
} from "./entities.js";
import {
  applyDemoCommand,
  browseDemoMedia,
  randomizeDemoAttributes,
  searchDemoMedia
} from "./behavior.js";

export {
  DEMO_DRIVER_ID,
  DEMO_FEATURE_ID,
  DEMO_INTEGRATION_ID,
  DEMO_PROFILE_ID,
  DEMO_PROFILE_PAGE_ENTERTAINMENT_ID,
  DEMO_PROFILE_PAGE_HOME_ID,
  createDemoEntityDefinitions
} from "./entities.js";

const log = logger("demo-mode");

export class DemoModeService {
  constructor(platform, options = {}) {
    this.platform = platform;
    this.intervalMs = Math.max(1_000, Number(options.intervalMs ?? process.env.UCVR_DEMO_INTERVAL_MS ?? DEFAULT_DEMO_UPDATE_INTERVAL_MS));
    this.timer = null;
    this.started = false;
    this.connected = false;
    this.configurationListener = (event) => {
      if (!["features", "all"].includes(event?.data?.key)) return;
      this.applyConfiguration().catch((error) => log.warn("Unable to apply demo-mode setting:", error.message));
    };
  }

  isIntegration(id) {
    return String(id || "") === DEMO_INTEGRATION_ID;
  }

  isEnabled() {
    return Boolean(this.platform.configuration.get("features").find((item) => item.id === DEMO_FEATURE_ID)?.enabled);
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.platform.events.on("configuration.change", this.configurationListener);
    await this.applyConfiguration();
  }

  async stop() {
    this.started = false;
    this.platform.events.off("configuration.change", this.configurationListener);
    this.#stopUpdates();
  }

  async applyConfiguration() {
    if (this.isEnabled()) return this.enable();
    return this.disable();
  }

  async enable() {
    const existing = this.platform.db.getIntegration(DEMO_INTEGRATION_ID);
    const record = this.platform.db.saveIntegration({
      id: DEMO_INTEGRATION_ID,
      driver_id: DEMO_DRIVER_ID,
      name: "UC Virtual Remote Demo",
      url: "virtual://demo",
      enabled: true,
      status: "CONNECTED",
      device_state: "CONNECTED",
      driver_version: this.platform.version,
      driver_type: "VIRTUAL",
      auth_method: "NONE",
      configured: true,
      metadata: {
        driver_id: DEMO_DRIVER_ID,
        name: translated("UC Virtual Remote Demo"),
        description: translated("Built-in preview integration with a complete Watch TV sample setup."),
        developer: { name: "UC Virtual Remote" },
        icon: "uc:beaker",
        preview_feature: DEMO_FEATURE_ID,
        demo: true,
        version: this.platform.version
      }
    });
    const connected = this.platform.db.updateIntegration(DEMO_INTEGRATION_ID, {
      enabled: true,
      status: "CONNECTED",
      device_state: "CONNECTED",
      driver_version: this.platform.version,
      configured: true,
      last_error: null,
      metadata: record.metadata
    });

    const definitions = createDemoEntityDefinitions();
    const expectedEntityIds = new Set(definitions.map((definition) => demoEntityId(definition.entity_id)));
    const staleEntities = [
      ...this.platform.db.listConfiguredEntities(DEMO_INTEGRATION_ID),
      ...this.platform.db.listActivities().filter((item) => item.integration_id === DEMO_INTEGRATION_ID),
      ...this.platform.db.listMacros().filter((item) => item.integration_id === DEMO_INTEGRATION_ID)
    ].filter((item) => !expectedEntityIds.has(item.entity_id));
    for (const stale of staleEntities) {
      if (stale.entity_type === "activity") this.platform.db.deleteActivity(stale.entity_id);
      else if (stale.entity_type === "macro") this.platform.db.deleteMacro(stale.entity_id);
      else this.platform.db.deleteConfiguredEntity(stale.entity_id);
      this.platform.events.publish("entity.deleted", { id: stale.entity_id, entity_id: stale.entity_id });
    }

    this.platform.db.replaceAvailableEntities(DEMO_INTEGRATION_ID, definitions);
    for (const definition of definitions) {
      let configuredEntity;
      if (definition.entity_type === "activity") {
        this.platform.db.deleteConfiguredEntity(demoEntityId(definition.entity_id));
        configuredEntity = this.platform.db.saveActivity({
          ...definition,
          id: demoEntityId(definition.entity_id),
          integration_id: DEMO_INTEGRATION_ID,
          sequence_on: [],
          sequence_off: [],
          options: { ...(definition.options || {}), features: definition.features, demo: true, editable: false }
        });
      } else if (definition.entity_type === "macro") {
        this.platform.db.deleteConfiguredEntity(demoEntityId(definition.entity_id));
        configuredEntity = this.platform.db.saveMacro({
          ...definition,
          id: demoEntityId(definition.entity_id),
          integration_id: DEMO_INTEGRATION_ID,
          sequence: [],
          options: { ...(definition.options || {}), demo: true, editable: false }
        });
      } else {
        configuredEntity = this.platform.db.configureEntity(DEMO_INTEGRATION_ID, definition.entity_id);
      }
      this.platform.events.publish(existing ? "entity.updated" : "entity.created", configuredEntity);
    }

    this.#ensureDemoProfile();

    this.connected = true;
    this.#startUpdates();
    this.platform.events.publish(existing ? "integration.status" : "integration.created", connected);
    this.platform.events.publish("entities.available", { integration_id: DEMO_INTEGRATION_ID, count: definitions.length });
    log.info(`Demo mode enabled with ${definitions.length} entities`);
    return connected;
  }

  async disable() {
    this.#stopUpdates();
    this.connected = false;

    const db = this.platform.db;
    const existing = db.getIntegration(DEMO_INTEGRATION_ID);
    const configured = db.listConfiguredEntities().filter((item) => this.#isDemoEntityId(item.entity_id) || item.integration_id === DEMO_INTEGRATION_ID);
    const activities = db.listActivities().filter((item) => this.#isDemoEntityId(item.entity_id) || item.integration_id === DEMO_INTEGRATION_ID);
    const macros = db.listMacros().filter((item) => this.#isDemoEntityId(item.entity_id) || item.integration_id === DEMO_INTEGRATION_ID);
    const definitionIds = createDemoEntityDefinitions().map((definition) => demoEntityId(definition.entity_id));
    const actualEntityIds = new Set([...configured, ...activities, ...macros].map((item) => item.entity_id));
    const knownEntityIds = new Set([...definitionIds, ...actualEntityIds]);

    const profileDeleted = this.#removeDemoProfile();
    const referencesRemoved = this.#removeDemoReferences(knownEntityIds);

    for (const activity of activities) db.deleteActivity(activity.entity_id);
    for (const macro of macros) db.deleteMacro(macro.entity_id);
    for (const entity of configured) db.deleteConfiguredEntity(entity.entity_id);
    const deleted = existing ? db.deleteIntegration(DEMO_INTEGRATION_ID) : false;

    for (const id of actualEntityIds) this.platform.events.publish("entity.deleted", { id, entity_id: id });
    if (deleted) this.platform.events.publish("integration.deleted", { id: DEMO_INTEGRATION_ID });
    if (deleted || profileDeleted || referencesRemoved || actualEntityIds.size) {
      log.info("Demo mode disabled and all demo-owned profiles, references, and entities were removed");
    }
    return Boolean(deleted || profileDeleted || referencesRemoved || actualEntityIds.size);
  }

  async connect() {
    if (!this.isEnabled()) throw Object.assign(new Error("Demo mode is disabled"), { status: 409 });
    if (!this.platform.db.getIntegration(DEMO_INTEGRATION_ID)) await this.enable();
    const value = this.platform.db.updateIntegration(DEMO_INTEGRATION_ID, {
      enabled: true,
      status: "CONNECTED",
      device_state: "CONNECTED",
      last_error: null
    });
    this.connected = true;
    this.#startUpdates();
    this.platform.events.publish("integration.status", value);
    return value;
  }

  async disconnect() {
    this.#stopUpdates();
    this.connected = false;
    const value = this.platform.db.updateIntegration(DEMO_INTEGRATION_ID, {
      enabled: false,
      status: "DISCONNECTED",
      device_state: "DISCONNECTED"
    });
    if (value) this.platform.events.publish("integration.status", value);
    return value;
  }

  availableEntities() {
    return this.platform.db.listAvailableEntities(DEMO_INTEGRATION_ID);
  }

  async tick() {
    if (!this.connected || !this.isEnabled()) return [];
    const updated = [];
    const entities = [
      ...this.platform.db.listConfiguredEntities(DEMO_INTEGRATION_ID),
      ...this.platform.db.listActivities().filter((item) => item.integration_id === DEMO_INTEGRATION_ID),
      ...this.platform.db.listMacros().filter((item) => item.integration_id === DEMO_INTEGRATION_ID)
    ];
    for (const entityRecord of entities) {
      const attributes = randomizeDemoAttributes(entityRecord);
      const value = this.#persistAttributes(entityRecord, attributes);
      if (value) {
        updated.push(value);
        this.#publishEntityChange(entityRecord, value);
      }
    }
    return updated;
  }

  async command(entityId, commandId, params = {}) {
    const entityRecord = this.platform.db.getConfiguredEntity(entityId)
      || this.platform.db.getActivity(entityId)
      || this.platform.db.getMacro(entityId);
    if (!entityRecord || entityRecord.integration_id !== DEMO_INTEGRATION_ID) {
      throw Object.assign(new Error(`Demo entity ${entityId} not found`), { status: 404 });
    }
    const { attributes, driverCommandId } = applyDemoCommand(entityRecord, commandId, params);
    const updated = this.#persistAttributes(entityRecord, attributes);
    this.platform.events.publish("entity.command", { entity_id: entityId, command_id: commandId, driver_command_id: driverCommandId, params: params || null });
    this.#publishEntityChange(entityRecord, updated);
    return { code: 200, message: "Demo command applied" };
  }

  browseMedia(entityId, parameters = {}) {
    const entityRecord = this.platform.db.getConfiguredEntity(entityId);
    if (!entityRecord || entityRecord.integration_id !== DEMO_INTEGRATION_ID || entityRecord.entity_type !== "media_player") {
      throw Object.assign(new Error(`${entityId} is not a demo media player`), { status: 404 });
    }
    return browseDemoMedia(parameters);
  }

  searchMedia(entityId, parameters = {}) {
    const entityRecord = this.platform.db.getConfiguredEntity(entityId);
    if (!entityRecord || entityRecord.integration_id !== DEMO_INTEGRATION_ID || entityRecord.entity_type !== "media_player") {
      throw Object.assign(new Error(`${entityId} is not a demo media player`), { status: 404 });
    }
    return searchDemoMedia(parameters);
  }


  #isDemoEntityId(value) {
    return String(value || "").startsWith(`${DEMO_INTEGRATION_ID}.`);
  }

  #ensureDemoProfile() {
    const db = this.platform.db;
    const existingProfile = db.getProfile(DEMO_PROFILE_ID);
    const profile = db.saveProfile({
      id: DEMO_PROFILE_ID,
      name: "Demo",
      icon: "uc:beaker",
      restricted: false,
      description: "Managed by UC Virtual Remote demo mode."
    });
    this.platform.events.publish("profile.change", {
      event_type: existingProfile ? "CHANGE" : "NEW",
      profile_id: profile.id,
      new_state: { profile: coreProfile(profile) }
    });

    const pages = [
      {
        id: DEMO_PROFILE_PAGE_ENTERTAINMENT_ID,
        profile_id: DEMO_PROFILE_ID,
        name: "Entertainment",
        pos: 0,
        columns: 4,
        rows: 7,
        items: [
          { entity_id: demoEntityId("activity_watch_tv"), pos: 0 },
          { entity_id: demoEntityId("remote_tv"), pos: 1 }
        ]
      },
      {
        id: DEMO_PROFILE_PAGE_HOME_ID,
        profile_id: DEMO_PROFILE_ID,
        name: "Home Controls",
        pos: 1,
        columns: 4,
        rows: 7,
        items: [
          { entity_id: demoEntityId("cover_living_room"), pos: 0 },
          { entity_id: demoEntityId("climate_living_room"), pos: 1 },
          { entity_id: demoEntityId("light_living_room"), pos: 2 }
        ]
      }
    ];
    const expectedPageIds = new Set(pages.map((page) => page.id));
    for (const stalePage of db.listPages(DEMO_PROFILE_ID).filter((page) => !expectedPageIds.has(page.id))) {
      db.deletePage(stalePage.id);
      this.platform.events.publish("profile.change", { event_type: "DELETE", profile_id: DEMO_PROFILE_ID, page_id: stalePage.id });
    }
    for (const pageDefinition of pages) {
      const existed = db.getPage(pageDefinition.id);
      const page = db.savePage(pageDefinition);
      this.platform.events.publish("profile.change", {
        event_type: existed ? "CHANGE" : "NEW",
        profile_id: DEMO_PROFILE_ID,
        page_id: page.id,
        new_state: { page: corePage(page) }
      });
    }
    return db.getProfile(DEMO_PROFILE_ID);
  }

  #removeDemoProfile() {
    const db = this.platform.db;
    const profile = db.getProfile(DEMO_PROFILE_ID);
    if (!profile) return false;

    if (db.listProfiles().length <= 1) {
      const fallback = db.saveProfile({
        id: "default",
        name: "Default",
        active: true,
        description: "Default virtual remote profile"
      });
      if (!db.listPages(fallback.id).length) {
        db.savePage({ id: "home", profile_id: fallback.id, name: "Home", pos: 0, items: [] });
      }
    }

    const pageIds = profile.pages.map((page) => page.id);
    const deleted = db.deleteProfile(DEMO_PROFILE_ID);
    if (deleted) {
      for (const pageId of pageIds) {
        this.platform.events.publish("profile.change", { event_type: "DELETE", profile_id: DEMO_PROFILE_ID, page_id: pageId });
      }
      this.platform.events.publish("profile.change", { event_type: "DELETE", profile_id: DEMO_PROFILE_ID });
    }
    return deleted;
  }

  #removeDemoReferences(entityIds) {
    let changed = false;
    const ids = new Set([...entityIds].map(String));
    const isDemoReference = (value) => {
      const id = typeof value === "string"
        ? value
        : value?.entity_id || value?.id || value?.target_id || value?.media_player_id || value?.sensor_id || value?.select_id;
      return ids.has(String(id || "")) || this.#isDemoEntityId(id);
    };
    const db = this.platform.db;

    for (const page of db.listPages().filter((item) => item.profile_id !== DEMO_PROFILE_ID)) {
      const items = page.items.filter((item) => !isDemoReference(item));
      if (items.length === page.items.length) continue;
      const updated = db.savePage({ ...page, items });
      changed = true;
      this.platform.events.publish("profile.change", {
        event_type: "CHANGE",
        profile_id: updated.profile_id,
        page_id: updated.id,
        new_state: { page: corePage(updated) }
      });
    }

    for (const group of db.listGroups().filter((item) => item.profile_id !== DEMO_PROFILE_ID)) {
      const entities = (group.entities || []).filter((item) => !isDemoReference(item));
      if (entities.length === (group.entities || []).length) continue;
      const updated = db.saveGroup({ ...group, entities });
      changed = true;
      this.platform.events.publish("profile.change", {
        event_type: "CHANGE",
        profile_id: updated.profile_id,
        group_id: updated.id,
        new_state: { group: coreGroup(updated) }
      });
    }

    for (const group of db.listActivityGroups()) {
      const activities = (group.activities || []).filter((item) => !isDemoReference(item));
      if (activities.length === (group.activities || []).length) continue;
      db.saveActivityGroup({ ...group, activities });
      changed = true;
    }
    return changed;
  }

  #persistAttributes(entityRecord, attributes) {
    if (entityRecord.entity_type === "activity") return this.platform.db.updateActivityAttributes(entityRecord.entity_id, attributes);
    if (entityRecord.entity_type === "macro") return this.platform.db.updateMacroAttributes(entityRecord.entity_id, attributes);
    return this.platform.db.updateEntityAttributes(entityRecord.entity_id, attributes);
  }

  #publishEntityChange(entityRecord, value) {
    if (!value) return;
    if (entityRecord.entity_type === "activity") this.platform.events.publish("activity.change", value);
    if (entityRecord.entity_type === "macro") this.platform.events.publish("macro.change", value);
    this.platform.events.publish("entity.change", value);
  }

  #startUpdates() {
    if (this.timer || !this.connected) return;
    this.timer = setInterval(() => {
      this.tick().catch((error) => log.warn("Demo entity update failed:", error.message));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  #stopUpdates() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
