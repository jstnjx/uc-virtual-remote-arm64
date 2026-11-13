// Core WebSocket API messages that have a REST Core-API counterpart.
//
// WebSocket Core-API 0.45.0-beta added the messages required for feature parity
// with the REST Core-API (remote-entity, activity, activity group, macro and
// IR messages). The REST implementation is authoritative: every message in this
// table is dispatched to the matching REST operation through the platform's
// internal REST dispatcher, so both APIs share validation, events and storage.
//
// Table fields:
// - method / path: REST operation. `{name}` path segments are taken from
//   msg_data and removed from the body / query.
// - resp: response message name.
// - list: wrap an array response as `{ paging, [list]: items }`.
// - count: answer `{ count }` from the `Pagination-Count` header (HEAD).
// - query: msg_data keys sent as query parameters instead of the body.
// - body: msg_data key holding the request body (default: remaining keys).

const R = (method, path, resp, extra = {}) => ({ method, path, resp, ...extra });

const LIST_QUERY = ["page", "limit", "sort", "order", "lang", "q", "in_group", "group_id", "kind"];

export const WS_REST_MESSAGES = Object.freeze({
  // Activities
  get_activities: R("GET", "/activities", "activities", { list: "activities", query: LIST_QUERY }),
  get_activity_count: R("HEAD", "/activities", "activity_count", { count: true, query: ["in_group", "group_id", "q"] }),
  get_activity: R("GET", "/activities/{entity_id}", "activity"),
  create_activity: R("POST", "/activities", "activity"),
  update_activity: R("PATCH", "/activities/{entity_id}", "activity"),
  delete_activity: R("DELETE", "/activities/{entity_id}", "result"),
  delete_all_activities: R("DELETE", "/activities", "activity_count", { countAfter: "/activities" }),
  get_activity_button_mappings: R("GET", "/activities/{entity_id}/buttons", "activity_button_mappings"),
  merge_activity_button_mappings: R("PATCH", "/activities/{entity_id}/buttons", "activity_button_mappings", { body: "button_mappings" }),
  set_activity_button_mappings: R("POST", "/activities/{entity_id}/buttons", "activity_button_mappings", { body: "button_mappings" }),
  reset_activity_button_mappings: R("DELETE", "/activities/{entity_id}/buttons", "activity_button_mappings"),
  get_activity_button_mapping: R("GET", "/activities/{entity_id}/buttons/{button}", "activity_button_mapping"),
  update_activity_button_mapping: R("PATCH", "/activities/{entity_id}/buttons/{button}", "activity_button_mapping"),
  delete_activity_button_mapping: R("DELETE", "/activities/{entity_id}/buttons/{button}", "activity_button_mappings", { refetch: "/activities/{entity_id}/buttons" }),
  get_activity_button_press_mapping: R("GET", "/activities/{entity_id}/buttons/{button}/{button_press}", "activity_button_press_mapping"),
  delete_activity_button_press_mapping: R("DELETE", "/activities/{entity_id}/buttons/{button}/{button_press}", "result"),
  get_activity_ui: R("GET", "/activities/{entity_id}/ui", "activity_ui"),
  reset_activity_ui: R("DELETE", "/activities/{entity_id}/ui", "activity_ui", { refetch: "/activities/{entity_id}/ui" }),
  get_activity_ui_pages: R("GET", "/activities/{entity_id}/ui/pages", "activity_ui_pages"),
  create_activity_ui_page: R("POST", "/activities/{entity_id}/ui/pages", "activity_ui_page", { createdPage: "/activities/{entity_id}/ui/pages" }),
  reorder_activity_ui_pages: R("PATCH", "/activities/{entity_id}/ui/pages", "activity_ui_pages", { wrap: "page_order", refetch: "/activities/{entity_id}/ui/pages" }),
  reset_activity_ui_pages: R("DELETE", "/activities/{entity_id}/ui/pages", "activity_ui_pages", { refetch: "/activities/{entity_id}/ui/pages" }),
  get_activity_ui_page: R("GET", "/activities/{entity_id}/ui/pages/{page_id}", "activity_ui_page"),
  update_activity_ui_page: R("PATCH", "/activities/{entity_id}/ui/pages/{page_id}", "activity_ui_page", { refetch: "/activities/{entity_id}/ui/pages/{page_id}" }),
  delete_activity_ui_page: R("DELETE", "/activities/{entity_id}/ui/pages/{page_id}", "activity_ui_pages", { refetch: "/activities/{entity_id}/ui/pages" }),

  // Activity groups
  get_activity_groups: R("GET", "/activity_groups", "activity_groups", { list: "activity_groups", query: LIST_QUERY }),
  get_activity_group_count: R("HEAD", "/activity_groups", "activity_group_count", { count: true }),
  get_activity_group: R("GET", "/activity_groups/{group_id}", "activity_group"),
  create_activity_group: R("POST", "/activity_groups", "activity_group"),
  update_activity_group: R("PATCH", "/activity_groups/{group_id}", "activity_group"),
  delete_activity_group: R("DELETE", "/activity_groups/{group_id}", "result"),
  delete_all_activity_groups: R("DELETE", "/activity_groups", "activity_group_count", { countAfter: "/activity_groups" }),

  // Macros
  get_macros: R("GET", "/macros", "macros", { list: "macros", query: LIST_QUERY }),
  get_macro_count: R("HEAD", "/macros", "macro_count", { count: true, query: ["q"] }),
  get_macro: R("GET", "/macros/{entity_id}", "macro"),
  create_macro: R("POST", "/macros", "macro"),
  update_macro: R("PATCH", "/macros/{entity_id}", "macro"),
  delete_macro: R("DELETE", "/macros/{entity_id}", "result"),
  delete_all_macros: R("DELETE", "/macros", "macro_count", { countAfter: "/macros" }),

  // Remote-entities
  get_remotes: R("GET", "/remotes", "remotes", { list: "remotes", query: LIST_QUERY }),
  get_remote_count: R("HEAD", "/remotes", "remote_count", { count: true, query: ["kind", "q"] }),
  get_remote: R("GET", "/remotes/{entity_id}", "remote"),
  create_remote: R("POST", "/remotes", "remote"),
  update_remote: R("PATCH", "/remotes/{entity_id}", "remote"),
  delete_remote: R("DELETE", "/remotes/{entity_id}", "result"),
  delete_all_remotes: R("DELETE", "/remotes", "remote_count", { query: ["kind"], countAfter: "/remotes" }),
  get_remote_ir_dataset: R("GET", "/remotes/{entity_id}/ir", "remote_ir_dataset"),
  get_remote_ir_code: R("GET", "/remotes/{entity_id}/ir/{cmd_id}", "remote_ir_code"),
  add_remote_ir_code: R("POST", "/remotes/{entity_id}/ir/{cmd_id}", "remote_ir_code"),
  update_remote_ir_code: R("PATCH", "/remotes/{entity_id}/ir/{cmd_id}", "remote_ir_code"),
  delete_remote_ir_code: R("DELETE", "/remotes/{entity_id}/ir/{cmd_id}", "result"),
  get_bt_remote_info: R("GET", "/remotes/{entity_id}/bt", "bt_remote_info"),
  get_bt_remote_pairing: R("GET", "/remotes/{entity_id}/bt/pairing", "bt_remote_pairing"),
  set_bt_remote_pairing: R("PUT", "/remotes/{entity_id}/bt/pairing", "result", { query: ["enabled"] }),
  forget_bt_remote: R("DELETE", "/remotes/{entity_id}/bt/pairing", "result"),
  get_remote_button_mappings: R("GET", "/remotes/{entity_id}/buttons", "remote_button_mappings"),
  merge_remote_button_mappings: R("PATCH", "/remotes/{entity_id}/buttons", "remote_button_mappings", { body: "button_mappings" }),
  set_remote_button_mappings: R("POST", "/remotes/{entity_id}/buttons", "remote_button_mappings", { body: "button_mappings" }),
  reset_remote_button_mappings: R("DELETE", "/remotes/{entity_id}/buttons", "remote_button_mappings"),
  get_remote_button_mapping: R("GET", "/remotes/{entity_id}/buttons/{button}", "remote_button_mapping"),
  update_remote_button_mapping: R("PATCH", "/remotes/{entity_id}/buttons/{button}", "remote_button_mapping"),
  delete_remote_button_mapping: R("DELETE", "/remotes/{entity_id}/buttons/{button}", "remote_button_mappings", { refetch: "/remotes/{entity_id}/buttons" }),
  get_remote_button_press_mapping: R("GET", "/remotes/{entity_id}/buttons/{button}/{button_press}", "remote_button_press_mapping"),
  delete_remote_button_press_mapping: R("DELETE", "/remotes/{entity_id}/buttons/{button}/{button_press}", "result"),
  get_remote_ui: R("GET", "/remotes/{entity_id}/ui", "remote_ui"),
  reset_remote_ui: R("DELETE", "/remotes/{entity_id}/ui", "remote_ui", { refetch: "/remotes/{entity_id}/ui" }),
  get_remote_ui_pages: R("GET", "/remotes/{entity_id}/ui/pages", "remote_ui_pages"),
  create_remote_ui_page: R("POST", "/remotes/{entity_id}/ui/pages", "remote_ui_page", { createdPage: "/remotes/{entity_id}/ui/pages" }),
  reorder_remote_ui_pages: R("PATCH", "/remotes/{entity_id}/ui/pages", "remote_ui_pages", { wrap: "page_order", refetch: "/remotes/{entity_id}/ui/pages" }),
  reset_remote_ui_pages: R("DELETE", "/remotes/{entity_id}/ui/pages", "remote_ui_pages", { refetch: "/remotes/{entity_id}/ui/pages" }),
  get_remote_ui_page: R("GET", "/remotes/{entity_id}/ui/pages/{page_id}", "remote_ui_page"),
  update_remote_ui_page: R("PATCH", "/remotes/{entity_id}/ui/pages/{page_id}", "remote_ui_page", { refetch: "/remotes/{entity_id}/ui/pages/{page_id}" }),
  delete_remote_ui_page: R("DELETE", "/remotes/{entity_id}/ui/pages/{page_id}", "remote_ui_pages", { refetch: "/remotes/{entity_id}/ui/pages" }),

  // Infrared code sets and emitters
  get_ir_manufacturers: R("GET", "/ir/codes/manufacturers", "ir_manufacturers", { list: "manufacturers", query: ["q", "page", "limit"] }),
  get_ir_codesets: R("GET", "/ir/codes/manufacturers/{manufacturer_id}", "ir_codesets", { list: "codesets", query: ["q", "page", "limit"] }),
  get_ir_codeset_commands: R("GET", "/ir/codes/manufacturers/{manufacturer_id}/{codeset_id}", "ir_codeset_commands"),
  get_custom_ir_codesets: R("GET", "/ir/codes/custom", "custom_ir_codesets", { list: "codesets", query: ["page", "limit"] }),
  get_custom_ir_codeset_count: R("HEAD", "/ir/codes/custom", "custom_ir_codeset_count", { count: true }),
  create_custom_ir_codeset: R("POST", "/ir/codes/custom", "custom_ir_codeset"),
  delete_all_custom_ir_codesets: R("DELETE", "/ir/codes/custom", "custom_ir_codeset_count", { countAfter: "/ir/codes/custom" }),
  get_custom_ir_codeset: R("GET", "/ir/codes/custom/{codeset_id}", "custom_ir_codeset"),
  update_custom_ir_codeset: R("PATCH", "/ir/codes/custom/{codeset_id}", "result"),
  delete_custom_ir_codeset: R("DELETE", "/ir/codes/custom/{codeset_id}", "result"),
  get_custom_ir_code: R("GET", "/ir/codes/custom/{codeset_id}/{key}", "custom_ir_code"),
  add_custom_ir_code: R("POST", "/ir/codes/custom/{codeset_id}/{key}", "result"),
  update_custom_ir_code: R("PUT", "/ir/codes/custom/{codeset_id}/{key}", "result"),
  delete_custom_ir_code: R("DELETE", "/ir/codes/custom/{codeset_id}/{key}", "result"),
  get_ir_emitters: R("GET", "/ir/emitters", "ir_emitters", { list: "emitters", query: ["page", "limit"], flatten: ["filter", "paging"] }),
  get_ir_emitter_count: R("HEAD", "/ir/emitters", "ir_emitter_count", { count: true, flatten: ["filter"] }),
  get_ir_emitter: R("GET", "/ir/emitters/{device_id}", "ir_emitter"),
  send_ir_cmd: R("PUT", "/ir/emitters/{device_id}/send", "result"),
  stop_ir_cmd: R("PUT", "/ir/emitters/{device_id}/stop_send", "result"),
  get_ir_learning_status: R("GET", "/ir/emitters/{device_id}/learn", "ir_learning_status"),
  start_ir_learning: R("PUT", "/ir/emitters/{device_id}/learn", "result", { query: ["timeout"] }),
  stop_ir_learning: R("DELETE", "/ir/emitters/{device_id}/learn", "ir_learning_status"),

  // Dock firmware updates
  check_dock_update: R("GET", "/docks/devices/{dock_id}/update", "dock_update_info", { query: ["force_update"], forceMethod: (data) => (data.force_update ? "PUT" : "GET") }),
  start_dock_update: R("POST", "/docks/devices/{dock_id}/update", "dock_update_progress"),
  stop_dock_update: R("DELETE", "/docks/devices/{dock_id}/update", "result"),
  get_dock_update_progress: R("GET", "/docks/devices/{dock_id}/update/{update_id}", "dock_update_progress"),
});

