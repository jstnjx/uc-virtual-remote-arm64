import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PlatformDatabase } from "../src/storage/database.js";
import { installPassiveActivityStatePersistence } from "../src/storage/activity-state-compatibility.js";

test("passive activity state patches persist without running an activity", () => {
  installPassiveActivityStatePersistence();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ucvr-passive-activity-state-"));
  const database = new PlatformDatabase(directory);

  try {
    const created = database.saveActivity({
      id: "spotify",
      name: "Spotify",
      attributes: { state: "OFF" },
      options: { sequences: { on: [{ type: "delay", delay: 1000 }], off: [] } },
    });
    assert.equal(created.state, "OFF");

    const updated = database.saveActivity({
      id: "spotify",
      attributes: { state: "ON" },
    });
    assert.equal(updated.state, "ON");
    assert.equal(updated.attributes.state, "ON");

    const stored = database.getActivity("spotify");
    assert.equal(stored.state, "ON");
    assert.equal(stored.attributes.state, "ON");
    assert.equal(stored.options.sequences.on.length, 1);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
