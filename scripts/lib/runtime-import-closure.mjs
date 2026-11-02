import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";

export function compileRuntimeImportClosure({ sourceRoot, outputDirectory, entryFiles, sourceTransform = source => source }) {
  const pending = [...entryFiles], copied = new Set();
  const outputPath = path => resolve(outputDirectory, path.replace(/\.tsx?$/, ".js"));
  const resolveDependency = (sourcePath, request) => {
    const path = request.startsWith("@/lib/")
      ? resolve(sourceRoot, request.slice("@/lib/".length))
      : resolve(dirname(sourcePath), request);
    const dependency = [path, path + ".ts", path + ".tsx", path + ".mjs", resolve(path, "index.ts")]
      .find(candidate => { try { return statSync(candidate).isFile(); } catch { return false; } });
    const withinRoot = dependency && relative(sourceRoot, dependency);
    if (!dependency || withinRoot.startsWith("..") || isAbsolute(withinRoot)) {
      throw new Error("Runtime source dependency is missing or outside src/lib: " + request);
    }
    return withinRoot;
  };
  while (pending.length) {
    const path = pending.shift();
    if (copied.has(path)) continue;
    copied.add(path);
    const sourcePath = resolve(sourceRoot, path), destination = outputPath(path);
    const source = sourceTransform(readFileSync(sourcePath, "utf8"));
    const isModule = path.endsWith(".mjs");
    const compiled = isModule ? { outputText: source } : ts.transpileModule(source, {
      fileName: sourcePath, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        esModuleInterop: true, strict: true, removeComments: false }
    });
    const errors = (compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) throw new Error(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n"));
    const imports = new Map();
    const emitted = ts.createSourceFile(destination, compiled.outputText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const addImport = request => {
      if (request.startsWith(".") || request.startsWith("@/lib/")) {
        imports.set(request, resolveDependency(sourcePath, request));
      } else if (request.startsWith("@/")) {
        throw new Error("Unsupported runtime source alias: " + request);
      }
    };
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          node.expression.text === "require" && node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0])) addImport(node.arguments[0].text);
      if (isModule && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) addImport(node.moduleSpecifier.text);
      ts.forEachChild(node, visit);
    };
    visit(emitted);
    let output = compiled.outputText;
    for (const [request, dependency] of imports) {
      pending.push(dependency);
      if (request.startsWith("@/lib/")) {
        let target = relative(dirname(destination), outputPath(dependency)).replaceAll("\\", "/");
        if (!target.startsWith(".")) target = "./" + target;
        output = output.replaceAll(JSON.stringify(request), JSON.stringify(target));
      }
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, output, "utf8");
  }
  return Object.freeze([...copied]);
}