function pathFor(template, data, used) {
  return template.replace(/\{([a-z_]+)\}/g, (_match, name) => {
    used.add(name);
    const value = data[name];
    if (value === undefined || value === null || value === "") {
      throw Object.assign(new Error(`Missing ${name}`), { status: 400, errorCode: "BAD_REQUEST" });
    }
    return encodeURIComponent(String(value));
  });
}

function queryFor(keys, data, used) {
  const params = new URLSearchParams();
  for (const key of keys || []) {
    if (data[key] === undefined || data[key] === null) continue;
    used.add(key);
    params.set(key, String(data[key]));
  }
  return params;
}

function flatten(data, keys = []) {
  const result = { ...data };
  for (const key of keys) {
    const value = data[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      delete result[key];
      Object.assign(result, value);
    }
  }
  return result;
}

function restError(result) {
  const payload = result.json && typeof result.json === "object" ? result.json : {};
  return Object.assign(new Error(payload.message || payload.error || `REST request failed with ${result.status}`), {
    status: result.status,
    errorCode: payload.code && payload.code !== "INTERNAL_ERROR" ? payload.code : undefined,
  });
}

function pagingFrom(result, fallbackCount) {
  const header = (name) => Number(result.headers?.[name.toLowerCase()] ?? result.headers?.[name]);
  const count = Number.isFinite(header("Pagination-Count")) ? header("Pagination-Count") : fallbackCount;
  const limit = Number.isFinite(header("Pagination-Limit")) ? header("Pagination-Limit") : Math.max(1, fallbackCount);
  const page = Number.isFinite(header("Pagination-Page")) ? header("Pagination-Page") : 1;
  return { page, limit, count };
}

