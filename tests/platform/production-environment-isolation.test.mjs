import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createServer} from "node:net";
import {once} from "node:events";
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
 ["missing credential signing secret",{HSE_CREDENTIAL_SIGNING_SECRET:undefined},/HSE_CREDENTIAL_SIGNING_SECRET/i],
 ["short credential signing secret",{HSE_CREDENTIAL_SIGNING_SECRET:"short"},/HSE_CREDENTIAL_SIGNING_SECRET/i],
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


test("production entry point rejects missing secrets and prohibited flags before listening", () => {
  const entry = resolve("scripts/start-production.mjs");
  const directory = mkdtempSync(join(tmpdir(), "hse-invalid-start-"));
  try {
    for (const [name, change, error] of cases) {
      const env = {...base, ...change, HOSTNAME: "127.0.0.1"};
      for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
      const result = spawnSync(process.execPath, [entry], {
        cwd: directory, env, encoding: "utf8", timeout: 3000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, error, name);
      assert.doesNotMatch(result.stderr, /Cannot find module/, name);
      assert.doesNotMatch(result.stdout, /Ready|Starting/, name);
    }
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test("production entry point exits before listening when PostgreSQL is unavailable", async () => {
  const entry = resolve("scripts/start-production.mjs");
  const directory = mkdtempSync(join(tmpdir(), "hse-unavailable-start-"));
  const portReservation = createServer().listen(0, "127.0.0.1");
  try {
    await once(portReservation, "listening");
    const port = portReservation.address().port;
    await new Promise(resolve => portReservation.close(resolve));
    const databaseUrl = "postgresql://synthetic:synthetic@127.0.0.1:" + port + "/unavailable";
    const result = spawnSync(process.execPath, [entry], {
      cwd: directory,
      env: {...base, DATABASE_URL: databaseUrl, HOSTNAME: "127.0.0.1"},
      encoding: "utf8",
      timeout: 12000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PostgreSQL is unavailable/);
    assert.ok(!result.stderr.includes(databaseUrl));
    assert.doesNotMatch(result.stdout, /Ready|Starting/);
  } finally {
    if (portReservation.listening) await new Promise(resolve => portReservation.close(resolve));
    rmSync(directory, {recursive: true, force: true});
  }
});
