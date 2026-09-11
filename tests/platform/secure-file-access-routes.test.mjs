import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const API_ROOT = resolve("src", "app", "api", "secure-files");

async function routeSource(name) {
  return readFile(resolve(API_ROOT, name, "route.ts"), "utf8");
}

test("signed secure file HTTP surface is exactly authorize, preview and download", async () => {
  const entries = await readdir(API_ROOT, { withFileTypes: true });
  const routeDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(routeDirectories, ["access", "download", "preview"]);

  const access = await routeSource("access");
  const preview = await routeSource("preview");
  const download = await routeSource("download");

  assert.match(access, /export async function POST\(/);
  assert.doesNotMatch(access, /export async function GET\(/);
  assert.match(preview, /export async function GET\(/);
  assert.doesNotMatch(preview, /export async function POST\(/);
  assert.match(download, /export async function GET\(/);
  assert.doesNotMatch(download, /export async function POST\(/);

  assert.match(preview, /expectedPurpose: "preview"/);
  assert.doesNotMatch(preview, /expectedPurpose: "download"/);
  assert.match(download, /expectedPurpose: "download"/);
  assert.doesNotMatch(download, /expectedPurpose: "preview"/);

  for (const source of [access, preview, download]) {
    assert.match(source, /export const runtime = "nodejs"/);
    assert.match(source, /export const dynamic = "force-dynamic"/);
    assert.doesNotMatch(
      source,
      /reviewer|verifier|assessor|admin|root|identity|qualification|experience|employment|credential/i,
      "Subunit 4 route must not pull later workflow/role rules forward"
    );
  }
});
