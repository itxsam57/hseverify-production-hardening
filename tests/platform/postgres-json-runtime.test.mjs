import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";

// This dedicated integration test must never silently certify PGlite as PostgreSQL.
const databaseUrl=process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if(!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)){
  throw new Error("Set HSE_POSTGRES_TEST_DATABASE_URL to an isolated actual PostgreSQL database.");
}
process.env.HSE_DATABASE_DRIVER="postgres";
process.env.DATABASE_URL=databaseUrl;
const runtimePath=resolve(".outbox-worker-dist/database/database.js");
if(!existsSync(runtimePath))throw new Error("Build the current outbox worker before this PostgreSQL integration test.");
const require=createRequire(import.meta.url);
const {getDatabaseClient}=require(runtimePath);

const values=[
  {nested:{enabled:true,missing:null,items:[1,"quoted \"value\"",{unicode:"λ"}]},empty:{}},
  [null,false,0,"",["nested"],{reportRef:"report_worker_test"}],
  null,true,false,17.25,"scalar with \"quotes\" and \\slashes"
];
async function verifyRoundtrips(client){
  for(const value of values){
    for(const cast of ["json","jsonb"]){
      let result;try {result=await client.query("SELECT $1::"+cast+" AS value",[JSON.stringify(value)]);} catch(error){error.message+=" (encoded "+cast+" "+typeof value+")";throw error;}
      assert.deepEqual(result.rows[0].value,value,"Encoded "+cast+" must not become a quoted JSON string");
    }
  }
  const object={reportRef:"report_worker_test",nested:[null,{active:true}]};
  assert.deepEqual((await client.query("SELECT $1::jsonb AS value",[object])).rows[0].value,object);
  assert.equal((await client.query("SELECT $1::text AS value",["plain text"])).rows[0].value,"plain text");
  assert.equal((await client.query("SELECT $1::jsonb IS NULL AS sql_null",[null])).rows[0].sql_null,true);
  
}

for(const [name,create] of [
  ["script adapter",()=>openScriptDatabase({databaseDriver:"postgres",databaseUrl})],
  ["compiled runtime adapter",()=>getDatabaseClient()]
]){
  test(name+" preserves PostgreSQL JSON parameters and transactional object constraints",async()=>{
    const database=await create();
    try{
      assert.equal((await database.query("SELECT current_setting('server_version_num')::integer AS version")).rows[0].version>0,true);
      await verifyRoundtrips(database);
      await assert.rejects(database.query("SELECT $1::jsonb",["invalid JSON"]),error=>error.code==="22P02");
      await database.transaction(async transaction=>{
        await verifyRoundtrips(transaction);
        await transaction.execute(`CREATE TEMP TABLE hse_json_parameter_regression (
          payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object' AND payload ? 'reportRef')
        ) ON COMMIT DROP`);
        const payload={reportRef:"report_worker_test",nested:{version:1}};
        await transaction.query("INSERT INTO hse_json_parameter_regression(payload) VALUES ($1::jsonb)",[JSON.stringify(payload)]);
        assert.deepEqual((await transaction.query("SELECT payload FROM hse_json_parameter_regression")).rows[0].payload,payload);
        await transaction.transaction(async nested=>{
          assert.deepEqual((await nested.query("SELECT $1::jsonb AS payload",[JSON.stringify(payload)])).rows[0].payload,payload);
        });
      });
    }finally{await database.close();}
  });
}
