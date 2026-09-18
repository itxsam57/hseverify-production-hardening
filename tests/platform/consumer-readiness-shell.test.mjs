import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("global response headers enforce browser security without blocking assessment capture", async () => {
  const source = await readFile("next.config.ts", "utf8");
  assert.match(source, /Content-Security-Policy/);
  assert.match(source, /Strict-Transport-Security/);
  assert.match(source, /camera=\(self\)/);
  assert.match(source, /microphone=\(self\)/);
  assert.match(source, /geolocation=\(\)/);
});

test("Worker navigation exposes privacy controls and scoped share links", async () => {
  const source = await readFile("src/components/worker/worker-navigation.tsx", "utf8");
  assert.match(source, /href: "\/worker\/privacy"/);
  assert.match(source, /href: "\/worker\/share-links"/);
});

test("integrity check uses real browser devices and offers an honest limited mode", async () => {
  const source = await readFile("src/app/integrity/page.tsx", "utf8");
  assert.match(source, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(source, /Check camera and microphone/);
  assert.match(source, /Continue with limited monitoring/);
  assert.doesNotMatch(source, /Simulate camera unavailable/);
});
