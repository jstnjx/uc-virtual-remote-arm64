function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null)
    .map(([key, item]) => [key, clean(item)]));
}

export function paging(input = {}, count = 0) {
  const page = Math.max(1, Number(input?.page || 1));
  const limit = Math.max(1, Math.min(500, Number(input?.limit || 100)));
  return { page, limit, count: Number(count) };
}

function localizedName(value, lang) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const entries = Object.entries(value).filter(([, text]) => typeof text === "string");
  if (!entries.length) return "";
  const culture = String(lang || "").replace("-", "_");
  const base = culture.split("_")[0];
  const pick = (predicate) => entries.find(([key]) => predicate(key))?.[1];
  return pick((key) => key === culture)
    ?? pick((key) => key === base)
    ?? pick((key) => key.split("_")[0] === base && base)
    ?? pick((key) => key === "en")
    ?? pick((key) => key.startsWith("en_"))
    ?? entries[0][1];
}

// Core-API `sort` / `order` / `lang` collection parameters. Without `sort`
// and `order` the storage order is kept.
export function sortItems(items, input = {}) {
  const sort = input.sort ? String(input.sort) : "";
  const order = input.order ? String(input.order).toLowerCase() : "";
  if (!sort && !order) return items;
  if (sort && !["name", "created"].includes(sort)) {
    throw Object.assign(new Error(`Invalid sort field ${sort}`), { status: 400, errorCode: "BAD_REQUEST", code: "BAD_REQUEST" });
  }
  if (order && !["asc", "desc"].includes(order)) {
    throw Object.assign(new Error(`Invalid sort order ${order}`), { status: 400, errorCode: "BAD_REQUEST", code: "BAD_REQUEST" });
  }
  const direction = order === "desc" ? -1 : 1;
  const collator = new Intl.Collator(String(input.lang || "en").replace("_", "-").split("-")[0] || "en", { sensitivity: "base", numeric: true });
  const keyed = items.map((item, index) => ({ item, index }));
  keyed.sort((left, right) => {
    let result = 0;
    if (sort === "created") {
      result = String(left.item.created_at || "").localeCompare(String(right.item.created_at || "")) || left.index - right.index;
    } else {
      const leftName = localizedName(left.item.name ?? left.item.display_name ?? left.item.entity_id ?? left.item.id, input.lang);
      const rightName = localizedName(right.item.name ?? right.item.display_name ?? right.item.entity_id ?? right.item.id, input.lang);
      result = collator.compare(leftName, rightName) || left.index - right.index;
    }
    return result * direction;
  });
  return keyed.map((entry) => entry.item);
}

export function pageSlice(items, input = {}) {
  items = sortItems(items, input || {});
  const meta = paging(input, items.length);
  const start = (meta.page - 1) * meta.limit;
  return { items: items.slice(start, start + meta.limit), paging: meta };
}

// Number entity `min` / `max`: `null` means unbounded, which differs from an
// absent option (default 0 / 100). `clean` must not drop them.
function withNumberLimits(value, options) {
  if (!value?.options || !options || typeof options !== "object") return value;
  for (const key of ["min", "max"]) {
    if (options[key] === null) value.options[key] = null;
  }
  return value;
}

export function coreEntity(entity) {
  if (!entity) return null;
  return withNumberLimits(clean({
    entity_id: entity.entity_id || entity.id,
    entity_type: entity.entity_type,
    integration_id: entity.integration_id,
    device_class: entity.device_class,
    name: entity.name,
    icon: entity.icon,
    features: entity.features,
    entity_commands: entity.entity_commands,
    simple_commands: entity.simple_commands,
    kind: entity.kind || entity.options?.kind,
    ir: entity.ir || entity.options?.ir,
    bt: entity.bt || entity.options?.bt,
    options: entity.options,
    description: entity.description,
    attributes: entity.attributes || {},
    entities: entity.entities,
    included_entities: entity.included_entities || entity.options?.included_entities
  }), entity.entity_type === "number" ? entity.options : null);
}

export function availableEntity(entity) {
  if (!entity) return null;
  return withNumberLimits(clean({
    entity_id: entity.local_id || entity.entity_id || entity.id,
    entity_type: entity.entity_type,
    integration_id: entity.integration_id,
    name: entity.name,
    icon: entity.icon,
    description: entity.description,
    features: entity.features,
    attributes: entity.attributes,
    area: entity.area,
    device_class: entity.device_class,
    device_id: entity.device_id,
    options: entity.options
  }), entity.entity_type === "number" ? entity.options : null);
}

export function coreProfile(profile) {
  if (!profile) return null;
  return clean({
    profile_id: profile.profile_id || profile.id,
    name: profile.name,
    icon: profile.icon,
    restricted: Boolean(profile.restricted),
    description: profile.description
  });
}

