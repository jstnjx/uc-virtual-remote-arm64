export const DEMO_FEATURE_ID = "demo_mode";
export const DEMO_INTEGRATION_ID = "ucvr_demo";
export const DEMO_DRIVER_ID = "ucvr_demo";
export const DEMO_EXTERNAL_DRIVER_ID = "virtual_remote_demo";
export const DEMO_PROFILE_ID = "ucvr-demo-profile";
export const DEMO_PROFILE_PAGE_ENTERTAINMENT_ID = "ucvr-demo-entertainment";
export const DEMO_PROFILE_PAGE_HOME_ID = "ucvr-demo-home";
export const DEFAULT_DEMO_UPDATE_INTERVAL_MS = 5_000;

export const DEMO_MEDIA_LIBRARY = [
  {
    title: "Blue Worlds",
    artist: "Nature One",
    album: "Coral Kingdom",
    artwork: "/demo-artwork/blue-worlds.svg",
    duration: 2_940
  },
  {
    title: "Night City",
    artist: "Demo Cinema",
    album: "Feature Presentation",
    artwork: "/demo-artwork/night-city.svg",
    duration: 6_480
  },
  {
    title: "Alpine Rails",
    artist: "Travel Channel",
    album: "Across Europe",
    artwork: "/demo-artwork/alpine-rails.svg",
    duration: 2_700
  },
  {
    title: "Space Frontier",
    artist: "Science Network",
    album: "Beyond the Moon",
    artwork: "/demo-artwork/space-frontier.svg",
    duration: 3_180
  },
  {
    title: "Cooking at Home",
    artist: "Kitchen Studio",
    album: "Summer Menu",
    artwork: "/demo-artwork/cooking-at-home.svg",
    duration: 1_860
  }
];

export function translated(en) { return { en }; }
export function isoNow() { return new Date().toISOString(); }
export function demoEntityId(localId) { return `${DEMO_INTEGRATION_ID}.${localId}`; }

function entity(localId, entityType, name, icon, features, attributes, options = {}) {
  const { device_class: deviceClass, ...entityOptions } = options;
  return {
    entity_id: localId,
    entity_type: entityType,
    name: translated(name),
    description: translated(`Demo ${entityType.replaceAll("_", " ")} with automatically changing sample data.`),
    icon,
    features,
    ...(deviceClass ? { device_class: deviceClass } : {}),
    attributes,
    options: { demo: true, ...entityOptions }
  };
}

function mediaPlayerDefinition() {
  const media = DEMO_MEDIA_LIBRARY[0];
  return entity(
    "media_player_tv",
    "media_player",
    "Living Room TV",
    "uc:tv",
    [
      "on_off", "toggle", "play_pause", "play", "pause", "stop", "next", "previous",
      "volume_up_down", "volume", "mute_toggle", "select_source", "select_sound_mode", "seek",
      "dpad", "home", "menu", "media_browse", "media_search"
    ],
    {
      state: "PLAYING",
      volume: 34,
      muted: false,
      media_title: media.title,
      media_artist: media.artist,
      media_album: media.album,
      media_image_url: media.artwork,
      artwork_url: media.artwork,
      media_position: 482,
      media_duration: media.duration,
      media_type: "video",
      source: "Apple TV",
      source_list: ["Apple TV", "Live TV", "Game Console", "Blu-ray"],
      sound_mode: "Movie",
      sound_mode_list: ["Movie", "Stereo", "Direct", "Night"]
    }
  );
}

function activityDefinition(mediaPlayer) {
  const mediaPlayerId = demoEntityId(mediaPlayer.entity_id);
  const includedMediaPlayer = {
    ...structuredClone(mediaPlayer),
    id: mediaPlayerId,
    entity_id: mediaPlayerId,
    local_id: mediaPlayer.entity_id,
    integration_id: DEMO_INTEGRATION_ID,
    entity_commands: mediaPlayer.features.map((feature) => `media_player.${feature}`)
  };
  return entity(
    "activity_watch_tv",
    "activity",
    "Watch TV",
    "uc:tv",
    ["start", "on_off"],
    {
      state: "ON",
      progress: 100,
      active_step: "Watching Living Room TV",
      last_started: isoNow()
    },
    {
      included_entities: [includedMediaPlayer],
      button_mapping: [
        { button: "POWER", short_press: { entity_id: mediaPlayerId, cmd_id: "media_player.toggle" } },
        { button: "VOLUME_UP", short_press: { entity_id: mediaPlayerId, cmd_id: "media_player.volume_up" } },
        { button: "VOLUME_DOWN", short_press: { entity_id: mediaPlayerId, cmd_id: "media_player.volume_down" } },
        { button: "MUTE", short_press: { entity_id: mediaPlayerId, cmd_id: "media_player.mute_toggle" } },
        { button: "PLAY", short_press: { entity_id: mediaPlayerId, cmd_id: "media_player.play_pause" } },
        { button: "NEXT", short_press: { entity_id: mediaPlayerId, cmd_id: "media_player.next" } },
        { button: "PREVIOUS", short_press: { entity_id: mediaPlayerId, cmd_id: "media_player.previous" } }
      ],
      user_interface: {
        pages: [{
          page_id: "now-playing",
          name: translated("Now Playing"),
          grid: { width: 4, height: 6 },
          items: [{
            type: "media_player",
            media_player_id: mediaPlayerId,
            location: { x: 0, y: 0 },
            size: { width: 4, height: 6 }
          }]
        }, {
          page_id: "audio",
          name: translated("Audio"),
          grid: { width: 4, height: 6 },
          items: [
            {
              type: "slider",
              text: "Volume",
              slider: {
                entity_id: mediaPlayerId,
                feature: "volume",
                style: "bar",
                icon_min: "uc:volume-low",
                icon_max: "uc:volume-high",
                max: 80,
                update_mode: "live"
              },
              location: { x: 0, y: 0 },
              size: { width: 4, height: 1 }
            },
            {
              type: "number",
              text: "Bass",
              number: { number_id: demoEntityId("number_bass") },
              location: { x: 0, y: 1 },
              size: { width: 4, height: 1 }
            },
            {
              type: "number",
              text: "Treble",
              number: { number_id: demoEntityId("number_treble"), display_mode: "stepper", step: 1 },
              location: { x: 0, y: 2 },
              size: { width: 4, height: 1 }
            },
            {
              type: "slider",
              text: "Light",
              slider: { entity_id: demoEntityId("light_living_room"), feature: "dim", style: "default", color: "entity" },
              location: { x: 0, y: 3 },
              size: { width: 2, height: 1 }
            },
            {
              type: "slider",
              text: "Blinds",
              slider: { entity_id: demoEntityId("cover_living_room"), feature: "position", style: "buttons" },
              location: { x: 2, y: 3 },
              size: { width: 2, height: 1 }
            }
          ]
        }]
      },
      touch_slider: {
        enabled: true,
        target: { entity_id: mediaPlayerId, feature: "volume" }
      }
    }
  );
}

