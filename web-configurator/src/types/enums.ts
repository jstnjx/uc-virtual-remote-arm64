export enum LoginState {
  NOT_DEFINED = -1,
  AUTHORISED = 1,
  ANONYMOUS = 0,
}

export enum SettingTypes {
  BOOL = "bool",
  PERCENT = "percent",
  SLIDE = "slide",
  SECONDS = "seconds",
  SELECT = "select",
  TEXT = "text",
}

export enum IntegrationStatuses {
  DISCOVERED = "discovered",
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
}

export enum CfgGroups {
  bt = "bt",
  button = "button",
  display = "display",
  haptic = "haptic",
  localization = "localization",
  network = "network",
  power_saving = "power_saving",
  software_update = "software_update",
  sound = "sound",
  voice_control = "voice_control",
  device = "device",
  profile = "profile",
  features = "features",
  network_wifi = "network_wifi",
}

export enum SelectTypes {
  VoiceAssistant = "voice_assistant",
  UnitSystem = "unit_system",
  TimeZone = "timezone",
  Country = "country",
  Language = "language",
  Icon = "icon",
  SoftwareUpdate = "software_update",
}

// IntegrationState is the combined state of DeviceState & DriverState used in IntegrationStatus (returned from GET /api/intg)
export enum IntegrationState {
  NOT_CONFIGURED = "NOT_CONFIGURED",
  UNKNOWN = "UNKNOWN",
  IDLE = "IDLE",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
  RECONNECTING = "RECONNECTING",
  ACTIVE = "ACTIVE",
  ERROR = "ERROR",
}

export enum DeviceState {
  UNKNOWN = "UNKNOWN",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
  ERROR = "ERROR",
}

export enum DriverState {
  NOT_CONFIGURED = "NOT_CONFIGURED",
  IDLE = "IDLE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  RECONNECTING = "RECONNECTING",
  ERROR = "ERROR",
}

export enum DriverChangeSetupState {
  START = "START",
  ADD_ELEMENTS = "ADD_ELEMENTS",
  SETUP = "SETUP",
}

export enum DriverType {
  LOCAL = "LOCAL",
  EXTERNAL = "EXTERNAL",
  CUSTOM = "CUSTOM",
}

export enum EntityType {
  button = "button",
  climate = "climate",
  cover = "cover",
  light = "light",
  media_player = "media_player",
  sensor = "sensor",
  switch = "switch",
  select = "select",
  activity = "activity",
  macro = "macro",
  remote = "remote",
}

export enum BinarySensorUnit {
  none = "none",
  battery = "battery",
  battery_charging = "battery_charging",
  carbon_monoxide = "carbon_monoxide",
  cold = "cold",
  connectivity = "connectivity",
  door = "door",
  garage_door = "garage_door",
  gas = "gas",
  heat = "heat",
  light = "light",
  lock = "lock",
  moisture = "moisture",
  motion = "motion",
  moving = "moving",
  occupancy = "occupancy",
  opening = "opening",
  plug = "plug",
  power = "power",
  presence = "presence",
  problem = "problem",
  running = "running",
  safety = "safety",
  smoke = "smoke",
  sound = "sound",
  tamper = "tamper",
  update = "update",
  vibration = "vibration",
  window = "window",
}

export enum BinarySensorUnitOn {
  battery = "normal",
  battery_charging = "charging",
  carbon_monoxide = "detected",
  cold = "cold",
  connectivity = "connected",
  door = "opened",
  garage_door = "opened",
  gas = "detected",
  heat = "hot",
  light = "light_detected",
  lock = "unlocked",
  moisture = "wet",
  motion = "detected",
  moving = "moving",
  occupancy = "detected",
  opening = "open",
  plug = "plugged_in",
  power = "on",
  presence = "home",
  problem = "problem",
  running = "running",
  safety = "unsafe",
  smoke = "detected",
  sound = "detected",
  tamper = "tampering_detected",
  update = "update_detected",
  vibration = "detected",
  window = "open",
  none = "on",
}

export enum BinarySensorUnitOff {
  battery = "low",
  battery_charging = "not_charging",
  carbon_monoxide = "clear",
  cold = "normal",
  connectivity = "disconnected",
  door = "closed",
  garage_door = "closed",
  gas = "clear",
  heat = "normal",
  light = "no light",
  lock = "locked",
  moisture = "dry",
  motion = "clear",
  moving = "not_moving",
  occupancy = "clear",
  opening = "closed",
  plug = "unplugged",
  power = "off",
  presence = "not_home",
  problem = "ok",
  running = "not_running",
  safety = "safe",
  smoke = "clear",
  sound = "clear",
  tamper = "clear",
  update = "up_to_date",
  vibration = "clear",
  window = "closed",
  none = "off",
}

