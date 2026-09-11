import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const routeSource = await readFile(
  resolve("src/app/staff/invite/[token]/route.ts"),
  "utf8"
);

test("staff invitation redirect keeps the browser on the exact external origin", () => {
  assert.match(
    routeSource,
    /function\s+relativeRedirect\(location:\s*string\)[\s\S]*headers:\s*\{\s*["']?Location["']?\s*:\s*location\s*\}/i,
    "route must construct the redirect from a relative Location value"
  );
  assert.match(
    routeSource,
    /relativeRedirect\(["']\/staff\/invite\/accept["']\)/,
    "successful invitation must target the relative accept path"
  );
  assert.doesNotMatch(
    routeSource,
    /new URL\([^\n]*request\.url/,
    "staff invitation redirect must not rebuild an absolute origin from request.url"
  );
});
