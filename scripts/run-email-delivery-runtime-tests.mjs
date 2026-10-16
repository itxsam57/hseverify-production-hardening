import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const outputDirectory = resolve(".email-delivery-runtime-test-dist");
const sourceRoot = resolve("src", "lib");
rmSync(outputDirectory, { recursive: true, force: true });

const SOURCE_FILES = Object.freeze([
  "auth/auth-domain.ts",
  "authorization/authorization-domain.ts",
  "authorization/authorization-context-domain.ts",
  "authorization/tenant-scoped-resource-domain.ts",
  "authorization/tenant-scoped-command-guard.ts",
  "audit/audit-domain.ts",
  "audit/audit-repository.ts",
  "outbox/outbox-domain.ts",
  "outbox/outbox-repository.ts",
  "email-delivery/email-delivery-domain.ts",
  "email-delivery/email-delivery-adapter.ts",
  "email-delivery/email-delivery-repository.ts",
  "email-delivery/email-delivery-handler.ts",
  "config/environment.ts",
  "config/server-environment.ts",
  "database/database.ts"
]);

function runtimeSource(sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  // `server-only` is a Next.js build marker, not product logic and not a direct
  // dependency in this repository. The real project typecheck/build validate the
  // marker. The temporary execution copy removes only this exact side-effect import.
  return source.replace(/^import "server-only";\r?\n\r?\n?/, "");
}

function compileRuntimeModule(relativePath) {
  if(relativePath.endsWith(".mjs")){
    const destination=resolve(outputDirectory,relativePath);
    mkdirSync(dirname(destination),{recursive:true});
    writeFileSync(destination,readFileSync(resolve(sourceRoot,relativePath),"utf8"),"utf8");
    return [];
  }
  const sourcePath = resolve(sourceRoot, relativePath);
  const source = runtimeSource(sourcePath);
  const compiled = ts.transpileModule(source, {
    fileName: sourcePath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
      removeComments: false
    }
  });

  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors.length > 0) {
    for (const diagnostic of errors) {
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n"
      );
      console.error(
        `Runtime transpile failed for ${relative(sourceRoot, sourcePath)}: ${message}`
      );
    }
    process.exit(1);
  }

  const destination = resolve(
    outputDirectory,
    relativePath.replace(/\.ts$/, ".js")
  );
  mkdirSync(dirname(destination), { recursive: true });
  const imports=[];
  const emitted=ts.createSourceFile(destination,compiled.outputText,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
  const visit=node=>{
    if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text==="require" &&
      node.arguments.length===1 && ts.isStringLiteral(node.arguments[0])){
      const request=node.arguments[0].text;
      if(request.startsWith(".") || request.startsWith("@/lib/")){
        const path=request.startsWith("@/lib/")?resolve(sourceRoot,request.slice("@/lib/".length)):resolve(dirname(sourcePath),request);
        const dependency=[path,path+".ts",path+".tsx",path+".mjs"].find(candidate=>existsSync(candidate));
        if(!dependency || relative(sourceRoot,dependency).startsWith(".."))throw new Error("Runtime source dependency is missing or outside src/lib: "+request);
        imports.push(relative(sourceRoot,dependency));
      }else if(request.startsWith("@/"))throw new Error("Unsupported runtime source alias: "+request);
    }
    ts.forEachChild(node,visit);
  };
  visit(emitted);
  let output=compiled.outputText;
  for(const dependency of imports){
    const alias="@/lib/"+dependency.replace(/\.tsx?$/,"");
    let target=relative(dirname(destination),resolve(outputDirectory,dependency.replace(/\.tsx?$/,".js"))).replaceAll("\\\\","/");
    if(!target.startsWith("."))target="./"+target;
    output=output.replaceAll(JSON.stringify(alias),JSON.stringify(target));
  }
  writeFileSync(destination, output, "utf8");
  return imports;
}

// Follow only the current real emitted runtime imports from the original roots.
// This retains the existing source-copy harness and both explicit default-factory stubs.
const pending=[...SOURCE_FILES],copied=new Set();
while(pending.length){
  const sourceFile=pending.shift();
  if(copied.has(sourceFile))continue;
  copied.add(sourceFile);
  pending.push(...compileRuntimeModule(sourceFile));
}

// The runtime test injects the real PGlite script database client explicitly.
// Replace only the default compiled factories so test execution never opens a
// hidden second database or depends on application-only environment bootstrap.
const databaseStub = resolve(outputDirectory, "database", "database.js");
writeFileSync(
  databaseStub,
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getDatabaseClient = async function getDatabaseClient() { throw new Error("Runtime test must inject a database client."); };\n',
  "utf8"
);

const environmentStub = resolve(
  outputDirectory,
  "config",
  "server-environment.js"
);
writeFileSync(
  environmentStub,
  '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.getServerEnvironment = function getServerEnvironment() { throw new Error("Runtime test must inject the local/test adapter environment."); };\n',
  "utf8"
);

const tests = spawnSync(
  process.execPath,
  ["--test", resolve("tests", "platform", "email-delivery-runtime.test.mjs")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HSE_EMAIL_DELIVERY_RUNTIME_DIST: outputDirectory
    }
  }
);

rmSync(outputDirectory, { recursive: true, force: true });
process.exit(tests.status ?? 1);
