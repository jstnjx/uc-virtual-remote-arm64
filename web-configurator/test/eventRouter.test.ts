/**
 * EventRouter tests — docs/specs/004-ws-event-handling-rework.md §6.
 * Pure: constructs EventRouter directly, no transport, no stores.
 */
import { describe, expect, test } from "vitest";
import { EventRouter, normalizeEvent } from "../src/api/eventRouter";
import type { NormalizedEvent } from "../src/api/eventRouter";

function makeRouter(): { router: EventRouter; logs: string[] } {
  const logs: string[] = [];
  const router = new EventRouter(undefined, (line) => logs.push(line));
  return { router, logs };
}

describe("normalizeEvent", () => {
  test("entity type from new_state wins, top-level is the fallback", () => {
    expect(
      normalizeEvent({
        kind: "event",
        msg: "entity_change",
        msg_data: {
          entity_type: "top",
          new_state: { entity_type: "nested" },
        },
      }).entityType,
    ).toBe("nested");
    expect(
      normalizeEvent({
        kind: "event",
        msg: "entity_change",
        msg_data: { entity_type: "top", new_state: {} },
      }).entityType,
    ).toBe("top");
  });

  test("event type is lowercased; msgData stays untouched (enum safety)", () => {
    const e = normalizeEvent({
      kind: "event",
      msg: "entity_change",
      msg_data: { event_type: "CHANGE" },
    });
    expect(e.eventType).toBe("change");
    expect(e.msgData.event_type).toBe("CHANGE"); // discovery/setup enums rely on this
  });

  test("id extraction covers the per-message id fields", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ entity_id: "e1" }, "e1"],
      [{ group_id: "g1" }, "g1"],
      [{ profile_id: "p1" }, "p1"],
      [{ dock_id: "d1" }, "d1"],
      [{ integration_id: "i1" }, "i1"],
    ];
    for (const [msg_data, id] of cases) {
      expect(
        normalizeEvent({ kind: "event", msg: "x", msg_data }).entityId,
      ).toBe(id);
    }
  });

  test("running-noise flag requires running state AND a step", () => {
    const running = {
      kind: "event",
      msg: "entity_change",
      msg_data: {
        new_state: { attributes: { state: "RUNNING", step: 3 } },
      },
    };
    expect(normalizeEvent(running).isRunningNoise).toBe(true);
    const noStep = {
      kind: "event",
      msg: "entity_change",
      msg_data: { new_state: { attributes: { state: "running" } } },
    };
    expect(normalizeEvent(noStep).isRunningNoise).toBe(false);
    const off = {
      kind: "event",
      msg: "entity_change",
      msg_data: { new_state: { attributes: { state: "OFF", step: 1 } } },
    };
    expect(normalizeEvent(off).isRunningNoise).toBe(false);
  });

  test("missing msg_data is tolerated", () => {
    const e = normalizeEvent({ kind: "event", msg: "pong" });
    expect(e.entityType).toBe(undefined);
    expect(e.eventType).toBe(undefined);
    expect(e.msgData).toEqual({});
    expect(e.isRunningNoise).toBe(false);
  });
});

