import { describe, it, expect } from "vitest";
import { DockState } from "../src/types/enums";
import {
  isDockActive,
  canChangePassword,
  canChangeWifi,
} from "../src/composables/dockValidation";

describe("dockValidation", () => {
  describe("isDockActive", () => {
    it("returns true for ACTIVE state", () => {
      expect(isDockActive(DockState.ACTIVE)).toBe(true);
    });

    it("returns false for IDLE state", () => {
      expect(isDockActive(DockState.IDLE)).toBe(false);
    });

    it("returns false for CONNECTING state", () => {
      expect(isDockActive(DockState.CONNECTING)).toBe(false);
    });

    it("returns false for RECONNECTING state", () => {
      expect(isDockActive(DockState.RECONNECTING)).toBe(false);
    });

    it("returns false for ERROR state", () => {
      expect(isDockActive(DockState.ERROR)).toBe(false);
    });
  });

  describe("canChangePassword", () => {
    describe("basic validation", () => {
      it("returns false when both password fields are empty", () => {
        expect(canChangePassword(DockState.ACTIVE, "", "", true)).toBe(false);
      });

      it("returns false when only first password is entered", () => {
        expect(
          canChangePassword(DockState.ACTIVE, "password123", "", true),
        ).toBe(false);
      });

      it("returns false when only second password is entered", () => {
        expect(
          canChangePassword(DockState.ACTIVE, "", "password123", true),
        ).toBe(false);
      });

      it("returns false when passwords do not match", () => {
        expect(
          canChangePassword(
            DockState.ACTIVE,
            "password123",
            "password456",
            true,
          ),
        ).toBe(false);
      });

      it("returns true when passwords match and dock is active", () => {
        expect(
          canChangePassword(
            DockState.ACTIVE,
            "password123",
            "password123",
            true,
          ),
        ).toBe(true);
      });
    });

    describe("connection-based validation", () => {
      it("returns true when dock is ACTIVE and passwords match", () => {
        expect(
          canChangePassword(
            DockState.ACTIVE,
            "password123",
            "password123",
            true,
          ),
        ).toBe(true);
      });

      it("returns false when dock is IDLE and changeDockToken is true (requires connection)", () => {
        expect(
          canChangePassword(DockState.IDLE, "password123", "password123", true),
        ).toBe(false);
      });

      it("returns false when dock is CONNECTING and changeDockToken is true (requires connection)", () => {
        expect(
          canChangePassword(
            DockState.CONNECTING,
            "password123",
            "password123",
            true,
          ),
        ).toBe(false);
      });

      it("returns false when dock is RECONNECTING and changeDockToken is true (requires connection)", () => {
        expect(
          canChangePassword(
            DockState.RECONNECTING,
            "password123",
            "password123",
            true,
          ),
        ).toBe(false);
      });

      it("returns false when dock is ERROR and changeDockToken is true (requires connection)", () => {
        expect(
          canChangePassword(
            DockState.ERROR,
            "password123",
            "password123",
            true,
          ),
        ).toBe(false);
      });

      it("returns true when dock is IDLE and changeDockToken is false (configurator only)", () => {
        expect(
          canChangePassword(
            DockState.IDLE,
            "password123",
            "password123",
            false,
          ),
        ).toBe(true);
      });

      it("returns true when dock is CONNECTING and changeDockToken is false (configurator only)", () => {
        expect(
          canChangePassword(
            DockState.CONNECTING,
            "password123",
            "password123",
            false,
          ),
        ).toBe(true);
      });

      it("returns true when dock is RECONNECTING and changeDockToken is false (configurator only)", () => {
        expect(
          canChangePassword(
            DockState.RECONNECTING,
            "password123",
            "password123",
            false,
          ),
        ).toBe(true);
      });

      it("returns true when dock is ERROR and changeDockToken is false (configurator only)", () => {
        expect(
          canChangePassword(
            DockState.ERROR,
            "password123",
            "password123",
            false,
          ),
        ).toBe(true);
      });
    });

    describe("combined scenarios", () => {
      it("allows password change only with valid passwords and (active dock OR NOT updating dock)", () => {
        const scenarios = [
          // { state, pass1, pass2, changeDockToken, expected }
          {
            state: DockState.ACTIVE,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: true,
            expected: true,
          },
          {
            state: DockState.ACTIVE,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: false,
            expected: true,
          },
          {
            state: DockState.IDLE,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: true,
            expected: false,
          },
          {
            state: DockState.IDLE,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: false,
            expected: true,
          },
          {
            state: DockState.CONNECTING,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: true,
            expected: false,
          },
          {
            state: DockState.CONNECTING,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: false,
            expected: true,
          },
          {
            state: DockState.RECONNECTING,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: true,
            expected: false,
          },
          {
            state: DockState.RECONNECTING,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: false,
            expected: true,
          },
          {
            state: DockState.ERROR,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: true,
            expected: false,
          },
          {
            state: DockState.ERROR,
            pass1: "pwd",
            pass2: "pwd",
            changeDockToken: false,
            expected: true,
          },
          {
            state: DockState.ACTIVE,
            pass1: "",
            pass2: "",
            changeDockToken: true,
            expected: false,
          },
          {
            state: DockState.ACTIVE,
            pass1: "pwd",
            pass2: "different",
            changeDockToken: true,
            expected: false,
          },
        ];

        scenarios.forEach(
          ({ state, pass1, pass2, changeDockToken, expected }) => {
            expect(
              canChangePassword(state, pass1, pass2, changeDockToken),
            ).toBe(expected);
          },
        );
      });
    });
  });

  describe("canChangeWifi", () => {
    describe("basic validation", () => {
      it("returns false when both SSID and password are empty", () => {
        expect(canChangeWifi(DockState.ACTIVE, "", "")).toBe(false);
      });

      it("returns false when only SSID is entered", () => {
        expect(canChangeWifi(DockState.ACTIVE, "MyNetwork", "")).toBe(false);
      });

      it("returns false when only password is entered", () => {
        expect(canChangeWifi(DockState.ACTIVE, "", "password123")).toBe(false);
      });

      it("returns true when both SSID and password are entered and dock is active", () => {
        expect(
          canChangeWifi(DockState.ACTIVE, "MyNetwork", "password123"),
        ).toBe(true);
      });
    });

    describe("connection-based validation", () => {
      it("returns true when dock is ACTIVE and credentials are valid", () => {
        expect(
          canChangeWifi(DockState.ACTIVE, "MyNetwork", "password123"),
        ).toBe(true);
      });

      it("returns false when dock is IDLE even with valid credentials", () => {
        expect(canChangeWifi(DockState.IDLE, "MyNetwork", "password123")).toBe(
          false,
        );
      });

      it("returns false when dock is CONNECTING even with valid credentials", () => {
        expect(
          canChangeWifi(DockState.CONNECTING, "MyNetwork", "password123"),
        ).toBe(false);
      });

      it("returns false when dock is RECONNECTING even with valid credentials", () => {
        expect(
          canChangeWifi(DockState.RECONNECTING, "MyNetwork", "password123"),
        ).toBe(false);
      });

      it("returns false when dock is ERROR even with valid credentials", () => {
        expect(canChangeWifi(DockState.ERROR, "MyNetwork", "password123")).toBe(
          false,
        );
      });

      it("returns false when dock is IDLE and credentials are empty", () => {
        expect(canChangeWifi(DockState.IDLE, "", "")).toBe(false);
      });
    });

    describe("combined scenarios", () => {
      it("allows WiFi change only when dock is connected and credentials are valid", () => {
        const scenarios = [
          // { state, ssid, pass, expected }
          {
            state: DockState.ACTIVE,
            ssid: "MyNetwork",
            pass: "password123",
            expected: true,
          },
          {
            state: DockState.IDLE,
            ssid: "MyNetwork",
            pass: "password123",
            expected: false,
          },
          {
            state: DockState.CONNECTING,
            ssid: "MyNetwork",
            pass: "password123",
            expected: false,
          },
          {
            state: DockState.RECONNECTING,
            ssid: "MyNetwork",
            pass: "password123",
            expected: false,
          },
          {
            state: DockState.ERROR,
            ssid: "MyNetwork",
            pass: "password123",
            expected: false,
          },
          {
            state: DockState.ACTIVE,
            ssid: "",
            pass: "password123",
            expected: false,
          },
          {
            state: DockState.ACTIVE,
            ssid: "MyNetwork",
            pass: "",
            expected: false,
          },
          { state: DockState.IDLE, ssid: "", pass: "", expected: false },
        ];

        scenarios.forEach(({ state, ssid, pass, expected }) => {
          expect(canChangeWifi(state, ssid, pass)).toBe(expected);
        });
      });
    });
  });
});
