const port = Number(process.env.UCVR_REST_PORT || process.env.UCVR_PORT || 11090);
const response = await fetch(`http://127.0.0.1:${port}/health`);
if (!response.ok) process.exit(1);
const body = await response.json();
if (body.status !== "ok") process.exit(1);
