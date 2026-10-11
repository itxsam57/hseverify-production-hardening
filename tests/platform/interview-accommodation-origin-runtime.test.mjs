import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";

const require=createRequire(import.meta.url);
const {validateRuntimeEnvironment}=loadTs("src/lib/config/environment.ts");
const {isSameOriginRegistrationPost}=loadTs("src/lib/http/registration-request.ts");
const support=loadTs("src/lib/privacy/interview-accommodation-support.ts");
const PUBLIC="https://preview.example.test";
const output=ts.transpileModule(
 readFileSync("src/app/api/interviews/[interviewRequestId]/accommodation-support/route.ts","utf8"),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText;
function route(mode,publicBaseUrl=PUBLIC) {
 const environment=validateRuntimeEnvironment({
  HSE_APP_ENV:mode,HSE_DATABASE_DRIVER:"postgres",
  DATABASE_URL:"postgres://fixture:fixture@localhost:5432/fixture",
  HSE_RELEASE_SHA:"accommodation-origin-runtime",
  HSE_SESSION_SECRET:"synthetic-origin-test-session-secret-0001",
  HSE_AUTH_PEPPER:"synthetic-origin-test-auth-pepper-0001",
  HSE_CREDENTIAL_SIGNING_SECRET:"synthetic-origin-test-signing-secret-0001",
  ...(publicBaseUrl?{HSE_PUBLIC_BASE_URL:publicBaseUrl}:{}),
  HSE_ENABLE_AUTH_SANDBOX:"false",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"
 });
 const record={exports:{}};
 // Inject only configuration and an unauthenticated actor, so successful origin
 // validation must still reach the real route's authentication boundary.
 new Function("require","module","exports",output)((id)=>{
  if(id==="@/lib/config/server-environment")return {getServerEnvironment:()=>environment};
  if(id==="@/lib/auth/auth-session-service")return {readAuthenticatedSession:async()=>null};
  if(id==="@/lib/http/registration-request")return {isSameOriginRegistrationPost};
  if(id==="@/lib/privacy/interview-accommodation-support")return support;
  return require(id);
 },record,record.exports);
 return record.exports;
}
function request(origin=PUBLIC,{internal="http://localhost:3003",host="preview.example.test",forwardedHost=host,forwardedProto="https"}={}) {
 const headers={"content-type":"application/json",host};
 if(origin!==null)headers.origin=origin;
 if(forwardedHost!==null)headers["x-forwarded-host"]=forwardedHost;
 if(forwardedProto!==null)headers["x-forwarded-proto"]=forwardedProto;
 return new Request(internal+"/api/interviews/interview_fixture/accommodation-support",{method:"POST",headers,body:"{}"});
}
async function status(mode,req,publicBaseUrl=PUBLIC) {
 const response=await route(mode,publicBaseUrl).POST(req,{params:Promise.resolve({interviewRequestId:"interview_fixture"})});
 assert.equal(response.headers.get("cache-control"),"no-store, private");
 if(response.status===401)assert.deepEqual(await response.json(),{error:"Authentication required."});
 return response.status;
}
for(const mode of ["development","test","production"])test(mode+" configured public proxy origin reaches authentication",async()=>{
 assert.equal(await status(mode,request()),401);
});
test("configured canonical origin still requires matching request or proxy authority",async()=>{
 assert.equal(await status("development",request(PUBLIC,{host:"localhost:3003",forwardedHost:null,forwardedProto:null})),403);
});
test("attacker origin cannot be authorized by forged forwarding headers",async()=>{
 assert.equal(await status("development",request("https://attacker.example.test",{host:"attacker.example.test",forwardedHost:"attacker.example.test"})),403);
});
test("missing and non-origin Origin values fail closed",async()=>{
 for(const origin of [null,PUBLIC+"/path",PUBLIC+"/","null","invalid"])assert.equal(await status("development",request(origin)),403);
});
test("unconfigured public preview remains denied",async()=>{
 assert.equal(await status("development",request(),null),403);
});
for(const configured of [false,true])test("development preserves strict loopback with "+(configured?"configured":"no")+" canonical origin",async()=>{
 assert.equal(await status("development",request("http://localhost:3003",{host:"localhost:3003",forwardedHost:"attacker.example.test",forwardedProto:"https"}),configured?PUBLIC:null),401);
});
test("loopback protocol, port and Host mismatches remain denied",async()=>{
 for(const [origin,options] of [
  ["https://localhost:3003",{host:"localhost:3003"}],
  ["http://localhost:3004",{host:"localhost:3004"}],
  ["http://localhost:3003",{host:"attacker.example.test"}]
 ])assert.equal(await status("development",request(origin,options)),403);
});
test("production canonical origin does not allow development loopback exception",async()=>{
 assert.equal(await status("production",request("http://localhost:3003",{host:"localhost:3003"})),403);
});
