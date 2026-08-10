/**
 * Pure helpers for the login flow (docs/specs/002-login-flow-hardening.md).
 * No imports, no side effects — fully unit-testable.
 */

/** Result contract of authStorage().authenticate(). */
export type AuthResult = "ok" | "rejected" | "unreachable";

/**
 * Transient = the device did not answer; nothing may be concluded about the
 * credentials (never clear the PIN, never log out).
 * Definitive = the device answered and rejected the credentials.
 */
export function isTransientAuthError(codeOrError: unknown): boolean {
  const code =
    typeof codeOrError === "string"
      ? codeOrError
      : String(
          (codeOrError as { code?: string })?.code ??
            (codeOrError as { message?: string })?.message ??
            "",
        );
  return [
    "ERR_NETWORK",
    "ERR_CANCELED",
    "ECONNABORTED",
    "error.HAS_TIMEOUT",
  ].includes(code);
}

/** Error codes that have a translation under login.error.* in en_US.json. */
const KNOWN_LOGIN_ERRORS = new Set([
  "NOT_AUTHORIZED",
  "VALIDATION_ERROR",
  "ERR_NETWORK",
  "ERR_CANCELED",
]);

/**
 * Map an auth error to an existing i18n key — unknown codes must never leak
 * a nonexistent key to the UI (REVIEW-Claude-login-flow.md P2-3).
 */
export function toLoginErrorKey(e: unknown): string {
  const code = (
    typeof e === "string"
      ? e
      : String(
          (e as { code?: string })?.code ??
            (e as { message?: string })?.message ??
            "",
        )
  )
    .toUpperCase()
    .replace(/^ERROR\./, "");
  if (code === "ECONNABORTED" || code === "HAS_TIMEOUT") {
    return "login.error.TIMEOUT";
  }
  return "login.error." + (KNOWN_LOGIN_ERRORS.has(code) ? code : "UNKNOWN");
}

export type GuardRedirect =
  { name: string; query?: Record<string, string> } | string | undefined;

/**
 * Routing decision for the auth guard, applied AFTER auth initialization has
 * resolved (or definitively failed). Unresolved-with-error states also land on
 * the login route — LoginView renders a "connecting" panel instead of the PIN
 * form in that case, so the user is never presented as logged-out while the
 * auth state is unknown.
 */
export function decideLoginRedirect(opts: {
  isAuthenticated: boolean;
  toName: string | null | undefined;
  toFullPath: string;
  redirectQuery?: string;
}): GuardRedirect {
  const { isAuthenticated, toName, toFullPath, redirectQuery } = opts;
  if (!isAuthenticated && toName !== "login") {
    return {
      name: "login",
      // preserve deep links; "/" is the default target anyway
      query: toFullPath && toFullPath !== "/" ? { redirect: toFullPath } : {},
    };
  }
  if (isAuthenticated && toName === "login") {
    return redirectQuery || { name: "home" };
  }
  return undefined;
}
