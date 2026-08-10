import { defineStore } from "pinia";
import type {
  AvailableEntity,
  ConfiguredEntity,
  DriverConnectionTestResult,
  DriverId,
  EntityDataLists,
  EntityRequest,
  IntegrationDiscoveryChangeMessage,
  IntegrationDriver,
  IntegrationDriverInfo,
  IntegrationDriverUpdate,
  IntegrationInstance,
  IntegrationRequest,
  IntegrationSetupChangeMessage,
  IntegrationSetupData,
  IntegrationSetupDataInput,
  IntegrationSetupInfo,
  IntegrationStatus,
  IntegrationStateMessage,
  NewIntegrationData,
} from "@/types/integrationInstance";
import ApiConnection from "@/api";
import type { EntityCommandMetadata } from "@/types/activity";
import {
  DeviceState,
  DriverType,
  IntegrationState,
  IntegrationDiscoveryChangeEventType,
  IntegrationSetupState,
  EntityType,
} from "@/types/enums";

import { mergeEventPayload } from "@/composables/dataHelper";
import { createCoalescer } from "@/composables/requestCoalescer";
import { paginationCount } from "@/composables/listing";
import {
  createCachedList,
  createListCacheMeta,
  loadList,
  loadListInto,
  replaceListContents,
} from "@/composables/storeCache";
import { eventRouter } from "@/api/eventRouter";
import type { NormalizedEvent } from "@/api/eventRouter";
import type { WsEntityState, WsMsgData } from "@/types/websocket";
import type { Headers } from "@/types/rest";
import { appStateStore } from "@/stores/appState";

const API = ApiConnection.integrations;

/** Coalesces WS-event-triggered reloads (004-ws-event-handling-rework.md §3.2). */
const coalesce = createCoalescer();

/**
 * Entity types owned by this store (route registration — events for other
 * types never reach this store; processing them here caused full
 * configured-entity reloads on every activity event, REVIEW-Claude-ws-events.md
 * P0-1). Derived from the `EntityType` enum so it cannot drift (P3-6 D):
 * `activity` / `macro` / `remote` are owned elsewhere — `remote` is registered
 * separately as a shared route with the remotes store.
 */
export const INTEGRATION_ENTITY_TYPES: string[] = Object.values(
  EntityType,
).filter(
  (t) =>
    t !== EntityType.activity &&
    t !== EntityType.macro &&
    t !== EntityType.remote,
);

/** The paged-list query echo stored alongside a fetched page. */
interface PagedListMeta {
  limit: number;
  page: number;
  searchText: string;
  integrationId: string;
  entityTypes: string;
}

/**
 * Shared body for the mirror `…ByPageByLimit` getters (P3-6 B). Fetch a page
 * via `fetcher`, write it and the query echo into `pageState`, and return the
 * store's paged envelope. `getList` reads the family's own list field
 * (avoiding a dynamic-key cast, ADR 0002); its contents are replaced in place,
 * never the array itself — views hold that array (#683).
 */
async function fetchPagedInto<
  T,
  // `count` is response metadata, not query echo, so it constrains only the
  // page state — not the `query` argument (#685).
  S extends PagedListMeta & { count: number },
>(
  pageState: S,
  getList: (state: S) => T[],
  fetcher: () => Promise<{ data: T[]; headers?: object }>,
  query: PagedListMeta,
): Promise<{ data: S; headers: object }> {
  const res = await fetcher();
  replaceListContents(getList(pageState), res.data ?? []);
  pageState.count = paginationCount(res.headers as Headers);
  pageState.limit = query.limit;
  pageState.page = query.page;
  pageState.searchText = query.searchText;
  pageState.integrationId = query.integrationId;
  pageState.entityTypes = query.entityTypes;
  return { data: pageState, headers: res.headers || {} };
}

