import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

export function loadAssessmentAttemptRuntime() {
  const out = mkdtempSync(join(tmpdir(), "hse-assessment-attempt-runtime-direct-"));
  const root = resolve("src", "lib");
  const seen = new Set();
  const entries = [
    "assessment-attempt/assessment-attempt-domain.ts",
    "assessment-attempt/assessment-attempt-draft-domain.ts",
    "assessment-attempt/assessment-attempt-repository.ts",
    "assessment-attempt/assessment-attempt-service.ts",
    "assessment-attempt/assessment-attempt-client-view.ts"
  ];
  const stubs = new Set(["database/database.ts"]);

  const resolveImport = (importer, specifier) => {
    let base = null;
    if (specifier.startsWith(".")) base = resolve(dirname(importer), specifier);
    else if (specifier.startsWith("@/lib/")) base = resolve(root, specifier.slice(6));
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, resolve(base, "index.ts")]) {
      if (candidate.endsWith(".ts") && existsSync(candidate)) return candidate;
    }
    throw new Error(`Unable to resolve runtime dependency ${specifier}`);
  };

  const collect = (relativePath) => {
    if (seen.has(relativePath) || stubs.has(relativePath)) return;
    seen.add(relativePath);
    const file = resolve(root, relativePath);
    for (const imported of ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
      const dependency = resolveImport(file, imported.fileName);
      if (dependency) collect(relative(root, dependency).replaceAll("\\", "/"));
    }
  };
  entries.forEach(collect);

  for (const relativePath of seen) {
    const sourcePath = resolve(root, relativePath);
    const source = readFileSync(sourcePath, "utf8").replace(/^import "server-only";\r?\n\r?\n?/, "");
    const transformed = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText;
    const destination = resolve(out, relativePath.replace(/\.ts$/, ".js"));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, transformed, "utf8");
  }
  mkdirSync(resolve(out, "database"), { recursive: true });
  writeFileSync(resolve(out, "database/database.js"), "exports.getDatabaseClient=async()=>{throw new Error('runtime injects database')};", "utf8");
  return out;
}
