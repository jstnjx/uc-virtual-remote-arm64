import { expect, test } from "vitest";

import { irLearnReadiness } from "../src/composables/irCode";
import type { IrEmitter } from "../src/types/ir";
import { RemoteIrCodeFormat } from "../src/types/enums";

///////////////////////////////////////////////////////////////////////////////
// IR learn readiness test
//
// Guards the fix for the "Add new infrared code" dialog, which previously
// showed "This device does not support IR learning." for every reason
// canStartLearning() returned false — including an emitter that simply went
// offline (lost Wi-Fi). Each distinct reason must now map to a distinct state.
///////////////////////////////////////////////////////////////////////////////

function emitter(overrides: Partial<IrEmitter> = {}): IrEmitter {
  return {
    device_id: "UCD3-0B889C",
    name: "UCD3-0B889C",
    active: true,
    ports: [],
    capabilities: {
      learning: {
        description: "",
        instruction: "",
        formats: RemoteIrCodeFormat.HEX,
      },
    },
    ...overrides,
  };
}

test("online emitter with learning capability is ready", () => {
  expect(irLearnReadiness(emitter())).toBe("ready");
});

test("emitter that lost its connection is offline, not unsupported", () => {
  expect(irLearnReadiness(emitter({ active: false }))).toBe("offline");
});

test("offline takes priority even when capabilities are omitted", () => {
  // A dock may drop its capabilities block while it is down; it must still be
  // reported as offline rather than mislabeled as unsupported.
  expect(
    irLearnReadiness(emitter({ active: false, capabilities: undefined })),
  ).toBe("offline");
});

test("online emitter without capabilities is unsupported", () => {
  expect(irLearnReadiness(emitter({ capabilities: undefined }))).toBe(
    "unsupported",
  );
});

test("online emitter without the learning capability is unsupported", () => {
  expect(irLearnReadiness(emitter({ capabilities: {} }))).toBe("unsupported");
});

test("no selected emitter is unsupported", () => {
  expect(irLearnReadiness(undefined)).toBe("unsupported");
});
