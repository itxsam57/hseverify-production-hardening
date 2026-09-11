import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const loginPageSource = await readFile(
  resolve("src/components/auth/role-login-page.tsx"),
  "utf8"
);

test("staff enrollment redirect gives visible completion feedback on role login", () => {
  assert.match(
    loginPageSource,
    /reason\s*===\s*["']enrollment-complete["']/,
    "role login must handle the enrollment-complete reason"
  );
  assert.match(
    loginPageSource,
    /Enrollment complete\./,
    "successful enrollment must visibly confirm completion"
  );
  assert.match(
    loginPageSource,
    /form-alert form-alert-success[\s\S]*role=["']status["']/,
    "completion feedback must use the existing success status pattern"
  );
});
