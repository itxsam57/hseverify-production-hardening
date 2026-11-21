import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

async function freePort(){
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const port=server.address().port;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}
test("M1.07.02 Worker all three profile section drafts survive rejected save, navigation and retry", {timeout:230000}, async()=>{
  const fixture=await workerAssessmentSearchFixture();
  const base="http://127.0.0.1:"+(await freePort());
  try{
    const run=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      projectRoot:process.cwd(),probeUrl:base+"/worker/login",environment:fixture.environment,
      probe:async({output})=>{
        const browser=await chromium.launch({headless:true});
        try{
          const page=await browser.newPage({viewport:{width:390,height:844}});
          const fatal=[];
          page.on("pageerror",error=>fatal.push(error.message));
          page.on("response",response=>{if(response.status()>=500)fatal.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);});
          await page.goto(base+"/worker/login",{waitUntil:"domcontentloaded"});
          await page.getByLabel("Email address").fill(fixture.credentials.worker.email);
          await page.getByLabel("Password").fill(fixture.credentials.worker.password);
          await page.getByRole("button",{name:"Sign in",exact:true}).click();
          await page.waitForURL("**/worker/dashboard");
          const visit=async section=>{
            await page.goto(base+"/worker/profile?section="+section,{waitUntil:"domcontentloaded"});
            await page.getByRole("heading",{name:"My profile",exact:true}).waitFor();
            await page.locator('form.profile-form[data-hydrated="ready"]').waitFor({timeout:20000});
          };
          const save=async()=>page.getByRole("button",{name:"Save changes",exact:true}).click();
          const waitSaved=async section=>{
            try {
              await page.locator('.profile-step-navigation a[href*="section='+section+'"] small')
                .getByText("Complete",{exact:true}).waitFor({timeout:20000});
            } catch (error) {
              throw new Error("Saved section not visible as Complete: "+section+
                "\nURL: "+page.url()+"\nPAGE:\n"+await page.locator("body").innerText()+
                "\nBROWSER ERRORS:\n"+fatal.join("\n")+"\nSERVER:\n"+output(),{cause:error});
            }
          };
          const feedback=page.getByRole("alert");
          const expectInvalid=async phase=>{
            try {await feedback.getByText("Correct the highlighted fields and try again.",{exact:true}).waitFor({timeout:15000});}
            catch(error){throw new Error("Expected invalid section feedback missing: "+phase+
              "\nURL "+page.url()+"\nPAGE:\n"+await page.locator("body").innerText()+
              "\nSERVER:\n"+output(),{cause:error});}
          };
          await visit("personal");
          await page.getByLabel("Legal first name",{exact:true}).fill("Navin");
          await page.getByLabel("Legal last name",{exact:true}).fill("Worker");
          await page.getByLabel("Preferred name").fill("X");
          await page.getByLabel("Date of birth",{exact:true}).fill("1994-02-14");
          await page.getByLabel("Nationality",{exact:true}).fill("Pakistani");
          await page.getByLabel("Country of residence",{exact:true}).fill("Pakistan");
          await page.getByLabel("Primary language",{exact:true}).fill("Urdu");
          await save();
          await expectInvalid("section recheck");
          assert.equal(await page.getByLabel("Legal first name",{exact:true}).inputValue(),"Navin","Rejected Personal save lost a valid typed field.");
          assert.equal(await page.getByLabel("Preferred name").inputValue(),"X","Rejected Personal save lost invalid typed draft.");
          assert.equal(await page.getByLabel("Date of birth",{exact:true}).inputValue(),"1994-02-14",
            "Rejected Personal save must retain the valid date input for correction and retry.");
          await page.getByLabel("Preferred name").fill("Nav");
          await save();
          await waitSaved("personal");
          await visit("contact");
          await page.getByLabel("Country code",{exact:true}).fill("+92");
          await page.getByLabel("Phone number",{exact:true}).fill("3001234567");
          await page.getByLabel("Address line 1",{exact:true}).fill("123 Safety Street");
          await page.getByLabel("City",{exact:true}).fill("X");
          await page.getByLabel("Region or province").fill("Punjab");
          await save();
          await expectInvalid("section recheck");
          assert.equal(await page.getByLabel("Address line 1",{exact:true}).inputValue(),"123 Safety Street","Rejected Contact save erased address.");
          assert.equal(await page.locator('input[name="city"]').count(),1,"Contact City field disappeared on "+page.url());
          assert.equal(await page.locator('input[name="city"]').inputValue(),"X","Rejected Contact save lost invalid city.");
          await page.locator('input[name="city"]').fill("Lahore");
          const correctedContactForm=await page.getByRole("button",{name:"Save changes",exact:true}).locator("xpath=ancestor::form").evaluate(form=>Object.fromEntries(new FormData(form)));
          assert.equal(correctedContactForm.phoneCountryCode,"+92","Corrected Contact country code changed before submit.");
          assert.equal(correctedContactForm.city,"Lahore","Corrected Contact city changed before submit.");
          console.log("ACTUAL_PROFILE_CORRECTED_FORM validated actual country code and corrected city");
          await save();
          await waitSaved("contact");
          await visit("professional");
          await page.getByLabel("Primary occupation or trade",{exact:true}).fill("Safety Officer");
          await page.getByLabel("Years of experience",{exact:true}).fill("70");
          await page.locator('select[name="employmentStatus"]').selectOption("");
          await page.getByLabel("Preferred work countries").fill("Saudi Arabia, Pakistan");
          await page.getByLabel("I am willing to relocate for suitable work.").check();
          await save();
          await expectInvalid("section recheck");
          let occupationAfterRejection;
           try {
             occupationAfterRejection=await page.getByLabel("Primary occupation or trade",{exact:true}).inputValue({timeout:10000});
           } catch (error) {
             throw new Error("Professional draft field missing after rejected save. URL="+page.url()+
               "\nPAGE:\n"+await page.locator("body").innerText()+
               "\nBROWSER ERRORS:\n"+fatal.join("\n")+
               "\nSERVER:\n"+output(),{cause:error});
           }
           assert.equal(occupationAfterRejection,"Safety Officer","Rejected Professional save lost occupation.");
          assert.equal(await page.getByLabel("Years of experience",{exact:true}).inputValue(),"70","Rejected Professional save lost years.");
          assert.equal(await page.getByLabel("I am willing to relocate for suitable work.").isChecked(),true);
          await page.getByLabel("Years of experience",{exact:true}).fill("8");
          await page.locator('select[name="employmentStatus"]').selectOption("employed");
          await save();
          await waitSaved("professional");
          await page.reload({waitUntil:"domcontentloaded"});
          assert.equal(await page.getByLabel("Primary occupation or trade",{exact:true}).inputValue(),"Safety Officer");
          assert.equal(await page.getByLabel("Years of experience",{exact:true}).inputValue(),"8");
          assert.equal(await page.locator('select[name="employmentStatus"]').inputValue(),"employed");
          assert.equal(await page.getByLabel("I am willing to relocate for suitable work.").isChecked(),true);
          await page.getByRole("link",{name:/Contact and address/}).click();
          await page.waitForURL(/section=contact/);
          assert.equal(await page.getByLabel("Address line 1",{exact:true}).inputValue(),"123 Safety Street");
          assert.equal(await page.getByLabel("City",{exact:true}).inputValue(),"Lahore");
          await page.getByRole("link",{name:/Personal details/}).click();
          await page.waitForURL(/section=personal/);
          assert.equal(await page.getByLabel("Legal first name",{exact:true}).inputValue(),"Navin");
          assert.equal(await page.getByLabel("Preferred name").inputValue(),"Nav");
          await page.goto(base+"/worker/dashboard",{waitUntil:"domcontentloaded"});
          await visit("professional");
          assert.equal(await page.getByLabel("Years of experience",{exact:true}).inputValue(),"8");
          await page.getByRole("progressbar",{name:"Worker profile completion"}).waitFor();
          assert.equal(await page.getByRole("progressbar",{name:"Worker profile completion"}).getAttribute("aria-valuenow"),"100");
          await page.getByText("Ready to submit",{exact:true}).first().waitFor();
          assert.deepEqual(fatal,[],output());
          console.log("ACTUAL_M10702_BROWSER three section drafts reject invalid values without clearing typed input, retry saves, cold reload, tab navigation, dashboard return, 100% ready but not submitted");

          // The historical green case above already proves ordinary section
          // validation/navigation. This adds the uncovered real concurrent
          // session / stale write / typed draft retention and retry outcome.
          const second=await browser.newPage({viewport:{width:320,height:740}});
          second.on("pageerror",error=>fatal.push(error.message));
          second.on("response",response=>{
            if(response.status()>=500)fatal.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);
          });
          await second.goto(base+"/worker/login",{waitUntil:"domcontentloaded"});
          await second.getByLabel("Email address").fill(fixture.credentials.worker.email);
          await second.getByLabel("Password").fill(fixture.credentials.worker.password);
          await second.getByRole("button",{name:"Sign in",exact:true}).click();
          await second.waitForURL("**/worker/dashboard",{timeout:25000});
          await second.goto(base+"/worker/profile?section=professional",{waitUntil:"domcontentloaded"});
          await second.locator('form.profile-form[data-hydrated="ready"]').waitFor({timeout:20000});
          const formVersion=p=>p.locator('form.profile-form input[name="expectedVersion"]').inputValue();
          assert.equal(await formVersion(page),"3","Original A must hold the three-section accepted version.");
          assert.equal(await formVersion(second),"3","Independent B must hold the same version before A saves.");
          assert.equal(await second.getByLabel("Years of experience",{exact:true}).inputValue(),"8");

          const saveAction=async p=>{
            const posted=p.waitForResponse(response=>
              response.request().method()==="POST" &&
              new URL(response.url()).pathname==="/worker/profile",{timeout:25000});
            await p.getByRole("button",{name:"Save changes",exact:true}).click();
            assert.equal((await posted).status(),200,"Actual signed profile Server Action transport must remain healthy.");
          };
          await page.getByLabel("Years of experience",{exact:true}).fill("9");
          await saveAction(page);
          await page.reload({waitUntil:"domcontentloaded"});
          await page.locator('form.profile-form[data-hydrated="ready"]').waitFor({timeout:20000});
          assert.equal(await formVersion(page),"4");
          assert.equal(await page.getByLabel("Years of experience",{exact:true}).inputValue(),"9",
            "A successful new draft must be committed before B submits stale version 3.");

          // B edits its own genuine old DOM from an independent authenticated
          // context: the same Worker owner, but exact version is stale.
          assert.equal(await formVersion(second),"3");
          await second.getByLabel("Years of experience",{exact:true}).fill("10");
          await saveAction(second);
          await second.getByRole("alert").getByText(
            "Your profile changed in another request. Reloaded data is required before saving again.",
            {exact:true}
          ).waitFor({timeout:18000});
          await second.waitForFunction(()=>
            document.querySelector('form.profile-form input[name="expectedVersion"]')?.value==="4",
            {timeout:20000});
          assert.equal(await second.getByLabel("Years of experience",{exact:true}).inputValue(),"10",
            "Stale edit must preserve B's typed draft for a deliberate safe retry.");
          await page.reload({waitUntil:"domcontentloaded"});
          assert.equal(await page.getByLabel("Years of experience",{exact:true}).inputValue(),"9",
            "Rejected stale B request must not overwrite A's committed year value.");
          console.log("ACTUAL_M10702_STALE_TWO_SIGNED_WORKER_SESSIONS",
            "independent signed A390/B320 version3, A version4 saved9, stale B draft10 rejected visibly and retained, A winner9 untouched");

          await saveAction(second);
          await second.reload({waitUntil:"domcontentloaded"});
          await second.locator('form.profile-form[data-hydrated="ready"]').waitFor({timeout:20000});
          assert.equal(await formVersion(second),"5");
          assert.equal(await second.getByLabel("Years of experience",{exact:true}).inputValue(),"10");
          await second.getByText("Ready to submit",{exact:true}).first().waitFor();
          assert.equal(await second.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,
            "320px stale-conflict recovery must not overflow horizontally.");
          assert.deepEqual(fatal,[],output());
          console.log("ACTUAL_M10702_STALE_RETRY_BROWSER",
            "B reloads latest version and retries retained draft10 successfully, version5 ready/not submitted, responsive320px no JS/500");
        } finally{await browser.close();}
      }
    });
    assert.equal(run.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const rows=(await db.query("SELECT worker_sub,version,status,submitted_at,profile_document FROM worker_profiles WHERE worker_sub=$1",[fixture.credentials.worker.accountId])).rows;
      assert.equal(rows.length,1);
      const record=typeof rows[0].profile_document==="string"?JSON.parse(rows[0].profile_document):rows[0].profile_document;
      assert.equal(rows[0].version,5);
      assert.equal(rows[0].status,"ready");
      assert.equal(rows[0].submitted_at,null);
      assert.equal(record.personal.legalFirstName,"Navin");
      assert.equal(record.personal.preferredName,"Nav");
      assert.equal(record.contact.addressLine1,"123 Safety Street");
      assert.equal(record.contact.city,"Lahore");
      assert.equal(record.professional.yearsExperience,10);
      assert.equal(record.professional.willingToRelocate,true);
      assert.deepEqual(record.audit.filter(e=>e.action==="section_saved").map(e=>e.section),
        ["personal","contact","professional","professional","professional"],
        "Only A's winning write and B's successful corrected retry may append audits; stale B must not.");
      assert.equal(rows[0].status,"ready");
      assert.equal(rows[0].submitted_at,null);
      console.log("ACTUAL_M10702_STALE_RETRY_DB",
        "exact 5 successful immutable profile versions/section-save audits; stale concurrent B never committed, latest B draft10 retained ready unsubmitted");
      console.log("ACTUAL_M10702_DB three initial section saves plus A winner and B safe retry = five successful audited versions; invalid and stale attempts not persisted; ready unsubmitted");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
