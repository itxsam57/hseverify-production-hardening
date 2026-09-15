import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import ts from "typescript";

export async function loadWrittenScoringRuntime() {
  const out = mkdtempSync(resolve(tmpdir(), "hse-written-scoring-runtime-"));
  const root = resolve("src", "lib");
  const files = ["scoring/written-scoring-domain.ts", "scoring/written-scoring-service.ts", "auth/auth-domain.ts"];
  const resolveImport = (importer, specifier) => {
    if (specifier.startsWith(".")) {
      const base = resolve(dirname(importer), specifier);
      for (const candidate of [base, `${base}.ts`]) if (existsSync(candidate)) return candidate;
    }
    if (specifier.startsWith("../database")) return resolve(root, "database/database.ts");
    if (specifier.startsWith("@/lib/")) return resolve(root, specifier.slice(6) + ".ts");
    return null;
  };
  const seen = new Set();
  const collect = (relative) => {
    if (seen.has(relative) || relative === "database/database.ts") return;
    seen.add(relative);
    const file = resolve(root, relative);
    for (const item of ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
      const dependency = resolveImport(file, item.fileName);
      if (dependency) collect(dependency.replace(`${root}/`, ""));
    }
  };
  files.forEach(collect);
  for (const relative of seen) {
    const source = readFileSync(resolve(root, relative), "utf8").replace(/^import "server-only";\n?/, "");
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const target = resolve(out, relative.replace(/\.ts$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output, "utf8");
  }
  const db = resolve(out, "database/database.js");
  mkdirSync(dirname(db), { recursive: true });
  writeFileSync(db, "module.exports={};", "utf8");
  const scoringModule = await import(`file://${resolve(out, "scoring/written-scoring-service.js")}`);
  const domain = await import(`file://${resolve(out, "scoring/written-scoring-domain.js")}`);
  const auth = await import(`file://${resolve(out, "auth/auth-domain.js")}`);
  return { WrittenScoringService: scoringModule.WrittenScoringService, createIdentifier: auth.createIdentifier, ...domain };
}
