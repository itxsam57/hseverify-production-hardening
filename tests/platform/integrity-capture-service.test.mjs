import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

test("M2.09 integrity capture runtime preserves degraded and recovered states", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/api/integrity/snapshot`,
    probe: async () => {
      const degraded = await fetch(`${baseUrl}/api/integrity/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "CAMERA_UNAVAILABLE", occurredAt: "2026-09-12T09:00:00.000Z" })
      });
      const recovered = await fetch(`${baseUrl}/api/integrity/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "BROWSER_RESUMED", occurredAt: "2026-09-12T09:01:00.000Z" })
      });

      assert.equal((await degraded.json()).event.state, "DEGRADED");
      assert.equal((await recovered.json()).event.state, "RECOVERED");
    }
  });
});
