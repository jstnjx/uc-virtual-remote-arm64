/**
 * WS event handling regression tests, Stages 1+2
 * (docs/specs/004-ws-event-handling-rework.md §6, W1/W2/W3/W5/W6/W7/W8).
 *
 * Uses vi.mock for the module-singleton API — runs under vitest, not the
 * portable test shim. Stores are re-imported per test because the coalescers
 * and the EventRouter singleton are module-level state.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

type MessageCb = (data: unknown, ev?: unknown) => void;
let messageCb: MessageCb | null = null;
let serviceCalls: Record<string, number> = {};

/**
 * Any called service method is counted by name and resolves an empty result
 * that satisfies BOTH service result shapes in use: plain-array methods
 * (getIntegrationStatuses, getConfiguredEntities, …) and paged methods that
 * destructure `{ data, headers }` (getEntitiesByPageByLimit, …). A bare []
 * would make the paged store actions assign `undefined` to their page state.
 */
function makeServiceProxy() {
  return new Proxy({} as Record<string, unknown>, {
    get(target: Record<string, unknown>, prop: string) {
      if (!(prop in target)) {
        target[prop] = vi.fn(async () => {
          serviceCalls[prop] = (serviceCalls[prop] ?? 0) + 1;
          return Object.assign([] as unknown[], { data: [], headers: {} });
        });
      }
      return target[prop];
    },
  });
}
const integrationsService = makeServiceProxy();

vi.mock("../src/api", () => ({
  default: {
    integrations: integrationsService,
    websocket: () => ({
      // the EventRouter attaches itself here; messageCb becomes its dispatch
      addMessageCallback: (_name: string, cb: MessageCb) => {
        messageCb = cb;
      },
    }),
    rest: () => ({
      addErrorInterceptor: vi.fn(),
      isUnauthorizedError: vi.fn(() => false),
    }),
    getService: () => ({}),
  },
}));
// appState → auth → monitor/router: mocked so store imports stay lightweight
vi.mock("../src/api/monitor", () => ({
  connectionMonitor: { setAuthenticated: vi.fn(), wakeHint: vi.fn() },
}));
vi.mock("../src/composables/router", () => ({
  default: { currentRoute: { value: { name: "home" } }, push: vi.fn() },
  getPreviousRoute: () => "",
}));

