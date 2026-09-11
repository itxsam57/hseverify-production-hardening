import assert from "node:assert/strict";
import { createServer } from "node:net";

import { runDevelopmentServer } from "./lib/development-server.mjs";

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a development smoke-test port."));
        return;
      }

      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

const port = await findFreePort();
const route = `http://127.0.0.1:${port}/worker/login`;
const result = await runDevelopmentServer({
  args: ["--hostname", "127.0.0.1", "--port", String(port)],
  probeUrl: route
});

assert.equal(result.responseStatus, 200, result.output);
assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
console.log(
  "Normal development mode smoke passed with HTTP 200, isolated output, clean shutdown and unchanged source configuration."
);
