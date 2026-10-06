import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
async function freePort(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));});});}
test("Public home exposes usable primary routes, registrations and six role destinations on desktop/mobile",{timeout:180000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"hse-public-nav-")),port=await freePort(),base="http://127.0.0.1:"+port;
 const env={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dir,HSE_RELEASE_SHA:"public-navigation-proof",HSE_SESSION_SECRET:"public-nav-test-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"public-nav-test-auth-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",HSE_ENABLE_AUTH_SANDBOX:"false"};
 try {
  const migrated=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{env,encoding:"utf8"});assert.equal(migrated.status,0,migrated.stderr);
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:base,projectRoot:process.cwd(),environment:env,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
     const page=await browser.newPage({viewport});page.setDefaultTimeout(5000);
     for(const [label,path] of [["How it works","/how-it-works"],["For Workers","/workers"],["For Companies","/companies"],["Verify","/verify"],["Contact","/contact"],["Sign in","/auth/select"]]){
      await page.goto(base);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"Public home must fit the viewport");const nav=page.getByRole("navigation",{name:"Public navigation",exact:true});
      await nav.getByRole("link",{name:label,exact:true}).click();await page.waitForURL(base+path);
      await page.getByRole("heading",{level:1}).first().waitFor();assert.equal(await page.locator('text=Application error').count(),0);
     }
     for(const [label,path] of [["Register as a Worker","/worker/register"],["Register a Company","/company/register"]]){
      await page.goto(base);await page.getByRole("link",{name:label,exact:true}).click();await page.waitForURL(base+path);await page.locator('form input[type="email"]').first().waitFor();
     }
     for(const role of ["Worker","Company","Verifier","Assessor","Admin","Root"]){
      await page.goto(base);await page.getByRole("navigation",{name:"Public navigation"}).getByRole("link",{name:"Sign in",exact:true}).click();
      await page.getByRole("link",{name:"Open "+role,exact:true}).click();await page.waitForURL(base+"/"+role.toLowerCase()+"/login");await page.getByLabel("Email address").waitFor();
     }
     await page.close();
    }
    console.log("ACTUAL_PUBLIC_NAVIGATION real desktop/mobile links, both registration entry forms and all six role sign-in forms; demo and general contact fulfilment remain separate");
   }finally{await browser.close();}
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
 }finally{await rm(dir,{recursive:true,force:true});}
});
