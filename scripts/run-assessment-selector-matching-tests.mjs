import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const out = resolve(".assessment-selector-matching-runtime-test-dist");
const root = resolve("src", "lib");
const alias = "@/lib/";
const entries = ["assessment-generation/assessment-selector-matching.ts"];
rmSync(out, { recursive: true, force: true });

function fail(message) {
  console.error(message);
  process.exit(1);
}
function relativeLib(path) {
  const value = relative(root, path).replaceAll("\\", "/");
  if (value.startsWith("../") || value === "..") throw new Error(`M2.05 selector matching dependency escaped src/lib: ${path}`);
  return value;
}
function resolveImport(importer, specifier) {
  let base;
  if (specifier.startsWith(".")) base = resolve(dirname(importer), specifier);
  else if (specifier.startsWith(alias)) base = resolve(root, specifier.slice(alias.length));
  else return null;
  for (const candidate of [base, `${base}.ts`, resolve(base, "index.ts")]) {
    if (candidate.endsWith(".ts") && existsSync(candidate)) {
      relativeLib(candidate);
      return candidate;
    }
  }
  throw new Error(`M2.05 selector matching dependency unresolved: ${specifier} from ${importer}`);
}
function outputSpecifier(importer, dependency) {
  let value = relative(dirname(importer), dependency).replaceAll("\\", "/").replace(/\.ts$/, "");
  if (!value.startsWith(".")) value = `./${value}`;
  return value;
}
function transformedSource(path) {
  let source = readFileSync(path, "utf8").replace(/^import "server-only";\r?\n\r?\n?/, "");
  for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
    const dependency = resolveImport(path, imported.fileName);
    if (!dependency) continue;
    const replacement = outputSpecifier(path, dependency);
    source = source.replaceAll(`"${imported.fileName}"`, `"${replacement}"`).replaceAll(`'${imported.fileName}'`, `'${replacement}'`);
  }
  return source;
}
function collect() {
  const seen = new Set();
  function visit(relativePath) {
    if (seen.has(relativePath)) return;
    const path = resolve(root, relativePath);
    if (!existsSync(path)) fail(`M2.05 selector matching runtime module missing: ${relativePath}`);
    seen.add(relativePath);
    for (const imported of ts.preProcessFile(readFileSync(path, "utf8"), true, true).importedFiles) {
      const dependency = resolveImport(path, imported.fileName);
      if (dependency) visit(relativeLib(dependency));
    }
  }
  entries.forEach(visit);
  return [...seen].sort();
}
function compile(relativePath) {
  const path = resolve(root, relativePath);
  const compiled = ts.transpileModule(transformedSource(path), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
      removeComments: false
    }
  });
  const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    errors.forEach((diagnostic) => console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")));
    fail(`M2.05 selector matching runtime compile failed for ${relativePath}`);
  }
  const destination = resolve(out, relativePath.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, compiled.outputText, "utf8");
}
collect().forEach(compile);
const result = spawnSync(process.execPath, ["--test", resolve("tests", "platform", "randomized-assessment-selector-matching.test.mjs")], {
  stdio: "inherit",
  env: { ...process.env, HSE_ASSESSMENT_SELECTOR_MATCHING_RUNTIME_DIST: out }
});
rmSync(out, { recursive: true, force: true });
process.exit(result.status ?? 1);
