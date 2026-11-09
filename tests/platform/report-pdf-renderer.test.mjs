import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp, writeFile, rm, mkdir, cp, readFile, symlink} from "node:fs/promises";
import ts from "typescript";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

test("Report PDF retains supported Unicode and explicitly labels unsupported glyphs in real parsed bytes", async()=>{
 const {renderReportPdf}=loadWorkerRegistrationTs("src/lib/reports/report-renderer.ts");
 const input={reportId:"report_unicode_native",title:"Qualification report",requestedAt:"2026-10-10T00:00:00.000Z",headers:["Worker","Qualification"],rows:[{Worker:"José Müller Иван",Qualification:"安全"}]};
 const bytes=await renderReportPdf(input);
 assert.equal(createHash("sha256").update(bytes).digest("hex"),createHash("sha256").update(await renderReportPdf(input)).digest("hex"),"Retries must retain identical frozen snapshot bytes");
 assert.equal(Buffer.from(bytes).subarray(0,8).toString(),"%PDF-1.4");
 const dir=await mkdtemp(join(tmpdir(),"hse-report-pdf-"));
 try {
  const path=join(dir,"report.pdf");await writeFile(path,bytes);
  const result=spawnSync("pdftotext",["-layout",path,"-"],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/José Müller Иван/u);
  assert.match(result.stdout,/U\+5B89/);assert.match(result.stdout,/U\+5168/);
  assert.match(result.stdout,/Unsupported characters/);
  assert.match(result.stdout,/report_unicode_native/);
 } finally {await rm(dir,{recursive:true,force:true});}
});


test("Standalone report module renders using only its adjacent packaged font and rejects missing or tampered assets", async()=>{
 const dir=await mkdtemp(join(tmpdir(),"hse-report-font-package-"));
 try {
  const reports=join(dir,"reports");await mkdir(reports);
  await writeFile(join(dir,"package.json"),JSON.stringify({type:"commonjs"}));
  await symlink(resolve("node_modules"),join(dir,"node_modules"),"dir");
  for (const name of ["report-renderer","report-delivery-domain","report-types"]) {
   const source=(await readFile("src/lib/reports/"+name+".ts","utf8")).replace(/^import "server-only";\r?\n/m,"");
   const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
   await writeFile(join(reports,name+".js"),output);
  }
  await cp("src/lib/reports/fonts",join(reports,"fonts"),{recursive:true});
  const input={reportId:"report_isolated_font",title:"Qualification",requestedAt:"2026-10-10T00:00:00.000Z",headers:["Name"],rows:[{Name:"José Иван"}]};
  const generate="require('./reports/report-renderer.js').renderReportPdf("+JSON.stringify(input)+").then(bytes=>require('node:fs').writeFileSync('report.pdf',bytes)).catch(error=>{console.error(error.name);process.exitCode=1;});";
  let result=spawnSync(process.execPath,["-e",generate],{cwd:dir,encoding:"utf8"});assert.equal(result.status,0,result.stderr);
  result=spawnSync("pdftotext",[join(dir,"report.pdf"),"-"],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/José Иван/u);
  await rm(join(dir,"report.pdf"));
  await writeFile(join(reports,"fonts","DejaVuSans.ttf"),"tampered");
  result=spawnSync(process.execPath,["-e",generate],{cwd:dir,encoding:"utf8"});assert.equal(result.status,1);assert.match(result.stderr,/ReportArtifactUnavailableError/);
  await rm(join(reports,"fonts"),{recursive:true});
  result=spawnSync(process.execPath,["-e",generate],{cwd:dir,encoding:"utf8"});assert.equal(result.status,1);assert.match(result.stderr,/ReportArtifactUnavailableError/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
