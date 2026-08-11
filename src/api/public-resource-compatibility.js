import http from "node:http";

function coreResourceType(type) {
  const value = String(type || "").toLowerCase();
  if (value === "icon") return "icon";
  if (["background", "backgroundimage"].includes(value)) return "background";
  return null;
}

export function normalizePublicResourceUrl(requestUrl, method = "GET") {
  if (String(method || "GET").toUpperCase() !== "GET") return requestUrl;
  const url = new URL(requestUrl || "/", "http://localhost");
  const resource = url.pathname.match(/^\/(?:api\/)?resources\/([^/]+)\/([^/]+)$/);
  if (!resource) return requestUrl;
  const type = coreResourceType(resource[1]);
  if (!type) return requestUrl;

  // Core resource URLs are embedded in views rendered by external/mobile clients.
  // Their image requests commonly do not propagate the Core Authorization header.
  // Route only the immutable binary GET to UCVR's existing public content endpoint.
  // Listing, upload and deletion requests still use the authenticated API routes.
  url.pathname = `/api/resources/${type}/${resource[2]}/content`;
  return `${url.pathname}${url.search}`;
}

export function installPublicResourceCompatibility(httpModule = http) {
  if (httpModule.createServer.__ucvrPublicResourceCompatibility) return;
  const nativeCreateServer = httpModule.createServer;

  const createServer = function createServer(...args) {
    const listenerIndex = typeof args[0] === "function" ? 0 : typeof args[1] === "function" ? 1 : -1;
    if (listenerIndex >= 0) {
      const listener = args[listenerIndex];
      args[listenerIndex] = (request, response) => {
        request.url = normalizePublicResourceUrl(request.url, request.method);
        return listener(request, response);
      };
    }
    return nativeCreateServer.apply(httpModule, args);
  };

  Object.defineProperty(createServer, "__ucvrPublicResourceCompatibility", { value: true });
  httpModule.createServer = createServer;
}
