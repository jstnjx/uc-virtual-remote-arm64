import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installApiParityCompatibility } from "../src/api/api-parity-compatibility.js";
import { CoreWebSocketFacade } from "../src/core/websocket-facade.js";
import { EventBus } from "../src/core/event-bus.js";

class FakePeer extends EventEmitter {
  static OPEN = 1;
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
  }
  send(value) { this.sent.push(JSON.parse(String(value))); }
  close() { this.readyState = 3; this.emit("close"); }
}

function profile(id, active) {
  return {
    id,
    name: { en: id },
    active,
    pages: [],
    groups: [],
  };
}

test("active_profile_change is emitted only when the active profile ID changes", async () => {
  installApiParityCompatibility();
  const events = new EventBus();
  const profiles = [profile("a", true), profile("b", false)];
  const platform = {
    events,
    adminToken: "",
    coreToken: "",
    db: {
      listProfiles: () => profiles,
      findApiKey: () => null,
    },
  };
  const facade = new CoreWebSocketFacade(platform);
  const peer = new FakePeer();
  facade.attach(peer, { authenticated: true });
  await new Promise((resolve) => setImmediate(resolve));
  peer.sent.length = 0;

  events.publish("profile.change", {
    event_type: "CHANGE",
    profile_id: "a",
    new_state: { profile: profile("a", true) },
  });
  assert.equal(peer.sent.filter((item) => item.msg === "active_profile_change").length, 0,
    "editing the already-active profile must not emit a switch event");

  events.publish("profile.change", {
    event_type: "CHANGE",
    profile_id: "b",
    new_state: { profile: profile("b", true) },
  });
  const switches = peer.sent.filter((item) => item.msg === "active_profile_change");
  assert.equal(switches.length, 1);
  assert.equal(switches[0].msg_data.profile_id, "b");
  peer.close();
});