export const integrationsStore = defineStore("integrations", {
  state: () => ({
    inited: false,
    statuses: [] as IntegrationStatus[],
    instances: [] as IntegrationInstance[],
    enabledDrivers: [] as IntegrationDriverInfo[],
    instantiableDrivers: [] as IntegrationDriverInfo[],
    // notConfiguredDrivers: [] as IntegrationDriverInfo[],
    notConfiguredCustomDrivers: [] as IntegrationDriverInfo[],
    notConfiguredExternalDrivers: [] as IntegrationDriverInfo[],
    availableEntities: [] as AvailableEntity[],
    configuredIntegrationEntities: [] as ConfiguredEntity[],
    configuredEntities: [] as ConfiguredEntity[],
    configuredSensorEntities: createCachedList<ConfiguredEntity>(),
    configuredSelectEntities: createCachedList<ConfiguredEntity>(),
    /**
     * Fetch metadata for the flat list fields above (storeCache.ts, P1-3):
     * `loaded` separates a server-side empty list from "never fetched",
     * `error` keeps the last fetch failure. The list fields themselves stay
     * plain arrays — components read them directly.
     */
    fetchMeta: {
      statuses: createListCacheMeta(),
      instances: createListCacheMeta(),
      enabledDrivers: createListCacheMeta(),
      instantiableDrivers: createListCacheMeta(),
      notConfiguredCustomDrivers: createListCacheMeta(),
      notConfiguredExternalDrivers: createListCacheMeta(),
    },
    configuredEntitiesByTypes: {
      list: [],
      types: "",
    } as { list: ConfiguredEntity[]; types: string },
    commands: [] as EntityCommandMetadata[],
    discoverActive: false,
    discovered: [] as IntegrationDriverInfo[],
    availableEntitiesByPage: {
      availableEntities: [] as AvailableEntity[],
      // the server's total, echoed from the response headers (#685)
      count: 0,
      limit: 20,
      page: 1,
      searchText: "",
      integrationId: "",
      entityTypes: "",
    },
    configuredEntitiesByPage: {
      configuredEntities: [] as ConfiguredEntity[],
      // the server's total, echoed from the response headers (#685)
      count: 0,
      limit: 20,
      page: 1,
      searchText: "",
      integrationId: "",
      entityTypes: "",
    },
  }),

  actions: {
    init() {
      if (this.$state.inited) {
        return;
      }

      this.$state.inited = true;

      const onEntityEvent = (e: NormalizedEvent) => {
        if (e.eventType === "change" && e.entityId && e.newState) {
          this.applyEntityChange(e.entityId, e.newState);
        } else if (e.eventType === "change" && e.entityId) {
          this.reloadConfiguredEntityData(e.entityId);
        } else if (e.eventType === "new" && e.entityId && e.newState) {
          // NEW events carry the complete entity (core guarantee, see
          // docs/specs/003-verify-core-new-event-completeness.md)
          this.applyEntityNew(e.entityId, e.newState as ConfiguredEntity);
        } else if (e.eventType === "delete" && e.entityId) {
          this.applyEntityDelete(e.entityId);
        } else {
          coalesce("integrations:entities", () =>
            Promise.all([
              this.getConfiguredEntities(null, true),
              this.getConfiguredEntitiesByPageByLimit(
                this.configuredEntitiesByPage.integrationId,
                true,
                this.configuredEntitiesByPage.page,
                this.configuredEntitiesByPage.limit,
                this.configuredEntitiesByPage.searchText,
                this.configuredEntitiesByPage.entityTypes,
              ),
            ]),
          );
        }
        this.socketUpdate(e.msgData, e);
      };
      eventRouter.route(
        "entity_change",
        INTEGRATION_ENTITY_TYPES,
        onEntityEvent,
        {
          name: "integrations",
        },
      );
      // remote entities are also configured entities → deliberate dual-owner
      // route with the remotes store (task doc §4.1)
      eventRouter.route("entity_change", "remote", onEntityEvent, {
        name: "integrations",
        shared: true,
      });

      eventRouter.route(
        "integration_driver_change",
        undefined,
        (e) => {
          // show newly created integration driver in overview screen.
          // The integration setup process might be cancelled: the driver still exists though!
          if (e.msgData.event_type === "NEW") {
            // A new driver appeared: refresh the driver lists the add-integration
            // UI renders from. Coalesced: a burst of driver events costs one round.
            coalesce("integrations:drivers", () =>
              Promise.all([
                this.getStatuses(true),
                this.getInstantiableDrivers(true),
                this.getNotConfiguredCustomDrivers(true),
                this.getNotConfiguredExternalDrivers(true),
              ]).then(() => {
                this.socketUpdate(e.msgData, e);
              }),
            );
          }
        },
        { name: "integrations" },
      );

      eventRouter.route(
        "integration_change",
        undefined,
        (e) => {
          if (
            e.eventType === "change" &&
            e.newState &&
            e.msgData.integration_id
          ) {
            void this.updateStatusInt(e.newState as IntegrationStatus);
            this.socketUpdate(e.msgData, e);
          } else {
            // MONITORING NOTE (004-ws-event-handling-rework.md OQ-6): an
            // integration_change can only invalidate statuses and instances.
            // Driver/command metadata changes only with an external driver
            // update, which the fetch-fresh-on-open behavior of the integration
            // screens covers. If integration UIs ever show stale driver/command
            // metadata after driver updates, widen this reload — do not revert
            // to reloading everything on every event.
            coalesce("integrations:change", () =>
              Promise.all([
                this.getStatuses(true),
                this.getInstances(true),
              ]).then(() => {
                this.socketUpdate(e.msgData, e);
              }),
            );
            if (e.eventType === "new" || e.eventType === "delete") {
              // The not-configured driver lists are filtered by
              // `has_instances=false`, so a created/deleted instance flips a
              // CUSTOM/EXTERNAL driver in or out of them. Without this the
              // just-configured driver stays in the overview next to its new
              // integration (duplicate card until reload). Own coalesce key:
              // the "integrations:change" closure is replaced by later events.
              coalesce("integrations:notConfiguredDrivers", () =>
                Promise.all([
                  this.getNotConfiguredCustomDrivers(true),
                  this.getNotConfiguredExternalDrivers(true),
                ]),
              );
            }
          }
        },
        { name: "integrations" },
      );

      eventRouter.route(
        "integration_discovery",
        undefined,
        (e) =>
          this.integrationDiscovery(
            e.msgData as IntegrationDiscoveryChangeMessage,
          ),
        { name: "integrations" },
      );
      eventRouter.route(
        "integration_setup_change",
        undefined,
        (e) =>
          this.integrationSetupChange(
            e.msgData as IntegrationSetupChangeMessage,
          ),
        { name: "integrations" },
      );
      eventRouter.route(
        "integration_state",
        undefined,
        (e) => this.stateChange(e.msgData as IntegrationStateMessage),
        { name: "integrations" },
      );

      appStateStore().registerResyncHandler("integrations", () => {
        if (
          this.$state.statuses.length > 0 ||
          this.$state.instances.length > 0
        ) {
          coalesce("integrations:change", () =>
            Promise.all([this.getStatuses(true), this.getInstances(true)]),
          );
        }
        if (
          this.$state.configuredEntities.length > 0 ||
          this.$state.configuredEntitiesByPage.configuredEntities.length > 0
        ) {
          coalesce("integrations:entities", () =>
            Promise.all([
              this.getConfiguredEntities(null, true),
              this.getConfiguredEntitiesByPageByLimit(
                this.configuredEntitiesByPage.integrationId,
                true,
                this.configuredEntitiesByPage.page,
                this.configuredEntitiesByPage.limit,
                this.configuredEntitiesByPage.searchText,
                this.configuredEntitiesByPage.entityTypes,
              ),
            ]),
          );
        }
      });
    },

    socketUpdate(msg_data: WsMsgData, event?: NormalizedEvent) {
      // Placeholder action for $onAction subscribers (edit screens).
      void event;
    },

    async getStatuses(update = false): Promise<IntegrationStatus[]> {
      this.init();
      return loadListInto(
        this.$state.fetchMeta.statuses,
        () => this.$state.statuses,
        (items) => (this.$state.statuses = items),
        () => API.getIntegrationStatuses(),
        update,
      );
    },

    async updateStatusInt(intStatus: IntegrationStatus) {
      if (this.$state.statuses && this.$state.statuses.length > 0) {
        const existing = this.$state.statuses.find(
          (e) => e.integration_id === intStatus.integration_id,
        );
        if (existing) {
          mergeEventPayload(existing, intStatus);
        } else {
          // Unknown integration: refresh the list, coalesced — a burst of
          // events must not multiply into parallel reloads (P0-2).
          coalesce("integrations:statuses", () => this.getStatuses(true));
        }
      }
    },

    async getInstances(update = false): Promise<IntegrationInstance[]> {
      this.init();
      return loadListInto(
        this.$state.fetchMeta.instances,
        () => this.$state.instances,
        (items) => (this.$state.instances = items),
        () => API.getInstances(),
        update,
      );
    },

    async getEnabledDrivers(update = false): Promise<IntegrationDriverInfo[]> {
      this.init();
      if (this.$state.discoverActive) {
        return this.$state.enabledDrivers;
      }

      return loadListInto(
        this.$state.fetchMeta.enabledDrivers,
        () => this.$state.enabledDrivers,
        (items) => (this.$state.enabledDrivers = items),
        () => API.getEnabledDrivers(),
        update,
      );
    },

    async getInstantiableDrivers(
      update = false,
    ): Promise<IntegrationDriverInfo[]> {
      this.init();
      if (this.$state.discoverActive) {
        return this.$state.instantiableDrivers;
      }

      return loadListInto(
        this.$state.fetchMeta.instantiableDrivers,
        () => this.$state.instantiableDrivers,
        (items) => (this.$state.instantiableDrivers = items),
        () => API.getInstantiableDrivers(),
        update,
      );
    },

    async getNotConfiguredCustomDrivers(
      update = false,
    ): Promise<IntegrationDriverInfo[]> {
      this.init();
      return loadListInto(
        this.$state.fetchMeta.notConfiguredCustomDrivers,
        () => this.$state.notConfiguredCustomDrivers,
        (items) => (this.$state.notConfiguredCustomDrivers = items),
        () => API.getNotConfiguredCustomDrivers(),
        update,
      );
    },

    async getNotConfiguredExternalDrivers(
      update = false,
    ): Promise<IntegrationDriverInfo[]> {
      this.init();
      return loadListInto(
        this.$state.fetchMeta.notConfiguredExternalDrivers,
        () => this.$state.notConfiguredExternalDrivers,
        (items) => (this.$state.notConfiguredExternalDrivers = items),
        () => API.getNotConfiguredExternalDrivers(),
        update,
      );
    },

    async getCommandMetadata(update = false): Promise<EntityCommandMetadata[]> {
      if (!this.$state.commands || !this.$state.commands.length || update) {
        this.$state.commands =
          (await ApiConnection.config.getCommandData(update)) ?? [];
      }
      return this.$state.commands;
    },

    async getConfiguredEntity(entity_id: string): Promise<ConfiguredEntity> {
      this.init();
      return await API.getEntity(entity_id);
    },

    async getEntities(
      integration_id: string,
      update = false,
      user_fetch_first_page = false,
    ): Promise<AvailableEntity[]> {
      this.init();
      if (
        (!this.$state.availableEntities ||
          !this.$state.availableEntities.length ||
          update) &&
        user_fetch_first_page
      ) {
        const paramFilter = "NEW";
        this.$state.availableEntities =
          (await API.getEntities(integration_id, paramFilter, true)) ?? [];
      } else if (
        !this.$state.availableEntities ||
        !this.$state.availableEntities.length ||
        update
      ) {
        const paramFilter = "NEW";
        this.$state.availableEntities =
          (await API.getEntities(integration_id, paramFilter)) ?? [];
      }
      return this.$state.availableEntities;
    },

    async getEntitiesByPage(
      integration_id: string,
      update = false,
      fetch_first_page = false,
      reload = false,
      page = 1,
      searchText = "",
      entityTypes = "",
    ): Promise<{ data: EntityDataLists; headers: object }> {
      this.init();
      let newEntities = <{ data: AvailableEntity[]; headers?: object }>{};
      if (
        (!this.$state.availableEntities ||
          !this.$state.availableEntities.length ||
          update) &&
        (fetch_first_page || reload)
      ) {
        const paramFilter = "NEW";
        newEntities = await API.getAvailableEntitiesPaged({
          integrationId: integration_id,
          reload,
          page,
          limit: 50,
          filter: paramFilter,
          search: searchText,
          types: entityTypes,
        });
        this.$state.availableEntities = newEntities.data ?? [];
      } else if (
        !this.$state.availableEntities ||
        !this.$state.availableEntities.length ||
        update
      ) {
        const paramFilter = "NEW";
        newEntities = await API.getAvailableEntitiesPaged({
          integrationId: integration_id,
          reload,
          page,
          limit: 50,
          filter: paramFilter,
          search: searchText,
          types: entityTypes,
        });
        this.$state.availableEntities = this.$state.availableEntities.concat(
          newEntities.data ?? [],
        );
      }
      return {
        data: {
          fullList: this.$state.availableEntities,
          loadedEntityList: newEntities.data,
        },
        headers: newEntities.headers || {},
      };
    },

    async getAvailableEntitiesByPageByLimit(
      integrationId = "",
      update = false,
      page = 1,
      limit = 100,
      searchText = "",
      entityTypes = "",
    ): Promise<{
      data: {
        availableEntities: AvailableEntity[];
        limit: number;
        page: number;
      };
      headers: object;
    }> {
      this.init();
      return fetchPagedInto(
        this.$state.availableEntitiesByPage,
        (state) => state.availableEntities,
        () =>
          API.getAvailableEntitiesPaged({
            integrationId,
            reload: update,
            page,
            limit,
            filter: "NEW",
            search: searchText,
            types: entityTypes,
          }),
        { limit, page, searchText, integrationId, entityTypes },
      );
    },

    /** All lists that can cache a configured entity. */
    cachedEntityLists(): ConfiguredEntity[][] {
      return [
        this.$state.configuredEntities,
        this.$state.configuredEntitiesByPage.configuredEntities,
        this.$state.configuredSensorEntities.list,
        this.$state.configuredSelectEntities.list,
      ];
    },

    /**
     * The cached copy of an entity, from whichever list holds it. Reactive:
     * `applyEntityChange` merges into these entries in place, so a render that
     * reads the result follows the entity's live state.
     */
    findCachedEntity(entityId: string): ConfiguredEntity | undefined {
      for (const list of this.cachedEntityLists()) {
        const cached = list.find((e) => e.entity_id === entityId);
        if (cached) {
          return cached;
        }
      }
      return undefined;
    },

    /**
     * Store contract (004-ws-event-handling-rework.md §4.2): merge a possibly
     * partial payload into every cached list entry, in place. Cache miss
     * updates nothing — overview pages render cached data, edit screens
     * fetch fresh via REST. (The former full reload on miss fired on EVERY
     * unknown-entity event — P0-1.)
     */
    applyEntityChange(entityId: string, patch: WsEntityState) {
      if (patch.entity_id && patch.entity_id !== entityId) {
        return;
      }
      // WS payload → typed-entity merge boundary (ADR 0002).
      const entityPatch = patch as Partial<ConfiguredEntity>;
      for (const list of this.cachedEntityLists()) {
        const cached = list.find((e) => e.entity_id === entityId);
        if (cached) {
          mergeEventPayload(cached, entityPatch);
        }
      }
    },

    /** NEW events carry the complete entity (core guarantee, task doc OQ-2). */
    applyEntityNew(entityId: string, entity: ConfiguredEntity) {
      if (
        !this.$state.configuredEntities.some((e) => e.entity_id === entityId)
      ) {
        this.$state.configuredEntities.push(entity);
      }
      coalesce("integrations:entityPage", () =>
        this.getConfiguredEntitiesByPageByLimit(
          this.configuredEntitiesByPage.integrationId,
          true,
          this.configuredEntitiesByPage.page,
          this.configuredEntitiesByPage.limit,
          this.configuredEntitiesByPage.searchText,
          this.configuredEntitiesByPage.entityTypes,
        ),
      );
    },

    /** Targeted removal — no full reloads on delete (task doc P1-3). */
    applyEntityDelete(entityId: string) {
      let removedFromPage = false;
      for (const list of this.cachedEntityLists()) {
        const index = list.findIndex((e) => e.entity_id === entityId);
        if (index > -1) {
          if (
            list === this.$state.configuredEntitiesByPage.configuredEntities
          ) {
            removedFromPage = true;
          }
          list.splice(index, 1);
        }
      }
      if (
        removedFromPage ||
        this.$state.configuredEntitiesByPage.configuredEntities.length > 0
      ) {
        // total count changed → refresh pagination, coalesced
        coalesce("integrations:entityPage", () =>
          this.getConfiguredEntitiesByPageByLimit(
            this.configuredEntitiesByPage.integrationId,
            true,
            this.configuredEntitiesByPage.page,
            this.configuredEntitiesByPage.limit,
            this.configuredEntitiesByPage.searchText,
            this.configuredEntitiesByPage.entityTypes,
          ),
        );
      }
    },

    /** Change event without payload: reload the single entity via REST. */
    async reloadConfiguredEntityData(entityId: string) {
      const updatedEntity = await API.getEntity(entityId);
      this.applyEntityChange(updatedEntity.entity_id, updatedEntity);
    },

    async getConfiguredEntities(
      inst_id: string | null = null,
      update = false,
    ): Promise<ConfiguredEntity[]> {
      this.init();
      if (
        !this.$state.configuredEntities ||
        !this.$state.configuredEntities.length ||
        update
      ) {
        this.$state.configuredEntities =
          (await API.getConfiguredEntities(inst_id)) ?? [];
      }
      return this.$state.configuredEntities;
    },

    /**
     * Single source of truth for the per-type configured-entity getters
     * (P3-6 A). Each supported type keeps its own `$state` cached list (cache
     * identity preserved); the body is shared. The named getters below are
     * thin wrappers so call sites read the same.
     */
    async getConfiguredEntitiesOfType(
      type: EntityType.sensor | EntityType.select,
      update = false,
    ): Promise<ConfiguredEntity[]> {
      this.init();
      const cache =
        type === EntityType.select
          ? this.$state.configuredSelectEntities
          : this.$state.configuredSensorEntities;
      return loadList(
        cache,
        () => API.getConfiguredEntitiesByTypes(type),
        update,
      );
    },

    async getConfiguredSensorEntities(
      update = false,
    ): Promise<ConfiguredEntity[]> {
      return this.getConfiguredEntitiesOfType(EntityType.sensor, update);
    },

    async getConfiguredSelectEntities(
      update = false,
    ): Promise<ConfiguredEntity[]> {
      return this.getConfiguredEntitiesOfType(EntityType.select, update);
    },

    async getConfiguredEntitiesByTypes(
      entityTypes: string,
      update = false,
    ): Promise<{ list: ConfiguredEntity[]; types: string }> {
      this.init();
      if (
        !this.$state.configuredEntitiesByTypes.list ||
        !this.$state.configuredEntitiesByTypes.list.length ||
        this.$state.configuredEntitiesByTypes.types != entityTypes ||
        update
      ) {
        this.$state.configuredEntitiesByTypes.list =
          (await API.getConfiguredEntitiesByTypes(entityTypes)) ?? [];

        this.$state.configuredEntitiesByTypes.types = entityTypes;
      }
      return this.$state.configuredEntitiesByTypes;
    },

    async getConfiguredEntitiesByPageByLimit(
      integrationId = "",
      update = false,
      page = 1,
      limit = 100,
      searchText = "",
      entityTypes = "",
      exclude = "",
    ): Promise<{
      data: {
        configuredEntities: ConfiguredEntity[];
        limit: number;
        page: number;
      };
      headers: object;
    }> {
      this.init();
      return fetchPagedInto(
        this.$state.configuredEntitiesByPage,
        (state) => state.configuredEntities,
        () =>
          API.getConfiguredEntitiesPaged({
            integrationIds: integrationId,
            reload: update,
            page,
            limit,
            search: searchText,
            types: entityTypes,
            exclude,
          }),
        { limit, page, searchText, integrationId, entityTypes },
      );
    },

    async getConfiguredEntitiesByPage(
      integration_id = "",
      update = false,
      fetch_first_page = false,
      reload = false,
      page = 1,
      searchText = "",
      entityTypes = "",
    ): Promise<{ data: ConfiguredEntity[]; headers: object }> {
      this.init();
      let newEntities = <{ data: ConfiguredEntity[]; headers?: object }>{};
      if (
        (!this.$state.configuredIntegrationEntities ||
          !this.$state.configuredIntegrationEntities.length ||
          update) &&
        (fetch_first_page || reload)
      ) {
        newEntities = await API.getConfiguredEntitiesPaged({
          integrationIds: integration_id,
          reload,
          page,
          limit: 50,
          search: searchText,
          types: entityTypes,
        });
        this.$state.configuredIntegrationEntities = newEntities.data ?? [];
      } else if (
        !this.$state.configuredIntegrationEntities ||
        !this.$state.configuredIntegrationEntities.length ||
        update
      ) {
        newEntities = await API.getConfiguredEntitiesPaged({
          integrationIds: integration_id,
          reload,
          page,
          limit: 50,
          search: searchText,
          types: entityTypes,
        });
        this.$state.configuredIntegrationEntities =
          this.$state.configuredIntegrationEntities.concat(
            newEntities.data ?? [],
          );
      }
      return {
        data: this.$state.configuredIntegrationEntities,
        headers: newEntities.headers || {},
      };
    },

    async stateChange(msg_data: IntegrationStateMessage) {
      const index = this.$state.statuses.findIndex((item) => {
        return item.integration_id === msg_data.integration_id;
      });

      if (index > -1) {
        // DeviceState is a value-subset of IntegrationState with identical key
        // names, so map by name rather than a blind double-cast.
        const deviceState = msg_data.device_state ?? DeviceState.UNKNOWN;
        this.$state.statuses[index].state =
          IntegrationState[deviceState as keyof typeof IntegrationState];
      }

      return true;
    },

    async addIntegration(
      driver_id: DriverId,
      data: NewIntegrationData,
    ): Promise<IntegrationInstance> {
      return await API.addIntegration(driver_id, data);
    },

    async getIntegrationStatus(
      inst_id: string,
      update = false,
    ): Promise<IntegrationStatus | undefined> {
      if (update || !this.$state.statuses || !this.$state.statuses.length) {
        await this.getStatuses(update);
      }
      return this.$state.statuses.find((intsg: IntegrationStatus) => {
        return intsg.integration_id === inst_id;
      });
    },

    async getIntegration(
      inst_id: string,
      update = false,
    ): Promise<{
      inst: IntegrationInstance | null;
      status: IntegrationStatus | null;
      driver: IntegrationDriver | null;
      _error?: Record<string, any>;
    }> {
      let inst = null;
      let status = null;
      let driver = null;
      let hasError = false;
      const errors: Record<string, any> = {};
      try {
        inst = await API.getIntegration(inst_id);
      } catch (e) {
        hasError = true;
        errors.inst = e;
      }
      if (inst) {
        try {
          driver = await API.getDriver(inst.driver_id);
        } catch (e) {
          hasError = true;
          errors.driver = e;
        }
      }
      try {
        status = await this.getIntegrationStatus(inst_id, update);
      } catch (e) {
        hasError = true;
        errors.status = e;
      }
      return {
        inst,
        status: status || null,
        driver,
        _error: hasError ? errors : undefined,
      };
    },

    async updateEntityLists(
      inst_id: string,
      user_fetch_first_page = false,
    ): Promise<{
      entities: AvailableEntity[];
      configured: ConfiguredEntity[];
    }> {
      const entitiesPromise = this.getEntities(
        inst_id,
        true,
        user_fetch_first_page,
      );
      return entitiesPromise.then(async (entities: AvailableEntity[]) => {
        const configured = await this.getConfiguredEntities(inst_id, true);
        return {
          entities,
          configured,
        };
      });
    },

    async pagedUpdateAvailableEntityLists(
      inst_id: string,
      fetch_first_page = false,
      reload = false,
      page = 1,
      searchText = "",
      entityTypes = "",
    ): Promise<{ data: EntityDataLists; headers: any }> {
      const entities = await this.getEntitiesByPage(
        inst_id,
        true,
        fetch_first_page,
        reload,
        page,
        searchText,
        entityTypes,
      );
      return entities;
    },

    async pagedUpdateConfiguredEntityLists(
      inst_id: string,
      fetch_first_page = false,
      reload = false,
      page = 1,
      searchText = "",
      entityTypes = "",
    ): Promise<{ data: ConfiguredEntity[]; headers: any }> {
      const configured = await this.getConfiguredEntitiesByPage(
        inst_id,
        true,
        fetch_first_page,
        reload,
        page,
        searchText,
        entityTypes,
      );
      return configured;
    },

    async updateIntegration(
      inst_id: string,
      data: IntegrationRequest,
    ): Promise<IntegrationInstance> {
      const inst = await API.updateIntegration(inst_id, data);
      // Best-effort refresh: the update itself succeeded, so a failed reload
      // must not reject this action (P1-4 — explicit fire-and-forget).
      void Promise.all([this.getInstances(true), this.getStatuses(true)]).catch(
        (e) => console.error("Failed to refresh after integration update:", e),
      );
      return inst;
    },

    async addInstanceEntity(
      inst: IntegrationInstance,
      entity: AvailableEntity,
    ): Promise<ConfiguredEntity> {
      return await API.addInstanceEntity(inst, entity);
    },

    async addInstanceEntities(
      inst: IntegrationInstance,
      entity_ids: string[],
    ): Promise<string[]> {
      return await API.addInstanceEntities(inst, entity_ids);
    },

    async removeEntity(entity: ConfiguredEntity): Promise<boolean> {
      return await API.removeEntity(entity);
    },

    async removeEntities(entity_ids: string[]): Promise<boolean> {
      return await API.removeEntities(entity_ids);
    },

    async updateEntity(
      entity_id: string,
      changes: EntityRequest,
    ): Promise<ConfiguredEntity> {
      const resp = await API.updateEntity(entity_id, changes);
      this.applyEntityChange(entity_id, resp);

      if (resp) {
        return resp;
      }
      return this.$state.configuredEntities.find((entity: ConfiguredEntity) => {
        return entity.entity_id === entity_id;
      }) as ConfiguredEntity;
    },

    async connectInst(inst_id: string): Promise<{
      inst: IntegrationInstance;
      status: IntegrationStatus;
    }> {
      const inst = await API.connectInst(inst_id);
      const status = await this.getIntegrationStatus(inst_id, true);
      return {
        inst,
        status: status as IntegrationStatus,
      };
    },

    async disconnectInst(inst_id: string): Promise<{
      inst: IntegrationInstance;
      status: IntegrationStatus;
    }> {
      const inst = await API.disconnectInst(inst_id);
      const status = await this.getIntegrationStatus(inst_id, true);
      return {
        inst,
        status: status as IntegrationStatus,
      };
    },

    async deleteIntegration(integration: IntegrationStatus): Promise<boolean> {
      const resp = await API.deleteIntegration(integration);
      await Promise.all([
        this.getStatuses(true),
        this.getNotConfiguredCustomDrivers(true),
        this.getNotConfiguredExternalDrivers(true),
      ]);
      return resp;
    },

    async updateDriver(
      driver_id: string,
      data: IntegrationDriverUpdate,
    ): Promise<IntegrationDriver> {
      await API.updateDriver(driver_id, data);
      return API.getDriver(driver_id);
    },

    async startDiscovery(): Promise<boolean> {
      if (this.$state.discoverActive) {
        return true;
      }
      const result = await API.startDiscovery();
      this.$state.discoverActive = true;
      this.$state.discovered = [];
      return result;
    },

    async stopDiscovery(): Promise<boolean> {
      this.$state.discoverActive = false;
      this.$state.discovered = [];
      return API.stopDiscovery();
    },

    async integrationDiscovery(msg_data: IntegrationDiscoveryChangeMessage) {
      if (msg_data.event_type === IntegrationDiscoveryChangeEventType.START) {
        this.$state.discoverActive = true;
      } else if (
        msg_data.event_type === IntegrationDiscoveryChangeEventType.STOP
      ) {
        this.$state.discoverActive = false;
      } else if (
        this.$state.discoverActive &&
        msg_data.event_type === IntegrationDiscoveryChangeEventType.DISCOVERY &&
        msg_data.integration
      ) {
        this.$state.discovered.push({
          driver_id: msg_data.integration.id,
          name: {
            en: msg_data.integration.name,
          },
          driver_type: DriverType.EXTERNAL,
          driver_url: msg_data.integration.driver_url,
          pwd_protected: msg_data.integration.pwd_protected,
          version: msg_data.integration.version || "",
          icon: msg_data.integration.icon,
          developer_name: msg_data.integration.developer_name,
          discovered: true,
        });
      }
    },

    async testConnection(
      driver_id: string,
      driver_url: string,
      token: string | undefined = undefined,
    ): Promise<DriverConnectionTestResult> {
      return API.testConnection(driver_id, driver_url, token);
    },

    async registerIntegration(
      driver_id: string,
      driver_url: string,
      token: string | undefined = undefined,
    ): Promise<IntegrationDriver> {
      return API.registerIntegration(driver_id, driver_url, token);
    },

    async getDriver(driver_id: string): Promise<IntegrationDriver> {
      return API.getDriver(driver_id);
    },

    async startSetupIntegration(
      driver_id: string,
      reconfigure = false,
      setup_data: IntegrationSetupDataInput,
    ): Promise<IntegrationSetupInfo> {
      return API.startSetupIntegration(driver_id, reconfigure, setup_data);
    },

    async continueSetupIntegration(
      driver_id: string,
      setup_data: IntegrationSetupData,
    ): Promise<IntegrationSetupInfo> {
      return API.continueSetupIntegration(driver_id, setup_data);
    },

    async integrationSetupChange(data_msg: IntegrationSetupChangeMessage) {
      if (data_msg.state === IntegrationSetupState.OK) {
        // WS-event-triggered best-effort refresh: nothing awaits the route
        // callback, so a failure must not become an unhandled rejection.
        await this.getInstances(true).catch((e) =>
          console.error("Failed to refresh instances after setup:", e),
        );
      }
    },

    async stopSetupIntegration(driver_id: string): Promise<boolean> {
      const response = await API.stopSetupIntegration(driver_id);
      await this.getInstances(true);
      return response;
    },
  },
});
