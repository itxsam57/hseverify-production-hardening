import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "privacy-consent-accommodation-runtime",
  sessionSecret: "privacy-consent-accommodation-session-secret-more-than-32-characters",
  authPepper: "privacy-consent-accommodation-auth-pepper-more-than-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const NOW = "2026-10-01T00:00:00.123Z";

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(
    db,
    ENV.releaseSha,
    "0078_privacy_request_review_history"
  );
  return db;
}

import ts from "typescript";
import { createRequire } from "node:module";
import { readFileSync,existsSync } from "node:fs";
import {resolve,dirname} from "node:path";
const cache=new Map();
function realTs(path) {
 path=resolve(path); if(cache.has(path))return cache.get(path);
 const record={exports:{}}; cache.set(path,record.exports);
 const output=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const native=createRequire(path);
 const imports=name=>{
  if(name==="server-only"||name==="../database/database")return {};
  if(name.startsWith(".")||name.startsWith("@/")) {
   const candidate=name.startsWith("@/")?resolve("src",name.slice(2)):resolve(dirname(path),name);
   for(const suffix of [".ts",".tsx"])if(existsSync(candidate+suffix))return realTs(candidate+suffix);
  }
  return native(name);
 };
 new Function("require","module","exports",output)(imports,record,record.exports);
 return record.exports;
}
const {ScopedShareLinkService}=realTs("src/lib/share-links/scoped-share-link-service.ts");
const {ScopedShareLinkRepository}=realTs("src/lib/share-links/scoped-share-link-repository.ts");

test("Worker direct revocation handles future-dated legacy metadata and returns the persisted first timestamp", async()=>{
 const db=await database();
 try {
  await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES('legacy_direct','legacy_owner','[]'::jsonb,'Legacy direct sharing','2099-01-01T00:00:00.789Z',$1)",['n'.repeat(64)]);
  const service=new ScopedShareLinkService(new ScopedShareLinkRepository(Promise.resolve(db)));
  await assert.rejects(service.revoke({shareLinkId:'legacy_direct',ownerWorkerId:'foreign_owner',revokedAt:NOW}),/not found/i);
  const result=await service.revoke({shareLinkId:'legacy_direct',ownerWorkerId:'legacy_owner',revokedAt:NOW});
  assert.equal(result.createdAt,'2099-01-01T00:00:00.789Z');
  assert.equal(result.revokedAt,NOW);
  const listed=await new ScopedShareLinkRepository(Promise.resolve(db)).listOwned('legacy_owner');
  assert.equal(listed.length,1);
  assert.equal(listed[0].createdAt,'2099-01-01T00:00:00.789Z');
  assert.equal(listed[0].revokedAt,NOW);
  const repeated=await service.revoke({shareLinkId:'legacy_direct',ownerWorkerId:'legacy_owner',revokedAt:'2026-10-02T00:00:00.000Z'});
  assert.equal(repeated.revokedAt,NOW);
  const stored=(await db.query("SELECT created_at,revoked_at FROM scoped_share_links WHERE share_link_id='legacy_direct'")).rows[0];
  assert.equal(new Date(stored.created_at).toISOString(),'2099-01-01T00:00:00.789Z');
  assert.equal(new Date(stored.revoked_at).toISOString(),NOW);
 } finally {await db.close();}
});


test("direct revocation returns the persisted first outcome on repeat",async()=>{
 const db=await database();
 try {
  await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES('repeat_direct','repeat_owner','[]'::jsonb,'Repeat direct sharing',$1,$2)",[NOW,'r'.repeat(64)]);
  const service=new ScopedShareLinkService(new ScopedShareLinkRepository(Promise.resolve(db)));
  const first='2026-10-01T00:10:00.456Z';
  const result=await service.revoke({shareLinkId:'repeat_direct',ownerWorkerId:'repeat_owner',revokedAt:first});
  assert.equal(result.revokedAt,first);
  const repeated=await service.revoke({shareLinkId:'repeat_direct',ownerWorkerId:'repeat_owner',revokedAt:'2026-10-02T00:00:00.000Z'});
  assert.equal(repeated.revokedAt,first);
  assert.equal((await new ScopedShareLinkRepository(Promise.resolve(db)).find('repeat_direct')).revokedAt,first);
 } finally {await db.close();}
});
