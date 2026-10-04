import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const modules = new Map();
export function loadWorkerRegistrationTs(path) {
  const filename = resolve(path);
  if (modules.has(filename)) return modules.get(filename).exports;
  const record = { exports: {} };
  modules.set(filename, record);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const localRequire = request => {
    if (request === "server-only") return {};
    // Tests inject the real database repository and service config; runtime singleton getters are unused.
    if (request === "@/lib/database/database" || request === "@/lib/config/server-environment") return {};
    if (request.startsWith("@/")) return loadWorkerRegistrationTs("src/" + request.slice(2) + ".ts");
    if (request.startsWith(".")) return loadWorkerRegistrationTs(resolve(dirname(filename), request + ".ts"));
    return require(request);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", output)(record.exports, localRequire, record, filename, dirname(filename));
  return record.exports;
}
