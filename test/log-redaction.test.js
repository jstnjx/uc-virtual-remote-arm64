import assert from "node:assert/strict";
import test from "node:test";

import { redactIntegrationLogLine } from "../src/shared/log-redaction.js";

test("redacts JSON and Python setup secrets", () => {
  const json = redactIntegrationLogLine('{"client_secret":"secret-1","auth_code":"https://example.com/callback?code=abc123&state=x","client_id":"public"}');
  assert.equal(json.includes("secret-1"), false);
  assert.equal(json.includes("abc123"), false);
  assert.match(json, /client_secret.*REDACTED/);
  assert.match(json, /auth_code.*REDACTED/);
  assert.match(json, /client_id.*public/);

  const python = redactIntegrationLogLine("UserDataResponse(input_values={'client_secret': 'secret-2', 'refresh_token': 'refresh-1', 'client_id': 'public'})");
  assert.equal(python.includes("secret-2"), false);
  assert.equal(python.includes("refresh-1"), false);
  assert.match(python, /client_id': 'public/);
});

test("redacts OAuth callback codes and authorization headers", () => {
  const line = redactIntegrationLogLine("redirect=https://example.com/callback?code=oauth-code&state=x Authorization: Bearer bearer-token");
  assert.equal(line.includes("oauth-code"), false);
  assert.equal(line.includes("bearer-token"), false);
  assert.match(line, /code=\*\*\*REDACTED\*\*\*/);
});
