import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  "src/lib/credential/credential-issuance-domain.ts",
  "utf8"
);

test("credential issuance contains signed-identifier, QR and version foundations", () => {
  assert.match(source, /credentialId/);
  assert.match(source, /qrPayload/);
  assert.match(source, /version/);
  assert.match(source, /publicStatusUrl/);
});

test("credential lifecycle keeps public statuses bounded", () => {
  assert.match(source, /valid/);
  assert.match(source, /expired/);
  assert.match(source, /suspended/);
  assert.match(source, /revoked/);
});
