import assert from "node:assert/strict";
import test from "node:test";
import { runtimeInfo } from "../src/integrations/runtime-info-compatibility.js";

test("Integration API runtime_info uses the official driver/intg/log identifiers", () => {
  const connection = {
    record: { id: "hass", driver_id: "home-assistant" },
    platform: {
      db: {
        listIntegrations: () => [
          { id: "hass.main" },
          { id: "other.main" },
        ],
      },
      integrations: {
        resolveIntegration: (id) => id === "hass.main"
          ? { record_id: "hass" }
          : { record_id: "other" },
      },
      nativeIntegrations: {
        services: () => [{ id: "hass", service: "integration-hass" }],
      },
      externalIntegrations: { services: () => [] },
    },
  };

  assert.deepEqual(runtimeInfo(connection), {
    driver_id: "home-assistant",
    intg_ids: ["hass.main"],
    log_id: "integration-hass",
  });
});

test("Integration API runtime_info always contains the required driver_id", () => {
  const value = runtimeInfo({
    record: { id: "demo" },
    platform: {
      db: { listIntegrations: () => [] },
      integrations: { resolveIntegration: () => null },
      nativeIntegrations: { services: () => [] },
      externalIntegrations: { services: () => [] },
    },
  });
  assert.deepEqual(value, { driver_id: "demo" });
});
