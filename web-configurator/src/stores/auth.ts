import { defineStore } from "pinia";
import ApiConnection from "@/api";
import Api from "@/api";
import { connectionMonitor } from "@/api/monitor";
import type ServiceAuth from "@/api/services/authenticate";
import sStorageWrapper from "@/api/local";

import { LoginState } from "@/types/enums";
import { isTransientAuthError } from "@/composables/authHelpers";
import type { AuthResult } from "@/composables/authHelpers";

import router from "@/composables/router";

const PIN_KEY = "user.auth.pin";
/** Pre-rename storage key; fallback read keeps sessions across the upgrade. */
const LEGACY_PIN_KEY = "user.auth.response";
let stored: string | null = (sStorageWrapper.getValue(PIN_KEY) ??
  sStorageWrapper.getValue(LEGACY_PIN_KEY) ??
  null) as string | null;

/** Idempotent initialization promise (docs/specs/002-login-flow-hardening.md §3.3). */
let initPromise: Promise<void> | null = null;

function isProfileSwitch(url: string) {
  return url.includes("api/profiles?active_profile_id");
}

export const authStorage = defineStore("user", {
  state: () => ({
    inited: false,
    authenticated: LoginState.NOT_DEFINED,
    /**
     * True when initialization could not resolve the auth state because the
     * device was unreachable. The state stays NOT_DEFINED (unknown ≠ logged
     * out); LoginView shows a "connecting" panel and retries via
     * retryInitialization() when the device becomes reachable.
     */
    initError: false,
    /** Reactive mirror of the (module-level) stored PIN presence. */
    hasPin: !!stored,
    error: "",
    reAuthenticating: false,
  }),
  getters: {
    isAuthenticated: (state) => {
      return state.authenticated === LoginState.AUTHORISED;
    },
  },
  actions: {
    init() {
      this.registerInterceptor();
      void this.ensureInitialized();
    },

    registerInterceptor() {
      if (this.inited) {
        return;
      }
      this.inited = true;
      Api.rest().addErrorInterceptor(
        "auth",
        (error) => {
          if (!Api.rest().isUnauthorizedError(error)) {
            return;
          }
          const url = error.request?.responseURL ?? "";
          // Exclude Profile switching and the login request itself — a wrong
          // PIN 401 must not ripple into the rest of the app (P1-2).
          if (isProfileSwitch(url) || url.includes("/api/pub/login")) {
            return;
          }
          // No Api.rest().abort() here: an expired session must not cancel
          // unrelated in-flight requests app-wide (REVIEW-Claude.md P3-6).
          // Try to recover first; reAuthenticate() logs out by itself only
          // when the device definitively rejects the stored PIN.
          void this.reAuthenticate();
        },
        true,
      );
    },

    /**
     * Resolve the initial auth state exactly once; concurrent callers (router
     * guard, App bootstrap) share the same pending promise. Never resolves an
     * unreachable device into "logged out" (login-flow P0-1).
     */
    async ensureInitialized(): Promise<void> {
      if (this.$state.authenticated !== LoginState.NOT_DEFINED) {
        return;
      }
      if (!initPromise) {
        initPromise = (async () => {
          this.registerInterceptor();
          if (!stored) {
            this.$state.authenticated = LoginState.ANONYMOUS;
            return;
          }
          const result = await this.authenticate(stored ?? "");
          if (result === "unreachable") {
            this.$state.initError = true; // still NOT_DEFINED: unknown, not logged out
          }
        })().finally(() => {
          initPromise = null;
        });
      }
      return initPromise;
    },

    /** Re-run initialization after an unreachable-device failure. */
    retryInitialization(): Promise<void> {
      this.$state.initError = false;
      return this.ensureInitialized();
    },

    /**
     * @param opts.force skip the already-authorised short-circuit; used by
     *        reAuthenticate() to establish a fresh session in place.
     */
    async authenticate(
      pin: string,
      opts: { force?: boolean } = {},
    ): Promise<AuthResult> {
      if (this.$state.authenticated === LoginState.AUTHORISED && !opts.force) {
        return "ok";
      }

      // Fresh attempt, fresh error state — also guarantees watchers fire when
      // the same error code occurs on consecutive attempts.
      this.$state.error = "";

      const auth = ApiConnection.getService("auth") as ServiceAuth;

      const setLoggedIn = () => {
        this.$state.authenticated = LoginState.AUTHORISED;
        this.$state.error = "";
        this.$state.initError = false;
        sStorageWrapper.setValue(PIN_KEY, pin);
        sStorageWrapper.clearValue(LEGACY_PIN_KEY);
        stored = sStorageWrapper.getValue(PIN_KEY) as string | null;
        this.$state.hasPin = true;
        connectionMonitor.setAuthenticated(true);
      };

      /**
       * Definitive rejection: the device answered and said no — forget the
       * PIN and notify the monitor. Transient failure: the device did not
       * answer — keep the PIN, keep the current login state (NOT_DEFINED
       * during init, AUTHORISED during re-auth), and let the caller decide
       * (REVIEW-Claude.md P0-3).
       */
      const setError = (code: string | null, definitive: boolean) => {
        this.$state.error = code || "unknown";
        if (!definitive) {
          return;
        }
        this.$state.authenticated = LoginState.ANONYMOUS;
        sStorageWrapper.clearValue(PIN_KEY);
        sStorageWrapper.clearValue(LEGACY_PIN_KEY);
        stored = null;
        this.$state.hasPin = false;
        connectionMonitor.setAuthenticated(false);
      };

      try {
        const resp = await auth.authenticate(pin);
        if (resp.result) {
          // OQ-2 (resolved): a login response with code "OK" guarantees an
          // immediately valid session — no settle probing required.
          setLoggedIn();
          return "ok";
        }
        const code = resp.code || null;
        if (isTransientAuthError(code)) {
          setError(code, false);
          return "unreachable";
        }
        setError(code, true);
        return "rejected";
      } catch (e) {
        console.error(e);
        let error = null;
        if (typeof (e as any)?.code === "string") {
          error = (e as any)?.code;
        } else if (typeof (e as any)?.message === "string") {
          error = (e as any)?.message;
        } else if (typeof e === "string") {
          error = e;
        }
        if (isTransientAuthError(error ?? e)) {
          setError(error, false);
          return "unreachable";
        }
        setError(error, true);
        return "rejected";
      }
    },

    /**
     * Re-authenticate in place using the stored PIN. No logout first: the
     * core issues a fresh session over a stale cookie (connection-monitor
     * spec OQ-2), so the WebSocket stays untouched and a transient failure
     * costs nothing — the monitor keeps reconnecting and the server repeats
     * auth_required on the next session.
     */
    async reAuthenticate() {
      if (this.$state.reAuthenticating) {
        return;
      }
      if (!stored) {
        this.$state.authenticated = LoginState.ANONYMOUS;
        connectionMonitor.setAuthenticated(false);
        if (router.currentRoute.value.name != "home") {
          router.push({ name: "home" });
        }
        return;
      }
      this.$state.reAuthenticating = true;
      try {
        await this.authenticate(stored ?? "", { force: true });
        // "rejected"    → setError already cleared the PIN and notified the
        //                 monitor; the router guard sends the user to login.
        // "unreachable" → stay AUTHORISED with the PIN intact.
      } finally {
        this.$state.reAuthenticating = false;
      }
    },

    async logout() {
      if (this.$state.authenticated !== LoginState.AUTHORISED) {
        return true;
      }

      sStorageWrapper.clearValue(PIN_KEY);
      sStorageWrapper.clearValue(LEGACY_PIN_KEY);
      stored = null;
      this.$state.hasPin = false;
      this.$state.authenticated = LoginState.ANONYMOUS;
      this.$state.error = "";
      connectionMonitor.setAuthenticated(false);
      const auth = ApiConnection.getService("auth") as ServiceAuth;
      try {
        await auth.logout();
        return true;
      } catch (e) {
        this.$state.error = e as string;
      }
      return false;
    },
  },
});
