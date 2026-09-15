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

test("M2.11 assessor interview route executes in the running application", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/assessor/interviews`,
    probe: async () => {
      const response = await fetch(`${baseUrl}/assessor/interviews`, { redirect: "manual" });
      assert(response.status < 500);
      assert.notEqual(response.status, 404);
    }
  });
});
