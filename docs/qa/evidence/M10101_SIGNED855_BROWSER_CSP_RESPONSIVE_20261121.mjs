import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const base='https://127.0.0.1:45279';
const sha='85554af4aac9dd110627a3176425bf8bf07eff2b';
const roles=['worker','company','verifier','assessor','admin','root'];
const widths=[320,390,1280];
const results=[];let browser;
try{
 browser=await chromium.launch({headless:true});
 for(const role of roles){
  for(const width of widths){
   const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:width===1280?850:760},reducedMotion:'reduce'});
   const page=await context.newPage();const pageErrors=[];const consoleErrors=[];
   page.on('pageerror',e=>pageErrors.push(String(e.message).slice(0,240)));
   page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(msg.text().slice(0,240))});
   const one={role,width,pass:false};
   try{
    const response=await page.goto(`${base}/${role}/login`,{waitUntil:'networkidle',timeout:18000});
    one.status=response?.status()??null;
    const csp=response?.headers()['content-security-policy']??'';
    one.csp_nonce_present=/script-src[^;]*'nonce-[^']+'/.test(csp);
    one.csp_strict_dynamic=/script-src[^;]*'strict-dynamic'/.test(csp);
    one.csp_no_unsafe_inline_script=!/script-src[^;]*'unsafe-inline'/.test(csp);
    one.email=await page.locator('input[name="email"]').count()===1;
    one.password=await page.locator('input[name="password"]').count()===1;
    one.submit=await page.locator('button[type="submit"]').count()===1;
    one.geometry=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
    one.no_horizontal_overflow=one.geometry.scrollWidth<=one.geometry.clientWidth+2;
    const e=page.locator('input[name="email"]');
    await e.focus();await page.keyboard.type('synthetic@example.test');
    await page.keyboard.press('Tab');
    one.keyboard_tab_to_password=await page.evaluate(()=>document.activeElement?.getAttribute('name')==='password');
    await page.keyboard.press('Shift+Tab');
    one.keyboard_shift_tab_to_email=await page.evaluate(()=>document.activeElement?.getAttribute('name')==='email');
    one.page_errors=pageErrors;one.console_errors=consoleErrors.filter(s=>!/favicon/.test(s));
    one.pass=one.status===200&&one.csp_nonce_present&&one.csp_strict_dynamic&&one.csp_no_unsafe_inline_script&&one.email&&one.password&&one.submit&&one.no_horizontal_overflow&&one.keyboard_tab_to_password&&one.keyboard_shift_tab_to_email&&pageErrors.length===0&&one.console_errors.length===0;
   }catch(error){one.error=String(error?.message??error).slice(0,350)}
   results.push(one); console.log(`${role} ${width}: ${one.pass?'PASS':'FAIL'} status=${one.status} no_js_errors=${!pageErrors.length}`);
   await context.close();
  }
 }
}finally{await browser?.close()}
const summary={utc:new Date().toISOString(),source_sha:sha,endpoint:'isolated signed855 localhost-only production HTTPS',browser:'Playwright Chromium',scope:'six role real browser login responsive and keyboard plus nonce-CSP, no authenticated actions or external providers',rows:results,checks:results.length,passed:results.filter(x=>x.pass).length,all_pass:results.every(x=>x.pass)};
const path='.autopilot/artifacts/m10101-signed855-browser-csp-responsive.json';await writeFile(path,JSON.stringify(summary,null,2)+'\n');
console.log('SUMMARY',summary.passed+'/'+summary.checks,'OVERALL',summary.all_pass?'PASS':'FAIL');
console.log('RAW_SHA256',createHash('sha256').update(await readFile(path)).digest('hex'));
if(!summary.all_pass){for(const r of results.filter(x=>!x.pass))console.log('FAILED_CASE',JSON.stringify(r));}
process.exitCode=summary.all_pass?0:1;
