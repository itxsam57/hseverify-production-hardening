import { createRequire } from "node:module";
import ts from "typescript";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
    if (request === "./assessment-review-source") return loadTs("src/lib/scoring/assessment-review-source.ts");
    if (request === "../database/database") return {};
    if (request === "server-only") return {};
    if (request.startsWith(".") || request.startsWith("@/")) {
      const candidate = request.startsWith("@/")
        ? resolve("src",request.slice(2)) : resolve(dirname(path),request);
      for (const suffix of [".ts",".tsx"]) {
        if (existsSync(candidate+suffix)) return loadTs(candidate+suffix);
      }
    }
    return require(request);
  };
  const factory = new Function("exports", "require", "module", "__filename", "__dirname", output);
  factory(moduleRecord.exports, localRequire, moduleRecord, path, ".");
  compiled.set(path, moduleRecord.exports);
  return moduleRecord.exports;
}
