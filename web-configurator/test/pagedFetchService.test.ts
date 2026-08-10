/**
 * Characterization tests for the paged-fetch service methods
 * (dedup-copy-paste-families B.1). They pin the exact request — url, method,
 * params, limit, page — that each `…ByPage(ByLimit)` service method issues via
 * `rest.baseGet`, so the B.2 collapse onto a `{ page, limit, search, types }`
 * options object can be proven byte-for-byte behaviour-preserving (B.5).
 *
 * Post-collapse: these call the consolidated `…Paged({...})` methods; the
 * asserted requests are byte-for-byte identical to what the former
 * `…ByPage(ByLimit)` methods issued.
 */
import { describe, expect, test } from "vitest";
import type { RawAxiosRequestConfig } from "axios";
import ServiceIntegrations from "@/api/services/integrations";
import ServiceMacros from "@/api/services/macros";
import type Connection from "@/api/connection";

interface BaseGetCall {
  config: RawAxiosRequestConfig;
  limit: number;
  page: number;
}

/** Build a service backed by a rest client that records `baseGet` calls. */
function withCapturingRest<T>(Service: new (c: Connection) => T): {
  service: T;
  calls: BaseGetCall[];
} {
  const calls: BaseGetCall[] = [];
  const rest = {
    baseGet: (config: RawAxiosRequestConfig, limit: number, page: number) => {
      calls.push({ config, limit, page });
      return Promise.resolve({ data: [], headers: {} });
    },
  };
  const connection = { rest: () => rest } as unknown as Connection;
  return { service: new Service(connection), calls };
}

describe("paged-fetch service requests", () => {
  test("available entities — ByPageByLimit", async () => {
    const { service, calls } = withCapturingRest(ServiceIntegrations);
    await service.getAvailableEntitiesPaged({
      integrationId: "intg1",
      reload: false,
      page: 2,
      limit: 30,
      filter: "NEW",
      search: "tv",
      types: "media_player",
    });
    expect(calls[0]).toEqual({
      config: {
        url: "/api/intg/instances/intg1/entities",
        method: "get",
        params: {
          reload: false,
          filter: "NEW",
          q: "tv",
          entity_types: "media_player",
        },
      },
      limit: 30,
      page: 2,
    });
  });

  test("available entities — ByPage (limit 50)", async () => {
    const { service, calls } = withCapturingRest(ServiceIntegrations);
    await service.getAvailableEntitiesPaged({
      integrationId: "intg1",
      reload: false,
      page: 3,
      limit: 50,
      filter: "NEW",
      search: "hbo",
      types: "light",
    });
    expect(calls[0]).toEqual({
      config: {
        url: "/api/intg/instances/intg1/entities",
        method: "get",
        params: {
          reload: false,
          filter: "NEW",
          q: "hbo",
          entity_types: "light",
        },
      },
      limit: 50,
      page: 3,
    });
  });

  test("configured entities — ByPageByLimit (with exclude)", async () => {
    const { service, calls } = withCapturingRest(ServiceIntegrations);
    await service.getConfiguredEntitiesPaged({
      integrationIds: "intgA",
      reload: true,
      page: 2,
      limit: 25,
      search: "cam",
      types: "sensor",
      exclude: "e1",
    });
    expect(calls[0]).toEqual({
      config: {
        url: "/api/entities",
        method: "get",
        params: {
          reload: true,
          intg_ids: "intgA",
          q: "cam",
          entity_types: "sensor",
          exclude: "e1",
        },
      },
      limit: 25,
      page: 2,
    });
  });

  test("configured entities — ByPage (limit 50, no exclude)", async () => {
    const { service, calls } = withCapturingRest(ServiceIntegrations);
    await service.getConfiguredEntitiesPaged({
      integrationIds: "intgB",
      reload: false,
      page: 4,
      limit: 50,
      search: "door",
      types: "cover",
    });
    expect(calls[0]).toEqual({
      config: {
        url: "/api/entities",
        method: "get",
        params: {
          reload: false,
          intg_ids: "intgB",
          q: "door",
          entity_types: "cover",
        },
      },
      limit: 50,
      page: 4,
    });
  });

  test("configured entities — empty optionals omit their params", async () => {
    const { service, calls } = withCapturingRest(ServiceIntegrations);
    await service.getConfiguredEntitiesPaged({ page: 1, limit: 100 });
    expect(calls[0].config.params).toEqual({ reload: false });
    expect(calls[0].limit).toBe(100);
    expect(calls[0].page).toBe(1);
  });

  test("macros — ByPageByLimit", async () => {
    const { service, calls } = withCapturingRest(ServiceMacros);
    await service.getMacrosPaged({ page: 2, limit: 40, search: "movie" });
    expect(calls[0]).toEqual({
      config: {
        url: "/api/macros",
        method: "get",
        params: { q: "movie" },
      },
      limit: 40,
      page: 2,
    });
  });

  test("macros — empty search omits q", async () => {
    const { service, calls } = withCapturingRest(ServiceMacros);
    await service.getMacrosPaged({ page: 1, limit: 100, search: "" });
    expect(calls[0].config.params).toEqual({});
    expect(calls[0].limit).toBe(100);
    expect(calls[0].page).toBe(1);
  });
});
