import ts from "typescript";
import {readFileSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),cache=new Map();
const overrides=new Map();
export function loadQuestionBankSource(path){
 path=resolve(path);if(cache.has(path))return cache.get(path).exports;
 const source=readFileSync(overrides.get(path)||path,"utf8");
 const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const record={exports:{}};cache.set(path,record);
 const local=req=>{
  if(req==="server-only")return {};
  const candidate=req.startsWith("@/")?resolve("src",req.slice(2)):req.startsWith(".")?resolve(dirname(path),req):null;
  if(candidate){
   if(candidate===resolve("src/lib/database/database"))return {};
   for(const suffix of [".ts",".tsx"])if(overrides.has(candidate+suffix)||existsSync(candidate+suffix))return loadQuestionBankSource(candidate+suffix);
  }
  return require(req);
 };
 new Function("exports","require","module",out)(record.exports,local,record);
 return record.exports;
}