export enum MediaClass {
  ALBUM = "album",
  APP = "app",
  ARTIST = "artist",
  CHANNEL = "channel",
  COMPOSER = "composer",
  DIRECTORY = "directory",
  EPISODE = "episode",
  GAME = "game",
  GENRE = "genre",
  IMAGE = "image",
  MOVIE = "movie",
  MUSIC = "music",
  PLAYLIST = "playlist",
  PODCAST = "podcast",
  RADIO = "radio",
  SEASON = "season",
  TRACK = "track",
  TV_SHOW = "tv_show",
  URL = "url",
  VIDEO = "video",
}

export enum SequenceType {
  delay = "delay",
  command = "command",
}

export enum ActiveSequenceState {
  RUNNING = "RUNNING",
  DONE = "DONE",
  ERROR = "ERROR",
}

export enum ButtonMappingPressType {
  short_press = "short_press",
  double_press = "double_press",
  long_press = "long_press",
}

export enum FlashMessageType {
  error = "error",
  info = "info",
}

export enum FlashMessageInfoStatus {
  DOWNLOADING = "DOWNLOADING",
  SAVING = "SAVING",
  LOADING = "LOADING",
  SUCCESS = "SUCCESS",
}

export enum FlashMessagePlacement {
  TOP = "TOP",
  BOTTOM = "BOTTOM",
  FULL = "FULL",
  INITIAL = "INITIAL",
}

export enum DeviceButtonGroup {
  keypad = "keypad",
}

export enum DeviceColor {
  DARK = "D",
  SILVER = "S",
}

export enum IrCodeSetType {
  manufacturer = "manufacturer",
  custom = "custom",
}

export enum ImportIrCodeSetState {
  UPLOAD = "UPLOAD",
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
}

export enum RemoteIrCodeFormat {
  HEX = "HEX",
  PRONTO = "PRONTO",
}

export enum IrLearningEventType {
  START = "START",
  STOP = "STOP",
  CODE = "CODE",
}

export enum IrAddingState {
  START = "START",
  PASTE = "PASTE",
  LEARN = "LEARN",
}

export enum IrActionType {
  SUBMIT = "SUBMIT",
  TEST = "TEST",
}

export enum DeviceType {
  audio = "audio",
  radio = "radio",
  cd_player = "cd_player",
  receiver = "receiver",
  soundbar = "soundbar",
  hdmi_switch = "hdmi_switch",
  television = "television",
  projector = "projector",
  set_top_box = "set_top_box",
  media_player = "media_player",
  dvd_player = "dvd_player",
  bluray_player = "bluray_player",
  climate = "climate",
  light = "light",
  various = "various",
}

export enum RemoteKind {
  IR = "IR",
  BT = "BT",
  EXTERNAL = "EXTERNAL",
}

export enum RemoteBluetoothSetup {
  DISABLED_BT = "DISABLED_BT",
  ADD = "ADD",
  NO_SLOT = "NO_SLOT",
  WAITING = "WAITING",
  CODE_INPUT = "CODE_INPUT",
  PROGRESS = "PROGRESS",
  SUCCESS = "SUCCESS",
  FAIL = "FAIL",
}

export enum DockState {
  IDLE = "IDLE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  RECONNECTING = "RECONNECTING",
  ERROR = "ERROR",
}

export enum DockDiscoveryType {
  BT = "BT",
  NET = "NET",
}

export enum DockSetupState {
  NEW = "NEW",
  CONFIGURING = "CONFIGURING",
  UPLOADING = "UPLOADING",
  RESTARTING = "RESTARTING",
  OK = "OK",
  ERROR = "ERROR",
}

export enum DockSetupError {
  NONE = "NONE",
  NOT_FOUND = "NOT_FOUND",
  CONNECTION_REFUSED = "CONNECTION_REFUSED",
  AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR",
  TIMEOUT = "TIMEOUT",
  OTHER = "OTHER",
}

export enum DockCommandType {
  SET_LED_BRIGHTNESS = "SET_LED_BRIGHTNESS",
  IDENTIFY = "IDENTIFY",
  REMOTE_LOW_BATTERY = "REMOTE_LOW_BATTERY",
  REMOTE_CHARGED = "REMOTE_CHARGED",
  REBOOT = "REBOOT",
  RESET = "RESET",
}

export enum DockUpdateProgressState {
  IDLE = "IDLE",
  IN_PROGRESS = "IN_PROGRESS",
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
}

