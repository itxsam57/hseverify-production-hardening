import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { integrityAssessmentFixture } from "../helpers/integrity-assessment-fixture.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";

function totp(secret) {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits="";
  for(const c of secret.toUpperCase().replace(/=+$/g,"")) {
    const index=alphabet.indexOf(c);
    assert.ok(index>=0);
    bits+=index.toString(2).padStart(5,"0");
  }
  const bytes=[];
  for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
  const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const hash=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
  const offset=hash[hash.length-1]&15;
  return String((hash.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,"0");
}
async function freePort() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(error=>error?reject(error):resolve(address.port));
    });
  });
}
async function login(page,base,credential) {
  await page.goto(base+"/worker/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/worker/dashboard",{timeout:20000});
}

test("A14 real Worker browser enforces media permission denial, partial acquisition cleanup, BLOCK and REVIEW policies",{timeout:240000},async()=>{
  for(const mode of process.env.HSE_A14_SCENARIO ? [process.env.HSE_A14_SCENARIO] : ["BLOCK","REVIEW","PARTIAL_BLOCK","STOPPED_SCREEN_BLOCK"]) {
    const fixture=await integrityAssessmentFixture();
    try {
      const attempt=(await fixture.database.query("SELECT blueprint_version_id FROM assessment_attempts WHERE attempt_id=$1",[fixture.attemptId])).rows[0];
      assert.ok(attempt?.blueprint_version_id);
      await fixture.database.query(
        "INSERT INTO assessment_blueprint_delivery_settings "+
        "(blueprint_version_id,progression_mode,section_config_json,require_camera,require_microphone,require_screen_share,"+
        "record_camera,record_microphone,record_screen,integrity_failure_mode,require_fullscreen,require_environment_declaration,require_monitoring_consent) "+
        "VALUES($1,'STRICT','[]'::jsonb,TRUE,TRUE,TRUE,FALSE,FALSE,FALSE,$2,FALSE,FALSE,FALSE) "+
        "ON CONFLICT(blueprint_version_id) DO UPDATE SET require_camera=TRUE,require_microphone=TRUE,require_screen_share=TRUE,"+
        "record_camera=FALSE,record_microphone=FALSE,record_screen=FALSE,integrity_failure_mode=EXCLUDED.integrity_failure_mode,require_fullscreen=FALSE",
        [attempt.blueprint_version_id,mode.endsWith("_BLOCK") ? "BLOCK" : mode]
      );
      await fixture.releaseDatabase();
      const p=await freePort();
      const base="http://127.0.0.1:"+p;
      const result=await runDevelopmentServer({
        args:["--hostname","127.0.0.1","--port",String(p)],
        probeUrl:base+"/worker/login",
        environment:fixture.environment,
        probe:async()=>{
          const browser=await chromium.launch({headless:true});
          try {
            const context=await browser.newContext({viewport:{width:1280,height:900}});
            await context.addInitScript(()=>{
              const denied=async()=>{throw new DOMException("Synthetic permission denial","NotAllowedError");};
              const partial=location.search.includes("partial-media");
              const screenEnds=location.search.includes("screen-ends");
              const track=(kind)=>({
                kind,stopped:false,listeners:{},
                stop(){this.stopped=true;},
                addEventListener(event,listener){this.listeners[event]=listener;},
                emit(event){this.listeners[event]?.();}
              });
              const camera=track("video"),microphone=track("audio"),screen=track("video");
              window.__proctorTracks=[camera,microphone,screen];
              Object.defineProperty(navigator,"mediaDevices",{
                configurable:true,value:{
                  getUserMedia:partial||screenEnds ? async()=>({getTracks:()=>[camera,microphone]}) : denied,
                  getDisplayMedia:screenEnds ? async()=>({getTracks:()=>[screen],getVideoTracks:()=>[screen]}) : denied
                }
              });
            });
            const page=await context.newPage();
            const errors=[];
            page.on("pageerror",e=>errors.push(e.message));
            await login(page,base,fixture.credentials.worker);
            const query=mode==="PARTIAL_BLOCK" ? "?partial-media=1" : mode==="STOPPED_SCREEN_BLOCK" ? "?screen-ends=1" : "";
            await page.goto(base+"/worker/assessments/"+fixture.attemptId+query,{waitUntil:"domcontentloaded"});
            await page.getByRole("button",{name:"Start required monitoring"}).waitFor({timeout:20000});
            assert.equal(await page.getByText("private-question-prompt-marker").count(),0);
            await page.getByRole("button",{name:"Start required monitoring"}).click();
            if(mode==="BLOCK" || mode==="PARTIAL_BLOCK") {
              await page.getByText(mode==="PARTIAL_BLOCK"
                ? "Required monitoring is unavailable: screen. Retry before continuing."
                : "Required monitoring is unavailable: camera, microphone, screen. Retry before continuing.",{exact:true}).waitFor({timeout:20000});
              if(mode==="PARTIAL_BLOCK"){
                const stopped=await page.evaluate(()=>window.__proctorTracks.slice(0,2).map(track=>track.stopped));
                assert.deepEqual(stopped,[true,true],"BLOCK denial did not release already-acquired camera and microphone");
              }
              assert.equal(await page.getByText("private-question-prompt-marker").count(),0);
              await page.getByRole("button",{name:"Retry required monitoring"}).waitFor();
            }else if(mode==="STOPPED_SCREEN_BLOCK"){
              await page.getByText("Required live monitoring is active.",{exact:true}).waitFor({timeout:20000});
              await page.getByText("private-question-prompt-marker",{exact:true}).waitFor();
              await page.evaluate(()=>window.__proctorTracks[2].emit("ended"));
              await page.getByText("Required screen sharing stopped. Restore monitoring before continuing.",{exact:true}).waitFor({timeout:20000});
              assert.equal(await page.getByText("private-question-prompt-marker").count(),0);
              assert.deepEqual(await page.evaluate(()=>window.__proctorTracks.map(track=>track.stopped)),[true,true,true],
                "Ending a required screen track did not release all active media tracks");
              await page.getByRole("button",{name:"Retry required monitoring"}).waitFor();
            }else {
              await page.getByText("Monitoring is degraded (camera, microphone, screen). The assessment may continue but requires human integrity review.",{exact:true}).waitFor({timeout:20000});
              await page.getByText("private-question-prompt-marker",{exact:true}).waitFor();
            }
            assert.deepEqual(errors,[]);
            await page.goto(base+"/worker/dashboard",{waitUntil:"domcontentloaded"});
            await context.close();
          }finally{await browser.close();}
        }
      });
      assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
      const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR});
      try {
        const events=(await db.query("SELECT event_type FROM integrity_capture_events WHERE attempt_id=$1",[fixture.attemptId])).rows.map(item=>item.event_type);
        const expected=mode==="STOPPED_SCREEN_BLOCK"
          ? ["SCREEN_UNAVAILABLE","BROWSER_RESUMED"]
          : mode==="PARTIAL_BLOCK"
            ? ["SCREEN_UNAVAILABLE","MONITORING_PROVIDER_DEGRADED"]
            : ["CAMERA_UNAVAILABLE","MIC_UNAVAILABLE","SCREEN_UNAVAILABLE","MONITORING_PROVIDER_DEGRADED"];
        for(const key of expected)
          assert.ok(events.includes(key),mode+" missing "+key+": "+events.join(","));
        const state=(await db.query("SELECT monitoring_state,provider_state FROM assessment_integrity_sessions WHERE attempt_id=$1",[fixture.attemptId])).rows[0];
        assert.equal(state.monitoring_state,"DEGRADED");
        assert.equal(state.provider_state,"DEGRADED");
        assert.equal((await db.query("SELECT status FROM assessment_attempts WHERE attempt_id=$1",[fixture.attemptId])).rows[0].status,"IN_PROGRESS");
      }finally{await db.close();}
      console.log("ACTUAL_A14_BROWSER "+mode+" synthetic permission rejection; retained four signals; attempt IN_PROGRESS");
    }finally{await fixture.cleanup();}
  }
});