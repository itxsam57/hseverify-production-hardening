import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile("src/lib/integrity/integrity-domain.ts", "utf8");

test("integrity domain contains canonical classifications and signal vocabulary", () => {
  assert.match(source, /GREEN/);
  assert.match(source, /YELLOW/);
  assert.match(source, /RED/);
  assert.match(source, /CAMERA_UNAVAILABLE/);
  assert.match(source, /MIC_UNAVAILABLE/);
  assert.match(source, /SCREEN_UNAVAILABLE/);
  assert.match(source, /BROWSER_FOCUS_LOST/);
});

test("integrity domain keeps invalid signals fail closed", () => {
  assert.match(source, /IntegrityEventInputError/);
  assert.match(source, /INTEGRITY_EVENT_TYPES\.includes/);
});
