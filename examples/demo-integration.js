import { startStandaloneDemoIntegration } from "../src/demo/standalone.js";

const port = Number(process.env.DEMO_INTEGRATION_PORT || 11091);
const updateIntervalMs = Number(process.env.DEMO_UPDATE_INTERVAL_MS || 5_000);

await startStandaloneDemoIntegration({ port, updateIntervalMs });
console.log(`Demo UC integration listening on ws://0.0.0.0:${port}/intg`);