describe("EventRouter routing", () => {
  test("routes by (msg, entityType) with msg-level fallback", () => {
    const { router } = makeRouter();
    const seen: string[] = [];
    router.route("entity_change", "activity", () => {
      seen.push("typed");
    });
    router.route("dock_change", undefined, () => {
      seen.push("msg-level");
    });

    router.dispatch({
      kind: "event",
      msg: "entity_change",
      msg_data: { new_state: { entity_type: "activity" } },
    });
    router.dispatch({ kind: "event", msg: "dock_change", msg_data: {} });
    expect(seen).toEqual(["typed", "msg-level"]);
  });

  test("array registration owns several entity types", () => {
    const { router } = makeRouter();
    const seen: string[] = [];
    router.route("entity_change", ["light", "switch"], (e) => {
      seen.push(e.entityType as string);
    });
    for (const type of ["light", "switch"]) {
      router.dispatch({
        kind: "event",
        msg: "entity_change",
        msg_data: { new_state: { entity_type: type } },
      });
    }
    expect(seen).toEqual(["light", "switch"]);
  });

  test("duplicate registration throws (exactly one owner)", () => {
    const { router } = makeRouter();
    router.route("entity_change", "activity", () => undefined, {
      name: "activities",
    });
    let threw = false;
    try {
      router.route("entity_change", "activity", () => undefined, {
        name: "impostor",
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("dual-owner routes require shared:true on BOTH sides", () => {
    const { router } = makeRouter();
    const seen: string[] = [];
    router.route(
      "entity_change",
      "remote",
      () => {
        seen.push("remotes");
      },
      {
        name: "remotes",
        shared: true,
      },
    );
    router.route(
      "entity_change",
      "remote",
      () => {
        seen.push("integrations");
      },
      {
        name: "integrations",
        shared: true,
      },
    );
    router.dispatch({
      kind: "event",
      msg: "entity_change",
      msg_data: { new_state: { entity_type: "remote" } },
    });
    expect(seen).toEqual(["remotes", "integrations"]);

    // shared route + non-shared registration still throws
    let threw = false;
    try {
      router.route("entity_change", "remote", () => undefined);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("a throwing handler does not silence its dual-owner peer", () => {
    const { router } = makeRouter();
    const seen: string[] = [];
    router.route(
      "profile_change",
      undefined,
      () => {
        throw new Error("boom");
      },
      { name: "profiles", shared: true },
    );
    router.route(
      "profile_change",
      undefined,
      () => {
        seen.push("profile");
      },
      {
        name: "profile",
        shared: true,
      },
    );
    router.dispatch({ kind: "event", msg: "profile_change", msg_data: {} });
    expect(seen).toEqual(["profile"]);
  });

  test("unrouted messages log once per route key and never throw", () => {
    const { router, logs } = makeRouter();
    for (let i = 0; i < 5; i++) {
      router.dispatch({ kind: "event", msg: "mystery_event", msg_data: {} });
    }
    expect(logs.length).toBe(1);
  });

  test("handlers receive the fully normalized event", () => {
    const { router } = makeRouter();
    let received: NormalizedEvent | null = null;
    router.route("entity_change", "light", (e) => {
      received = e;
    });
    router.dispatch({
      kind: "event",
      msg: "entity_change",
      msg_data: {
        entity_id: "light.1",
        event_type: "CHANGE",
        new_state: { entity_type: "light", attributes: { state: "ON" } },
      },
    });
    expect(received!.entityId).toBe("light.1");
    expect(received!.eventType).toBe("change");
    expect(received!.newState).toEqual({
      entity_type: "light",
      attributes: { state: "ON" },
    });
    expect(received!.isRunningNoise).toBe(false);
  });
});

/**
 * Typed entity-state read model (ws-and-integration-payload-typing).
 * Each frame is a representative real payload; the assertions read the modelled
 * fields off the typed `newState` / `msgData` (a mis-spelled field would fail
 * type-checking, not silently return undefined). Unmodelled fields still deliver.
 */
describe("typed read model over representative frames", () => {
  test("entity update: entity_type and attributes.state are typed reads", () => {
    const e = normalizeEvent({
      kind: "event",
      msg: "entity_change",
      msg_data: {
        entity_id: "media_player.1",
        event_type: "CHANGE",
        new_state: {
          entity_type: "media_player",
          attributes: { state: "PLAYING", media_type: "MUSIC" },
        },
      },
    });
    expect(e.newState?.entity_type).toBe("media_player");
    expect(e.newState?.attributes?.state).toBe("PLAYING");
    // unmodelled attribute leaf still delivered (open read model)
    expect(e.newState?.attributes?.media_type).toBe("MUSIC");
    expect(e.msgData.event_type).toBe("CHANGE");
  });

  test("activity running-noise: attributes.state + step flag the noise", () => {
    const e = normalizeEvent({
      kind: "event",
      msg: "entity_change",
      msg_data: {
        entity_id: "activity.1",
        new_state: {
          entity_type: "activity",
          attributes: { state: "RUNNING", step: { index: 2, state: "START" } },
        },
      },
    });
    expect(e.isRunningNoise).toBe(true);
    expect(e.newState?.attributes?.step?.index).toBe(2);
  });

  test("activity group: group_id resolves the entity id off new_state", () => {
    const e = normalizeEvent({
      kind: "event",
      msg: "activity_group_change",
      msg_data: {
        group_id: "ag1",
        event_type: "CHANGE",
        new_state: { group_id: "ag1", name: { en: "Living Room" } },
      },
    });
    expect(e.entityId).toBe("ag1");
    expect(e.newState?.group_id).toBe("ag1");
  });

  test("dock change: new_state and dock_id are typed on the envelope", () => {
    const e = normalizeEvent({
      kind: "event",
      msg: "dock_change",
      msg_data: {
        dock_id: "dock.1",
        event_type: "CHANGE",
        new_state: { state: "ACTIVE" },
      },
    });
    expect(e.entityId).toBe("dock.1");
    expect(e.msgData.new_state?.state).toBe("ACTIVE");
  });

  test("integration change: integration_id read off the envelope", () => {
    const e = normalizeEvent({
      kind: "event",
      msg: "integration_change",
      msg_data: {
        integration_id: "int.1",
        event_type: "CHANGE",
        new_state: { integration_id: "int.1", state: "CONNECTED" },
      },
    });
    expect(e.entityId).toBe("int.1");
    expect(e.msgData.integration_id).toBe("int.1");
  });
});
