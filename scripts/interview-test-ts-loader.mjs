import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compiled = new Map();

export function loadTs(path) {
  if (compiled.has(path)) return compiled.get(path);
  const source = require("node:fs").readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  const localRequire = (request) => {
    if (request === "../auth/auth-domain") return loadTs("src/lib/auth/auth-domain.ts");
    if (request === "./interview-scheduling-domain") return loadTs("src/lib/interview/interview-scheduling-domain.ts");
    if (request === "./interview-scheduling-repository") return loadTs("src/lib/interview/interview-scheduling-repository.ts");
    if (request === "./privacy-operations-repository") return loadTs("src/lib/privacy/privacy-operations-repository.ts");
    if (request === "./privacy-operations-domain") return loadTs("src/lib/privacy/privacy-operations-domain.ts");
    if (request === "../database/database") return {};
    if (request === "server-only") return {};
    return require(request);
  };
  const factory = new Function("exports", "require", "module", "__filename", "__dirname", output);
  factory(moduleRecord.exports, localRequire, moduleRecord, path, ".");
  compiled.set(path, moduleRecord.exports);
  return moduleRecord.exports;
}