// Execute a bridged WebSocket message. Returns `{ msg, data, code }` or null
// if the message is not part of the table.
export async function bridgeWebSocketMessage(platform, msg, input = {}) {
  const definition = WS_REST_MESSAGES[msg];
  if (!definition) return null;
  if (typeof platform.restDispatch !== "function") {
    throw Object.assign(new Error("REST dispatcher is not available"), { status: 503 });
  }
  const data = flatten(input && typeof input === "object" ? input : {}, definition.flatten);
  const used = new Set();
  const method = definition.forceMethod ? definition.forceMethod(data) : definition.method;
  const path = pathFor(definition.path, data, used);
  const query = queryFor(definition.query, data, used);
  let body;
  if (["POST", "PUT", "PATCH"].includes(method)) {
    if (definition.wrap) body = { [definition.wrap]: data[definition.wrap] };
    else if (definition.body) body = data[definition.body];
    else {
      body = {};
      for (const [key, value] of Object.entries(data)) if (!used.has(key)) body[key] = value;
    }
  }
  const result = await platform.restDispatch(method, path, { query, body });
  if (result.status >= 400) throw restError(result);

  if (definition.count) {
    const paging = pagingFrom(result, 0);
    return { msg: definition.resp, data: { count: paging.count }, code: 200 };
  }
  if (definition.countAfter) {
    const after = await platform.restDispatch("HEAD", definition.countAfter, { query });
    return { msg: definition.resp, data: { count: pagingFrom(after, 0).count }, code: 200 };
  }
  if (definition.createdPage) {
    const pages = await platform.restDispatch("GET", pathFor(definition.createdPage, data, new Set()), {});
    const items = Array.isArray(pages.json) ? pages.json : [];
    const page = (data.page_id && items.find((item) => item.page_id === data.page_id)) || items.at(-1) || {};
    return { msg: definition.resp, data: page, code: 201 };
  }
  if (definition.refetch) {
    const refetched = await platform.restDispatch("GET", pathFor(definition.refetch, data, new Set()), {});
    if (refetched.status >= 400) throw restError(refetched);
    return { msg: definition.resp, data: refetched.json, code: 200 };
  }
  if (definition.list) {
    const items = Array.isArray(result.json) ? result.json : Array.isArray(result.json?.[definition.list]) ? result.json[definition.list] : [];
    return { msg: definition.resp, data: { paging: pagingFrom(result, items.length), [definition.list]: items }, code: 200 };
  }
  if (definition.resp === "result") {
    const payload = result.json && typeof result.json === "object" && !Array.isArray(result.json) ? result.json : {};
    return { msg: "result", data: payload, code: result.status === 201 ? 201 : 200 };
  }
  return { msg: definition.resp, data: result.json ?? {}, code: result.status === 201 ? 201 : 200 };
}
