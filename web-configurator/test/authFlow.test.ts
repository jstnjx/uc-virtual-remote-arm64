/**
 * Auth store flow tests — docs/specs/002-login-flow-hardening.md §5
 * (A2–A7 credential handling, A10–A11 interceptor behavior).
 *
 * The auth store's collaborators are module singletons, so they are replaced
 * with vi.mock factories; the store module itself is re-imported per test via
 * vi.resetModules() because it captures the stored PIN at import time.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { LoginState } from "../src/types/enums";
import { flush } from "./helpers/fakeConnection";

// ---------------------------------------------------------------------------
// collaborator mocks

const setAuthenticated = vi.fn();
vi.mock("../src/api/monitor", () => ({
  connectionMonitor: {
    setAuthenticated: (v: boolean) => setAuthenticated(v),
    wakeHint: vi.fn(),
  },
}));

const routerPush = vi.fn();
vi.mock("../src/composables/router", () => ({
  default: {
    currentRoute: { value: { name: "entities" } },
    push: (target: unknown) => routerPush(target),
  },
  getPreviousRoute: () => "",
}));

const authService = {
  authenticate: vi.fn(),
  logout: vi.fn(async () => true),
};
type InterceptorCb = (error: any) => void;
let interceptor: InterceptorCb | null = null;
const restMock = {
  addErrorInterceptor: vi.fn((_n: string, cb: InterceptorCb) => {
    interceptor = cb;
  }),
  isUnauthorizedError: vi.fn((e: any) => e?.response?.status === 401),
  abort: vi.fn(),
};
vi.mock("../src/api", () => ({
  default: {
    getService: (id: string) => (id === "auth" ? authService : {}),
    rest: () => restMock,
  },
}));

// ---------------------------------------------------------------------------

const PIN_STORAGE_KEY = "UCRemote.user.auth.pin";
const LEGACY_STORAGE_KEY = "UCRemote.user.auth.response";

function seedPin(pin: string, key = PIN_STORAGE_KEY) {
  sessionStorage.setItem(key, JSON.stringify({ value: pin, expire: null }));
}

function storedPin(): string | null {
  const raw = sessionStorage.getItem(PIN_STORAGE_KEY);
  return raw ? JSON.parse(raw).value : null;
}

/** Re-import the store module so it picks up the seeded sessionStorage. */
async function loadAuthStore() {
  vi.resetModules();
  const mod = await import("../src/stores/auth");
  return mod.authStorage();
}

