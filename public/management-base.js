/* UC Virtual Remote management URL helper — SPDX-License-Identifier: MIT */

export function appUrl(pathname, base = globalThis.document?.baseURI || "http://localhost/") {
  const relative = String(pathname || "").replace(/^\/+/, "");
  return new URL(relative, base).toString();
}
