import fs from "node:fs";
import test from "node:test";
import path from "node:path";
import {createRequire} from "node:module";
import http from "node:http";
import assert from "node:assert/strict";
import {chromium} from "playwright";
import ts from "typescript";
const root=process.cwd(), require=createRequire(import.meta.url);
test("Approved break refresh resets countdown without stale elapsed and cleans up timers", async () => {
const modules=[], ids=new Map();
function add(file){
 if(ids.has(file))return ids.get(file);
 const id=modules.length;ids.set(file,id);modules.push("");
 let code;
 if(file==="fixture:router")code='exports.useRouter=()=>window.fixtureRouter;';
 else if(file==="fixture:actions")code='exports.startApprovedAssessmentBreakAction=async()=>{throw Error("not exercised")};exports.interruptAssessmentAction=async()=>{throw Error("not exercised")};';
 else {
 code=fs.readFileSync(file,"utf8");
 if(/\.tsx?$/.test(file))code=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
 }
 code=code.replace(/require\(["']([^"']+)["']\)/g,(_,name)=>{
 let target;
 if(name==="next/navigation")target="fixture:router";
 else if(name.includes("/assessments/[attemptId]/actions"))target="fixture:actions";
 else if(name==="@/components/ui/button")target=path.join(root,"src/components/ui/button.tsx");
 else target=createRequire(file.startsWith("fixture:")?import.meta.url:file).resolve(name);
 return "__require("+add(target)+")";
 });
 modules[id]=code;return id;
}
const react=add(require.resolve("react")), client=add(require.resolve("react-dom/client"));
const component=add(path.join(root,"src/components/worker/approved-assessment-break.tsx"));
const bundle='var process={env:{NODE_ENV:"production"}};var __modules=['+modules.map(c=>'function(module,exports,__require){'+c+'}').join(",")+'];var __cache={};function __require(id){if(__cache[id])return __cache[id].exports;var m=__cache[id]={exports:{}};__modules[id](m,m.exports,__require);return m.exports;}'+
'const React=__require('+react+'),{createRoot}=__require('+client+'),{ApprovedBreakRest}=__require('+component+');let render;window.fixtureRemaining=40;window.fixtureRefreshes=0;window.fixtureRouter={refresh(){window.fixtureRefreshes++;render(window.fixtureRemaining)},push(){throw Error("not exercised")}};const app=createRoot(document.getElementById("root"));render=remaining=>app.render(React.createElement(ApprovedBreakRest,{view:{attemptId:"fixture_attempt",accommodationBreak:{remainingSeconds:remaining,remainingAllowanceSeconds:120,endsAt:"2026-10-11T12:00:00Z"}}}));window.fixtureUnmount=()=>app.unmount();render(60);';
const server=http.createServer((req,res)=>{res.setHeader("Content-Type","text/html");res.end('<div id="root"></div><script>'+bundle+'</script>');});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage(); await page.clock.install();await page.goto("http://127.0.0.1:"+server.address().port);
 const timer=page.getByRole("timer",{name:"Approved break time remaining"});await timer.waitFor();
 await page.clock.runFor(20000);assert.equal(await timer.innerText(),"0:40 remaining");
 await page.getByRole("button",{name:"Check break status",exact:true}).click();
 assert.equal(await timer.innerText(),"0:40 remaining","Fresh server remainingSeconds must reset previous elapsed immediately");
 await page.clock.runFor(1000);assert.equal(await timer.innerText(),"0:39 remaining");
 await page.evaluate(()=>{window.fixtureRemaining=20;});
 await page.getByRole("button",{name:"Check break status",exact:true}).click();
 assert.equal(await timer.innerText(),"0:20 remaining","Repeated refresh keeps original endsAt but resets elapsed");
 await page.clock.runFor(1000);assert.equal(await timer.innerText(),"0:19 remaining");
 const beforeUnmount=await page.evaluate(()=>{window.fixtureUnmount();return window.fixtureRefreshes;});
 await page.clock.runFor(30000);
 assert.equal(await page.evaluate(()=>window.fixtureRefreshes),beforeUnmount,"Unmount clears countdown interval and prevents later refresh");
 assert.equal(await timer.count(),0);
}finally{try{await browser?.close();}finally{await new Promise(resolve=>server.close(resolve));}}

});