beforeEach(() => {
  setActivePinia(createPinia());
  sessionStorage.clear();
  interceptor = null;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("authenticate credential handling", () => {
  test("definitive rejection clears PIN and notifies the monitor (A2)", async () => {
    seedPin("1234");
    const auth = await loadAuthStore();
    authService.authenticate.mockResolvedValue({
      result: false,
      code: "NOT_AUTHORIZED",
    });

    const result = await auth.authenticate("1234");

    expect(result).toBe("rejected");
    expect(auth.authenticated).toBe(LoginState.ANONYMOUS);
    expect(storedPin()).toBe(null);
    expect(setAuthenticated).toHaveBeenCalledWith(false);
  });

  test("transient failure during init keeps PIN, stays unresolved (A3)", async () => {
    seedPin("1234");
    const auth = await loadAuthStore();
    authService.authenticate.mockRejectedValue({ code: "ERR_NETWORK" });

    await auth.ensureInitialized();

    expect(auth.authenticated).toBe(LoginState.NOT_DEFINED); // unknown, NOT logged out
    expect(auth.initError).toBe(true);
    expect(storedPin()).toBe("1234");
    expect(setAuthenticated).not.toHaveBeenCalled();
  });

  test("success stores PIN under the new key and notifies the monitor", async () => {
    const auth = await loadAuthStore();
    authService.authenticate.mockResolvedValue({ result: true, code: "OK" });

    const result = await auth.authenticate("9999");

    expect(result).toBe("ok");
    expect(auth.authenticated).toBe(LoginState.AUTHORISED);
    expect(storedPin()).toBe("9999");
    expect(setAuthenticated).toHaveBeenCalledWith(true);
  });

  test("legacy storage key is migrated on load", async () => {
    seedPin("4321", LEGACY_STORAGE_KEY);
    const auth = await loadAuthStore();
    authService.authenticate.mockResolvedValue({ result: true, code: "OK" });

    await auth.ensureInitialized();

    expect(auth.authenticated).toBe(LoginState.AUTHORISED);
    expect(authService.authenticate).toHaveBeenCalledWith("4321");
    expect(storedPin()).toBe("4321");
    expect(sessionStorage.getItem(LEGACY_STORAGE_KEY)).toBe(null);
  });
});

describe("reAuthenticate (A4, A5)", () => {
  async function loggedInStore() {
    seedPin("1234");
    const auth = await loadAuthStore();
    authService.authenticate.mockResolvedValue({ result: true, code: "OK" });
    await auth.ensureInitialized();
    vi.clearAllMocks();
    return auth;
  }

  test("transient failure keeps session and PIN (A4)", async () => {
    const auth = await loggedInStore();
    authService.authenticate.mockRejectedValue({ code: "ECONNABORTED" });

    await auth.reAuthenticate();

    expect(auth.authenticated).toBe(LoginState.AUTHORISED); // still signed in
    expect(storedPin()).toBe("1234");
    expect(setAuthenticated).not.toHaveBeenCalled();
  });

  test("definitive rejection logs out and clears PIN (A5)", async () => {
    const auth = await loggedInStore();
    authService.authenticate.mockResolvedValue({
      result: false,
      code: "NOT_AUTHORIZED",
    });

    await auth.reAuthenticate();

    expect(auth.authenticated).toBe(LoginState.ANONYMOUS);
    expect(storedPin()).toBe(null);
    expect(setAuthenticated).toHaveBeenCalledWith(false);
  });

  test("re-auth succeeds in place without logout", async () => {
    const auth = await loggedInStore();
    authService.authenticate.mockResolvedValue({ result: true, code: "OK" });

    await auth.reAuthenticate();

    expect(auth.authenticated).toBe(LoginState.AUTHORISED);
    expect(authService.logout).not.toHaveBeenCalled(); // no logout-first (P0-3)
    expect(authService.authenticate).toHaveBeenCalledTimes(1);
  });
});

describe("initialization lifecycle (A6, A7)", () => {
  test("ensureInitialized is idempotent under concurrency (A6)", async () => {
    seedPin("1234");
    const auth = await loadAuthStore();
    let resolveLogin!: (v: { result: boolean; code?: string }) => void;
    authService.authenticate.mockReturnValue(
      new Promise((r) => (resolveLogin = r)),
    );

    const p1 = auth.ensureInitialized();
    const p2 = auth.ensureInitialized();
    resolveLogin({ result: true, code: "OK" });
    await Promise.all([p1, p2]);

    expect(authService.authenticate).toHaveBeenCalledTimes(1);
    expect(auth.authenticated).toBe(LoginState.AUTHORISED);
  });

  test("no stored PIN resolves to ANONYMOUS without a login request", async () => {
    const auth = await loadAuthStore();
    await auth.ensureInitialized();
    expect(auth.authenticated).toBe(LoginState.ANONYMOUS);
    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  test("retryInitialization recovers after an unreachable start (A7)", async () => {
    seedPin("1234");
    const auth = await loadAuthStore();
    authService.authenticate.mockRejectedValueOnce({ code: "ERR_NETWORK" });
    await auth.ensureInitialized();
    expect(auth.initError).toBe(true);

    authService.authenticate.mockResolvedValueOnce({
      result: true,
      code: "OK",
    });
    await auth.retryInitialization();

    expect(auth.initError).toBe(false);
    expect(auth.authenticated).toBe(LoginState.AUTHORISED);
    expect(setAuthenticated).toHaveBeenCalledWith(true);
  });
});

describe("401 interceptor (A10, A11)", () => {
  async function storeWithInterceptor() {
    seedPin("1234");
    const auth = await loadAuthStore();
    authService.authenticate.mockResolvedValue({ result: true, code: "OK" });
    auth.init();
    await auth.ensureInitialized();
    vi.clearAllMocks();
    expect(interceptor).not.toBe(null);
    return auth;
  }

  test("401 from the login endpoint is ignored (A10)", async () => {
    const auth = await storeWithInterceptor();
    interceptor!({
      response: { status: 401 },
      request: { responseURL: "http://device/api/pub/login" },
    });
    await Promise.resolve();
    expect(authService.authenticate).not.toHaveBeenCalled();
    expect(auth.authenticated).toBe(LoginState.AUTHORISED);
  });

  test("401 elsewhere triggers re-auth, no abort, no direct logout (A11)", async () => {
    const auth = await storeWithInterceptor();
    authService.authenticate.mockResolvedValue({ result: true, code: "OK" });

    interceptor!({
      response: { status: 401 },
      request: { responseURL: "http://device/api/activities" },
    });
    await flush(); // let the fire-and-forget reAuthenticate settle

    expect(authService.authenticate).toHaveBeenCalledTimes(1);
    expect(restMock.abort).not.toHaveBeenCalled(); // no app-wide cancel (P3-6)
    expect(auth.authenticated).toBe(LoginState.AUTHORISED); // recovered in place
    expect(storedPin()).toBe("1234");
  });

  test("non-401 errors are ignored by the interceptor", async () => {
    await storeWithInterceptor();
    interceptor!({ response: { status: 500 }, request: { responseURL: "x" } });
    expect(authService.authenticate).not.toHaveBeenCalled();
  });
});