export enum DockUpdateProgressEventType {
  START = "START",
  UPDATE = "UPDATE",
}

export enum DockUpdateProgressEventState {
  NEW = "NEW",
  UPLOADING = "UPLOADING",
  OK = "OK",
  ERROR = "ERROR",
}

export enum DockSetupScreen {
  START = "START",
  DISCOVERY = "DISCOVERY",

  ADD_MANUALLY = "ADD_MANUALLY",
  ADD_DISCOVERED_NET = "ADD_DISCOVERED_NET",
  ADD_DISCOVERED_BT = "ADD_DISCOVERED_BT",

  CONFIGURING = "CONFIGURING",

  RESULT_ERROR = "RESULT_ERROR",
  RESULT_SUCCESS = "RESULT_SUCCESS",
}

export enum DockDiscoveryChangeEventType {
  START = "START",
  DISCOVERY = "DISCOVER",
  STOP = "STOP",
}

export enum DockPortMode {
  NONE = "NONE",
  AUTO = "AUTO",
  MANUAL = "MANUAL",
  IR_BLASTER = "IR_BLASTER",
  IR_EMITTER_MONO_PLUG = "IR_EMITTER_MONO_PLUG",
  IR_EMITTER_STEREO_PLUG = "IR_EMITTER_STEREO_PLUG",
  TRIGGER_5V = "TRIGGER_5V",
  RS232 = "RS232",
  ERROR = "ERROR",
}

export enum IntegrationSetupScreen {
  START = "START",
  DISCOVERY = "DISCOVERY",
  ALREADY_CONFIGURED = "ALREADY_CONFIGURED",
  CONNECT_EXTERNAL = "CONNECT_EXTERNAL",
  SETUP = "SETUP",
  ADD_ELEMENTS = "ADD_ELEMENTS",

  RESULT_SUCCESS = "RESULT_SUCCESS",
  RESULT_ERROR = "RESULT_ERROR",
}

export enum IntegrationDiscoveryChangeEventType {
  START = "START",
  DISCOVERY = "DISCOVER",
  STOP = "STOP",
}

export enum IntegrationSetupState {
  SETUP = "SETUP",
  WAIT_USER_ACTION = "WAIT_USER_ACTION",
  OK = "OK",
  ERROR = "ERROR",
}

export enum IntegrationSetupError {
  NONE = "NONE",
  NOT_FOUND = "NOT_FOUND",
  CONNECTION_REFUSED = "CONNECTION_REFUSED",
  AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR",
  TIMEOUT = "TIMEOUT",
  OTHER = "OTHER",
}

export enum SeverityLevel {
  EMERG = 0,
  ALERT = 1,
  CRIT = 2,
  ERR = 3,
  WARNING = 4,
  NOTICE = 5,
  INFO = 6,
  DEBUG = 7,
}

export enum RemoveTurnOnDelays {
  previous_cmd_skipped = "previous_cmd_skipped",
  between_skipped_cmds = "between_skipped_cmds",
  never = "never",
}

export enum TurnOffUnusedEntities {
  always = "always",
  in_off_sequence = "in_off_sequence",
  run_off_sequence = "run_off_sequence",
  never = "never",
}

export enum SystemUpdateEventType {
  START = "START",
  PROGRESS = "PROGRESS",
  STOP = "STOP",
}

export enum SystemUpdateProgressState {
  IDLE = "IDLE",
  START = "START",
  RUN = "RUN",
  SUCCESS = "SUCCESS",
  FAILURE = "FAILURE",
  DOWNLOAD = "DOWNLOAD",
  DONE = "DONE",
  PROGRESS = "PROGRESS",
  SUB_PROCESS = "SUB_PROCESS",
}

export enum BatteryStatusValue {
  FULL = "FULL",
  CHARGING = "CHARGING",
  NOT_CHARGING = "NOT_CHARGING",
  DISCHARGING = "DISCHARGING",
  LOW_BATTERY = "LOW_BATTERY",
}

export enum SystemUpdateDownloadState {
  PENDING = "PENDING",
  DOWNLOADING = "DOWNLOADING",
  DOWNLOADED = "DOWNLOADED",
}

export enum BackupStates {
  BACKUPING = "BACKUPING",
  UPLOADING = "UPLOADING",
  RESTART_NEEDED = "RESTART_NEEDED",
}

export enum ResourceUploadStates {
  IDLE = "IDLE",
  UPLOADING = "UPLOADING",
  ERROR = "ERROR",
}

export enum ResourceTypeEnum {
  ICON = "Icon",
  TV_CHANNEL_ICON = "TvChannelIcon",
  BACKGROUND_IMAGE = "BackgroundImage",
}