function totalCalls(): number {
  return Object.values(serviceCalls).reduce((a, b) => a + b, 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadIntegrationsStore() {
  vi.resetModules();
  const mod = await import("../src/stores/integrations");
  const store = mod.integrationsStore();
  store.init();
  expect(messageCb).not.toBe(null);
  return store;
}

async function loadAppState() {
  const mod = await import("../src/stores/appState");
  return mod.appStateStore();
}

function changeEvent(
  entityId: string,
  entityType: string,
  attributes: Record<string, unknown>,
) {
  return {
    msg: "entity_change",
    msg_data: {
      entity_id: entityId,
      event_type: "CHANGE",
      new_state: { entity_type: entityType, attributes },
    },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  sessionStorage.clear();
  messageCb = null;
  serviceCalls = {};
  vi.clearAllMocks();
});

describe("integrations store — routed event handling", () => {
  test("foreign entity types trigger no REST calls, even on cache miss (W1)", async () => {
    const store = await loadIntegrationsStore();
    store.$state.configuredEntities = [
      { entity_id: "light.1", entity_type: "light" } as never,
    ];

    // the exact event class that caused the >3 msg/s reload storm:
    // activity running/step updates during sequence execution
    for (let i = 0; i < 10; i++) {
      messageCb!(
        changeEvent("activity.1", "activity", {
          state: "running",
          step: i,
        }),
      );
    }
    messageCb!({
      msg: "entity_change",
      msg_data: {
        entity_id: "macro.1",
        event_type: "DELETE",
        entity_type: "macro",
      },
    });

    await sleep(400); // beyond the 250ms coalescer window
    expect(totalCalls()).toBe(0);
  });

  test("unknown own-type entity does not trigger a full reload on miss (P0-1)", async () => {
    const store = await loadIntegrationsStore();
    store.$state.configuredEntities = [
      { entity_id: "light.1", entity_type: "light" } as never,
    ];
    messageCb!(changeEvent("light.unknown", "light", { state: "ON" }));
    await sleep(400);
    expect(totalCalls()).toBe(0);
  });

  test("partial payload merges in place, preserving sibling attributes (W3)", async () => {
    const store = await loadIntegrationsStore();
    const cached = {
      entity_id: "media.1",
      entity_type: "media_player",
      attributes: { state: "OFF", volume: 30, source: "HDMI1" },
    };
    store.$state.configuredEntities = [cached as never];

    messageCb!(changeEvent("media.1", "media_player", { state: "ON" }));
    await sleep(400);

    const entity = store.$state
      .configuredEntities[0] as unknown as typeof cached;
    expect(entity.attributes.state).toBe("ON");
    expect(entity.attributes.volume).toBe(30); // sibling keys preserved
    expect(entity.attributes.source).toBe("HDMI1");
    expect(totalCalls()).toBe(0);
  });

  test("DELETE removes the entity from cached lists, no full reload (W5)", async () => {
    const store = await loadIntegrationsStore();
    store.$state.configuredEntities = [
      { entity_id: "light.1", entity_type: "light" } as never,
      { entity_id: "light.2", entity_type: "light" } as never,
    ];
    store.$state.configuredEntitiesByPage.configuredEntities = [
      { entity_id: "light.1", entity_type: "light" } as never,
    ];

    messageCb!({
      msg: "entity_change",
      msg_data: {
        entity_id: "light.1",
        event_type: "DELETE",
        entity_type: "light",
      },
    });
    await sleep(400);

    expect(store.$state.configuredEntities.length).toBe(1);
    expect(
      store.$state.configuredEntitiesByPage.configuredEntities.length,
    ).toBe(0);
    // one coalesced page reload for pagination counts, nothing else
    expect(totalCalls()).toBe(1);
  });

  test("NEW pushes the complete payload and refreshes the page once (W6)", async () => {
    const store = await loadIntegrationsStore();
    store.$state.configuredEntities = [
      { entity_id: "light.1", entity_type: "light" } as never,
    ];

    for (let i = 0; i < 3; i++) {
      messageCb!({
        msg: "entity_change",
        msg_data: {
          entity_id: "light.new",
          event_type: "NEW",
          new_state: { entity_id: "light.new", entity_type: "light" },
        },
      });
    }
    await sleep(400);

    expect(store.$state.configuredEntities.length).toBe(2); // no duplicates
    expect(totalCalls()).toBe(1); // one coalesced page reload
  });

  test("a burst of unmatched integration_change events coalesces into one reload (W2)", async () => {
    await loadIntegrationsStore();
    for (let i = 0; i < 10; i++) {
      messageCb!({
        msg: "integration_change",
        msg_data: { event_type: "STOPPED", integration_id: "i1" },
      });
    }
    await sleep(500);
    // exactly one coalesced round: getStatuses + getInstances (OQ-6)
    expect(totalCalls()).toBe(2);
  });

  test("integration_change NEW/DELETE also refreshes the not-configured driver lists", async () => {
    await loadIntegrationsStore();
    // A created instance flips its CUSTOM/EXTERNAL driver out of the
    // has_instances=false lists — without the refresh the driver stays in the
    // integrations overview next to its new integration.
    messageCb!({
      msg: "integration_change",
      msg_data: {
        event_type: "NEW",
        integration_id: "psn_driver.main",
        driver_id: "psn_driver",
      },
    });
    await sleep(500);
    expect(serviceCalls["getNotConfiguredCustomDrivers"] ?? 0).toBe(1);
    expect(serviceCalls["getNotConfiguredExternalDrivers"] ?? 0).toBe(1);

    serviceCalls = {};
    messageCb!({
      msg: "integration_change",
      msg_data: { event_type: "DELETE", integration_id: "psn_driver.main" },
    });
    await sleep(500);
    expect(serviceCalls["getNotConfiguredCustomDrivers"] ?? 0).toBe(1);
    expect(serviceCalls["getNotConfiguredExternalDrivers"] ?? 0).toBe(1);
  });

  test("targeted integration_change merges the status in place without REST calls", async () => {
    const store = await loadIntegrationsStore();
    store.$state.statuses = [
      { integration_id: "i1", state: "CONNECTED", name: "Hue" } as never,
    ];

    messageCb!({
      msg: "integration_change",
      msg_data: {
        event_type: "CHANGE",
        integration_id: "i1",
        new_state: { integration_id: "i1", state: "DISCONNECTED" },
      },
    });
    await sleep(400);

    const status = store.$state.statuses[0] as unknown as {
      state: string;
      name: string;
    };
    expect(status.state).toBe("DISCONNECTED");
    expect(status.name).toBe("Hue"); // merge, not replace
    expect(totalCalls()).toBe(0);
  });

  test("socketUpdate fires exactly once per recognized event, never for unrouted ones (W7)", async () => {
    const store = await loadIntegrationsStore();
    store.$state.configuredEntities = [
      { entity_id: "light.1", entity_type: "light" } as never,
    ];
    let socketUpdates = 0;
    store.$onAction(({ name }) => {
      if (name === "socketUpdate") {
        socketUpdates++;
      }
    });

    messageCb!(changeEvent("light.1", "light", { state: "ON" }));
    expect(socketUpdates).toBe(1);
    messageCb!({ msg: "mystery_event", msg_data: {} }); // unrouted
    messageCb!(changeEvent("activity.1", "activity", { state: "ON" })); // foreign
    expect(socketUpdates).toBe(1);
  });

  test("reconnect resync refreshes populated stores once, coalesced (W8)", async () => {
    const store = await loadIntegrationsStore();
    const appState = await loadAppState();
    store.$state.statuses = [{ integration_id: "i1" } as never];

    appState.sessionEstablished({ reconnect: true });
    appState.sessionEstablished({ reconnect: true }); // double fire → still one round
    await sleep(400);
    // statuses + instances, exactly once (config store refresh is separate)
    expect(serviceCalls["getIntegrationStatuses"] ?? 0).toBe(1);
    expect(serviceCalls["getInstances"] ?? 0).toBe(1);

    serviceCalls = {};
    appState.sessionEstablished({ reconnect: false }); // first session: no resync
    await sleep(400);
    expect(serviceCalls["getIntegrationStatuses"] ?? 0).toBe(0);
    expect(serviceCalls["getInstances"] ?? 0).toBe(0);
  });
});
