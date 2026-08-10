import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const integrationsView = fs.readFileSync(
  new URL("../web-configurator/src/views/integrations/DevicesIntegrations.vue", import.meta.url),
  "utf8",
);
const customImport = fs.readFileSync(
  new URL("../web-configurator/src/components/integration/ImportCustomIntegration.vue", import.meta.url),
  "utf8",
);

test("Integrations toolbar uses the official Add new entry point", () => {
  assert.match(
    integrationsView,
    /isDockTab\s*\?\s*\$t\("dock\.add\.title"\)\s*:\s*\$t\("ui\.add_new"\)/,
  );
  assert.match(integrationsView, /name="add-integration-menu"/);
});

test("Add new chooser exposes registry and custom install actions", () => {
  assert.match(integrationsView, /\$t\("integration\.add\.title"\)/);
  assert.match(
    integrationsView,
    /\$t\("integration\.install_custom\.trigger"\)/,
  );
  assert.match(integrationsView, /@click="startNewIntegration"/);
  assert.match(integrationsView, /@click="startCustomIntegrationInstall"/);
});

test("Install custom reuses the official tarball uploader", () => {
  assert.match(integrationsView, /ImportCustomIntegration/);
  assert.match(
    integrationsView,
    /elImportCustomIntegration\.value\?\.open\(\)/,
  );
  assert.match(customImport, /importCustomIntegration\(/);
  assert.match(customImport, /:accept="'\.tgz,\.gz'"/);
  assert.match(
    customImport,
    /integration\.install_custom\.popup\.update_installed/,
  );
});