export function corePage(page) {
  if (!page) return null;
  return clean({
    page_id: page.page_id || page.id,
    profile_id: page.profile_id,
    name: page.name,
    image: page.image,
    items: (page.items || page.elements || []).map((item, index) => clean({
      ...(item.group_id ? { group_id: item.group_id } : { entity_id: item.entity_id || item.id }),
      pos: Number(item.pos ?? index)
    })),
    pos: Number(page.pos ?? page.sort_order ?? 0)
  });
}

export function coreGroup(group) {
  if (!group) return null;
  return clean({
    group_id: group.group_id || group.id,
    profile_id: group.profile_id,
    name: group.name,
    icon: group.icon,
    entities: group.entities || [],
    description: group.description
  });
}

export function integrationDriver(record) {
  if (!record) return null;
  const metadata = record.metadata || {};
  return clean({
    driver_id: record.driver_id || metadata.driver_id || record.id,
    name: metadata.name || { en: record.name },
    driver_type: record.driver_type || "EXTERNAL",
    driver_url: record.url,
    auth_method: record.auth_method || (record.token ? "TOKEN" : "NONE"),
    version: record.driver_version || metadata.version || "0.0.0",
    min_core_api: metadata.min_core_api,
    icon: metadata.icon,
    enabled: record.enabled !== false,
    description: metadata.description,
    developer: metadata.developer,
    home_page: metadata.home_page,
    device_discovery: Boolean(metadata.device_discovery),
    setup_data_schema: metadata.setup_data_schema,
    instance_count: Number(record.instance_count ?? (record.configured === false ? 0 : 1)),
    has_instances: Boolean(record.has_instances ?? record.configured !== false),
    release_date: metadata.release_date,
    driver_state: record.status === "CONNECTED" ? "RUNNING" : record.status === "ERROR" ? "ERROR" : "STOPPED",
    registry_managed: Boolean(record.registry_managed ?? metadata.registry_managed),
    update_supported: Boolean(record.update_supported),
    update_available: Boolean(record.update_available),
    available_version: record.available_version,
    available_ref: record.available_ref,
    update_checked_at: record.checked_at || record.update_checked_at
  });
}

export function integrationInstance(record) {
  if (!record) return null;
  const metadata = record.metadata || {};
  return clean({
    integration_id: record.id,
    driver_id: record.driver_id || metadata.driver_id || record.id,
    device_id: record.device_id || metadata.device_id,
    name: metadata.instance_name || { en: record.name },
    icon: metadata.icon,
    enabled: record.enabled !== false,
    setup_data: record.setup_data || {},
    device_state: record.device_state || "UNKNOWN"
  });
}

export function integrationStatus(record) {
  if (!record) return null;
  const driver = integrationDriver(record);
  return clean({
    integration_id: record.id,
    name: { en: record.name },
    icon: record.metadata?.icon,
    device_state: record.device_state || "UNKNOWN",
    driver_state: driver.driver_state,
    state: record.status || "DISCONNECTED",
    enabled: record.enabled !== false,
    driver_id: record.driver_id || record.metadata?.driver_id || record.id,
    driver_type: record.driver_type || record.metadata?.driver_type || "EXTERNAL",
    instance_count: Number(record.instance_count ?? 1),
    has_instances: true,
    registry_managed: Boolean(record.registry_managed ?? record.metadata?.registry_managed),
    update_supported: Boolean(record.update_supported),
    update_available: Boolean(record.update_available),
    available_version: record.available_version,
    available_ref: record.available_ref,
    update_checked_at: record.checked_at || record.update_checked_at
  });
}

export function isInternalIntegration(record) {
  if (!record) return false;
  const metadata = record.metadata || {};
  const id = String(record.id || record.integration_id || "");
  const driverId = String(record.driver_id || metadata.driver_id || id);
  return Boolean(
    metadata.internal === true
    || metadata.hidden === true
    || metadata.instance_alias === true
    || (id === "uc.main" && (driverId === "uc" || record.driver_type === "INTERNAL" || record.url === "virtual://core"))
  );
}

export function visibleIntegrations(records = []) {
  return records.filter((record) => !isInternalIntegration(record));
}

export function uniqueDrivers(records) {
  const values = new Map();
  for (const record of visibleIntegrations(records)) {
    const driverId = record.driver_id || record.metadata?.driver_id || record.id;
    const current = values.get(driverId);
    const configured = record.configured !== false;
    if (!current) {
      values.set(driverId, integrationDriver({
        ...record,
        instance_count: configured ? 1 : 0,
        has_instances: configured
      }));
    } else if (configured) {
      current.instance_count = Number(current.instance_count || 0) + 1;
      current.has_instances = true;
    }
  }
  return [...values.values()];
}
