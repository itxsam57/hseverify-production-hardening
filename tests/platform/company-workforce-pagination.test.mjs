import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Execute the real server page with deterministic authorized directory data.
// This focused render regression is not a live authorization or browser proof.
const require = createRequire(import.meta.url);
async function render(params, pageNumber = 2, total = 75) {
  const source = await readFile("src/app/company/(portal)/workers/page.tsx", "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022, esModuleInterop: true
  }}).outputText;
  const loaded = {exports: {}};
  const calls = [];
  const loader = (name) => {
    if (name === "next/link") return ({children, ...props}) => ({type: "a", props: {...props, children}});
    if (name.endsWith("company-workforce-print-button")) return {CompanyWorkforcePrintButton: () => null};
    if (name.endsWith("authorization-service")) return {requireCurrentTenantPermission: async permission => ({permission})};
    if (name.endsWith("company-organization-repository")) return {getCompanyOrganizationRepository: () => ({list: async () => []})};
    if (name.endsWith("company-workforce-directory-service")) return {getCompanyWorkforceDirectoryService: () => ({
      search: async (principal, input) => {
        calls.push({principal, input});
        return {rows: [], total, page: pageNumber, pageSize: 25};
      }
    })};
    return require(name);
  };
  new Function("require", "module", "exports", output)(loader, loaded, loaded.exports);
  return {tree: await loaded.exports.default({searchParams: Promise.resolve(params)}), calls};
}
function elements(value, found = []) {
  if (Array.isArray(value)) for (const item of value) elements(item, found);
  else if (value && typeof value === "object" && value.props) {
    found.push(value);
    elements(value.props.children, found);
  }
  return found;
}
test("Directory Previous and Next preserve every active filter and omit caller-supplied scope", async () => {
  const filters = {q: "Safety & Operations", status: "active", site: "site_a", department: "department_a", assurance: "ASSESSMENT_PENDING"};
  const {tree, calls} = await render({...filters, page: "2", tenantId: "foreign", accountId: "foreign"});
  assert.equal(calls[0].principal.permission, "company.workforce.manage");
  assert.deepEqual(calls[0].input, {query: filters.q, status: filters.status, siteId: filters.site, departmentId: filters.department, assuranceStatus: filters.assurance, page: 2});
  const links = elements(tree).filter(element => ["Previous", "Next"].includes(element.props.children));
  assert.equal(links.length, 2);
  for (const link of links) {
    const query = new URL(link.props.href, "https://example.test/company/workers").searchParams;
    for (const [key, value] of Object.entries(filters)) assert.equal(query.get(key), value, link.props.children + " lost " + key);
    assert.equal(query.get("page"), link.props.children === "Previous" ? "1" : "3");
    assert.equal(query.has("tenantId"), false);
    assert.equal(query.has("accountId"), false);
  }
});
test("Unfiltered first and last pages expose only valid pagination directions", async () => {
  for (const [pageNumber, label] of [[1, "Next"], [3, "Previous"]]) {
    const {tree} = await render({}, pageNumber);
    const links = elements(tree).filter(element => ["Previous", "Next"].includes(element.props.children));
    assert.equal(links.length, 1);
    assert.equal(links[0].props.children, label);
    const query = new URL(links[0].props.href, "https://example.test").searchParams;
    assert.deepEqual([...query.keys()], ["page"]);
  }
});
