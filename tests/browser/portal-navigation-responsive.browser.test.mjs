import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
function totp(secret){
 const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits="";for(const c of secret)bits+=alphabet.indexOf(c).toString(2).padStart(5,"0");
 const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function port(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});}
test("Every portal exposes usable mobile navigation at 320/390 pixels and preserves desktop navigation",{timeout:300000},async()=>{
 const f=await workerAssessmentSearchFixture(),base="http://127.0.0.1:"+await port();
 const browser=await chromium.launch({headless:true}),errors=[];
 try {
 await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",new URL(base).port],projectRoot:process.cwd(),probeUrl:base+"/verify",environment:f.environment,probe:async()=>{
 for(const role of ["worker","company","assessor","verifier","admin","root"]){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on("pageerror",e=>errors.push(role+": "+e.message));
 try {
 const identity=f.credentials[role];await page.goto(base+"/"+role+"/login");
 await page.getByLabel("Email address").fill(identity.email);await page.getByLabel("Password",{exact:true}).fill(identity.password);
 if(role!=="worker")await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
 await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL("**/"+role+"/dashboard");
 for(const width of [320,390]){
 await page.setViewportSize({width,height:844});
 const menu=page.locator(".mobile-nav-menu");await menu.waitFor({state:"visible"});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+" closed mobile header overflow at "+width);
 await menu.locator("summary").click();
 const panel=page.locator(".mobile-nav-panel"),links=panel.locator("a.nav-link");await panel.waitFor({state:"visible"});assert(await links.count()>0);
 for(const link of await links.all()){
 const rect=await link.boundingBox();assert(rect&&rect.width>0&&rect.height>=44,role+" navigation target must retain touch size");
 assert(rect.x>=0&&rect.x+rect.width<=width,role+" navigation extends beyond viewport");
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+" open mobile menu overflow at "+width);
 await page.screenshot({path:".autopilot/artifacts/concern-"+role+"-mobile-"+width+".png"});
 await menu.locator("summary").click();
 }
 await page.setViewportSize({width:1280,height:900});
 await page.locator(".portal-sidebar").waitFor({state:"visible"});assert.equal(await page.locator(".mobile-nav-menu").isVisible(),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,role+" desktop overflow");
 }finally{await context.close();}
 }
 }});
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await f.cleanup();}
});
