(function ucvrSimulatorEnhancement() {
  const SESSION_BASE = window.__UCVR_BASE_PATH__ || "";
  const API = `${SESSION_BASE}/api`;
  const DEFAULT_BACKGROUND = `${SESSION_BASE}/configurator/assets/remote-simulator-background.svg`;
  const HARDWARE_BUTTONS = [
    ["BACK", "Back", "back"],
    ["HOME", "Home", "home"],
    ["POWER", "Power", "power"],
    ["VOLUME_UP", "Volume up", "volume-up"],
    ["VOLUME_DOWN", "Volume down", "volume-down"],
    ["DPAD_UP", "Up", "dpad-up"],
    ["DPAD_DOWN", "Down", "dpad-down"],
    ["DPAD_LEFT", "Left", "dpad-left"],
    ["DPAD_RIGHT", "Right", "dpad-right"],
    ["DPAD_MIDDLE", "OK", "dpad-middle"],
    ["CHANNEL_UP", "Channel up", "channel-up"],
    ["CHANNEL_DOWN", "Channel down", "channel-down"],
    ["MUTE", "Mute", "mute"],
    ["RECORD", "Record", "record"],
    ["MENU", "Menu", "menu"],
    ["VOICE", "Voice", "voice"],
    ["PREV", "Previous", "prev"],
    ["STOP", "Stop", "stop"],
    ["PLAY", "Play / pause", "play"],
    ["NEXT", "Next", "next"]
  ];

  const state = {
    open: false,
    busy: false,
    settings: {
      battery_level: 82,
      charging: false,
      touch_slider_mode: "auto",
      display: { brightness: 70, auto_brightness: true },
      button: { brightness: 70, static_color: { rgb: [255, 255, 255] } }
    },
    settingsLoaded: false,
    profiles: [],
    profile: null,
    profilePages: [],
    groups: new Map(),
    activities: [],
    activeActivity: null,
    activityMappings: [],
    remoteMappings: [],
    remoteMappingEntityId: "",
    entities: new Map(),
    screens: [],
    screenIndex: 0,
    selectedIndex: 0,
    expandedGroups: new Set(),
    lastRefresh: 0,
    activityOverlayOpen: false,
    overlayEntity: null,
    activityOverlayIndex: 0,
    activityOverlaySelectedIndex: 0,
    activeHardwareButton: "",
    activeHardwarePress: "",
    remoteHoldEntity: null,
    selectInteraction: false,
    deferredRefresh: false,
    updatesPaused: false,
    pausedRefreshPending: false,
    profileSelectorOpen: false,
    profileSelectorIndex: 0,
    activityOverlayOpening: false,
    activityOverlayClosing: false,
    transientRefreshPending: false,
    refreshGeneration: 0,
    entityControlOpen: false,
    entityControlOpening: false,
    entityControlClosing: false,
    controlEntity: null,
    controlFeatureIndex: 0
  };
  const boundScreenElements = new WeakMap();

  function bindOnce(element, key, listener) {
    if (!element) return;
    let keys = boundScreenElements.get(element);
    if (!keys) {
      keys = new Set();
      boundScreenElements.set(element, keys);
    }
    if (keys.has(key)) return;
    listener();
    keys.add(key);
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const response = await fetch(API + path, { credentials: "same-origin", ...options, headers });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) throw new Error(payload?.message || payload?.error || text || `HTTP ${response.status}`);
    return payload;
  }

  function collection(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }

  function mappingCollection(payload, owner = state.activeActivity) {
    const direct = collection(payload);
    if (direct.length) return direct;
    const nested = payload?.button_mapping || payload?.buttons || payload?.options?.button_mapping;
    if (Array.isArray(nested) && nested.length) return nested;
    const fallback = owner?.button_mapping || owner?.options?.button_mapping;
    return Array.isArray(fallback) ? fallback : [];
  }

  function nameOf(value, fallback = "Unnamed") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return String(value.en || value.en_US || value[document.documentElement.lang] || Object.values(value)[0] || fallback);
    }
    return String(value || fallback);
  }

  function idOf(item) {
    return String(item?.entity_id || item?.id || item?.profile_id || item?.page_id || item?.group_id || "");
  }

  function stateOf(item) {
    const value = item?.attributes?.state ?? item?.state ?? item?.attributes?.value ?? item?.value;
    if (value === undefined || value === null || value === "") return item?.available === false ? "unavailable" : "";
    return String(value).toLowerCase();
  }

  function customResourceUrl(kind, value) {
    const text = String(value || "");
    if (!text) return "";
    if (text.startsWith("/api/resources/")) return `${SESSION_BASE}${text}`;
    if (text.startsWith("custom:")) return `${API}/resources/${kind}/${encodeURIComponent(text.slice(7))}`;
    if (/^https?:\/\//i.test(text) || text.startsWith("data:")) return text;
    if (/\.(?:png|jpe?g|webp|gif|svg)$/i.test(text)) return `${API}/resources/${kind}/${encodeURIComponent(text)}`;
    return "";
  }

  function iconUrl(item) {
    return customResourceUrl("Icon", item?.icon);
  }

  function backgroundUrl(screen) {
    return customResourceUrl("BackgroundImage", screen?.image) || DEFAULT_BACKGROUND;
  }

  function escapeHtml(value) {
    const node = document.createElement("span");
    node.textContent = String(value ?? "");
    return node.innerHTML;
  }

  function iconClass(item) {
    const identifier = String(item?.icon || "").toLowerCase();
    if (identifier.startsWith("uc:")) {
      const ucIcons = {
        "angle-up": "fa-angle-up", "angle-down": "fa-angle-down", "angle-left": "fa-angle-left", "angle-right": "fa-angle-right",
        "arrow-up": "fa-arrow-up", "arrow-down": "fa-arrow-down", "arrow-left": "fa-arrow-left", "arrow-right": "fa-arrow-right",
        "arrow-turn-down-left": "fa-arrow-turn-down-left", "circle": "fa-circle", "gear": "fa-gear", "info": "fa-circle-info",
        "house": "fa-house", "house-blank": "fa-house-blank", "bars": "fa-bars", "play": "fa-play", "pause": "fa-pause",
        "stop": "fa-stop", "power": "fa-power-off", "on": "fa-power-off", "off": "fa-power-off", "remote": "fa-gamepad",
        "mediaplayer": "fa-tv", "media-player": "fa-tv", "sensor": "fa-gauge", "list-dropdown": "fa-list-dropdown",
        "volume-up": "fa-volume-high", "volume-down": "fa-volume-low", "volume-mute": "fa-volume-xmark", "warning": "fa-triangle-exclamation"
      };
      const key = identifier.slice(3);
      if (ucIcons[key]) return ucIcons[key];
    }
    const type = String(item?.entity_type || item?.type || "").toLowerCase();
    const map = {
      activity: "fa-circle-play",
      macro: "fa-bolt",
      media_player: "fa-tv",
      remote: "fa-gamepad",
      light: "fa-lightbulb",
      switch: "fa-toggle-on",
      cover: "fa-window-maximize",
      sensor: "fa-gauge",
      climate: "fa-temperature-half",
      button: "fa-hand-pointer",
      select: "fa-list",
      group: "fa-layer-group"
    };
    return map[type] || "fa-circle-dot";
  }

  function iconMarkup(item) {
    const image = iconUrl(item);
    if (image) {
      return `<div class="selected-icon selected-icon--custom"><div class="vue-load-image"><img src="${escapeHtml(image)}" role="presentation" alt=""></div></div>`;
    }
    return `<i class="fa-light ${iconClass(item)}" aria-hidden="true"></i>`;
  }

  function normalizeActivities(payload) {
    return collection(payload).map((item) => ({
      ...item,
      id: idOf(item),
      entity_id: idOf(item),
      title: nameOf(item.name || item.display_name, idOf(item)),
      state: String(item.state || item.attributes?.state || "OFF").toUpperCase()
    })).filter((item) => item.id);
  }

  function currentActivity() {
    return state.activities.find((item) => ["ON", "STARTING"].includes(String(item.state).toUpperCase())) || null;
  }

  function pageItems(page) {
    const raw = collection(page?.items?.length !== undefined ? page.items : page?.elements);
    return raw.length ? raw : (Array.isArray(page?.items) ? page.items : Array.isArray(page?.elements) ? page.elements : []);
  }

  function entityForReference(reference) {
    const entityId = String(reference?.entity_id || reference?.target_id || (reference?.type !== "group" ? reference?.id : "") || reference || "");
    if (!entityId) return null;
    return state.entities.get(entityId) || state.activities.find((item) => item.id === entityId) || null;
  }

  function screenItems(screen) {
    if (!screen) return [];
    const result = [];
    for (const reference of pageItems(screen.page)) {
      const groupId = String(reference?.group_id || (reference?.type === "group" ? reference?.target_id || reference?.id : "") || "");
      if (groupId) {
        const group = state.groups.get(groupId) || { id: groupId, group_id: groupId, name: groupId, entity_type: "group", entities: [] };
        result.push({ kind: "group", id: groupId, data: { ...group, entity_type: "group" } });
        if (state.expandedGroups.has(groupId)) {
          for (const member of collection(group.entities)) {
            const entity = entityForReference(member);
            if (entity) result.push({ kind: "entity", id: idOf(entity), data: entity, nested: true });
          }
        }
        continue;
      }
      const entity = entityForReference(reference);
      if (entity) result.push({ kind: entity.entity_type === "activity" ? "activity" : "entity", id: idOf(entity), data: entity });
    }
    return result;
  }

  function entityScreens(entity) {
    if (!entity) return [];
    const entityId = idOf(entity);
    const entityTitle = entity.title || nameOf(entity.name || entity.display_name, entityId || "Remote");
    const ui = entity.options?.user_interface || entity.user_interface || {};
    const pages = Array.isArray(ui.pages) ? ui.pages : [];
    if (pages.length) {
      return pages.map((page, index) => ({
        kind: "entity-page",
        owner: entityId,
        id: String(page.page_id || page.id || `${entityId}-page-${index}`),
        title: nameOf(page.name, entityTitle),
        image: page.image || ui.image,
        page
      }));
    }
    const included = Array.isArray(entity.options?.included_entities)
      ? entity.options.included_entities
      : Array.isArray(entity.entities)
        ? entity.entities
        : Array.isArray(entity.included_entities)
          ? entity.included_entities
          : [];
    if (!included.length) return [];
    return [{
      kind: "entity-page",
      owner: entityId,
      id: `${entityId}-included`,
      title: entityTitle,
      image: ui.image,
      page: { items: included }
    }];
  }

  function overlayOwner() {
    return state.overlayEntity || state.activeActivity;
  }

  function rebuildScreens() {
    const previous = state.screens[state.screenIndex];
    const screens = [];

    const profilePages = [...state.profilePages].sort((a, b) => Number(a.pos ?? a.sort_order ?? 0) - Number(b.pos ?? b.sort_order ?? 0));
    for (const page of profilePages) {
      screens.push({
        kind: "profile-page",
        id: String(page.page_id || page.id),
        title: nameOf(page.name, "Page"),
        image: page.image,
        page
      });
    }

    state.screens = screens;
    let nextIndex = previous ? screens.findIndex((screen) => screen.id === previous.id) : -1;
    if (nextIndex < 0) nextIndex = Math.min(state.screenIndex, Math.max(0, screens.length - 1));
    state.screenIndex = nextIndex;
    state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, Math.max(0, screenItems(screens[nextIndex]).length - 1)));

    const overlays = overlayScreens();
    if (!overlayOwner() || !overlays.length) {
      state.activityOverlayOpen = false;
      state.overlayEntity = null;
      state.remoteMappingEntityId = "";
      state.remoteMappings = [];
    }
    if (state.controlEntity) {
      const controlId = idOf(state.controlEntity);
      state.controlEntity = state.entities.get(controlId) || null;
      if (!state.controlEntity) state.entityControlOpen = false;
    }
    state.activityOverlayIndex = Math.max(0, Math.min(state.activityOverlayIndex, Math.max(0, overlays.length - 1)));
    state.activityOverlaySelectedIndex = Math.max(0, Math.min(
      state.activityOverlaySelectedIndex,
      Math.max(0, screenItems(overlays[state.activityOverlayIndex]).length - 1)
    ));
  }

  function overlayScreens() {
    return entityScreens(overlayOwner());
  }

  function displayedScreen() {
    if (state.activityOverlayOpen) {
      const overlays = overlayScreens();
      if (overlays.length) return overlays[state.activityOverlayIndex] || overlays[0];
    }
    return state.screens[state.screenIndex] || null;
  }

  function displayedSelection() {
    return state.activityOverlayOpen ? state.activityOverlaySelectedIndex : state.selectedIndex;
  }

  function setDisplayedSelection(value) {
    if (state.activityOverlayOpen) state.activityOverlaySelectedIndex = value;
    else state.selectedIndex = value;
  }

  function openEntityOverlay(entity) {
    const overlays = entityScreens(entity);
    if (!entity || !overlays.length) return false;
    const entityId = idOf(entity);
    const remote = String(entity?.entity_type || entity?.type || "").toLowerCase() === "remote";
    if (remote) {
      if (state.remoteMappingEntityId !== entityId) {
        state.remoteMappingEntityId = entityId;
        state.remoteMappings = mappingCollection(null, entity);
      }
    } else {
      state.remoteMappingEntityId = "";
      state.remoteMappings = [];
    }
    state.overlayEntity = entity;
    state.profileSelectorOpen = false;
    state.activityOverlayClosing = false;
    state.activityOverlayOpening = !state.activityOverlayOpen;
    state.activityOverlayOpen = true;
    state.activityOverlayIndex = Math.max(0, Math.min(state.activityOverlayIndex, overlays.length - 1));
    state.activityOverlaySelectedIndex = 0;
    renderScreen();
    if (state.activityOverlayOpening) setTimeout(() => { state.activityOverlayOpening = false; }, 340);
    return true;
  }

  function openActivityOverlay() {
    return openEntityOverlay(state.activeActivity);
  }

  function closeEntityControl() {
    if (!state.entityControlOpen || state.entityControlClosing) return false;
    state.entityControlOpening = false;
    state.entityControlClosing = true;
    renderScreen();
    setTimeout(() => {
      state.entityControlOpen = false;
      state.entityControlClosing = false;
      state.controlEntity = null;
      state.controlFeatureIndex = 0;
      renderScreen();
    }, 230);
    return true;
  }

  function openEntityControl(entity) {
    const type = String(entity?.entity_type || entity?.type || "").toLowerCase();
    if (!entity || !["cover", "light", "climate", "select", "media_player", "switch", "button"].includes(type)) return false;
    state.controlEntity = entity;
    state.controlFeatureIndex = 0;
    state.entityControlClosing = false;
    state.entityControlOpening = !state.entityControlOpen;
    state.entityControlOpen = true;
    state.profileSelectorOpen = false;
    renderScreen();
    if (state.entityControlOpening) setTimeout(() => { state.entityControlOpening = false; }, 340);
    return true;
  }

  function closeActivityOverlay() {
    if (!state.activityOverlayOpen || state.activityOverlayClosing) return false;
    state.activityOverlayOpening = false;
    state.activityOverlayClosing = true;
    renderScreen();
    setTimeout(() => {
      state.activityOverlayOpen = false;
      state.overlayEntity = null;
      state.remoteMappingEntityId = "";
      state.remoteMappings = [];
      state.activityOverlayClosing = false;
      state.activityOverlaySelectedIndex = 0;
      renderScreen();
    }, 230);
    return true;
  }

  function openProfileSelector() {
    if (!state.profiles.length) return false;
    state.profileSelectorIndex = Math.max(0, state.profiles.findIndex((profile) => idOf(profile) === idOf(state.profile)));
    state.profileSelectorOpen = true;
    renderScreen();
    return true;
  }

  function closeProfileSelector() {
    if (!state.profileSelectorOpen) return false;
    state.profileSelectorOpen = false;
    renderScreen();
    return true;
  }

  async function setActiveProfile(profileId) {
    const id = String(profileId || "");
    if (!id) throw new Error("Profile ID is missing");
    try {
      return await request(`/profiles?active_profile_id=${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ active_profile_id: id })
      });
    } catch (primaryError) {
      try {
        return await request("/profiles/active", {
          method: "PATCH",
          body: JSON.stringify({ profile_id: id })
        });
      } catch {
        throw primaryError;
      }
    }
  }

  async function activateProfile(profile) {
    if (!profile || state.busy) return;
    state.busy = true;
    setBusy(true);
    try {
      await setActiveProfile(idOf(profile));
      state.profileSelectorOpen = false;
      state.screenIndex = 0;
      state.selectedIndex = 0;
      state.lastRefresh = 0;
      await refresh(true);
    } catch (error) {
      toast(error.message, true);
    } finally {
      state.busy = false;
      setBusy(false);
    }
  }

  async function refresh(force = false, reloadSettings = false) {
    if (state.updatesPaused) {
      state.pausedRefreshPending = true;
      return;
    }
    if (state.selectInteraction) {
      state.deferredRefresh = true;
      return;
    }
    if ((!force && state.busy) || (!force && Date.now() - state.lastRefresh < 700)) return;
    const generation = ++state.refreshGeneration;
    const previousVisualSignature = visualDataSignature();
    const preserveTransient = Boolean(state.activityOverlayOpen || state.profileSelectorOpen || state.entityControlOpen || state.activityOverlayOpening || state.activityOverlayClosing || state.entityControlOpening || state.entityControlClosing);
    try {
      const [settings, activitiesPayload, entitiesPayload, profilesPayload, activeProfilePayload] = await Promise.all([
        reloadSettings || !state.settingsLoaded ? request("/simulator").catch(() => state.settings) : Promise.resolve(state.settings),
        request("/activities"),
        request("/entities"),
        request("/profiles"),
        request("/profiles/active").catch(() => null)
      ]);
      if (generation !== state.refreshGeneration) return;

      const activities = normalizeActivities(activitiesPayload);
      let activeActivity = activities.find((item) => ["ON", "STARTING"].includes(String(item.state).toUpperCase())) || null;
      if (activeActivity?.id) {
        const detail = await request(`/activities/${encodeURIComponent(activeActivity.id)}`).catch(() => null);
        if (generation !== state.refreshGeneration) return;
        const normalizedDetail = detail ? normalizeActivities([detail])[0] : null;
        if (normalizedDetail) {
          activeActivity = { ...activeActivity, ...normalizedDetail };
          const index = activities.findIndex((item) => item.id === activeActivity.id);
          if (index >= 0) activities[index] = activeActivity;
        }
      }

      const entities = new Map(collection(entitiesPayload).map((item) => [idOf(item), item]).filter(([id]) => id));
      for (const activity of activities) {
        entities.set(activity.id, activity);
        const included = Array.isArray(activity.options?.included_entities)
          ? activity.options.included_entities
          : Array.isArray(activity.entities)
            ? activity.entities
            : [];
        for (const entity of included) {
          const entityId = idOf(entity);
          if (entityId && !entities.has(entityId)) entities.set(entityId, entity);
        }
      }

      const profiles = collection(profilesPayload)
        .filter((profile) => idOf(profile) === "ucvr-demo-profile");
      const activeProfileId = idOf(activeProfilePayload) || idOf(profiles.find((profile) => profile.active));
      const profile = profiles.find((candidate) => idOf(candidate) === activeProfileId)
        || activeProfilePayload
        || profiles[0]
        || null;
      let profilePages = [];
      let groups = new Map();
      if (profile) {
        const profileId = idOf(profile);
        const [pagesPayload, groupsPayload] = await Promise.all([
          request(`/profiles/${encodeURIComponent(profileId)}/pages`).catch(() => profile.pages || []),
          request(`/profiles/${encodeURIComponent(profileId)}/groups`).catch(() => profile.groups || [])
        ]);
        if (generation !== state.refreshGeneration) return;
        profilePages = collection(pagesPayload).filter((page) => !page?.profile_id || String(page.profile_id) === profileId);
        groups = new Map(collection(groupsPayload)
          .filter((group) => !group?.profile_id || String(group.profile_id) === profileId)
          .map((group) => [String(group.group_id || group.id), group]));
      }

      const mappings = activeActivity
        ? mappingCollection(await request(`/activities/${encodeURIComponent(activeActivity.id)}/buttons`).catch(() => null), activeActivity)
        : [];
      const currentOverlayId = state.activityOverlayOpen && String(state.overlayEntity?.entity_type || state.overlayEntity?.type || "").toLowerCase() === "remote"
        ? idOf(state.overlayEntity)
        : "";
      const remoteMappingPayload = currentOverlayId
        ? await request(`/remotes/${encodeURIComponent(currentOverlayId)}/buttons`).catch(() => null)
        : null;
      if (generation !== state.refreshGeneration) return;

      state.settings = { ...state.settings, ...(settings || {}) };
      state.settingsLoaded = true;
      applyLighting();
      state.activities = activities;
      state.activeActivity = activeActivity;
      state.entities = entities;
      state.profiles = profiles;
      state.profile = profile;
      state.profilePages = profilePages;
      state.groups = groups;
      state.activityMappings = mappings;
      state.remoteMappingEntityId = currentOverlayId;
      state.remoteMappings = currentOverlayId
        ? mappingCollection(remoteMappingPayload, entities.get(currentOverlayId) || state.overlayEntity)
        : [];
      if (state.overlayEntity) {
        const overlayId = idOf(state.overlayEntity);
        state.overlayEntity = state.entities.get(overlayId) || state.activities.find((item) => item.id === overlayId) || null;
      }
      if (state.controlEntity) {
        const controlId = idOf(state.controlEntity);
        state.controlEntity = state.entities.get(controlId) || state.controlEntity;
      }
      state.lastRefresh = Date.now();
      rebuildScreens();
      const visualChanged = previousVisualSignature !== visualDataSignature();
      if (!visualChanged && display?.childElementCount) {
        updateLiveContent();
      } else if (preserveTransient && (state.activityOverlayOpen || state.profileSelectorOpen || state.entityControlOpen || state.activityOverlayOpening || state.activityOverlayClosing || state.entityControlOpening || state.entityControlClosing)) {
        updateTransientContent();
      } else {
        renderScreen();
      }
    } catch (error) {
      if (generation === state.refreshGeneration) toast(error.message, true);
    }
  }

  async function activityCommand(activity, action) {
    if (!activity?.id || state.busy) return;
    state.busy = true;
    setBusy(true);
    try {
      if (action === "on" && state.activeActivity && state.activeActivity.id !== activity.id) {
        await request(`/entities/${encodeURIComponent(state.activeActivity.id)}/command`, {
          method: "PUT",
          body: JSON.stringify({ cmd_id: "activity.off" })
        });
      }
      await request(`/entities/${encodeURIComponent(activity.id)}/command`, {
        method: "PUT",
        body: JSON.stringify({ cmd_id: `activity.${action}` })
      });
      const shouldOpenActivity = action === "on";
      if (!shouldOpenActivity) {
        state.activityOverlayOpen = false;
        state.overlayEntity = null;
      }
      state.activityOverlayIndex = 0;
      state.activityOverlaySelectedIndex = 0;
      await refreshAfterCommand();
      if (shouldOpenActivity) openActivityOverlay();
    } catch (error) {
      toast(error.message, true);
    } finally {
      state.busy = false;
      setBusy(false);
    }
  }

  function activityControlContext() {
    return Boolean(state.activityOverlayOpen && !state.profileSelectorOpen && state.activeActivity && idOf(overlayOwner()) === state.activeActivity.id);
  }

  function remoteControlContext() {
    const owner = overlayOwner();
    return Boolean(
      state.activityOverlayOpen
      && !state.profileSelectorOpen
      && owner
      && String(owner.entity_type || owner.type || "").toLowerCase() === "remote"
      && idOf(owner) === state.remoteMappingEntityId
    );
  }

  function buttonControlContext() {
    if (remoteControlContext()) return { kind: "remote", owner: overlayOwner(), mappings: state.remoteMappings };
    if (activityControlContext()) return { kind: "activity", owner: state.activeActivity, mappings: state.activityMappings };
    return null;
  }

  function mappingFor(button) {
    const context = buttonControlContext();
    if (!context) return null;
    return context.mappings.find((item) => String(item.button || item.button_id || "").toUpperCase() === button) || null;
  }

  function commandFromMapping(mapping, press) {
    if (!mapping) return null;
    const shortValue = mapping.short_press || mapping.shortPress;
    const value = press === "long" ? (mapping.long_press || mapping.longPress || shortValue) : shortValue;
    if (!value) return null;
    if (typeof value === "string") return { cmd_id: value };
    return {
      entity_id: value.entity_id || value.entityId,
      cmd_id: value.cmd_id || value.command || value.command_id,
      params: value.params
    };
  }

  async function sendEntityCommand(entityId, commandId, params) {
    if (!entityId || !commandId) throw new Error("The mapped command is incomplete");
    const entity = state.entities.get(entityId);
    let cmdId = commandId;
    let commandParams = params;
    if (String(entity?.entity_type || "").toLowerCase() === "remote") {
      if (!String(commandId).startsWith("remote.")) {
        cmdId = "remote.send_cmd";
        commandParams = { command: commandId, ...(params || {}) };
      } else if (cmdId === "remote.send") {
        cmdId = "remote.send_cmd";
      }
      if (cmdId === "remote.send_cmd") state.remoteHoldEntity = entityId;
    }
    return request(`/entities/${encodeURIComponent(entityId)}/command`, {
      method: "PUT",
      body: JSON.stringify({ cmd_id: cmdId, params: commandParams })
    });
  }

  async function stopRemoteHold() {
    const entityId = state.remoteHoldEntity;
    state.remoteHoldEntity = null;
    if (!entityId) return;
    try {
      await request(`/entities/${encodeURIComponent(entityId)}/command`, {
        method: "PUT",
        body: JSON.stringify({ cmd_id: "remote.stop_send", params: {} })
      });
    } catch {}
  }

  function navigateScreens(delta) {
    if (state.activityOverlayOpen) {
      const overlays = overlayScreens();
      if (!overlays.length) return;
      state.activityOverlayIndex = (state.activityOverlayIndex + delta + overlays.length) % overlays.length;
      state.activityOverlaySelectedIndex = 0;
      renderScreen();
      return;
    }
    if (!state.screens.length) return;
    state.screenIndex = (state.screenIndex + delta + state.screens.length) % state.screens.length;
    state.selectedIndex = 0;
    renderScreen();
  }

  function moveSelection(delta) {
    const items = screenItems(displayedScreen());
    if (!items.length) return;
    setDisplayedSelection((displayedSelection() + delta + items.length) % items.length);
    renderScreen();
  }

  async function activateCurrentItem() {
    const item = screenItems(displayedScreen())[displayedSelection()];
    if (!item) return;
    if (item.kind === "group") {
      if (state.expandedGroups.has(item.id)) state.expandedGroups.delete(item.id);
      else state.expandedGroups.add(item.id);
      renderScreen();
      return;
    }
    if (item.kind === "activity") {
      const activity = state.activities.find((candidate) => candidate.id === item.id) || item.data;
      if (state.activeActivity?.id === activity.id) {
        if (!openActivityOverlay()) toast(`${activity.title} is active`);
      } else {
        await activityCommand(activity, "on");
      }
      return;
    }
    const entityType = String(item.data?.entity_type || "").toLowerCase();
    if (["cover", "light", "climate", "select", "media_player", "switch", "button"].includes(entityType)) {
      openEntityControl(item.data);
      return;
    }
    if (entityType === "remote") {
      let remote = item.data;
      if (!entityScreens(remote).length) {
        const detail = await request(`/entities/${encodeURIComponent(idOf(remote))}`).catch(() => null);
        if (detail) {
          remote = { ...remote, ...detail };
          state.entities.set(idOf(remote), remote);
        }
      }
      const remoteId = idOf(remote);
      state.remoteMappingEntityId = remoteId;
      state.remoteMappings = mappingCollection(
        await request(`/remotes/${encodeURIComponent(remoteId)}/buttons`).catch(() => null),
        remote
      );
      if (!openEntityOverlay(remote)) toast(`${nameOf(remote?.name || remote?.display_name, "Remote")} has no grid pages`, true);
      return;
    }
    await triggerEntity(item.data);
  }

  function defaultEntityCommand(entity) {
    const commands = new Set([...(entity?.entity_commands || []), ...(entity?.simple_commands || [])].map(String));
    const candidates = [
      "toggle", "on_off.toggle", "light.toggle", "switch.toggle",
      "push", "button.push", "macro.start", "start",
      "media_player.play_pause", "play_pause", "cover.toggle"
    ];
    for (const candidate of candidates) if (commands.has(candidate)) return candidate;
    const type = String(entity?.entity_type || "").toLowerCase();
    if (type === "macro") return "macro.start";
    if (type === "button") return "push";
    if (["switch", "light"].includes(type)) return "toggle";
    if (type === "media_player") return "media_player.play_pause";
    return "";
  }

  async function triggerEntity(entity) {
    const entityId = idOf(entity);
    const commandId = defaultEntityCommand(entity);
    if (!entityId || !commandId) {
      toast(`No default action is available for ${nameOf(entity?.name, entityId || "this item")}`);
      return;
    }
    state.busy = true;
    setBusy(true);
    try {
      await sendEntityCommand(entityId, commandId, {});
      toast(nameOf(entity.name, commandId));
      await refreshAfterCommand();
    } catch (error) {
      toast(error.message, true);
    } finally {
      state.busy = false;
      setBusy(false);
    }
  }

  async function localButtonAction(button, press) {
    if (press === "long") return false;
    if (state.entityControlOpen) {
      if (button === "BACK" || button === "HOME") return closeEntityControl();
      return true;
    }
    if (state.profileSelectorOpen) {
      if (button === "BACK" || button === "HOME") return closeProfileSelector();
      if (button === "DPAD_UP") { state.profileSelectorIndex = (state.profileSelectorIndex - 1 + state.profiles.length) % state.profiles.length; renderScreen(); return true; }
      if (button === "DPAD_DOWN") { state.profileSelectorIndex = (state.profileSelectorIndex + 1) % state.profiles.length; renderScreen(); return true; }
      if (button === "DPAD_MIDDLE") { await activateProfile(state.profiles[state.profileSelectorIndex]); return true; }
      return true;
    }
    if (button === "BACK") {
      if (closeActivityOverlay()) return true;
      if (state.screenIndex !== 0) { state.screenIndex = 0; state.selectedIndex = 0; renderScreen(); }
      return true;
    }
    if (button === "HOME") {
      state.entityControlOpen = false;
      state.controlEntity = null;
      state.activityOverlayOpen = false;
      state.overlayEntity = null;
      state.remoteMappingEntityId = "";
      state.remoteMappings = [];
      state.screenIndex = 0;
      state.selectedIndex = 0;
      renderScreen();
      return true;
    }
    if (button === "DPAD_LEFT") { navigateScreens(-1); return true; }
    if (button === "DPAD_RIGHT") { navigateScreens(1); return true; }
    if (button === "DPAD_UP") { moveSelection(-1); return true; }
    if (button === "DPAD_DOWN") { moveSelection(1); return true; }
    if (button === "DPAD_MIDDLE") { await activateCurrentItem(); return true; }
    if (button === "POWER" && state.activeActivity) { state.activityOverlayOpen = false; state.overlayEntity = null; await activityCommand(state.activeActivity, "off"); return true; }
    if (button === "MENU" && state.screens.length > 1) { navigateScreens(1); return true; }
    return false;
  }

  async function pressButton(button, press = "short") {
    if (state.busy) return;
    const command = commandFromMapping(mappingFor(button), press);
    if (command?.cmd_id) {
      const target = command.entity_id || idOf(buttonControlContext()?.owner);
      state.busy = true;
      setBusy(true);
      try {
        await sendEntityCommand(target, command.cmd_id, command.params);
        toast(command.cmd_id);
        await refreshAfterCommand();
      } catch (error) {
        toast(error.message, true);
      } finally {
        state.busy = false;
        setBusy(false);
      }
      return;
    }
    if (await localButtonAction(button, press)) return;
    toast(`No ${press}-press command mapped for ${button.replaceAll("_", " ").toLowerCase()}`);
  }

  async function refreshAfterCommand() {
    await new Promise((resolve) => setTimeout(resolve, 160));
    state.lastRefresh = 0;
    await refresh(true);
  }

  function entityIsActive(entity) {
    const value = stateOf(entity);
    const type = String(entity?.entity_type || entity?.type || "").toLowerCase();
    if (entity?.available === false || ["unavailable", "unknown", "disconnected"].includes(value)) return false;
    if (type === "button") return value !== "unavailable";
    if (type === "cover") return !["closed", "off"].includes(value) || normalizedCoverPosition(entity) > 0;
    if (type === "climate") return value !== "off" && climateData(entity).mode !== "off";
    return !["off", "idle", "paused", "stopped", "closed", "false", "0", ""].includes(value);
  }

  function quickActionMarkup(entity) {
    const type = String(entity?.entity_type || entity?.type || "").toLowerCase();
    const active = entityIsActive(entity);
    const icons = {
      media_player: active ? "fa-pause" : "fa-play",
      light: "fa-lightbulb",
      cover: active ? "fa-arrow-down" : "fa-arrow-up",
      climate: "fa-power-off",
      switch: "fa-power-off",
      button: "fa-hand-pointer"
    };
    if (!icons[type]) return "";
    const label = type === "button" ? "Push" : active ? "Turn off" : "Turn on";
    return `<button type="button" class="ucvr-remoteui-card-action${active ? " is-active" : ""}${type === "button" ? " is-momentary" : ""}" data-card-quick="${escapeHtml(idOf(entity))}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><i class="fa-light ${icons[type]}"></i></button>`;
  }

  function groupMembers(group) {
    return collection(group?.entities).map(entityForReference).filter(Boolean);
  }

  function groupIsActive(group) {
    return groupMembers(group).some(entityIsActive);
  }

  async function setGroupPower(groupId, turnOn) {
    const group = state.groups.get(String(groupId || ""));
    const members = groupMembers(group);
    const commands = members.map((entity) => {
      const type = String(entity?.entity_type || "").toLowerCase();
      if (type === "light") return [entity, turnOn ? "light.on" : "light.off"];
      if (type === "switch") return [entity, turnOn ? "switch.on" : "switch.off"];
      if (type === "climate") return [entity, turnOn ? "climate.on" : "climate.off"];
      return null;
    }).filter(Boolean);
    if (!commands.length) {
      toast("This group has no on/off entities", true);
      return;
    }
    state.busy = true;
    setBusy(true);
    try {
      await Promise.all(commands.map(([entity, command]) => sendEntityCommand(idOf(entity), command, {})));
      toast(turnOn ? "Group turned on" : "Group turned off");
      await refreshAfterCommand();
    } catch (error) {
      toast(error.message, true);
    } finally {
      state.busy = false;
      setBusy(false);
    }
  }

  function renderItem(item, index, selectedIndex, scope = "base") {
    const data = item.data || {};
    const selected = index === selectedIndex;
    const inactive = ["off", "unavailable", "unknown", "disconnected"].includes(stateOf(data));
    const unavailable = data.available === false;
    const nestedClass = item.nested ? " ucvr-sim-entity-item--nested" : "";
    const type = String(data.entity_type || data.type || item.kind || "entity").toLowerCase();
    const title = nameOf(data.name || data.title, item.id);

    if (item.kind === "group") {
      const expanded = state.expandedGroups.has(item.id);
      const active = groupIsActive(data);
      const memberCount = collection(data.entities).length;
      return `<div id="ucvr-sim-item-${escapeHtml(scope)}-${escapeHtml(item.id)}" class="entity-item ucvr-sim-entity-item ucvr-remoteui-group${selected ? " ucvr-sim-entity-item--selected" : ""}${expanded ? " is-expanded" : ""}" role="button" tabindex="${selected ? "0" : "-1"}" data-item-index="${index}" data-item-scope="${scope}">
        <span class="ucvr-remoteui-group__arrow"><i class="fa-light fa-chevron-up" aria-hidden="true"></i></span>
        <span class="ucvr-remoteui-group__meta"><strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong><small>${memberCount} ${memberCount === 1 ? "entity" : "entities"}</small></span>
        <button type="button" class="ucvr-remoteui-group__toggle${active ? " is-active" : ""}" data-group-toggle="${escapeHtml(item.id)}" data-group-target="${active ? "off" : "on"}" aria-label="Turn ${escapeHtml(title)} ${active ? "off" : "on"}"><span></span></button>
      </div>`;
    }

    const media = type === "media_player" ? mediaPlayerData(data, title) : null;
    const artwork = media?.artwork ? `<img src="${escapeHtml(media.artwork)}" alt="">` : iconMarkup(data);
    return `<div id="ucvr-sim-item-${escapeHtml(scope)}-${escapeHtml(item.id)}" class="entity-item ucvr-sim-entity-item ucvr-remoteui-entity-card ucvr-remoteui-entity-card--${escapeHtml(type)}${selected ? " ucvr-sim-entity-item--selected" : ""}${nestedClass}${entityIsActive(data) ? " is-active" : " is-inactive"}" role="button" tabindex="${selected ? "0" : "-1"}" data-item-index="${index}" data-item-scope="${scope}">
      <div class="entity-item__icon ucvr-remoteui-entity-card__icon${inactive ? " entity-item__icon--inactive" : ""}${unavailable ? " entity-item__icon--unavailable" : ""}${media?.artwork ? " has-artwork" : ""}">${artwork}</div>
      <div class="entity-item__meta ucvr-remoteui-entity-card__meta">
        <span class="entity-item__title${inactive ? " entity-item__title--inactive" : ""}" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="entity-item__state">${escapeHtml(type === "media_player" ? (media.artist || media.title || stateOf(data)) : stateOf(data))}</span>
      </div>
      ${quickActionMarkup(data)}
    </div>`;
  }

  function commandLabel(command) {
    if (!command?.cmd_id) return "none";
    const targetId = command.entity_id || idOf(buttonControlContext()?.owner) || "";
    const target = state.entities.get(targetId) || state.activities.find((item) => item.id === targetId);
    const targetName = target ? nameOf(target.name || target.title, targetId) : targetId;
    const commandName = String(command.cmd_id).replaceAll("_", " ").replaceAll(".", " · ");
    return targetName ? `${targetName} — ${commandName}` : commandName;
  }

  function hardwareIcon(button) {
    const icons = {
      BACK: "fa-arrow-left", HOME: "fa-house-blank", POWER: "fa-power-off",
      VOLUME_UP: "fa-volume-up", VOLUME_DOWN: "fa-volume-down", MUTE: "fa-volume-mute",
      DPAD_UP: "fa-chevron-up", DPAD_DOWN: "fa-chevron-down", DPAD_LEFT: "fa-chevron-left",
      DPAD_RIGHT: "fa-chevron-right", DPAD_MIDDLE: "fa-circle", CHANNEL_UP: "fa-chevron-up",
      CHANNEL_DOWN: "fa-chevron-down", RECORD: "fa-circle", MENU: "fa-ellipsis-h",
      VOICE: "fa-microphone", PREV: "fa-backward", STOP: "fa-stop", PLAY: "fa-play", NEXT: "fa-forward"
    };
    return icons[button] || "fa-circle";
  }

  function renderMappingPanel() {
    if (!mappingPanelBody) return;
    const sliderMode = state.settings.touch_slider_mode || "auto";
    const activityContext = activityControlContext();
    const buttonContext = buttonControlContext();
    const sliderActive = state.activeHardwareButton === "TOUCH_SLIDER";
    const sliderText = sliderMode === "auto" ? (activityContext ? "Volume" : "Page navigation") : (sliderMode === "pages" ? "Page navigation" : "Volume");
    mappingPanel?.setAttribute("aria-label", buttonContext?.kind === "remote" ? "Current remote button mappings" : "Current activity button mappings");
    const rows = HARDWARE_BUTTONS.map(([button, label]) => {
      const mapping = mappingFor(button);
      const shortCommand = commandFromMapping(mapping, "short");
      const longCommand = commandFromMapping(mapping, "long");
      const active = state.activeHardwareButton === button;
      return `<div class="button-list__item ucvr-sim-mapping-item${active ? " ucvr-sim-mapping-item--active" : ""}" data-mapping-button="${button}">
        <div class="button-list__item__base"><span class="button-list__item__icon"><i class="fa-light icon ${hardwareIcon(button)}"></i></span><span class="button-list__item__name">${escapeHtml(label)}</span></div>
        <div class="button-list__item__config"><div class="button-list__item__config__expanded">
          <div class="button-press button-press--expanded-mode button-press--short${active && state.activeHardwarePress === "short" ? " ucvr-sim-button-press--active" : ""}"><div class="button-press__main"><span class="button-press__symbol"></span><span class="button-press__command">${escapeHtml(commandLabel(shortCommand))}</span></div></div>
          <div class="button-press button-press--expanded-mode button-press--long${active && state.activeHardwarePress === "long" ? " ucvr-sim-button-press--active" : ""}"><div class="button-press__main"><span class="button-press__symbol"></span><span class="button-press__command">${escapeHtml(commandLabel(longCommand))}</span></div></div>
        </div></div>
      </div>`;
    }).join("");
    mappingPanelBody.innerHTML = `<div class="config-touch-slider"><div class="config-touch-slider__item${sliderActive ? " ucvr-sim-mapping-item--active" : ""}"><div class="config-touch-slider__item__base"><span class="config-touch-slider__item__icon"><i class="fa-light fa-slider"></i></span><span class="config-touch-slider__item__name">Touch slider</span></div><div class="config-touch-slider__item__config"><div class="config-touch-slider__item__feature">${escapeHtml(sliderText)}</div></div></div></div>${rows}`;
  }

  function activityWidgetEntity(widget) {
    const id = widget?.sensor?.sensor_id || widget?.select?.select_id || widget?.media_player_id || widget?.light_id || widget?.cover_id || widget?.climate_id || widget?.light?.entity_id || widget?.cover?.entity_id || widget?.climate?.entity_id || widget?.entity_id || widget?.command?.entity_id || "";
    if (!id) return null;
    const direct = state.entities.get(String(id));
    if (direct) return direct;
    const included = state.activeActivity?.options?.included_entities || state.activeActivity?.entities || state.activeActivity?.included_entities || [];
    return collection(included).find((item) => idOf(item) === String(id)) || null;
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function widgetPlacement(widget, gridWidth, gridHeight) {
    const location = widget?.location || {};
    const size = widget?.size || {};
    const x = Math.max(0, Math.min(gridWidth - 1, Math.floor(finiteNumber(location.x, 0))));
    const y = Math.max(0, Math.min(gridHeight - 1, Math.floor(finiteNumber(location.y, 0))));
    const width = Math.max(1, Math.min(gridWidth - x, Math.floor(finiteNumber(size.width, 1))));
    const height = Math.max(1, Math.min(gridHeight - y, Math.floor(finiteNumber(size.height, 1))));
    return { x, y, width, height };
  }

  function entityAttribute(entity, ...keys) {
    for (const key of keys) {
      const value = entity?.attributes?.[key] ?? entity?.[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
  }

  function sensorValue(widget, entity) {
    const value = entityAttribute(entity, "value", "state");
    const showUnit = widget?.sensor?.show_unit !== false;
    const unit = showUnit ? entityAttribute(entity, "unit", "unit_of_measurement", "measurement_unit") : "";
    return `${value === "" ? "—" : value}${unit ? ` ${unit}` : ""}`;
  }

  function formatMediaTime(value) {
    const seconds = Math.max(0, Math.floor(finiteNumber(value, 0)));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function cleanMediaArtist(value) {
    return String(value || "")
      .replace(/(?:\s*[•·]\s*)?video available\b/gi, "")
      .replace(/\s*[•·]\s*$/g, "")
      .replace(/^\s*[•·]\s*/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }


  function normalizedOptions(value) {
    const values = Array.isArray(value) ? value : [];
    return [...new Set(values.filter((item) => item !== undefined && item !== null && String(item).length).map(String))];
  }

  function stableVisualValue(value, key = "") {
    if (Array.isArray(value)) return value.map((item) => stableVisualValue(item, key));
    if (!value || typeof value !== "object") {
      if (["media_artist", "artist"].includes(key)) return cleanMediaArtist(value);
      return value;
    }
    const result = {};
    for (const childKey of Object.keys(value).sort()) {
      if (["created_at", "updated_at", "last_updated", "last_changed", "timestamp", "media_position_updated_at", "position_updated_at"].includes(childKey)) continue;
      result[childKey] = stableVisualValue(value[childKey], childKey);
    }
    return result;
  }

  function mediaPlayerData(entity, label = "") {
    const attributes = entity?.attributes || {};
    const source = String(attributes.source || attributes.current_source || attributes.input_source || "");
    const sources = normalizedOptions([
      source,
      ...(attributes.source_list || attributes.sources || attributes.available_sources || attributes.input_sources || entity?.options?.sources || [])
    ]);
    return {
      title: String(attributes.media_title || attributes.title || nameOf(entity?.name, label || "Media player")),
      artist: cleanMediaArtist(attributes.media_artist || attributes.artist || ""),
      album: String(attributes.media_album || attributes.album || ""),
      artwork: String(attributes.media_image_url || attributes.media_image || attributes.artwork_url || attributes.image_url || ""),
      duration: finiteNumber(attributes.media_duration ?? attributes.duration, 0),
      source,
      sources,
      state: stateOf(entity)
    };
  }

  function mediaPlayerProgress(entity) {
    const attributes = entity?.attributes || {};
    const duration = finiteNumber(attributes.media_duration ?? attributes.duration, 0);
    const playing = ["playing", "play"].includes(stateOf(entity));
    let position = finiteNumber(attributes.media_position ?? attributes.position, 0);
    const updatedAt = Date.parse(attributes.media_position_updated_at || attributes.position_updated_at || "");
    if (playing && Number.isFinite(updatedAt)) position += Math.max(0, (Date.now() - updatedAt) / 1000);
    position = Math.max(0, Math.min(duration > 0 ? duration : Number.MAX_SAFE_INTEGER, position));
    return { duration, playing, position };
  }

  function normalizedBrightness(entity) {
    let value = finiteNumber(entityAttribute(entity, "brightness", "brightness_level", "level"), 0);
    if (value > 100) value = value / 255 * 100;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function entityCapabilitySet(entity) {
    const values = [];
    const collect = (value) => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (value && typeof value === "object") {
        if (value.id || value.cmd_id || value.command_id || value.feature) values.push(value.id || value.cmd_id || value.command_id || value.feature);
        for (const item of Object.values(value)) collect(item);
        return;
      }
      if (value !== undefined && value !== null) values.push(value);
    };
    collect(entity?.features);
    collect(entity?.entity_commands);
    collect(entity?.simple_commands);
    collect(entity?.attributes?.supported_features);
    collect(entity?.attributes?.supported_color_modes);
    collect(entity?.attributes?.color_modes);
    collect(entity?.options?.features);
    return new Set(values.map((value) => String(value).toLowerCase()));
  }

  function supportsLightControl(entity, control) {
    const capabilities = entityCapabilitySet(entity);
    const has = (...needles) => [...capabilities].some((value) => needles.some((needle) => value === needle || value.endsWith(`.${needle}`) || value.includes(needle)));
    const attributes = entity?.attributes || {};
    if (control === "power") return has("light.on", "light.off", "light.toggle", "on_off", "toggle", "onoff") || ["on", "off"].includes(stateOf(entity));
    if (control === "brightness") return has("light.brightness", "brightness", "dim") || attributes.brightness != null || attributes.brightness_level != null;
    if (control === "temperature") return has("light.color_temperature", "color_temperature", "color_temp") || attributes.color_temp != null || attributes.color_temperature != null || attributes.color_temp_kelvin != null;
    if (control === "color") return has("light.color", "rgb", "rgbw", "rgbww", "hs", "xy") || Array.isArray(attributes.rgb_color) || Array.isArray(attributes.hs_color);
    return false;
  }

  function lightTemperatureData(entity) {
    const attributes = entity?.attributes || {};
    const min = finiteNumber(attributes.min_color_temp_kelvin ?? attributes.min_color_temp ?? entity?.options?.min_color_temp, 2000);
    const max = finiteNumber(attributes.max_color_temp_kelvin ?? attributes.max_color_temp ?? entity?.options?.max_color_temp, 6500);
    const value = Math.max(min, Math.min(max, finiteNumber(attributes.color_temp_kelvin ?? attributes.color_temperature ?? attributes.color_temp ?? attributes.temperature, Math.round((min + max) / 2))));
    return { min, max, value: Math.round(value) };
  }

  function rgbToHex(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3) return "#ffffff";
    return `#${rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))).toString(16).padStart(2, "0")).join("")}`;
  }

  function hsToHex(hs) {
    if (!Array.isArray(hs) || hs.length < 2) return "#ffffff";
    const h = ((Number(hs[0]) || 0) % 360 + 360) % 360;
    const s = Math.max(0, Math.min(100, Number(hs[1]) || 0)) / 100;
    const v = 1;
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
  }

  function lightColorHex(entity) {
    const attributes = entity?.attributes || {};
    if (Array.isArray(attributes.rgb_color)) return rgbToHex(attributes.rgb_color);
    if (Array.isArray(attributes.hs_color)) return hsToHex(attributes.hs_color);
    const raw = String(attributes.color || "");
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw : "#ffffff";
  }

  function hexToHs(value) {
    const match = String(value || "").match(/^#([0-9a-f]{6})$/i);
    if (!match) return { hue: 0, saturation: 0 };
    const number = Number.parseInt(match[1], 16);
    const r = ((number >> 16) & 255) / 255;
    const g = ((number >> 8) & 255) / 255;
    const b = (number & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
    if (delta) {
      if (max === r) hue = 60 * (((g - b) / delta) % 6);
      else if (max === g) hue = 60 * ((b - r) / delta + 2);
      else hue = 60 * ((r - g) / delta + 4);
    }
    if (hue < 0) hue += 360;
    return { hue: Math.round(hue), saturation: Math.round(max ? delta / max * 100 : 0) };
  }

  function normalizedCoverPosition(entity) {
    return Math.max(0, Math.min(100, Math.round(finiteNumber(entityAttribute(entity, "current_position", "position"), 0))));
  }

  function climateData(entity) {
    const current = entityAttribute(entity, "current_temperature", "current_temp", "ambient_temperature");
    const target = entityAttribute(entity, "target_temperature", "setpoint", "temperature");
    const mode = String(entityAttribute(entity, "hvac_mode", "mode") || stateOf(entity) || "off");
    const modes = normalizedOptions(entity?.attributes?.hvac_modes || entity?.attributes?.modes || entity?.attributes?.options || entity?.options?.options);
    const unit = String(entityAttribute(entity, "temperature_unit", "unit_of_measurement", "unit") || "°");
    const step = Math.max(0.1, finiteNumber(entityAttribute(entity, "target_temperature_step", "temperature_step"), 0.5));
    return { current, target, mode, modes, unit, step };
  }

  function entityVisualData(entity) {
    const type = String(entity?.entity_type || entity?.type || "").toLowerCase();
    const base = {
      id: idOf(entity),
      type,
      name: nameOf(entity?.name || entity?.display_name, idOf(entity)),
      icon: String(entity?.icon || ""),
      available: entity?.available !== false,
      state: stateOf(entity)
    };
    if (type === "media_player") return { ...base, media: mediaPlayerData(entity) };
    if (type === "sensor") return { ...base, value: entityAttribute(entity, "value", "state"), unit: entityAttribute(entity, "unit", "unit_of_measurement", "measurement_unit") };
    if (type === "select") return { ...base, selected: entityAttribute(entity, "current_option", "selected", "value", "state"), options: normalizedOptions(entity?.attributes?.options || entity?.attributes?.available_options || entity?.options?.options || entity?.options?.items) };
    if (type === "light") return { ...base, brightness: normalizedBrightness(entity), colorTemperature: entityAttribute(entity, "color_temperature", "color_temp", "temperature"), color: stableVisualValue(entityAttribute(entity, "color", "hs_color", "rgb_color")) };
    if (type === "cover") return { ...base, position: normalizedCoverPosition(entity) };
    if (type === "climate") return { ...base, climate: climateData(entity) };
    if (type === "remote") return { ...base, pages: entityScreens(entity).map((screen) => ({ id: screen.id, title: screen.title, image: screen.image, page: stableVisualValue(screen.page) })) };
    return { ...base, value: entityAttribute(entity, "value", "state") };
  }

  function visualDataSignature() {
    const baseScreen = state.screens[state.screenIndex] || null;
    const baseItems = screenItems(baseScreen).map((item) => ({ kind: item.kind, id: item.id, nested: Boolean(item.nested), entity: entityVisualData(item.data) }));
    const overlays = overlayScreens();
    const overlayScreen = state.activityOverlayOpen ? (overlays[state.activityOverlayIndex] || overlays[0] || null) : null;
    const overlayWidgets = overlayScreen ? pageItems(overlayScreen.page).map((widget) => ({ widget: stableVisualValue(widget), entity: entityVisualData(activityWidgetEntity(widget)) })) : [];
    const profiles = state.profileSelectorOpen ? state.profiles.map((profile) => ({ id: idOf(profile), name: nameOf(profile?.name, idOf(profile)), icon: profile?.icon || "", active: idOf(profile) === idOf(state.profile) })) : [];
    return JSON.stringify(stableVisualValue({
      accent: state.settings.accent || "",
      touchSliderMode: state.settings.touch_slider_mode || "auto",
      buttonBacklight: state.settings.button || null,
      displayBrightness: state.settings.display?.brightness ?? 70,
      profile: state.profile ? { id: idOf(state.profile), name: nameOf(state.profile?.name, idOf(state.profile)), icon: state.profile?.icon || "" } : null,
      screens: state.screens.map((screen) => ({ id: screen.id, title: screen.title, image: screen.image })),
      baseScreen: baseScreen ? { id: baseScreen.id, title: baseScreen.title, image: baseScreen.image, page: stableVisualValue(baseScreen.page) } : null,
      baseItems,
      activeActivity: state.activeActivity ? entityVisualData(state.activeActivity) : null,
      overlayOpen: state.activityOverlayOpen,
      overlayOwner: state.activityOverlayOpen ? entityVisualData(overlayOwner()) : null,
      overlayScreen: overlayScreen ? { id: overlayScreen.id, title: overlayScreen.title, image: overlayScreen.image, page: stableVisualValue(overlayScreen.page) } : null,
      overlayWidgets,
      mappings: buttonControlContext() ? stableVisualValue(buttonControlContext().mappings) : [],
      profileSelectorOpen: state.profileSelectorOpen,
      profiles,
      entityControlOpen: state.entityControlOpen,
      controlEntity: state.entityControlOpen ? entityVisualData(state.controlEntity) : null
    }));
  }

  function mediaPlayerMarkup(entity, label) {
    const media = mediaPlayerData(entity, label);
    const { artwork, title, artist, album, duration } = media;
    const { playing, position } = mediaPlayerProgress(entity);
    const remaining = duration > 0 ? Math.max(0, duration - position) : 0;
    const progress = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
    const metadata = `${artist || "—"} | ${album || "—"}`;
    return `<span class="ucvr-sim-widget__media">
      <span class="ucvr-sim-media__visual">${artwork
        ? `<img class="ucvr-sim-widget__artwork" src="${escapeHtml(artwork)}" alt="">`
        : '<span class="ucvr-sim-widget__artwork ucvr-sim-widget__artwork--empty" aria-hidden="true"></span>'}</span>
      <strong class="ucvr-sim-media__title"><span class="ucvr-sim-marquee__content">${escapeHtml(title)}</span></strong>
      <span class="ucvr-sim-media__meta"><span class="ucvr-sim-marquee__content">${escapeHtml(metadata)}</span></span>
      <span class="ucvr-sim-media__progress-block" data-media-progress data-media-entity="${escapeHtml(idOf(entity))}" data-position="${position}" data-duration="${duration}" data-playing="${playing ? "true" : "false"}" data-rendered-at="${Date.now()}">
        <span class="ucvr-sim-media__progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><span style="width:${progress}%"></span></span>
        <span class="ucvr-sim-media__times"><span data-media-current>${escapeHtml(formatMediaTime(position))}</span><span data-media-remaining>-${escapeHtml(formatMediaTime(remaining))}</span></span>
      </span>
    </span>`;
  }

  function mediaMarqueeKey(container) {
    const widget = container.closest("[data-activity-widget]");
    const kind = container.classList.contains("ucvr-sim-media__title") ? "title" : "meta";
    return `${widget?.dataset.activityWidget || "unknown"}:${kind}:${container.textContent || ""}`;
  }

  function captureMediaMarquees() {
    const result = new Map();
    for (const container of display.querySelectorAll(".ucvr-sim-media__title,.ucvr-sim-media__meta")) {
      const animation = container.querySelector(".ucvr-sim-marquee__content")?.getAnimations?.()[0];
      if (animation && animation.currentTime !== null) result.set(mediaMarqueeKey(container), animation.currentTime);
    }
    return result;
  }

  function prepareMediaMarquees(previous = new Map()) {
    requestAnimationFrame(() => {
      for (const container of display.querySelectorAll(".ucvr-sim-media__title,.ucvr-sim-media__meta")) {
        const content = container.querySelector(".ucvr-sim-marquee__content");
        if (!content) continue;
        container.classList.remove("is-scrolling");
        content.style.removeProperty("--ucvr-marquee-distance");
        content.style.removeProperty("--ucvr-marquee-duration");
        const overflow = Math.max(0, content.scrollWidth - container.clientWidth);
        if (overflow > 2) {
          content.style.setProperty("--ucvr-marquee-distance", `${overflow}px`);
          content.style.setProperty("--ucvr-marquee-duration", `${Math.max(6, Math.min(20, overflow / 18 + 5))}s`);
          container.classList.add("is-scrolling");
          const previousTime = previous.get(mediaMarqueeKey(container));
          if (previousTime !== undefined) {
            requestAnimationFrame(() => {
              const animation = content.getAnimations?.()[0];
              if (animation) animation.currentTime = previousTime;
            });
          }
        }
      }
    });
  }

  function syncMediaProgressFromState() {
    const now = Date.now();
    for (const block of display.querySelectorAll("[data-media-progress][data-media-entity]")) {
      const entity = state.entities.get(String(block.dataset.mediaEntity || ""));
      if (!entity) continue;
      const progress = mediaPlayerProgress(entity);
      block.dataset.position = String(progress.position);
      block.dataset.duration = String(progress.duration);
      block.dataset.playing = progress.playing ? "true" : "false";
      block.dataset.renderedAt = String(now);
    }
  }

  function updateLiveContent() {
    const battery = Math.max(0, Math.min(100, Number(state.settings.battery_level ?? 82)));
    const nav = display.querySelector(":scope > .remote-controller__display__nav");
    const batteryElement = nav?.querySelector(".remote-nav__battery");
    const clockElement = nav?.querySelector(".remote-nav__clock .time");
    const profileElement = nav?.querySelector(".remote-nav__profile");
    if (batteryElement) batteryElement.style.width = `${battery}%`;
    if (clockElement) clockElement.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (profileElement) profileElement.textContent = nameOf(state.profile?.name, "U").slice(0, 1).toUpperCase();
    syncMediaProgressFromState();
    updateMediaProgressRealtime();
  }

  function updateMediaProgressRealtime() {
    if (!state.open || state.updatesPaused) return;
    const now = Date.now();
    for (const block of display.querySelectorAll("[data-media-progress]")) {
      const duration = finiteNumber(block.dataset.duration, 0);
      let position = finiteNumber(block.dataset.position, 0);
      if (block.dataset.playing === "true") position += Math.max(0, (now - finiteNumber(block.dataset.renderedAt, now)) / 1000);
      if (duration > 0) position = Math.min(duration, position);
      const remaining = duration > 0 ? Math.max(0, duration - position) : 0;
      const progress = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
      const progressElement = block.querySelector(".ucvr-sim-media__progress");
      const fill = progressElement?.querySelector("span");
      if (progressElement) progressElement.setAttribute("aria-valuenow", String(Math.round(progress)));
      if (fill) fill.style.width = `${progress}%`;
      const current = block.querySelector("[data-media-current]");
      const remainingElement = block.querySelector("[data-media-remaining]");
      if (current) current.textContent = formatMediaTime(position);
      if (remainingElement) remainingElement.textContent = `-${formatMediaTime(remaining)}`;
    }
  }

  function numpadMarkup(widget) {
    const entityId = widget?.entity_id || widget?.command?.entity_id || "";
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""];
    return `<span class="ucvr-sim-numpad">${keys.map((key) => key
      ? `<button type="button" class="ucvr-sim-numpad__key" data-command-entity="${escapeHtml(entityId)}" data-command-id="media_player.digit_${key}" data-command-params="{}">${key}</button>`
      : '<span class="ucvr-sim-numpad__spacer"></span>').join("")}</span>`;
  }

  function commandButton(entityId, commandId, label, icon, params = {}, className = "") {
    return `<button type="button" class="ucvr-sim-control-button ${className}" data-command-entity="${escapeHtml(entityId)}" data-command-id="${escapeHtml(commandId)}" data-command-params="${escapeHtml(JSON.stringify(params))}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><i class="fa-light ${icon}"></i></button>`;
  }

  function compactEntityWidgetMarkup(type, entity, label) {
    const entityId = idOf(entity);
    if (type === "light") {
      const brightness = normalizedBrightness(entity);
      const isOn = !["off", "unavailable", "unknown"].includes(stateOf(entity));
      return `<span class="ucvr-sim-compact-control"><span class="ucvr-sim-widget__label">${escapeHtml(label || nameOf(entity?.name, "Light"))}</span><span class="ucvr-sim-compact-control__value">${brightness}%</span>${commandButton(entityId, isOn ? "light.off" : "light.on", isOn ? "Turn off" : "Turn on", "fa-lightbulb")}</span>`;
    }
    if (type === "cover") {
      return `<span class="ucvr-sim-compact-control"><span class="ucvr-sim-widget__label">${escapeHtml(label || nameOf(entity?.name, "Cover"))}</span><span class="ucvr-sim-compact-control__value">${normalizedCoverPosition(entity)}%</span><span class="ucvr-sim-compact-control__buttons">${commandButton(entityId, "cover.open", "Open", "fa-arrow-up")}${commandButton(entityId, "cover.stop", "Stop", "fa-stop")}${commandButton(entityId, "cover.close", "Close", "fa-arrow-down")}</span></span>`;
    }
    const climate = climateData(entity);
    return `<span class="ucvr-sim-compact-control"><span class="ucvr-sim-widget__label">${escapeHtml(label || nameOf(entity?.name, "Climate"))}</span><span class="ucvr-sim-compact-control__value">${escapeHtml(climate.target === "" ? "—" : `${climate.target}${climate.unit}`)}</span><span class="ucvr-sim-widget__label">${escapeHtml(climate.mode)}</span></span>`;
  }

  function activityWidgetMarkup(widget, index, gridWidth, gridHeight) {
    const placement = widgetPlacement(widget, gridWidth, gridHeight);
    const entity = activityWidgetEntity(widget);
    const requestedType = String(widget?.type || "text").toLowerCase();
    const entityType = String(entity?.entity_type || "").toLowerCase();
    const type = requestedType === "entity" && ["cover", "light", "climate", "select"].includes(entityType) ? entityType : requestedType;
    const label = String(widget?.text || nameOf(entity?.name, ""));
    const style = `grid-column:${placement.x + 1}/span ${placement.width};grid-row:${placement.y + 1}/span ${placement.height}`;
    let body = "";
    if (type === "icon") {
      body = `<span class="ucvr-sim-widget__icon">${iconMarkup({ icon: widget.icon, entity_type: "button" })}</span>`;
    } else if (type === "sensor") {
      const showLabel = widget?.sensor?.show_label !== false;
      body = `${showLabel ? `<span class="ucvr-sim-widget__label">${escapeHtml(label || nameOf(entity?.name, "Sensor"))}</span>` : ""}<strong>${escapeHtml(sensorValue(widget, entity))}</strong>`;
    } else if (type === "select") {
      const showName = widget?.select?.show_name !== false;
      const selected = String(entityAttribute(entity, "current_option", "selected", "value", "state") || "");
      const candidates = entity?.attributes?.options || entity?.attributes?.available_options || entity?.options?.options || entity?.options?.items || [];
      const options = [...new Set([selected, ...(Array.isArray(candidates) ? candidates : [])].filter((value) => value !== undefined && value !== null && String(value).length).map(String))];
      body = `${showName ? `<span class="ucvr-sim-widget__label">${escapeHtml(label || nameOf(entity?.name, "Select"))}</span>` : ""}<select class="ucvr-sim-native-select" data-sim-select data-select-entity="${escapeHtml(entity?.entity_id || widget?.select?.select_id || widget?.entity_id || "")}">${options.map((option) => `<option value="${escapeHtml(option)}"${option === selected ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
    } else if (type === "media_player") {
      body = mediaPlayerMarkup(entity, label);
    } else if (["cover", "light", "climate"].includes(type)) {
      body = compactEntityWidgetMarkup(type, entity, label);
    } else if (type === "numpad") {
      body = numpadMarkup(widget);
    } else {
      body = `<span class="ucvr-sim-widget__text">${escapeHtml(label)}</span>`;
    }

    let command = widget?.command;
    if (type === "media_player" && widget?.media_player_id) {
      command = { entity_id: widget.media_player_id, cmd_id: "media_player.play_pause", params: {} };
    }
    const actionable = Boolean(command?.cmd_id && command?.entity_id);
    const tag = ["numpad", "select", "cover", "light", "climate"].includes(type) ? "div" : "button";
    const accessibleLabel = label || (type === "icon" ? "Command" : "");
    return `<${tag}${tag === "button" ? ' type="button"' : ""}${accessibleLabel ? ` title="${escapeHtml(accessibleLabel)}" aria-label="${escapeHtml(accessibleLabel)}"` : ""} class="ucvr-sim-activity-widget ucvr-sim-activity-widget--${escapeHtml(type)}${actionable ? " is-actionable" : ""}" style="${style}" data-activity-widget="${index}"${actionable ? ` data-command-entity="${escapeHtml(command.entity_id)}" data-command-id="${escapeHtml(command.cmd_id)}" data-command-params="${escapeHtml(JSON.stringify(command.params || {}))}"` : ""}>${body}</${tag}>`;
  }

  function overlayMarkup() {
    const owner = overlayOwner();
    if (!state.activityOverlayOpen || !owner) return "";
    const overlays = overlayScreens();
    if (!overlays.length) return "";
    const screen = overlays[state.activityOverlayIndex] || overlays[0];
    const page = screen.page || {};
    const grid = page.grid || {};
    const width = Math.max(1, Math.floor(finiteNumber(grid.width, 4)));
    const height = Math.max(1, Math.floor(finiteNumber(grid.height, 6)));
    const widgets = Array.isArray(page.items) && page.items.length ? page.items : (Array.isArray(page.gridCommands) ? page.gridCommands : []);
    const pageMarkup = widgets.length
      ? `<div class="ucvr-sim-activity-grid" style="--ucvr-grid-width:${width};--ucvr-grid-height:${height}">${widgets.map((widget, index) => activityWidgetMarkup(widget, index, width, height)).join("")}</div>`
      : '<div class="ucvr-sim-activity-empty"><strong>Empty page</strong><span>You can add UI elements via the Web Configurator</span></div>';
    const dots = overlays.length > 1
      ? `<div class="ucvr-sim-page-dots ucvr-sim-overlay-dots">${overlays.map((candidate, index) => `<button type="button" data-overlay-index="${index}" class="${index === state.activityOverlayIndex ? "is-active" : ""}" title="${escapeHtml(candidate.title)}" aria-label="Open ${escapeHtml(candidate.title)}"></button>`).join("")}</div>`
      : "";
    const ownerTitle = owner.title || nameOf(owner.name || owner.display_name, "Remote");
    const ownerType = String(owner.entity_type || owner.type || "activity").toLowerCase();
    const ownerLabel = ownerType === "activity" ? "activity" : ownerType === "remote" ? "remote" : "entity";
    const animationClass = state.activityOverlayClosing ? " is-closing" : state.activityOverlayOpening ? " is-opening" : "";
    return `<section class="ucvr-sim-activity-overlay${animationClass}" data-activity-overlay aria-label="${escapeHtml(ownerTitle)} ${escapeHtml(ownerLabel)}">
      <button type="button" class="ucvr-sim-overlay-close" title="Close ${escapeHtml(ownerLabel)} view" aria-label="Close ${escapeHtml(ownerLabel)} view"><i class="fa-light fa-xmark"></i></button>
      <header class="ucvr-sim-activity-titlebar">
        <span class="ucvr-sim-activity-titlebar__icon">${iconMarkup(owner)}</span>
        <span class="ucvr-sim-activity-titlebar__text"><strong>${escapeHtml(ownerTitle)}</strong><small>${escapeHtml(screen.title || nameOf(ownerLabel, "Page"))}</small></span>
      </header>
      <div class="ucvr-sim-activity-pages"><div class="ucvr-sim-activity-page">${pageMarkup}</div></div>${dots}
    </section>`;
  }

  function entityControlMarkup() {
    const entity = state.controlEntity;
    if (!state.entityControlOpen || !entity) return "";
    const entityId = idOf(entity);
    const type = String(entity.entity_type || entity.type || "").toLowerCase();
    const title = nameOf(entity.name || entity.display_name, entityId || "Entity");
    let body = "";

    if (type === "media_player") {
      const media = mediaPlayerData(entity, title);
      const { playing, position, duration } = mediaPlayerProgress(entity);
      const remaining = duration > 0 ? Math.max(0, duration - position) : 0;
      const progress = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0;
      body = `<div class="ucvr-remoteui-media${media.artwork ? " has-artwork" : ""}"${media.artwork ? ` style="--ucvr-media-art:url('${escapeHtml(media.artwork).replaceAll("'", "%27")}')"` : ""}>
        <div class="ucvr-remoteui-media__backdrop"></div>
        <div class="ucvr-remoteui-media__artwork">${media.artwork ? `<img src="${escapeHtml(media.artwork)}" alt="${escapeHtml(media.title)} artwork">` : '<i class="fa-light fa-music"></i>'}</div>
        <div class="ucvr-remoteui-media__copy"><strong><span class="ucvr-sim-marquee__content">${escapeHtml(media.title)}</span></strong><span><span class="ucvr-sim-marquee__content">${escapeHtml(media.artist || media.album || "—")}</span></span></div>
        <span class="ucvr-sim-media__progress-block ucvr-remoteui-media__progress" data-media-progress data-media-entity="${escapeHtml(entityId)}" data-position="${position}" data-duration="${duration}" data-playing="${playing ? "true" : "false"}" data-rendered-at="${Date.now()}">
          <span class="ucvr-sim-media__progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><span style="width:${progress}%"></span></span>
          <span class="ucvr-sim-media__times"><span data-media-current>${escapeHtml(formatMediaTime(position))}</span><span data-media-remaining>-${escapeHtml(formatMediaTime(remaining))}</span></span>
        </span>
        <div class="ucvr-remoteui-media__transport">${commandButton(entityId, "media_player.previous", "Previous", "fa-backward-step")}${commandButton(entityId, "media_player.play_pause", playing ? "Pause" : "Play", playing ? "fa-pause" : "fa-play", {}, "ucvr-sim-control-button--primary")}${commandButton(entityId, "media_player.next", "Next", "fa-forward-step")}</div>
        ${media.sources.length ? `<label class="ucvr-remoteui-select"><span>Source</span><select data-control-select data-control-entity="${escapeHtml(entityId)}" data-control-command="media_player.select_source" data-control-param="source">${media.sources.map((source) => `<option value="${escapeHtml(source)}"${source === media.source ? " selected" : ""}>${escapeHtml(source)}</option>`).join("")}</select></label>` : ""}
      </div>`;
    } else if (type === "light") {
      const brightness = normalizedBrightness(entity);
      const isOn = entityIsActive(entity);
      const temperature = lightTemperatureData(entity);
      const features = ["power"];
      if (supportsLightControl(entity, "brightness") || supportsLightControl(entity, "temperature")) features.push("brightness");
      if (supportsLightControl(entity, "color")) features.push("color");
      state.controlFeatureIndex = Math.max(0, Math.min(state.controlFeatureIndex, features.length - 1));
      const feature = features[state.controlFeatureIndex];
      let featureBody = "";
      if (feature === "power") {
        featureBody = `<div class="ucvr-remoteui-power"><strong>${isOn ? "On" : "Off"}</strong><button type="button" class="ucvr-remoteui-square-control${isOn ? " is-active" : ""}" data-command-entity="${escapeHtml(entityId)}" data-command-id="${isOn ? "light.off" : "light.on"}" data-command-params="{}" aria-label="Turn ${isOn ? "off" : "on"}"><span></span></button></div>`;
      } else if (feature === "brightness") {
        const temperatureControl = supportsLightControl(entity, "temperature") ? `<label class="ucvr-remoteui-vertical-slider is-temperature"><span>${temperature.value} K</span><input type="range" min="${temperature.min}" max="${temperature.max}" step="50" value="${temperature.value}" data-control-range data-control-entity="${escapeHtml(entityId)}" data-control-command="light.color_temperature" data-control-param="temperature" data-control-suffix=" K"><output>${temperature.value} K</output></label>` : "";
        featureBody = `<div class="ucvr-remoteui-light-level"><strong>${brightness}%</strong><div class="ucvr-remoteui-light-level__sliders"><label class="ucvr-remoteui-vertical-slider is-brightness"><span>Brightness</span><input type="range" min="0" max="100" step="1" value="${brightness}" data-control-range data-control-entity="${escapeHtml(entityId)}" data-control-command="light.brightness" data-control-param="brightness" data-control-suffix="%"><output>${brightness}%</output></label>${temperatureControl}</div></div>`;
      } else {
        const color = lightColorHex(entity);
        featureBody = `<div class="ucvr-remoteui-color"><strong>Color</strong><label class="ucvr-remoteui-color-wheel" style="--ucvr-current-color:${escapeHtml(color)}"><input type="color" value="${escapeHtml(color)}" data-control-color data-control-entity="${escapeHtml(entityId)}" aria-label="Choose color"><span></span></label><label class="ucvr-remoteui-horizontal-slider"><span>${brightness}%</span><input type="range" min="0" max="100" step="1" value="${brightness}" data-control-range data-control-entity="${escapeHtml(entityId)}" data-control-command="light.brightness" data-control-param="brightness" data-control-suffix="%"><output>${brightness}%</output></label></div>`;
      }
      body = `<div class="ucvr-remoteui-light">${featureBody}${features.length > 1 ? `<div class="ucvr-remoteui-pages">${features.map((name, index) => `<button type="button" class="${index === state.controlFeatureIndex ? "is-active" : ""}" data-control-feature-index="${index}" aria-label="${escapeHtml(name)} controls"></button>`).join("")}</div>` : ""}</div>`;
    } else if (type === "cover") {
      const position = normalizedCoverPosition(entity);
      const currentState = stateOf(entity) || (position ? "open" : "closed");
      body = `<div class="ucvr-remoteui-cover"><strong class="ucvr-remoteui-cover__state">${escapeHtml(currentState)}</strong><div class="ucvr-remoteui-cover__blind"><span class="ucvr-remoteui-cover__fill" style="height:${100-position}%"></span><i class="fa-light fa-grip-lines"></i><label><input type="range" min="0" max="100" step="1" value="${position}" data-control-range data-control-entity="${escapeHtml(entityId)}" data-control-command="cover.position" data-control-param="position" data-control-suffix="%" aria-label="Position"><output>${position}%</output></label></div><div class="ucvr-remoteui-cover__actions"><button type="button" data-command-entity="${escapeHtml(entityId)}" data-command-id="cover.close" data-command-params="{}"><i class="fa-light fa-arrow-down"></i><span>Close</span></button><button type="button" class="is-secondary" data-command-entity="${escapeHtml(entityId)}" data-command-id="cover.stop" data-command-params="{}"><i class="fa-light fa-stop"></i><span>Stop</span></button><button type="button" data-command-entity="${escapeHtml(entityId)}" data-command-id="cover.open" data-command-params="{}"><i class="fa-light fa-arrow-up"></i><span>Open</span></button></div></div>`;
    } else if (type === "climate") {
      const climate = climateData(entity);
      const target = finiteNumber(climate.target, 20);
      const previous = target - climate.step;
      const next = target + climate.step;
      const isOn = entityIsActive(entity);
      body = `<div class="ucvr-remoteui-climate"><button type="button" class="ucvr-remoteui-climate__step is-plus" data-command-entity="${escapeHtml(entityId)}" data-command-id="climate.set_temperature" data-command-params='${escapeHtml(JSON.stringify({temperature: next}))}' aria-label="Raise target"><i class="fa-light fa-plus"></i></button><div class="ucvr-remoteui-climate__tumbler"><span>${escapeHtml(`${previous}${climate.unit}`)}</span><strong>${escapeHtml(`${target}${climate.unit}`)}</strong><span>${escapeHtml(`${next}${climate.unit}`)}</span></div><button type="button" class="ucvr-remoteui-climate__step is-minus" data-command-entity="${escapeHtml(entityId)}" data-command-id="climate.set_temperature" data-command-params='${escapeHtml(JSON.stringify({temperature: previous}))}' aria-label="Lower target"><i class="fa-light fa-minus"></i></button><div class="ucvr-remoteui-climate__footer"><span><small>Current</small><strong>${escapeHtml(climate.current === "" ? "—" : `${climate.current}${climate.unit}`)}</strong></span>${climate.modes.length ? `<label class="ucvr-remoteui-select"><span>Mode</span><select data-control-select data-control-entity="${escapeHtml(entityId)}" data-control-command="climate.set_mode" data-control-param="mode">${normalizedOptions([climate.mode, ...climate.modes]).map((mode) => `<option value="${escapeHtml(mode)}"${mode === climate.mode ? " selected" : ""}>${escapeHtml(mode)}</option>`).join("")}</select></label>` : ""}<button type="button" class="ucvr-remoteui-round-power${isOn ? " is-active" : ""}" data-command-entity="${escapeHtml(entityId)}" data-command-id="${isOn ? "climate.off" : "climate.on"}" data-command-params="{}" aria-label="Turn ${isOn ? "off" : "on"}"><i class="fa-light fa-power-off"></i></button></div></div>`;
    } else if (type === "switch") {
      const isOn = entityIsActive(entity);
      body = `<div class="ucvr-remoteui-power"><strong>${isOn ? "On" : "Off"}</strong><button type="button" class="ucvr-remoteui-square-control${isOn ? " is-active" : ""}" data-command-entity="${escapeHtml(entityId)}" data-command-id="switch.toggle" data-command-params="{}" aria-label="Toggle switch"><span></span></button></div>`;
    } else if (type === "button") {
      body = `<div class="ucvr-remoteui-button"><button type="button" class="ucvr-remoteui-square-control is-momentary" data-command-entity="${escapeHtml(entityId)}" data-command-id="button.push" data-command-params="{}" aria-label="Push button"><span></span></button></div>`;
    } else if (type === "select") {
      const selected = String(entityAttribute(entity, "current_option", "selected", "value", "state") || "");
      const options = normalizedOptions([selected, ...(entity?.attributes?.options || entity?.attributes?.available_options || entity?.options?.options || entity?.options?.items || [])]);
      body = `<div class="ucvr-sim-entity-control__hero"><i class="fa-light fa-list-dropdown"></i><strong>${escapeHtml(selected || "—")}</strong><span>Selected option</span></div>${options.length ? `<label class="ucvr-remoteui-select"><span>Option</span><select data-control-select data-control-entity="${escapeHtml(entityId)}" data-control-command="select.select_option" data-control-param="option">${options.map((option) => `<option value="${escapeHtml(option)}"${option === selected ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>` : '<p class="ucvr-sim-control-empty">No options are available.</p>'}`;
    }
    const typeLabel = type.replaceAll("_", " ");
    const animationClass = state.entityControlClosing ? " is-closing" : state.entityControlOpening ? " is-opening" : "";
    return `<section class="ucvr-sim-activity-overlay ucvr-sim-entity-control ucvr-remoteui-detail ucvr-remoteui-detail--${escapeHtml(type)}${animationClass}" data-entity-control aria-label="${escapeHtml(title)} controls"><button type="button" class="ucvr-sim-overlay-close" data-control-close title="Close controls" aria-label="Close controls"><i class="fa-light fa-xmark"></i></button><header class="ucvr-sim-activity-titlebar"><span class="ucvr-sim-activity-titlebar__icon">${iconMarkup(entity)}</span><span class="ucvr-sim-activity-titlebar__text"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(typeLabel)}</small></span></header><div class="ucvr-sim-entity-control__body${type === "media_player" ? " ucvr-sim-entity-control__body--media" : ""}">${body}</div></section>`;
  }

  function profileSelectorMarkup() {
    if (!state.profileSelectorOpen) return "";
    const rows = state.profiles.map((profile, index) => {
      const active = idOf(profile) === idOf(state.profile);
      const selected = index === state.profileSelectorIndex;
      const name = nameOf(profile.name, `Profile ${index + 1}`);
      return `<button type="button" class="ucvr-sim-profile-item${active ? " is-active" : ""}${selected ? " is-selected" : ""}" data-profile-index="${index}" data-profile-id="${escapeHtml(idOf(profile))}">
        <span class="ucvr-sim-profile-item__icon">${iconMarkup(profile)}</span>
        <span class="ucvr-sim-profile-item__name">${escapeHtml(name)}</span>
        ${active ? '<i class="fa-light fa-check" aria-label="Active"></i>' : ""}
      </button>`;
    }).join("");
    return `<section class="ucvr-sim-profile-selector" aria-label="Profiles">
      <header class="ucvr-sim-profile-selector__header"><button type="button" data-profile-close aria-label="Close profiles"><i class="fa-light fa-arrow-left"></i></button><strong>Profiles</strong></header>
      <div class="ucvr-sim-profile-selector__list">${rows || '<p>No profiles available.</p>'}</div>
    </section>`;
  }

  function bindScreenEvents() {
    for (const image of display.querySelectorAll("img")) {
      bindOnce(image, "error", () => image.addEventListener("error", () => {
        image.closest(".selected-icon")?.remove();
        if (image.closest(".remote-controller__display__header")) image.style.display = "none";
      }, { once: true }));
    }
    for (const element of display.querySelectorAll("[data-item-index]")) {
      bindOnce(element, "activate-item", () => element.addEventListener("click", async (event) => {
        if (event.target.closest("[data-card-quick],[data-group-toggle]")) return;
        const overlay = element.dataset.itemScope === "overlay";
        if (overlay) state.activityOverlaySelectedIndex = Number(element.dataset.itemIndex || 0);
        else state.selectedIndex = Number(element.dataset.itemIndex || 0);
        renderScreen();
        await activateCurrentItem();
      }));
    }
    for (const quick of display.querySelectorAll("[data-card-quick]")) {
      bindOnce(quick, "card-quick", () => quick.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const entity = state.entities.get(String(quick.dataset.cardQuick || ""));
        if (entity) await triggerEntity(entity);
      }));
    }
    for (const toggle of display.querySelectorAll("[data-group-toggle]")) {
      bindOnce(toggle, "group-toggle", () => toggle.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await setGroupPower(toggle.dataset.groupToggle, toggle.dataset.groupTarget === "on");
      }));
    }
    for (const feature of display.querySelectorAll("[data-control-feature-index]")) {
      bindOnce(feature, "control-feature", () => feature.addEventListener("click", () => {
        state.controlFeatureIndex = Number(feature.dataset.controlFeatureIndex || 0);
        renderScreen();
      }));
    }
    for (const dot of display.querySelectorAll("[data-screen-index]")) {
      bindOnce(dot, "screen-index", () => dot.addEventListener("click", () => {
        state.screenIndex = Number(dot.dataset.screenIndex || 0);
        state.selectedIndex = 0;
        renderScreen();
      }));
    }
    for (const dot of display.querySelectorAll("[data-overlay-index]")) {
      bindOnce(dot, "overlay-index", () => dot.addEventListener("click", () => {
        state.activityOverlayIndex = Number(dot.dataset.overlayIndex || 0);
        state.activityOverlaySelectedIndex = 0;
        renderScreen();
      }));
    }
    for (const widget of display.querySelectorAll("[data-command-id][data-command-entity]")) {
      bindOnce(widget, "entity-command", () => widget.addEventListener("click", async () => {
        let params = {};
        try { params = JSON.parse(widget.dataset.commandParams || "{}"); } catch {}
        try {
          await sendEntityCommand(widget.dataset.commandEntity, widget.dataset.commandId, params);
          toast(widget.dataset.commandId);
          await refreshAfterCommand();
        } catch (error) { toast(error.message, true); }
      }));
    }
    for (const select of display.querySelectorAll("[data-sim-select]")) {
      bindOnce(select, "select-interaction", () => {
        const beginInteraction = () => { state.selectInteraction = true; };
        const finishInteraction = ({ refreshPending = true } = {}) => {
          const pending = state.deferredRefresh;
          state.selectInteraction = false;
          state.deferredRefresh = false;
          if (refreshPending && pending) {
            state.lastRefresh = 0;
            setTimeout(() => refresh(true), 0);
          }
        };
        select.addEventListener("pointerdown", beginInteraction);
        select.addEventListener("focus", beginInteraction);
        select.addEventListener("keydown", beginInteraction);
        select.addEventListener("blur", () => finishInteraction());
        select.addEventListener("change", async () => {
          if (!select.dataset.selectEntity) {
            finishInteraction();
            return;
          }
          finishInteraction({ refreshPending: false });
          try {
            await sendEntityCommand(select.dataset.selectEntity, "select.select_option", { option: select.value });
            await refreshAfterCommand();
          } catch (error) { toast(error.message, true); }
        });
      });
    }
    const closeControl = display.querySelector("[data-control-close]");
    bindOnce(closeControl, "close-control", () => closeControl.addEventListener("click", closeEntityControl));
    for (const range of display.querySelectorAll("[data-control-range]")) {
      bindOnce(range, "control-range", () => {
        const output = range.closest("label")?.querySelector("output");
        const updateOutput = () => { if (output) output.textContent = `${range.value}${range.dataset.controlSuffix || ""}`; };
        range.addEventListener("input", updateOutput);
        range.addEventListener("change", async () => {
          updateOutput();
          try {
            await sendEntityCommand(range.dataset.controlEntity, range.dataset.controlCommand, { [range.dataset.controlParam]: Number(range.value) });
            await refreshAfterCommand();
          } catch (error) { toast(error.message, true); }
        });
      });
    }
    for (const color of display.querySelectorAll("[data-control-color]")) {
      bindOnce(color, "control-color", () => color.addEventListener("change", async () => {
        try {
          await sendEntityCommand(color.dataset.controlEntity, "light.color", hexToHs(color.value));
          await refreshAfterCommand();
        } catch (error) { toast(error.message, true); }
      }));
    }
    for (const select of display.querySelectorAll("[data-control-select]")) {
      bindOnce(select, "control-select", () => select.addEventListener("change", async () => {
        try {
          await sendEntityCommand(select.dataset.controlEntity, select.dataset.controlCommand, { [select.dataset.controlParam]: select.value });
          await refreshAfterCommand();
        } catch (error) { toast(error.message, true); }
      }));
    }
    const closeOverlay = display.querySelector(".ucvr-sim-overlay-close");
    bindOnce(closeOverlay, "close-overlay", () => closeOverlay.addEventListener("click", closeActivityOverlay));
    const profileTrigger = display.querySelector(":scope > .remote-controller__display__nav .remote-nav__profile");
    bindOnce(profileTrigger, "open-profiles", () => profileTrigger.addEventListener("click", openProfileSelector));
    const closeProfiles = display.querySelector("[data-profile-close]");
    bindOnce(closeProfiles, "close-profiles", () => closeProfiles.addEventListener("click", closeProfileSelector));
    for (const profileButton of display.querySelectorAll("[data-profile-index]")) {
      bindOnce(profileButton, "activate-profile", () => profileButton.addEventListener("click", async () => {
        state.profileSelectorIndex = Number(profileButton.dataset.profileIndex || 0);
        await activateProfile(state.profiles[state.profileSelectorIndex]);
      }));
    }
  }

  function updateTransientContent() {
    state.transientRefreshPending = false;
    const battery = Math.max(0, Math.min(100, Number(state.settings.battery_level ?? 82)));
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const profileName = nameOf(state.profile?.name, "U");
    const nav = display.querySelector(":scope > .remote-controller__display__nav");
    const batteryElement = nav?.querySelector(".remote-nav__battery");
    const clockElement = nav?.querySelector(".remote-nav__clock .time");
    const profileElement = nav?.querySelector(".remote-nav__profile");
    if (batteryElement) batteryElement.style.width = `${battery}%`;
    if (clockElement) clockElement.textContent = time;
    if (profileElement) profileElement.textContent = profileName.slice(0, 1).toUpperCase();

    const marqueeState = captureMediaMarquees();
    if (state.activityOverlayOpen && overlayOwner()) {
      const template = document.createElement("template");
      template.innerHTML = overlayMarkup().trim();
      const fresh = template.content.firstElementChild;
      const current = display.querySelector("[data-activity-overlay]");
      if (fresh && current) {
        const freshTitlebar = fresh.querySelector(".ucvr-sim-activity-titlebar");
        const currentTitlebar = current.querySelector(".ucvr-sim-activity-titlebar");
        const freshPages = fresh.querySelector(".ucvr-sim-activity-pages");
        const currentPages = current.querySelector(".ucvr-sim-activity-pages");
        if (freshTitlebar && currentTitlebar) currentTitlebar.innerHTML = freshTitlebar.innerHTML;
        if (freshPages && currentPages && !state.selectInteraction && freshPages.innerHTML !== currentPages.innerHTML) currentPages.innerHTML = freshPages.innerHTML;
        const freshDots = fresh.querySelector(".ucvr-sim-overlay-dots");
        const currentDots = current.querySelector(".ucvr-sim-overlay-dots");
        if (freshDots && currentDots) currentDots.innerHTML = freshDots.innerHTML;
        else if (freshDots && !currentDots) current.appendChild(freshDots.cloneNode(true));
        else if (!freshDots && currentDots) currentDots.remove();
      }
    }

    if (state.entityControlOpen) {
      const template = document.createElement("template");
      template.innerHTML = entityControlMarkup().trim();
      const freshControl = template.content.firstElementChild;
      const currentControl = display.querySelector("[data-entity-control]");
      if (freshControl && currentControl && freshControl.innerHTML !== currentControl.innerHTML) currentControl.replaceWith(freshControl);
      else if (freshControl && !currentControl) display.appendChild(freshControl);
    }

    if (state.profileSelectorOpen) {
      const currentSelector = display.querySelector(".ucvr-sim-profile-selector");
      const currentList = currentSelector?.querySelector(".ucvr-sim-profile-selector__list");
      const previousProfileScroll = currentList?.scrollTop || 0;
      const template = document.createElement("template");
      template.innerHTML = profileSelectorMarkup().trim();
      const freshSelector = template.content.firstElementChild;
      const freshList = freshSelector?.querySelector(".ucvr-sim-profile-selector__list");
      if (currentList && freshList && currentList.innerHTML !== freshList.innerHTML) {
        currentList.innerHTML = freshList.innerHTML;
        currentList.scrollTop = previousProfileScroll;
      }
      for (const button of display.querySelectorAll("[data-profile-index]")) {
        const index = Number(button.dataset.profileIndex || 0);
        const profile = state.profiles[index];
        button.classList.toggle("is-active", idOf(profile) === idOf(state.profile));
        button.classList.toggle("is-selected", index === state.profileSelectorIndex);
      }
    }

    renderMappingPanel();
    bindScreenEvents();
    prepareMediaMarquees(marqueeState);
    syncMediaProgressFromState();
    updateMediaProgressRealtime();
  }

  function renderScreen() {
    if (!display) return;
    const previousScrollTop = display.querySelector(".remote-controller__display__list")?.scrollTop || 0;
    const marqueeState = captureMediaMarquees();
    if (state.selectInteraction) {
      state.deferredRefresh = true;
      return;
    }
    rebuildScreens();
    display.classList.toggle("ucvr-sim-display--activity", Boolean(state.activityOverlayOpen));
    const screen = state.screens[state.screenIndex] || { title: nameOf(state.profile?.name, "Remote"), image: "", kind: "empty", page: { items: [] } };
    const items = screenItems(screen);
    state.selectedIndex = Math.max(0, Math.min(state.selectedIndex, Math.max(0, items.length - 1)));
    const profileName = nameOf(state.profile?.name, "U");
    host.style.setProperty("--uc-theme-accent", String(state.settings.accent || "#769990"));
    const battery = Math.max(0, Math.min(100, Number(state.settings.battery_level ?? 82)));
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const itemMarkup = items.length
      ? items.map((item, index) => renderItem(item, index, state.selectedIndex, "base")).join("")
      : '<p class="remote-controller__display__no-items">You don’t have any items yet.</p>';
    const dots = state.screens.length > 1
      ? `<div class="ucvr-sim-page-dots">${state.screens.map((page, index) => `<button type="button" data-screen-index="${index}" class="${index === state.screenIndex ? "is-active" : ""}" title="${escapeHtml(page.title)}" aria-label="Open ${escapeHtml(page.title)}"></button>`).join("")}</div>`
      : "";

    display.innerHTML = `
      <div class="remote-nav remote-controller__display__nav">
        <span class="remote-nav__page-name">${escapeHtml(screen.title)}</span>
        <div class="remote-nav__info">
          <span class="remote-nav__battery" style="width:${battery}%;"></span>
          <div class="remote-nav__clock"><div class="time">${escapeHtml(time)}</div></div>
          <button type="button" class="remote-nav__profile" title="Switch profile">${escapeHtml(profileName.slice(0, 1).toUpperCase())}</button>
        </div>
      </div>
      <div class="remote-controller__display__header">
        <div class="remote-controller__display__header__body"><div><div class="vue-load-image"><img src="${escapeHtml(backgroundUrl(screen))}" role="presentation" alt=""></div></div><span class="remote-controller__display__header__title">${escapeHtml(screen.title)}</span></div>
      </div>
      <div class="remote-controller__display__list">${itemMarkup}</div>
      ${dots}${overlayMarkup()}${profileSelectorMarkup()}${entityControlMarkup()}`;

    bindScreenEvents();
    renderMappingPanel();
    prepareMediaMarquees(marqueeState);
    syncMediaProgressFromState();
    updateMediaProgressRealtime();
    requestAnimationFrame(() => {
      const list = display.querySelector(".remote-controller__display__list");
      if (list && previousScrollTop > 0) list.scrollTop = previousScrollTop;
      else display.querySelector(".ucvr-sim-entity-item--selected,.ucvr-sim-profile-item.is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  async function cycleProfile() {
    if (state.busy || state.profiles.length < 2) return;
    const currentIndex = Math.max(0, state.profiles.findIndex((profile) => idOf(profile) === idOf(state.profile)));
    const next = state.profiles[(currentIndex + 1) % state.profiles.length];
    state.busy = true;
    setBusy(true);
    try {
      await setActiveProfile(idOf(next));
      state.screenIndex = 0;
      state.selectedIndex = 0;
      state.lastRefresh = 0;
      await refresh(true);
    } catch (error) {
      toast(error.message, true);
    } finally {
      state.busy = false;
      setBusy(false);
    }
  }

  const host = document.createElement("div");
  host.id = "ucvr-simulator-host";
  host.className = "page-devices ucvr-sim-page";
  host.hidden = true;
  host.innerHTML = `
    <div class="page-devices__tools ucvr-sim-page__tools">
      <div class="ucvr-sim-page__heading">
        <h1>Remote 3</h1>
        <button type="button" class="button button--secondary button--icon button--icon--small ucvr-sim-update-toggle" data-simulator-update-toggle title="Pause visualizer updates" aria-label="Pause visualizer updates" aria-pressed="false">
          <i class="fa-light fa-pause" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div class="page-devices__body ucvr-sim-page__body" aria-label="Simulated Remote 3">
      <div class="ucvr-sim-stage">
        <div class="ucvr-sim-remote-zone">
          <div class="ucvr-sim-remote-wrap">
            <div class="remote-controller remote-controller--v3 ucvr-sim-device">
              <div class="remote-controller__device">
                <div class="remote-controller__display"></div>
                <div class="remote-button-layout" aria-label="Remote 3 hardware buttons">
                  ${HARDWARE_BUTTONS.map(([id, label, css]) => `<button type="button" class="remote-button-layout__item remote-button-layout__item--${css}" data-hardware-button="${id}" title="${label}" aria-label="${label}"><span class="remote-button-layout__item__label">${label}</span></button>`).join("")}
                  <button type="button" class="remote-button-layout__item remote-button-layout__item--touch-slider" data-touch-slider title="Touch slider" aria-label="Touch slider"><span class="remote-button-layout__item__label">Touch slider</span></button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="button-list ucvr-sim-mapping-panel" aria-label="Current activity button mappings">
          <div class="button-list__body v-overflow-indicator--on-top v-overflow-indicator v-overflow-indicator--scrollable ucvr-sim-mapping-body"></div>
        </div>
      </div>
      <div class="ucvr-sim-toast" role="status" aria-live="polite"></div>
    </div>`;

  const app = document.querySelector("#app");
  function simulatorMountPoint() {
    let mountPoint = document.querySelector("#ucvr-simulator-host-slot");
    if (!mountPoint && app) {
      mountPoint = document.createElement("div");
      mountPoint.id = "ucvr-simulator-host-slot";
      mountPoint.className = "ucvr-simulator-host-slot";
      mountPoint.setAttribute("aria-label", "Remote Simulator");
      app.appendChild(mountPoint);
    }
    return mountPoint || app || document.body;
  }
  function attachSimulatorHost() {
    const mountPoint = simulatorMountPoint();
    if (host.parentElement !== mountPoint) mountPoint.appendChild(host);
    return mountPoint;
  }
  attachSimulatorHost();

  const stage = host.querySelector(".ucvr-sim-stage");
  const remoteZone = host.querySelector(".ucvr-sim-remote-zone");
  const remoteWrap = host.querySelector(".ucvr-sim-remote-wrap");
  const remoteDevice = host.querySelector(".ucvr-sim-device");
  const display = host.querySelector(".remote-controller__display");
  const toastElement = host.querySelector(".ucvr-sim-toast");
  const touchSlider = host.querySelector("[data-touch-slider]");
  const mappingPanel = host.querySelector(".ucvr-sim-mapping-panel");
  const mappingPanelBody = host.querySelector(".ucvr-sim-mapping-body");
  const updateToggle = host.querySelector("[data-simulator-update-toggle]");

  function normalizedButtonBacklight() {
    const button = state.settings?.button && typeof state.settings.button === "object" ? state.settings.button : {};
    const rawRgb = Array.isArray(button.static_color?.rgb) ? button.static_color.rgb : [255, 255, 255];
    const rgb = [0, 1, 2].map((index) => Math.max(0, Math.min(255, Math.round(Number(rawRgb[index]) || 0))));
    const brightness = Math.max(0, Math.min(100, Number(button.brightness ?? 70)));
    return { rgb, opacity: brightness / 100 };
  }

  function applyButtonBacklight() {
    const { rgb, opacity } = normalizedButtonBacklight();
    remoteDevice.style.setProperty("--ucvr-button-backlight-rgb", rgb.join(" "));
    remoteDevice.style.setProperty("--ucvr-button-backlight-opacity", opacity.toFixed(3));
  }

  function applyDisplayBrightness() {
    const displaySettings = state.settings?.display && typeof state.settings.display === "object"
      ? state.settings.display
      : {};
    const brightness = Math.max(0, Math.min(100, Number(displaySettings.brightness ?? 70)));
    remoteDevice.style.setProperty("--ucvr-display-brightness", (brightness / 100).toFixed(3));
  }

  function applyLighting() {
    applyButtonBacklight();
    applyDisplayBrightness();
  }
  applyLighting();

  function syncUpdateToggle() {
    if (!updateToggle) return;
    const paused = Boolean(state.updatesPaused);
    updateToggle.classList.toggle("is-paused", paused);
    updateToggle.setAttribute("aria-pressed", String(paused));
    updateToggle.title = paused ? "Resume visualizer updates" : "Pause visualizer updates";
    updateToggle.setAttribute("aria-label", updateToggle.title);
    const icon = updateToggle.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-pause", !paused);
      icon.classList.toggle("fa-play", paused);
    }
  }

  updateToggle?.addEventListener("click", () => {
    state.updatesPaused = !state.updatesPaused;
    syncUpdateToggle();
    if (!state.updatesPaused) {
      const shouldRefresh = state.pausedRefreshPending || state.open;
      state.pausedRefreshPending = false;
      if (shouldRefresh) {
        state.lastRefresh = 0;
        refresh(true);
      }
    }
  });
  syncUpdateToggle();

  function locationShowsSimulator() {
    const route = String(location.hash || "").replace(/^#/, "").split("?")[0].replace(/\/+$/, "");
    return route === "/remote-simulator";
  }

  function applyIntegratedPageVisibility() {
    const mountPoint = attachSimulatorHost();
    mountPoint.hidden = !state.open;
    host.hidden = !state.open;
    document.body.classList.toggle("ucvr-sim-page-active", state.open);
  }

  function updateSimulatorLayout() {
    if (!state.open || host.hidden) return;
    attachSimulatorHost();

    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const naturalWidth = 22.25 * rootFontSize;
    const naturalHeight = 97.047 * rootFontSize;
    const availableWidth = Math.max(140, (remoteZone?.clientWidth || stage.clientWidth) - rootFontSize * 2);
    const availableHeight = Math.max(240, (remoteZone?.clientHeight || stage.clientHeight) - rootFontSize * 2);
    const scale = Math.max(0.16, Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight));
    remoteDevice.style.setProperty("--ucvr-sim-scale", scale.toFixed(4));
    remoteWrap.style.width = `${Math.ceil(naturalWidth * scale)}px`;
    remoteWrap.style.height = `${Math.ceil(naturalHeight * scale)}px`;
    if (mappingPanel) mappingPanel.style.maxHeight = `${Math.max(240, stage.clientHeight - rootFontSize * 2)}px`;
  }

  function syncPageState(forceRefresh = false) {
    const nextOpen = locationShowsSimulator() && !document.querySelector(".page-login");
    const entering = nextOpen && !state.open;
    const changed = nextOpen !== state.open;
    state.open = nextOpen;
    applyIntegratedPageVisibility();
    updateSimulatorLayout();
    if (state.open && (forceRefresh || changed || !state.lastRefresh)) {
      state.lastRefresh = 0;
      refresh(true, entering || forceRefresh);
    }
  }

  function setBusy(busy) {
    state.busy = Boolean(busy);
    host.classList.toggle("is-busy", state.busy);
  }

  let toastTimer;
  function toast(message, error = false) {
    clearTimeout(toastTimer);
    toastElement.textContent = String(message || "");
    toastElement.classList.toggle("is-error", error);
    toastElement.classList.add("is-visible");
    toastTimer = setTimeout(() => toastElement.classList.remove("is-visible"), 2400);
  }

  function wireHardwareButton(element, buttonId) {
    let longTimer = null;
    let longTriggered = false;
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      element.setPointerCapture?.(event.pointerId);
      longTriggered = false;
      state.activeHardwareButton = buttonId;
      state.activeHardwarePress = "short";
      renderMappingPanel();
      longTimer = setTimeout(() => {
        longTriggered = true;
        state.activeHardwarePress = "long";
        renderMappingPanel();
        pressButton(buttonId, "long");
      }, 650);
    });
    element.addEventListener("pointerup", async () => {
      if (longTimer) clearTimeout(longTimer);
      longTimer = null;
      if (!longTriggered) await pressButton(buttonId, "short");
      await stopRemoteHold();
      setTimeout(() => { state.activeHardwareButton = ""; state.activeHardwarePress = ""; renderMappingPanel(); }, 220);
    });
    element.addEventListener("pointercancel", async () => {
      if (longTimer) clearTimeout(longTimer);
      longTimer = null;
      await stopRemoteHold();
      state.activeHardwareButton = "";
      state.activeHardwarePress = "";
      renderMappingPanel();
    });
  }

  for (const button of host.querySelectorAll("[data-hardware-button]")) wireHardwareButton(button, button.dataset.hardwareButton);

  let sliderDrag = null;
  let sliderCommandChain = Promise.resolve();

  function touchSliderTarget() {
    if (!activityControlContext()) return "";
    const config = state.activeActivity?.options?.touch_slider || state.activeActivity?.touch_slider || {};
    return config?.enabled === false ? "" : String(config?.target?.entity_id || config?.entity_id || "");
  }

  function queueSliderStep(direction) {
    const target = touchSliderTarget();
    if (!target) return;
    const command = direction > 0 ? "media_player.volume_up" : "media_player.volume_down";
    sliderCommandChain = sliderCommandChain
      .catch(() => {})
      .then(() => sendEntityCommand(target, command, {}))
      .catch((error) => toast(error.message, true));
  }

  function finishSliderDrag(event) {
    if (!sliderDrag || (event && event.pointerId !== sliderDrag.pointerId)) return;
    const shouldRefresh = Boolean(activityControlContext() && touchSliderTarget());
    sliderDrag = null;
    state.activeHardwareButton = "";
    state.activeHardwarePress = "";
    renderMappingPanel();
    if (shouldRefresh) {
      sliderCommandChain.finally(() => {
        state.lastRefresh = 0;
        refresh(true);
      });
    }
  }

  touchSlider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    sliderDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, accumulator: 0 };
    state.activeHardwareButton = "TOUCH_SLIDER";
    state.activeHardwarePress = "slide";
    renderMappingPanel();
    touchSlider.setPointerCapture?.(event.pointerId);
  });
  touchSlider.addEventListener("pointermove", (event) => {
    if (!sliderDrag || event.pointerId !== sliderDrag.pointerId || !(event.buttons & 1)) return;
    event.preventDefault();
    const sliderMode = state.settings.touch_slider_mode || "auto";
    const current = sliderMode === "pages" || (sliderMode === "auto" && !activityControlContext()) ? event.clientX : event.clientY;
    const previous = sliderMode === "pages" || (sliderMode === "auto" && !activityControlContext()) ? sliderDrag.x : sliderDrag.y;
    const delta = current - previous;
    sliderDrag.x = event.clientX;
    sliderDrag.y = event.clientY;
    sliderDrag.accumulator += delta;
    const threshold = 12;
    while (Math.abs(sliderDrag.accumulator) >= threshold) {
      const physicalDirection = sliderDrag.accumulator > 0 ? 1 : -1;
      sliderDrag.accumulator -= physicalDirection * threshold;
      if (sliderMode === "pages" || (sliderMode === "auto" && !activityControlContext())) {
        navigateScreens(physicalDirection);
      } else {
        // The Remote 3 slider is vertical: dragging up increases and dragging
        // down decreases the configured target value.
        queueSliderStep(physicalDirection < 0 ? 1 : -1);
      }
    }
  });
  touchSlider.addEventListener("pointerup", finishSliderDrag);
  touchSlider.addEventListener("pointercancel", finishSliderDrag);
  touchSlider.addEventListener("lostpointercapture", finishSliderDrag);

  let screenSwipe = null;
  display.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".entity-item,button")) return;
    screenSwipe = { x: event.clientX, y: event.clientY };
  });
  display.addEventListener("pointerup", (event) => {
    if (!screenSwipe) return;
    const dx = event.clientX - screenSwipe.x;
    const dy = event.clientY - screenSwipe.y;
    screenSwipe = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) navigateScreens(dx > 0 ? -1 : 1);
  });

  const style = document.createElement("style");
  style.textContent = `
    body.ucvr-sim-page-active{overflow:hidden!important}
    body.ucvr-sim-page-active .navbar{display:flex!important}
    #ucvr-simulator-host-slot{display:block;width:100%;height:100%;min-height:0}
    .ucvr-sim-page[hidden]{display:none!important}.ucvr-sim-page{width:100%!important;min-height:0!important;overflow:hidden!important}.ucvr-sim-page__body{position:relative;z-index:1;display:flex;min-height:0;flex:1;overflow:hidden}.ucvr-sim-page__tools{flex:0 0 auto}.ucvr-sim-page__heading{display:flex;min-width:0;align-items:center;gap:.625rem}.ucvr-sim-page__heading h1{margin:0;color:var(--uc-text-text-primary);font-family:var(--uc-font-family-poppins);font-size:1.5rem;font-weight:400;line-height:1.3}.ucvr-sim-update-toggle{flex:0 0 auto}.ucvr-sim-update-toggle.is-paused{color:var(--uc-buttons-primary-button-primary-hover-text);background:var(--uc-buttons-primary-button-primary-hover-bg)}.ucvr-sim-stage{position:relative;display:flex;align-items:stretch;justify-content:stretch;gap:0;width:100%;min-height:0;flex:1 1 auto;overflow:hidden;padding:0;background:transparent}.ucvr-sim-remote-zone{display:flex;min-width:0;min-height:0;flex:1 1 auto;align-items:center;justify-content:center;overflow:hidden;padding:1rem;border:1px solid var(--uc-theme-color-20,#202424);border-radius:1rem;background:#000}.ucvr-sim-remote-wrap{position:relative;flex:0 0 auto}.ucvr-sim-device{position:absolute;left:50%;top:0;transform:translateX(-50%) scale(var(--ucvr-sim-scale,.5));transform-origin:top center;--ucvr-button-backlight-rgb:255 255 255;--ucvr-button-backlight-opacity:.7;--ucvr-display-brightness:.7}
    .ucvr-sim-device .remote-controller__device{position:relative;width:22.25rem;height:97.047rem;padding:1.125rem 1.125rem 0;background-size:cover;isolation:isolate}.ucvr-sim-device .remote-controller__device:before,.ucvr-sim-device .remote-controller__device:after{position:absolute;inset:0;z-index:1;content:"";pointer-events:none;background:rgb(var(--ucvr-button-backlight-rgb));-webkit-mask:url("${SESSION_BASE}/configurator/images/remote-3-dark-backlight-mask.png") center/cover no-repeat;mask:url("${SESSION_BASE}/configurator/images/remote-3-dark-backlight-mask.png") center/cover no-repeat}.ucvr-sim-device .remote-controller__device:before{opacity:calc(var(--ucvr-button-backlight-opacity) * .72);filter:blur(.32rem) drop-shadow(0 0 .38rem rgb(var(--ucvr-button-backlight-rgb)))}.ucvr-sim-device .remote-controller__device:after{opacity:var(--ucvr-button-backlight-opacity);filter:drop-shadow(0 0 .18rem rgb(var(--ucvr-button-backlight-rgb)))}.ucvr-sim-device .remote-controller__display,.ucvr-sim-device .remote-button-layout{z-index:2}.ucvr-sim-device .remote-controller__display{position:relative;height:33.33rem;border-radius:.15rem;overflow:hidden;filter:brightness(var(--ucvr-display-brightness,.7))}.ucvr-sim-device .remote-button-layout{pointer-events:none}.ucvr-sim-device .remote-button-layout__item{pointer-events:auto;appearance:none;background:transparent;padding:0;opacity:0}.ucvr-sim-device .remote-button-layout__item:hover,.ucvr-sim-device .remote-button-layout__item:focus-visible{opacity:1}.ucvr-sim-device .remote-button-layout__item:active{background:#76999035}.ucvr-sim-device .remote-button-layout__item__label{pointer-events:none}
    .ucvr-sim-device .remote-controller__display__list{cursor:default}.ucvr-sim-device .entity-item{flex:0 0 auto;cursor:pointer;max-width:100%;box-sizing:border-box}.ucvr-sim-device .entity-item:hover{background:transparent;border-color:var(--uc-theme-color-40)}.ucvr-sim-device .entity-item:hover .entity-item__title{color:var(--uc-text-text-primary)}.ucvr-sim-device .entity-item:hover .entity-item__state,.ucvr-sim-device .entity-item:hover .entity-item__icon{color:var(--uc-text-text-secondary)}.ucvr-sim-device .entity-item__icon{position:relative!important;display:flex!important;min-width:0!important;min-height:0!important;box-sizing:border-box!important;align-items:center!important;justify-content:center!important;overflow:visible!important;padding:.28rem!important}.ucvr-sim-device .entity-item__icon>.selected-icon{position:relative!important;inset:auto!important;display:flex!important;width:calc(100% - .2rem)!important;height:calc(100% - .2rem)!important;min-width:0!important;min-height:0!important;max-width:calc(100% - .2rem)!important;max-height:calc(100% - .2rem)!important;box-sizing:border-box!important;align-items:center!important;justify-content:center!important;overflow:visible!important;margin:0!important;padding:0!important;border-radius:0!important;transform:none!important}.ucvr-sim-device .entity-item__icon .selected-icon .vue-load-image{position:relative!important;inset:auto!important;top:auto!important;display:flex!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:100%!important;max-height:100%!important;box-sizing:border-box!important;align-items:center!important;justify-content:center!important;overflow:visible!important;margin:0!important;padding:0!important;border-radius:0!important}.ucvr-sim-device .entity-item__icon .selected-icon img{position:static!important;display:block!important;width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;max-width:100%!important;max-height:100%!important;aspect-ratio:auto!important;object-fit:contain!important;object-position:center!important;margin:auto!important;border-radius:0!important;transform:none!important}.ucvr-sim-device .entity-item__icon>i{display:flex!important;width:100%!important;height:100%!important;align-items:center!important;justify-content:center!important;max-width:100%!important;max-height:100%!important;overflow:visible!important;line-height:1!important}.ucvr-sim-entity-item--selected{border-color:var(--uc-theme-accent,#769990)!important;background:color-mix(in srgb,var(--uc-theme-accent,#769990) 18%,transparent)!important;box-shadow:0 0 0 1px var(--uc-theme-accent,#769990)}.ucvr-sim-entity-item--nested{width:calc(100% - 1rem)!important;margin-left:1rem}.ucvr-sim-group-chevron{color:var(--uc-text-text-secondary)}
    .ucvr-sim-page-dots{position:absolute;left:50%;bottom:.5rem;z-index:15;display:flex;gap:.25rem;transform:translateX(-50%)}.ucvr-sim-page-dots button{width:.42rem;height:.42rem;padding:0;border:0;border-radius:1rem;background:#ffffff72;cursor:pointer;transition:.15s}.ucvr-sim-page-dots button.is-active{width:1rem;background:#fff}.ucvr-sim-device .remote-nav__profile{position:relative;z-index:2;flex:0 0 1.5rem;padding:0;border:0;color:inherit;cursor:pointer}.ucvr-sim-device .remote-nav__page-name{display:none}.ucvr-sim-device .remote-controller__display__header{height:14rem!important;z-index:4;pointer-events:none;background:#111}.ucvr-sim-device .remote-controller__display__header__body{height:100%!important;background:#111}.ucvr-sim-device .remote-controller__display__header__body>div{height:100%!important}.ucvr-sim-device .remote-controller__display__header__body .vue-load-image{height:100%!important}.ucvr-sim-device .remote-controller__display__header img{height:100%!important;background:#111;object-fit:cover}.ucvr-sim-device .remote-controller__display__header__body:after{height:100%;background:linear-gradient(180deg,#0000 24%,rgba(0,0,0,.18) 72%,rgba(0,0,0,.58) 100%)}.ucvr-sim-device .remote-controller__display__list{position:relative;z-index:1;padding-top:calc(14rem + 5px)!important}.ucvr-sim-device .remote-controller__display__nav{z-index:8}@media screen and (max-width:600px){.ucvr-sim-device .remote-controller__display__header{height:12rem!important}.ucvr-sim-device .remote-controller__display__list{padding-top:calc(12rem + 5px)!important}}
    .ucvr-sim-device .remote-controller__display,.ucvr-sim-display--activity{background:#000!important}.ucvr-sim-activity-overlay{position:absolute;inset:0;z-index:40;display:flex;box-sizing:border-box;flex-direction:column;overflow:hidden;background:#000!important;color:#f7f7f5;isolation:isolate;contain:layout paint;transform:translateY(0)}.ucvr-sim-activity-overlay.is-opening{animation:ucvr-activity-reveal .3s cubic-bezier(.2,.8,.2,1) both}.ucvr-sim-activity-overlay.is-closing{animation:ucvr-activity-close .22s cubic-bezier(.4,0,1,1) both}@keyframes ucvr-activity-reveal{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes ucvr-activity-close{from{transform:translateY(0)}to{transform:translateY(100%)}}.ucvr-sim-overlay-close{position:absolute;z-index:6;top:.2rem;right:.2rem;display:inline-flex;width:2.2rem;height:2.2rem;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:transparent;color:#f7f7f5;font-size:1.5rem;cursor:pointer}.ucvr-sim-overlay-close:active{background:#fff;color:#000}.ucvr-sim-activity-titlebar{position:relative;z-index:2;display:flex;height:5.35rem;min-height:5.35rem;box-sizing:border-box;align-items:center;gap:.55rem;padding:.35rem 2.6rem .35rem .45rem;background:#000}.ucvr-sim-activity-titlebar__icon{display:flex;width:4.25rem;height:4.25rem;flex:0 0 4.25rem;box-sizing:border-box;align-items:center;justify-content:center;overflow:hidden;padding:.18rem;color:#f7f7f5;font-size:3rem}.ucvr-sim-activity-titlebar__icon,.ucvr-sim-activity-titlebar__icon .selected-icon,.ucvr-sim-activity-titlebar__icon .vue-load-image,.ucvr-sim-activity-titlebar__icon img{border-radius:0!important}.ucvr-sim-activity-titlebar__icon .selected-icon,.ucvr-sim-activity-titlebar__icon .vue-load-image{display:flex!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:100%!important;max-height:100%!important;box-sizing:border-box;align-items:center;justify-content:center;overflow:hidden}.ucvr-sim-activity-titlebar__icon img{display:block!important;width:auto!important;height:auto!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important}.ucvr-sim-activity-titlebar__text{display:flex;min-width:0;flex-direction:column}.ucvr-sim-activity-titlebar__text strong{overflow:hidden;color:#f7f7f5;font-size:1.45rem;font-weight:500;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}.ucvr-sim-activity-titlebar__text small{overflow:hidden;margin-top:.05rem;color:#a9b4b2;font-size:.85rem;line-height:1.1;text-overflow:ellipsis;white-space:nowrap}.ucvr-sim-activity-pages{position:relative;min-height:0;flex:1 1 auto;overflow:hidden;background:#000}.ucvr-sim-overlay-dots{bottom:.35rem}.ucvr-sim-activity-page{position:absolute;inset:0;box-sizing:border-box;overflow:hidden!important;padding:.2rem .25rem .8rem!important;background:#000}.ucvr-sim-activity-grid{display:grid;width:100%;height:100%;min-height:0;grid-template-columns:repeat(var(--ucvr-grid-width),minmax(0,1fr));grid-template-rows:repeat(var(--ucvr-grid-height),minmax(0,1fr));gap:0;background:#000}.ucvr-sim-activity-widget{display:flex;box-sizing:border-box;min-width:0;min-height:0;appearance:none;align-items:center;justify-content:center;gap:.25rem;overflow:hidden;margin:0;padding:.18rem;border:0;border-radius:.35rem;background:transparent;color:#f7f7f5;font:inherit;text-align:center}.ucvr-sim-activity-widget.is-actionable{cursor:pointer}.ucvr-sim-activity-widget.is-actionable:active{background:#f7f7f5;color:#000}.ucvr-sim-widget__label{display:block;overflow:hidden;max-width:100%;color:#a9b4b2;font-size:.52rem;line-height:1.1;text-overflow:ellipsis;white-space:nowrap}.ucvr-sim-activity-widget strong{display:block;overflow:hidden;max-width:100%;color:inherit;font-size:.72rem;font-weight:500;line-height:1.15;text-overflow:ellipsis}.ucvr-sim-activity-widget--icon{position:relative!important;padding:0!important}.ucvr-sim-widget__icon{position:absolute!important;inset:.28rem!important;display:flex!important;width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;box-sizing:border-box!important;align-items:center!important;justify-content:center!important;overflow:visible!important;padding:0!important;font-size:2.5rem;line-height:1}.ucvr-sim-widget__icon>.selected-icon{position:relative!important;inset:auto!important;display:flex!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:100%!important;max-height:100%!important;box-sizing:border-box!important;align-items:center!important;justify-content:center!important;overflow:visible!important;margin:0!important;padding:0!important;border-radius:0!important;transform:none!important}.ucvr-sim-widget__icon .selected-icon .vue-load-image{position:relative!important;inset:auto!important;top:auto!important;display:flex!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;max-width:100%!important;max-height:100%!important;box-sizing:border-box!important;align-items:center!important;justify-content:center!important;overflow:visible!important;margin:0!important;padding:0!important;border-radius:0!important}.ucvr-sim-widget__icon .selected-icon img{position:static!important;display:block!important;width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;max-width:100%!important;max-height:100%!important;aspect-ratio:auto!important;object-fit:contain!important;object-position:center!important;margin:auto!important;border-radius:0!important;transform:none!important}.ucvr-sim-widget__icon>i{display:flex!important;width:100%!important;height:100%!important;align-items:center!important;justify-content:center!important;max-width:100%!important;max-height:100%!important;overflow:visible!important;line-height:1!important}.ucvr-sim-widget__text{display:block;max-width:100%;overflow:hidden;font-size:.72rem;font-weight:500;line-height:1.15;text-overflow:ellipsis}.ucvr-sim-activity-widget--text{font-weight:500}.ucvr-sim-activity-widget--sensor{flex-direction:column}.ucvr-sim-activity-widget--sensor .ucvr-sim-widget__label{font-size:1.05rem!important;line-height:1.15}.ucvr-sim-activity-widget--sensor strong{font-size:1.5rem!important;line-height:1.12}.ucvr-sim-activity-widget--icon,.ucvr-sim-activity-widget--icon .ucvr-sim-widget__icon,.ucvr-sim-activity-widget--icon .selected-icon,.ucvr-sim-activity-widget--icon img{border-radius:0!important}.ucvr-sim-activity-widget--icon{border-radius:0}.ucvr-sim-activity-widget--select{width:100%;height:100%;align-self:stretch;justify-self:stretch;flex-direction:column;padding:0}.ucvr-sim-native-select{display:block;width:100%;height:100%;min-width:0;min-height:0;box-sizing:border-box;padding:.2rem .35rem;border:0;border-radius:.35rem;background:#1d201f;color:#f7f7f5;font:inherit;text-align:center;cursor:pointer}.ucvr-sim-native-select:focus{outline:1px solid #f7f7f5;outline-offset:-1px}.ucvr-sim-select__value{display:flex;width:100%;height:100%;min-width:0;min-height:0;box-sizing:border-box;flex:1 1 auto;align-items:center;justify-content:center;gap:.25rem;padding:.2rem .35rem;border-radius:.35rem;background:#1d201f}.ucvr-sim-select__value strong{min-width:0;white-space:nowrap}.ucvr-sim-select__value i{flex:0 0 auto;font-size:.55rem}.ucvr-sim-activity-widget--media_player{position:relative;align-items:stretch;justify-content:flex-start;padding:.18rem;text-align:center}.ucvr-sim-widget__media{display:flex;width:100%;height:100%;min-width:0;min-height:0;box-sizing:border-box;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:.18rem;overflow:hidden;padding:0}.ucvr-sim-media__visual{position:relative;display:flex;width:100%;min-height:0;max-height:66%;flex:1 1 auto;align-self:stretch;align-items:center;justify-content:center;overflow:hidden;border-radius:.3rem}.ucvr-sim-widget__artwork{display:block;width:100%;height:100%;object-fit:cover;object-position:center;background:#000}.ucvr-sim-widget__artwork--empty{background:#111}.ucvr-sim-media__title,.ucvr-sim-media__meta{display:block;overflow:hidden;max-width:100%;flex:0 0 auto;text-overflow:clip;white-space:nowrap}.ucvr-sim-marquee__content{display:inline-block;min-width:max-content;will-change:transform}.ucvr-sim-media__title.is-scrolling .ucvr-sim-marquee__content,.ucvr-sim-media__meta.is-scrolling .ucvr-sim-marquee__content{animation:ucvr-media-marquee var(--ucvr-marquee-duration,8s) ease-in-out infinite}@keyframes ucvr-media-marquee{0%,15%{transform:translateX(0)}75%,90%{transform:translateX(calc(-1 * var(--ucvr-marquee-distance,0px)))}100%{transform:translateX(0)}}.ucvr-sim-activity-widget--media_player .ucvr-sim-media__title{color:#f7f7f5;font-size:1.5rem!important;font-weight:600;line-height:1.12}.ucvr-sim-activity-widget--media_player .ucvr-sim-media__meta{color:#a9b4b2;font-size:1.05rem!important;line-height:1.15}.ucvr-sim-media__progress-block{display:flex;min-width:0;flex:0 0 auto;flex-direction:column;gap:.18rem;margin-top:.12rem}.ucvr-sim-activity-widget--media_player .ucvr-sim-media__progress{display:block;height:.55rem!important;overflow:hidden;border-radius:999px;background:#2b302e}.ucvr-sim-media__progress span{display:block;height:100%;border-radius:inherit;background:#f7f7f5}.ucvr-sim-media__times{display:flex;align-items:center;justify-content:space-between;color:#a9b4b2;font-size:.76rem;line-height:1.1}.ucvr-sim-media__times span{display:block;min-width:0;white-space:nowrap}.ucvr-sim-activity-widget--numpad{padding:.1rem}.ucvr-sim-numpad{display:grid;width:100%;height:100%;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,1fr);gap:.12rem}.ucvr-sim-numpad__key{appearance:none;border:0;border-radius:.3rem;background:#1d201f;color:#f7f7f5;font:inherit}.ucvr-sim-numpad__key:active{background:#f7f7f5;color:#000}.ucvr-sim-activity-empty{display:flex;height:100%;align-items:center;justify-content:center;flex-direction:column;gap:.35rem;color:#f7f7f5;text-align:center}.ucvr-sim-activity-empty strong{font-size:1rem;font-weight:500}.ucvr-sim-activity-empty span{max-width:80%;color:#a9b4b2;font-size:.75rem}
    .ucvr-sim-compact-control{display:flex;width:100%;height:100%;min-width:0;min-height:0;box-sizing:border-box;flex-direction:column;align-items:center;justify-content:center;gap:.18rem}.ucvr-sim-compact-control__value{font-size:1.15rem;font-weight:600}.ucvr-sim-compact-control__buttons{display:flex;gap:.2rem}.ucvr-sim-control-button{display:inline-flex;width:2.45rem;height:2.45rem;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:#222725;color:#f7f7f5;font-size:1rem;cursor:pointer}.ucvr-sim-control-button:active,.ucvr-sim-control-button--primary{background:#f7f7f5;color:#000}.ucvr-sim-compact-control .ucvr-sim-control-button{width:1.8rem;height:1.8rem;font-size:.75rem}.ucvr-sim-entity-control{z-index:65}.ucvr-sim-entity-control__body{display:flex;min-height:0;flex:1;box-sizing:border-box;flex-direction:column;align-items:stretch;justify-content:center;gap:.7rem;overflow:hidden;padding:.7rem .85rem}.ucvr-sim-entity-control__hero{display:flex;flex-direction:column;align-items:center;gap:.25rem;text-align:center}.ucvr-sim-entity-control__hero>i{font-size:4rem}.ucvr-sim-entity-control__hero>strong{font-size:2rem;font-weight:500}.ucvr-sim-entity-control__hero>span{color:#a9b4b2}.ucvr-sim-entity-control__actions{display:flex;align-items:center;justify-content:center;gap:.75rem}.ucvr-sim-control-range,.ucvr-sim-control-select,.ucvr-sim-control-color{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:.4rem;color:#a9b4b2}.ucvr-sim-control-range input,.ucvr-sim-control-select select,.ucvr-sim-control-color input{grid-column:1/-1;width:100%;box-sizing:border-box}.ucvr-sim-control-color input{height:2.4rem;padding:0;border:0;border-radius:.4rem;background:#1d201f}.ucvr-sim-control-select select{padding:.55rem;border:0;border-radius:.4rem;background:#1d201f;color:#f7f7f5;font:inherit}.ucvr-sim-control-empty{margin:0;color:#a9b4b2;text-align:center}.ucvr-sim-entity-control__body--media{justify-content:stretch;overflow:hidden!important;padding:.4rem .65rem .55rem}.ucvr-sim-media-control{display:grid;width:100%;height:100%;min-width:0;min-height:0;box-sizing:border-box;grid-template-rows:minmax(3.5rem,1fr) auto auto auto auto auto;align-items:center;gap:.22rem;overflow:hidden}.ucvr-sim-media-control__artwork{display:flex;width:100%;height:100%;min-height:0;max-height:100%;justify-self:stretch;align-self:stretch;align-items:center;justify-content:center;overflow:hidden;border-radius:.55rem;background:#111;color:#a9b4b2;font-size:2.4rem}.ucvr-sim-media-control__artwork img{display:block;width:100%;height:100%;object-fit:cover}.ucvr-sim-media-control .ucvr-sim-media__title{font-size:1.15rem;font-weight:600;line-height:1.15;text-align:center}.ucvr-sim-media-control .ucvr-sim-media__meta{color:#a9b4b2;font-size:.82rem;line-height:1.2;text-align:center}.ucvr-sim-media-control .ucvr-sim-media__progress{display:block;height:.55rem;overflow:hidden;border-radius:999px;background:#2b302e}.ucvr-sim-media-control__source{margin-top:0}.ucvr-sim-climate-target{display:flex;flex-direction:column;align-items:center;gap:.45rem}.ucvr-sim-climate-target>span{color:#a9b4b2}.ucvr-sim-climate-target>div{display:flex;align-items:center;gap:.75rem}.ucvr-sim-climate-target strong{min-width:5rem;font-size:1.8rem;font-weight:500;text-align:center}.ucvr-sim-profile-selector{position:absolute;inset:0;z-index:55;display:flex;flex-direction:column;background:#000;color:#f7f7f5;animation:ucvr-profile-open .26s cubic-bezier(.2,.8,.2,1) both}@keyframes ucvr-profile-open{from{opacity:0;transform:translateX(100%)}to{opacity:1;transform:translateX(0)}}.ucvr-sim-profile-selector__header{display:grid;height:3.75rem;min-height:3.75rem;grid-template-columns:3.75rem 1fr 3.75rem;align-items:center;border-bottom:1px solid #ffffff18}.ucvr-sim-profile-selector__header button{display:flex;width:3.75rem;height:3.75rem;align-items:center;justify-content:center;border:0;background:transparent;color:#f7f7f5;font-size:1.4rem}.ucvr-sim-profile-selector__header strong{grid-column:2;text-align:center;font-size:1.35rem;font-weight:500}.ucvr-sim-profile-selector__list{width:100%;max-width:100%;min-height:0;box-sizing:border-box;flex:1;overflow-x:hidden;overflow-y:auto;padding:.35rem}.ucvr-sim-profile-item{display:grid;width:100%;min-width:0;max-width:100%;min-height:4rem;box-sizing:border-box;grid-template-columns:3rem minmax(0,1fr) 2rem;align-items:center;gap:.55rem;padding:.35rem .55rem;border:0;border-radius:.45rem;background:transparent;color:#f7f7f5;text-align:left}.ucvr-sim-profile-item.is-selected{background:#ffffff16}.ucvr-sim-profile-item.is-active{color:var(--uc-theme-accent,#769990)}.ucvr-sim-profile-item__icon{display:flex;width:2.65rem;height:2.65rem;align-items:center;justify-content:center;overflow:hidden}.ucvr-sim-profile-item__icon .selected-icon,.ucvr-sim-profile-item__icon .vue-load-image{display:flex!important;width:100%!important;height:100%!important;align-items:center!important;justify-content:center!important}.ucvr-sim-profile-item__icon img{display:block!important;width:auto!important;height:auto!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important}.ucvr-sim-profile-item__name{overflow:hidden;font-size:1rem;text-overflow:ellipsis;white-space:nowrap}
    .ucvr-sim-mapping-panel{display:flex;width:min(44rem,42vw);min-width:20rem;height:100%;min-height:0;flex:0 0 min(44rem,42vw);overflow:hidden;margin-left:1rem;border:1px solid var(--uc-theme-color-20,#202424);border-radius:1rem;background:var(--uc-bg-bg-surface-1,var(--uc-bg-bg-surface,#111))}.ucvr-sim-mapping-panel .button-list__header{flex:0 0 auto}.ucvr-sim-mapping-panel .button-list__header__instruction{margin:0}.ucvr-sim-mapping-panel .button-list__body{position:relative!important;min-height:0;flex:1 1 auto;overflow:auto}.ucvr-sim-mapping-panel .button-list__item__config__expanded{display:flex;flex-direction:column;gap:.3rem}.ucvr-sim-mapping-panel .button-press__command{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ucvr-sim-mapping-item--active{background:color-mix(in srgb,var(--uc-theme-accent,#769990) 16%,transparent)!important}.ucvr-sim-button-press--active{outline:1px solid var(--uc-theme-accent,#769990);background:color-mix(in srgb,var(--uc-theme-accent,#769990) 24%,transparent)!important}.ucvr-sim-mapping-panel .config-touch-slider__item__feature{opacity:1}.ucvr-sim-mapping-panel strong{font-weight:500;color:var(--uc-text-text-primary)}
    .ucvr-sim-toast{position:absolute;z-index:60;right:1rem;bottom:1rem;left:1rem;padding:.65rem .8rem;border-radius:.375rem;background:var(--uc-success-success,#a2d4bf);color:var(--uc-black,#000);opacity:0;transform:translateY(.5rem);transition:.18s;pointer-events:none;box-shadow:0 .35rem 1.25rem #0008}.ucvr-sim-toast.is-visible{opacity:1;transform:none}.ucvr-sim-toast.is-error{background:var(--uc-error-error-40,#ff8978)}.ucvr-sim-page.is-busy{cursor:progress}.ucvr-sim-page.is-busy .remote-button-layout__item,.ucvr-sim-page.is-busy .entity-item{pointer-events:none}

    /* Remote UI entity cards and detail controls */
    .ucvr-remoteui-entity-card,.ucvr-remoteui-group{position:relative!important;display:grid!important;width:calc(100% - .7rem)!important;min-height:5.15rem!important;grid-template-columns:4.25rem minmax(0,1fr) 2.8rem!important;align-items:center!important;gap:.45rem!important;margin:.25rem .35rem!important;padding:.28rem .42rem!important;border:1px solid transparent!important;border-radius:.48rem!important;background:#000!important;color:#f7f7f5!important}
    .ucvr-remoteui-entity-card--media_player{grid-template-columns:4.25rem minmax(0,1fr) 2.8rem!important}
    .ucvr-remoteui-entity-card.is-inactive .ucvr-remoteui-entity-card__icon{opacity:.4}
    .ucvr-remoteui-entity-card__icon{width:4rem!important;height:4rem!important;padding:.25rem!important;color:#f7f7f5!important;font-size:2rem!important}
    .ucvr-remoteui-entity-card__icon.has-artwork{padding:0!important;overflow:hidden!important;border-radius:.35rem!important}
    .ucvr-remoteui-entity-card__icon.has-artwork img{width:100%!important;height:100%!important;object-fit:cover!important;border-radius:.35rem!important}
    .ucvr-remoteui-entity-card__meta{display:flex!important;min-width:0!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;gap:.14rem!important}
    .ucvr-remoteui-entity-card__meta .entity-item__title{width:100%!important;overflow:hidden!important;color:#f7f7f5!important;font-size:1.16rem!important;font-weight:400!important;line-height:1.12!important;text-overflow:ellipsis!important;white-space:nowrap!important}
    .ucvr-remoteui-entity-card__meta .entity-item__state{width:100%!important;overflow:hidden!important;color:#919a98!important;font-size:.78rem!important;text-overflow:ellipsis!important;white-space:nowrap!important}
    .ucvr-remoteui-card-action,.ucvr-remoteui-group__toggle,.ucvr-remoteui-round-power{appearance:none;display:flex;width:2.5rem;height:2.5rem;align-items:center;justify-content:center;padding:0;border:2px solid #4a504e;border-radius:50%;background:#161a19;color:#87908e;cursor:pointer;transition:.2s}
    .ucvr-remoteui-card-action.is-active,.ucvr-remoteui-round-power.is-active{border-color:#f7f7f5;background:#f7f7f5;color:#000}
    .ucvr-remoteui-card-action:active,.ucvr-remoteui-card-action.is-momentary:active{background:#f7f7f5;color:#000;transform:scale(.92)}
    .ucvr-remoteui-group{grid-template-columns:2.8rem minmax(0,1fr) 2.8rem!important;background:#151918!important;border-color:#313634!important}
    .ucvr-remoteui-group__arrow{display:flex;width:2.5rem;height:2.5rem;align-items:center;justify-content:center;color:#f7f7f5;font-size:1.15rem;transition:transform .25s}
    .ucvr-remoteui-group:not(.is-expanded) .ucvr-remoteui-group__arrow{transform:rotate(180deg)}
    .ucvr-remoteui-group__meta{display:flex;min-width:0;flex-direction:column;gap:.12rem}.ucvr-remoteui-group__meta strong{overflow:hidden;font-size:1.12rem;font-weight:400;text-overflow:ellipsis;white-space:nowrap}.ucvr-remoteui-group__meta small{color:#919a98;font-size:.76rem}
    .ucvr-remoteui-group__toggle{border:0;background:#343a38}.ucvr-remoteui-group__toggle span{width:1.25rem;height:1.25rem;border-radius:50%;background:#111;transition:.2s}.ucvr-remoteui-group__toggle.is-active{background:#f7f7f5}.ucvr-remoteui-group__toggle.is-active span{width:.72rem;height:.72rem;background:#000}
    .ucvr-sim-entity-item--nested{width:calc(100% - 1.45rem)!important;margin-left:1.1rem!important;border-color:#292e2c!important}
    .ucvr-remoteui-detail{background:#000!important}.ucvr-remoteui-detail .ucvr-sim-entity-control__body{padding:.45rem .75rem .75rem!important}
    .ucvr-remoteui-power,.ucvr-remoteui-button{display:flex;height:100%;min-height:0;flex-direction:column;align-items:stretch;justify-content:flex-end;gap:.55rem}.ucvr-remoteui-power>strong{overflow:hidden;min-height:3.6rem;padding:0 .35rem;color:#f7f7f5;font-size:4.35rem;font-weight:300;line-height:.95;text-overflow:ellipsis;white-space:nowrap}
    .ucvr-remoteui-square-control{appearance:none;position:relative;width:100%;aspect-ratio:1/1;padding:1.15rem;border:0;border-radius:.55rem;background:#333936;cursor:pointer;transition:background .25s}.ucvr-remoteui-square-control>span{display:block;width:100%;height:100%;border-radius:.48rem;background:#151918;transition:background .25s}.ucvr-remoteui-square-control.is-active>span{background:#f7f7f5}.ucvr-remoteui-square-control:active{background:#f7f7f5}.ucvr-remoteui-square-control.is-momentary:active>span{background:#f7f7f5}
    .ucvr-remoteui-light{display:flex;height:100%;min-height:0;flex-direction:column}.ucvr-remoteui-light>.ucvr-remoteui-power,.ucvr-remoteui-light-level,.ucvr-remoteui-color{min-height:0;flex:1}
    .ucvr-remoteui-pages{display:flex;flex:0 0 auto;align-items:center;justify-content:center;gap:.45rem;padding-top:.38rem}.ucvr-remoteui-pages button{appearance:none;width:.46rem;height:.46rem;padding:0;border:0;border-radius:50%;background:#3b413f}.ucvr-remoteui-pages button.is-active{background:#f7f7f5}
    .ucvr-remoteui-light-level{display:flex;flex-direction:column;align-items:center;gap:.35rem}.ucvr-remoteui-light-level>strong{font-size:4rem;font-weight:300;line-height:1}.ucvr-remoteui-light-level__sliders{display:flex;min-height:0;flex:1;justify-content:center;gap:1.1rem}
    .ucvr-remoteui-vertical-slider{position:relative;display:grid;width:4.3rem;min-height:0;grid-template-rows:auto minmax(0,1fr) auto;justify-items:center;gap:.25rem;color:#a9b4b2;font-size:.68rem}.ucvr-remoteui-vertical-slider input{width:3.15rem;height:100%;min-height:9rem;margin:0;writing-mode:vertical-lr;direction:rtl;accent-color:#f7f7f5}.ucvr-remoteui-vertical-slider.is-temperature input{accent-color:#f2c879}.ucvr-remoteui-vertical-slider output{color:#f7f7f5;font-size:.72rem}
    .ucvr-remoteui-color{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.55rem}.ucvr-remoteui-color>strong{font-size:1.05rem;font-weight:400}.ucvr-remoteui-color-wheel{position:relative;display:block;width:11rem;max-width:78%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,#fff 0 10%,transparent 42%),conic-gradient(red,#ff0,#0f0,#0ff,#00f,#f0f,red);box-shadow:inset 0 0 1rem #0006}.ucvr-remoteui-color-wheel:after{position:absolute;inset:31%;border:4px solid #fff;border-radius:50%;background:var(--ucvr-current-color);box-shadow:0 0 0 2px #0008;content:"";pointer-events:none}.ucvr-remoteui-color-wheel input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.ucvr-remoteui-horizontal-slider{display:grid;width:90%;grid-template-columns:1fr auto;align-items:center;gap:.3rem;color:#a9b4b2}.ucvr-remoteui-horizontal-slider input{grid-column:1/-1;width:100%;accent-color:#f7f7f5}.ucvr-remoteui-horizontal-slider output{color:#f7f7f5}
    .ucvr-remoteui-cover{display:flex;height:100%;min-height:0;flex-direction:column;gap:.38rem}.ucvr-remoteui-cover__state{overflow:hidden;flex:0 0 auto;font-size:2.9rem;font-weight:300;line-height:1;text-transform:capitalize;text-overflow:ellipsis;white-space:nowrap}.ucvr-remoteui-cover__blind{position:relative;min-height:0;flex:1;overflow:hidden;border:1px solid #3d4341;border-radius:.42rem;background:repeating-linear-gradient(to bottom,#161a19 0,#161a19 11px,#202523 12px,#202523 14px)}.ucvr-remoteui-cover__fill{position:absolute;top:0;right:0;left:0;background:#000d;border-bottom:2px solid #f7f7f5}.ucvr-remoteui-cover__blind>i{position:absolute;top:50%;left:50%;font-size:2rem;transform:translate(-50%,-50%)}.ucvr-remoteui-cover__blind label{position:absolute;inset:0;width:100%;height:100%}.ucvr-remoteui-cover__blind input{position:absolute;inset:0;width:100%;height:100%;opacity:0}.ucvr-remoteui-cover__blind output{position:absolute;right:.5rem;bottom:.35rem;color:#f7f7f5;font-size:1.1rem;opacity:1}.ucvr-remoteui-cover__actions{display:grid;flex:0 0 auto;grid-template-columns:1fr .7fr 1fr;gap:.35rem}.ucvr-remoteui-cover__actions button{appearance:none;display:flex;min-height:3rem;align-items:center;justify-content:center;gap:.3rem;border:0;border-radius:.38rem;background:#333936;color:#f7f7f5}.ucvr-remoteui-cover__actions button.is-secondary{background:#171b1a;color:#a9b4b2}.ucvr-remoteui-cover__actions button:active{background:#f7f7f5;color:#000}
    .ucvr-remoteui-climate{position:relative;display:grid;height:100%;min-height:0;grid-template-rows:3.2rem minmax(0,1fr) 3.2rem auto;overflow:hidden}.ucvr-remoteui-climate__step{appearance:none;display:flex;align-items:center;justify-content:center;border:0;background:linear-gradient(#000,transparent);color:#f7f7f5;font-size:2rem}.ucvr-remoteui-climate__step.is-minus{background:linear-gradient(transparent,#000)}.ucvr-remoteui-climate__tumbler{display:flex;min-height:0;flex-direction:column;align-items:center;justify-content:center;gap:.2rem}.ucvr-remoteui-climate__tumbler span{color:#626967;font-size:2rem;font-weight:300}.ucvr-remoteui-climate__tumbler strong{font-size:5.2rem;font-weight:300;line-height:1}.ucvr-remoteui-climate__footer{display:grid;grid-template-columns:1fr minmax(5.5rem,1.4fr) auto;align-items:end;gap:.4rem;padding-top:.35rem;border-top:1px solid #242927}.ucvr-remoteui-climate__footer>span{display:flex;flex-direction:column}.ucvr-remoteui-climate__footer small,.ucvr-remoteui-select>span{color:#919a98;font-size:.65rem}.ucvr-remoteui-climate__footer strong{font-size:1.25rem;font-weight:400}
    .ucvr-remoteui-select{display:flex;min-width:0;flex-direction:column;gap:.15rem}.ucvr-remoteui-select select{width:100%;min-width:0;padding:.38rem .45rem;border:0;border-radius:.3rem;background:#202523;color:#f7f7f5;font:inherit}
    .ucvr-remoteui-media{position:relative;display:grid;width:100%;height:100%;min-height:0;grid-template-rows:minmax(7rem,1fr) auto auto auto auto;align-items:center;gap:.28rem;overflow:hidden}.ucvr-remoteui-media__backdrop{position:absolute;inset:-1rem;background:linear-gradient(to bottom,#0006,#000 65%),var(--ucvr-media-art);background-position:center;background-size:cover;filter:blur(1.25rem);opacity:.48}.ucvr-remoteui-media__artwork,.ucvr-remoteui-media__copy,.ucvr-remoteui-media__progress,.ucvr-remoteui-media__transport,.ucvr-remoteui-media>.ucvr-remoteui-select{position:relative;z-index:1}.ucvr-remoteui-media__artwork{display:flex;width:100%;height:100%;min-height:0;align-items:center;justify-content:center;overflow:hidden;border-radius:.42rem;background:#111;color:#929b98;font-size:2.8rem}.ucvr-remoteui-media__artwork img{width:100%;height:100%;object-fit:contain}.ucvr-remoteui-media__copy{display:flex;min-width:0;flex-direction:column;align-items:center;text-align:center}.ucvr-remoteui-media__copy strong,.ucvr-remoteui-media__copy span{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ucvr-remoteui-media__copy strong{font-size:1.15rem;font-weight:500}.ucvr-remoteui-media__copy>span{color:#a9b4b2;font-size:.8rem}.ucvr-remoteui-media__transport{display:flex;justify-content:center;gap:1.2rem}.ucvr-remoteui-media__transport .ucvr-sim-control-button{width:3rem;height:3rem}.ucvr-remoteui-media__transport .ucvr-sim-control-button--primary{width:3.5rem;height:3.5rem}

        @media(max-width:992px){.ucvr-sim-page__tools{align-items:flex-start}.ucvr-sim-remote-zone{border-radius:.75rem}.ucvr-sim-mapping-panel{min-width:16rem;width:46%;flex-basis:46%;margin-left:.75rem;border-radius:.75rem}}
    @media(max-width:700px){.ucvr-sim-mapping-panel{min-width:12rem;width:43%;flex-basis:43%;margin-left:.5rem}.ucvr-sim-mapping-panel .button-list__item__base{min-width:6rem}.ucvr-sim-mapping-panel .button-list__item__name{font-size:.72rem}.ucvr-sim-mapping-panel .button-press__command{font-size:.68rem}}
  `;
  document.head.appendChild(style);

  let eventRefreshTimer = null;
  try {
    const events = new EventSource(`${API}/events`, { withCredentials: true });
    events.onmessage = () => {};
    for (const eventName of ["entity.change", "activity.change", "activity.deleted", "profile.change", "simulator.change", "configuration.change"]) {
      events.addEventListener(eventName, () => {
        if (["simulator.change", "configuration.change"].includes(eventName)) state.settingsLoaded = false;
        if (!state.open) return;
        if (state.selectInteraction) {
          state.deferredRefresh = true;
          return;
        }
        clearTimeout(eventRefreshTimer);
        eventRefreshTimer = setTimeout(() => { state.lastRefresh = 0; refresh(true); }, 100);
      });
    }
  } catch {}

  const routeChanged = () => queueMicrotask(() => {
    syncPageState();
  });
  addEventListener("popstate", routeChanged);
  addEventListener("hashchange", routeChanged);

  const navigationObserver = new MutationObserver(() => {
    // Vue Router may update hash history through replaceState without a
    // reliable hashchange event. Reconcile from the rendered route as well.
    attachSimulatorHost();
    syncPageState();
    if (state.open) updateSimulatorLayout();
  });
  const navbarNode = document.querySelector(".navbar");
  if (navbarNode) navigationObserver.observe(navbarNode, { childList: true, subtree: true, attributes: true });
  const vueRoot = document.querySelector("#app");
  if (vueRoot) navigationObserver.observe(vueRoot, { childList: true, subtree: true });
  addEventListener("resize", updateSimulatorLayout);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(updateSimulatorLayout).observe(stage);

  let observedHash = String(location.hash || "");
  setInterval(() => {
    const nextHash = String(location.hash || "");
    const shouldOpen = locationShowsSimulator() && !document.querySelector(".page-login");
    if (nextHash !== observedHash || shouldOpen !== state.open) {
      observedHash = nextHash;
      syncPageState();
    }
  }, 100);

  syncPageState(true);
  setInterval(updateMediaProgressRealtime, 250);
  setInterval(() => { if (state.open) { state.lastRefresh = 0; refresh(); } }, 2500);
  setInterval(() => {
    if (!state.open) return;
    if (state.updatesPaused) {
      state.pausedRefreshPending = true;
      return;
    }
    updateLiveContent();
  }, 30000);
})();
