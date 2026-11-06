import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve("src/lib");
const out = resolve(".outbox-worker-dist");
const seen = new Set();
rmSync(out,{recursive:true,force:true});
mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,"package.json"),JSON.stringify({type:"commonjs"}));

function dependency(importer,specifier) {
  const base = specifier.startsWith("@/lib/") ? resolve(root,specifier.slice(6)) :
    specifier.startsWith(".") ? resolve(dirname(importer),specifier) : null;
  if (!base) return null;
  const found = [base,base+".ts",base+".mjs",resolve(base,"index.ts")]
    .find(path => existsSync(path) && /\.(ts|mjs)$/.test(path));
  if (!found || relative(root,found).startsWith("..")) {
    throw new Error("Worker dependency is outside its server graph or missing.");
  }
  return found;
}

function compile(path) {
  if (seen.has(path)) return;
  seen.add(path);
  let source = readFileSync(path,"utf8").replace(/^import "server-only";\r?\n/m,"");
  for (const imported of ts.preProcessFile(source,true,true).importedFiles) {
    const target = dependency(path,imported.fileName);
    if (!target) continue;
    compile(target);
    let specifier = relative(dirname(path),target).replaceAll("\\","/").replace(/\.(ts|mjs)$/,".js");
    if (!specifier.startsWith(".")) specifier = "./"+specifier;
    source = source.replaceAll(JSON.stringify(imported.fileName),JSON.stringify(specifier))
      .replaceAll("'"+imported.fileName+"'","'"+specifier+"'");
  }
  const result = ts.transpileModule(source,{
    fileName:path.replace(/\.mjs$/,".ts"),reportDiagnostics:true,
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}
  });
  if (result.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) {
    throw new Error("Worker module compilation failed.");
  }
  const destination = resolve(out,relative(root,path).replace(/\.(ts|mjs)$/,".js"));
  mkdirSync(dirname(destination),{recursive:true});
  writeFileSync(destination,result.outputText);
}
compile(resolve(root,"outbox/outbox-worker.ts"));
compile(resolve(root,"database/database.ts"));
// Report rendering uses only its bundled licensed font assets in the compiled worker.
if (seen.has(resolve(root,"reports/report-renderer.ts"))) {
  cpSync(resolve(root,"reports/fonts"),resolve(out,"reports/fonts"),{recursive:true});
}
console.log("Outbox worker compiled from the real server graph.");
