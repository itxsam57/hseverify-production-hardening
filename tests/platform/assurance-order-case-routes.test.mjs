import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const paths = Object.freeze({
  list: "src/app/company/(portal)/assurance-orders/page.tsx",
  create: "src/app/company/(portal)/assurance-orders/new/page.tsx",
  detail: "src/app/company/(portal)/assurance-orders/[orderId]/page.tsx",
  actions: "src/app/company/(portal)/assurance-orders/actions.ts",
  actionCentre: "src/app/company/(portal)/action-centre/page.tsx",
  actionCentreActions: "src/app/company/(portal)/action-centre/actions.ts",
  workspace: "src/components/company/assurance-order-workspace.tsx",
  actionWorkspace: "src/components/company/assurance-action-centre.tsx",
  shell: "src/components/auth/role-portal-shell.tsx"
});

function source(path) {
  assert.equal(existsSync(resolve(path)), true, `${path} must exist`);
  return readFileSync(resolve(path), "utf8");
}

test("M2.01 exposes refresh-safe Company order and Action Centre routes", () => {
  const list = source(paths.list);
  const create = source(paths.create);
  const detail = source(paths.detail);
  const actionCentre = source(paths.actionCentre);
  const shell = source(paths.shell);

  assert.match(`${list}\n${create}\n${detail}`, /assurance/i);
  assert.match(actionCentre, /Action Centre/i);
  assert.match(shell, /\/company\/assurance-orders/);
  assert.match(shell, /\/company\/action-centre/);
});

test("M2.01 Company actions recheck permission and never trust browser tenant or actor authority", () => {
  const actions = source(paths.actions);
  const actionCentreActions = source(paths.actionCentreActions);
  for (const body of [actions, actionCentreActions]) {
    assert.match(body, /["']use server["']/);
    assert.match(body, /requireCurrentTenantPermission\(["']company\.orders\.manage["']\)/);
    for (const field of ["tenantId", "membershipId", "actorAccountId", "createdByMembershipId"]) {
      assert.ok(!new RegExp(`formData\\.get\\([\"']${field}[\"']\\)`).test(body), field);
    }
  }
});

test("M2.01 visible controls match canonical state semantics", () => {
  const workspace = source(paths.workspace);
  for (const label of [
    "Save Draft",
    "Add Workers",
    "Validate Order",
    "Submit Order",
    "Cancel Draft",
    "Cancel Submitted Order"
  ]) assert.ok(workspace.includes(label), label);
  assert.match(workspace, /pending|owner|next action/i);
  assert.ok(!/\bprocessing\b/i.test(workspace));
});

test("M2.01 Action Centre exposes only internal-safe commands and exact source deep links", () => {
  const workspace = source(paths.actionWorkspace);
  for (const label of ["Open", "Assign owner", "Mark internally acknowledged", "Snooze"])
    assert.ok(workspace.includes(label), label);
  assert.match(workspace, /reason/i);
  assert.match(workspace, /due/i);
  assert.match(workspace, /owner/i);
  assert.match(workspace, /allowed action|allowedAction/i);
  assert.ok(!/assign reviewer|assign assessor|approve evidence|reject evidence/i.test(workspace));
});
