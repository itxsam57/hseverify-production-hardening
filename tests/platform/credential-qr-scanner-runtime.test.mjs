import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";

const {issueCredential}=loadTs("src/lib/credential/credential-issuance-domain.ts");
const origin="https://verify.example.test";
const credential=issueCredential({workerId:"worker_id_"+"w".repeat(24),qualification:"Safety",issuedAt:"2026-10-09T01:00:00.127Z",expiresAt:null,validity:{mode:"unspecified",snapshotId:null,policyVersionId:null}},"decision_"+"d".repeat(24),"scanner-runtime-test-key-at-least-32-characters");

async function scan(rawValue) {
 const identifiers=[],paths=[],messages=[];
 let stopped=0,ticks=0;
 const saved={window:globalThis.window,document:globalThis.document,navigator:Object.getOwnPropertyDescriptor(globalThis,"navigator"),now:Date.now};
 globalThis.window={location:{origin,assign:path=>paths.push(path)},setTimeout:fn=>{fn();return 1;},BarcodeDetector:class{async detect(){return [{rawValue}];}}};
 globalThis.document={createElement:()=>({play:async()=>{}})};
 Object.defineProperty(globalThis,"navigator",{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stopped++}]})}}});
 Date.now=()=>ticks++<2?0:16000;
 try {
  const source=readFileSync("src/components/public-verification/public-qr-scanner.tsx","utf8");
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const record={exports:{}};
  const req=request=>{
   if(request==="react")return {useState:initial=>[initial,value=>messages.push(value)]};
   if(request==="react/jsx-runtime")return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
   if(request==="@/components/ui/button")return {Button:"button"};
   if(request==="@/lib/public-verification/public-qr-value")return loadTs("src/lib/public-verification/public-qr-value.ts");
   throw Error("Unexpected scanner import "+request);
  };
  new Function("exports","require","module",output)(record.exports,req,record);
  const tree=record.exports.PublicQrScanner({onIdentifier:id=>identifiers.push(id)});
  await tree.props.children[0].props.onClick();
  return {identifiers,paths,messages,stopped};
 } finally {
  globalThis.window=saved.window;globalThis.document=saved.document;
  if(saved.navigator)Object.defineProperty(globalThis,"navigator",saved.navigator);else delete globalThis.navigator;
  Date.now=saved.now;
 }
}
test("Actual signed issuance JSON is consumed by the real scanner component as a bounded lookup, with camera cleanup",async()=>{
 const result=await scan(credential.qrPayload);
 assert.deepEqual(result.identifiers,[credential.credentialId]);
 assert.deepEqual(result.paths,[]);
 assert.equal(result.stopped,1);
});
test("Actual issuance ID and public URL work while historical identifier and capability paths remain supported",async()=>{
 for(const value of [credential.credentialId,origin+credential.publicStatusUrl,credential.publicStatusUrl]){
  const r=await scan(value);assert.deepEqual(r.identifiers,[credential.credentialId]);assert.deepEqual(r.paths,[]);assert.equal(r.stopped,1);
 }
 const workerId="worker_id_"+"w".repeat(24);
 assert.deepEqual((await scan(workerId)).identifiers,[workerId]);
 for(const path of ["/verify/result/"+ "a".repeat(80),"/verify/qr/"+ "a".repeat(80)])assert.deepEqual((await scan(path)).paths,[path]);
});
test("Scanner rejects external, malformed, mismatched, oversized or self-claimed credential metadata",async()=>{
 const qr=JSON.parse(credential.qrPayload);
 const values=[
  "https://evil.example"+credential.publicStatusUrl,
  JSON.stringify({...qr,url:"https://evil.example"+credential.publicStatusUrl}),
  JSON.stringify({...qr,credentialId:"credential_id_"+"x".repeat(24)}),
  JSON.stringify({...qr,status:"valid"}),
  JSON.stringify({...qr,signing:{...qr.signing,algorithm:"none"}}),
  JSON.stringify({...qr,validity:{...qr.validity,days:-1}}),
  JSON.stringify({...qr,url:credential.publicStatusUrl+"?next=https://evil.example"}),
  JSON.stringify({...qr,url:credential.publicStatusUrl+"#x"}),
  "{invalid",JSON.stringify([qr]),"x".repeat(1601),"/settings"
 ];
 for(const value of values){const r=await scan(value);assert.deepEqual(r.identifiers,[],value);assert.deepEqual(r.paths,[],value);assert.equal(r.stopped,1);}
});
