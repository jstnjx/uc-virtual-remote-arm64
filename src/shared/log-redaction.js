const SENSITIVE_KEYS = [
  "client_secret",
  "clientSecret",
  "auth_code",
  "authCode",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "password",
  "api_key",
  "apiKey",
  "authorization"
];

const KEY_PATTERN = SENSITIVE_KEYS.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

export function redactIntegrationLogLine(value) {
  let line = String(value ?? "");

  // JSON-style dictionaries emitted by integrations/frameworks.
  line = line.replace(
    new RegExp(`("(?:${KEY_PATTERN})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi"),
    '$1"***REDACTED***"'
  );

  // Python repr-style dictionaries, which are common in ucapi-framework DEBUG logs.
  line = line.replace(
    new RegExp(`('(?:${KEY_PATTERN})'\\s*:\\s*)'(?:[^'\\\\]|\\\\.)*'`, "gi"),
    "$1'***REDACTED***'"
  );

  // Plain key=value output from integrations.
  line = line.replace(
    new RegExp(`\\b(${KEY_PATTERN})\\s*=\\s*([^\\s,;]+)`, "gi"),
    "$1=***REDACTED***"
  );

  // OAuth callback URLs can contain a one-time authorization code even if the
  // surrounding field has an unexpected name.
  line = line.replace(/([?&]code=)[^&\s'"}]+/gi, "$1***REDACTED***");

  // Defensive coverage for Authorization headers in arbitrary downstream logs.
  line = line.replace(/(Authorization\s*[:=]\s*(?:Bearer|Basic)\s+)[^\s,'"}]+/gi, "$1***REDACTED***");

  return line;
}