function demoEntities() {
  const mediaPlayer = mediaPlayerDefinition();
  return [
    mediaPlayer,
    entity(
      "light_living_room",
      "light",
      "Living Room Light",
      "uc:light-bulb",
      ["on_off", "toggle", "dim", "brightness", "color_temperature", "color"],
      {
        state: "ON",
        brightness: 158,
        color_temperature: 50,
        hue: 32,
        saturation: 48,
        hs_color: [32, 48],
        color: { hue: 32, saturation: 48 }
      },
      { color_temperature_steps: 5 }
    ),
    entity(
      "cover_living_room",
      "cover",
      "Living Room Blinds",
      "uc:blinds",
      ["open", "close", "stop", "position"],
      { state: "OPEN", current_position: 72, position: 72 }
    ),
    entity(
      "climate_living_room",
      "climate",
      "Living Room Climate",
      "uc:temperature",
      ["on_off", "target_temperature", "set_temperature", "set_mode", "hvac_mode"],
      {
        state: "HEAT",
        current_temperature: 21.4,
        target_temperature: 22,
        hvac_mode: "heat",
        hvac_modes: ["off", "heat", "cool", "auto"],
        options: ["off", "heat", "cool", "auto"],
        temperature_unit: "°C",
        target_temperature_step: 0.5,
        humidity: 45
      }
    ),
    entity(
      "remote_tv",
      "remote",
      "TV Remote",
      "uc:remote",
      ["send_cmd", "on_off", "toggle"],
      {
        state: "ON",
        last_command: "HOME",
        command_count: 126,
        battery_level: 82,
        signal_strength: 94
      },
      {
        simple_commands: [
          "POWER", "HOME", "BACK", "MENU", "UP", "DOWN", "LEFT", "RIGHT", "OK",
          "PLAY", "PAUSE", "NEXT", "PREVIOUS", "VOLUME_UP", "VOLUME_DOWN", "MUTE"
        ],
        button_mapping: [
          { button: "POWER", short_press: { cmd_id: "POWER" } },
          { button: "HOME", short_press: { cmd_id: "HOME" } },
          { button: "BACK", short_press: { cmd_id: "BACK" } },
          { button: "DPAD_UP", short_press: { cmd_id: "UP" } },
          { button: "DPAD_DOWN", short_press: { cmd_id: "DOWN" } },
          { button: "DPAD_LEFT", short_press: { cmd_id: "LEFT" } },
          { button: "DPAD_RIGHT", short_press: { cmd_id: "RIGHT" } },
          { button: "DPAD_MIDDLE", short_press: { cmd_id: "OK" } },
          { button: "PLAY", short_press: { cmd_id: "PLAY" }, long_press: { cmd_id: "PAUSE" } }
        ],
        user_interface: {
          pages: [{
            page_id: "navigation",
            name: translated("Navigation"),
            grid: { width: 3, height: 4 },
            items: []
          }]
        }
      }
    ),
    entity(
      "number_bass",
      "number",
      "Bass",
      "uc:input-numeric",
      ["value"],
      { state: "ON", value: 1.5 },
      { device_class: "audio_level", min: -10, max: 10, step: 0.5, decimals: 1 }
    ),
    entity(
      "number_treble",
      "number",
      "Treble",
      "uc:input-numeric",
      ["value"],
      { state: "ON", value: 0 },
      { device_class: "audio_level", min: -6, max: 6, step: 1 }
    ),
    entity(
      "number_sleep_timer",
      "number",
      "Sleep Timer",
      "uc:timer",
      ["value"],
      { state: "ON", value: 30 },
      { device_class: "duration", unit: "min", min: 0, max: null, step: 5, display_mode: "stepper" }
    ),
    activityDefinition(mediaPlayer)
  ];
}

export function createDemoEntityDefinitions() {
  return demoEntities().map((item) => structuredClone(item));
}
