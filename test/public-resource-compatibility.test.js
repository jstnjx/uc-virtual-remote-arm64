import assert from "node:assert/strict";
import test from "node:test";
import {
  installPublicResourceCompatibility,
  normalizePublicResourceUrl
} from "../src/api/public-resource-compatibility.js";

test("physical Core resource download URLs map to the existing public binary endpoint", () => {
  assert.equal(
    normalizePublicResourceUrl("/resources/Icon/living-room.png", "GET"),
    "/api/resources/icon/living-room.png/content"
  );
  assert.equal(
    normalizePublicResourceUrl("/api/resources/BackgroundImage/home.webp?cache=1", "GET"),
    "/api/resources/background/home.webp/content?cache=1"
  );
});

test("only known binary GET resource paths are rewritten", () => {
  for (const [url, method] of [
    ["/api/resources", "GET"],
    ["/api/resources/Icon", "GET"],
    ["/api/resources/icon/living-room.png/content", "GET"],
    ["/api/resources/Unknown/living-room.png", "GET"],
    ["/api/resources/Icon/living-room.png", "DELETE"],
    ["/resources/Icon/living-room.png", "POST"]
  ]) {
    assert.equal(normalizePublicResourceUrl(url, method), url);
  }
});

test("HTTP compatibility wrapper rewrites the request before the Core router", () => {
  let receivedUrl = null;
  const fakeHttp = {
    createServer(listener) {
      return { listener };
    }
  };

  installPublicResourceCompatibility(fakeHttp);
  const server = fakeHttp.createServer((request) => {
    receivedUrl = request.url;
  });
  server.listener(
    { method: "GET", url: "/api/resources/Icon/test.png" },
    {}
  );

  assert.equal(receivedUrl, "/api/resources/icon/test.png/content");
  assert.equal(fakeHttp.createServer.__ucvrPublicResourceCompatibility, true);
});
