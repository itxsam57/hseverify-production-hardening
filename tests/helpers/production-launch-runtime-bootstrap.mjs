import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

export function ensureProductionLaunchRuntime() {
  if (process.env.HSE_PRODUCTION_LAUNCH_RUNTIME_DIST) {
    return process.env.HSE_PRODUCTION_LAUNCH_RUNTIME_DIST;
  }

  const out = resolve(".production-launch-runtime-test-dist");
  rmSync(out, { recursive: true, force: true });
  const root = resolve("src", "lib");
  const entries = ["operations/production-launch-service.ts"];
  const skip = new Set(["database/database.ts"]);
  const seen = new Set();

  const resolveImport = (file, specifier) => {
    const candidate = specifier.startsWith("@/lib/")
      ? resolve(root, specifier.slice(6))
      : specifier.startsWith(".")
        ? resolve(dirname(file), specifier)
        : null;
    if (!candidate) return null;
    for (const value of [candidate, `${candidate}.ts`]) {
      if (value.endsWith(".ts") && existsSync(value)) return value;
    }
    throw new Error(`Unable to resolve ${specifier} from ${file}`);
  };

  const collect = (file) => {
    const relativeFile = relative(root, file).replaceAll("\\", "/");
    if (skip.has(relativeFile) || seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const item of ts.preProcessFile(source, true, true).importedFiles) {
      const dependency = resolveImport(file, item.fileName);
      if (dependency && !dependency.endsWith(".mjs")) collect(dependency);
    }
  };

  for (const entry of entries) collect(resolve(root, entry));

  for (const file of seen) {
    let source = readFileSync(file, "utf8").replace(/^import "server-only";\r?\n?/, "");
    source = source.replace(/(["'])@\/lib\/([^"']+)\1/g, (_match, quote, value) => {
      const absolute = resolve(root, value);
      const target = relative(dirname(file), absolute).replaceAll("\\", "/").replace(/\.ts$/, "");
      return `${quote}${target.startsWith(".") ? target : `./${target}`}${quote}`;
    });
    source = source.replace(/(["'])(\.[^"']+)\1/g, (match, quote, value) => {
      const absolute = resolve(dirname(file), value);
      if (!existsSync(`${absolute}.ts`) && !existsSync(absolute)) return match;
      const target = relative(dirname(file), absolute).replaceAll("\\", "/").replace(/\.ts$/, "");
      return `${quote}${target.startsWith(".") ? target : `./${target}`}${quote}`;
    });
    source = source.replace(/from (["'])(\.[^"']+)\.ts\1/g, "from $1$2$1");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText;
    const target = resolve(out, relative(root, file).replace(/\.ts$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
  }

  mkdirSync(resolve(out, "database"), { recursive: true });
  writeFileSync(
    resolve(out, "database", "database.js"),
    "exports.getDatabaseClient=async()=>{throw new Error('runtime injected database');};"
  );
  process.env.HSE_PRODUCTION_LAUNCH_RUNTIME_DIST = out;
  return out;
}
