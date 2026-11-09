import assert from "node:assert/strict";
import test from "node:test";
import {validateScriptEnvironment} from "../../scripts/lib/environment.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
const {validateRuntimeEnvironment}=loadTs("src/lib/config/environment.ts");
const base={NODE_ENV:"production",HSE_APP_ENV:"production",HSE_DATABASE_DRIVER:"postgres",
 DATABASE_URL:"postgres://test:test@localhost:5432/unused_validation_only",
 HSE_CREDENTIAL_SIGNING_SECRET:"isolated-test-credential-key-with-more-than32-characters",
 HSE_SESSION_SECRET:"isolated-test-session-secret-with-more-than32-characters",
 HSE_AUTH_PEPPER:"isolated-test-auth-pepper-with-more-than32-characters",HSE_RELEASE_SHA:"validation-only-release",
 HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",HSE_ENABLE_AUTH_SANDBOX:"false"};
test("otherwise valid production configuration is accepted by both application and scripts",()=>{
 for(const validate of [validateScriptEnvironment,validateRuntimeEnvironment]){
  const result=validate(base);
  assert.equal(result.appEnvironment,"production");assert.equal(result.databaseDriver,"postgres");
  assert.equal(result.demoAuthEnabled,false);assert.equal(result.demoDataEnabled,false);assert.equal(result.authSandboxEnabled,false);
 }
});
const cases=[
 ["demo authentication",{HSE_ENABLE_WORKER_DEMO_AUTH:"true"},/demo/i],
 ["demo data",{HSE_USE_WORKER_DEMO_DATA:"true"},/demo/i],
 ["authentication sandbox",{HSE_ENABLE_AUTH_SANDBOX:"true",HSE_AUTH_SANDBOX_ACCESS_KEY:"isolated-sandbox-access-key"},/sandbox/i],
 ["PGlite",{HSE_DATABASE_DRIVER:"pglite"},/PGlite/i],
 ["database URL",{DATABASE_URL:undefined},/DATABASE_URL/i],
 ["missing session secret",{HSE_SESSION_SECRET:undefined},/HSE_SESSION_SECRET/i],
 ["short session secret",{HSE_SESSION_SECRET:"short"},/HSE_SESSION_SECRET/i],
 ["missing auth pepper",{HSE_AUTH_PEPPER:undefined},/HSE_AUTH_PEPPER/i],
 ["short auth pepper",{HSE_AUTH_PEPPER:"short"},/HSE_AUTH_PEPPER/i],
 ["release identity",{HSE_RELEASE_SHA:undefined},/HSE_RELEASE_SHA/i]
];
for(const [name,change,error] of cases)test("production rejects only the independently invalid "+name,()=>{
 const env={...base,...change};for(const key of Object.keys(env))if(env[key]===undefined)delete env[key];
 for(const validate of [validateScriptEnvironment,validateRuntimeEnvironment])assert.throws(()=>validate(env),error);
});
