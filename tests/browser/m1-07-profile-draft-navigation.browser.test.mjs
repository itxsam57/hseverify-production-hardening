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
test("M1.07.02 Worker all three profile section drafts survive rejected save, navigation and retry", {timeout:180000}, async()=>{
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
          };
          const save=async()=>page.getByRole("button",{name:"Save changes",exact:true}).click();
          const feedback=page.getByRole("alert");
          await visit("personal");
          await page.getByLabel("Legal first name",{exact:true}).fill("Navin");
          await page.getByLabel("Legal last name",{exact:true}).fill("Worker");
          await page.getByLabel("Preferred name").fill("X");
          await page.getByLabel("Date of birth",{exact:true}).fill("1994-02-14");
          await page.getByLabel("Nationality",{exact:true}).fill("Pakistani");
          await page.getByLabel("Country of residence",{exact:true}).fill("Pakistan");
          await page.getByLabel("Primary language",{exact:true}).fill("Urdu");
          await save();
          await feedback.getByText("Correct the highlighted fields and try again.",{exact:true}).waitFor({timeout:15000});
          assert.equal(await page.getByLabel("Legal first name",{exact:true}).inputValue(),"Navin","Rejected Personal save lost a valid typed field.");
          assert.equal(await page.getByLabel("Preferred name").inputValue(),"X","Rejected Personal save lost invalid typed draft.");
          await page.getByLabel("Preferred name").fill("Nav");
          await save();
          await page.getByText("Profile section saved.",{exact:true}).waitFor({timeout:15000});
          await visit("contact");
          await page.getByLabel("Country code",{exact:true}).fill("+92");
          await page.getByLabel("Phone number",{exact:true}).fill("3001234567");
          await page.getByLabel("Address line 1",{exact:true}).fill("123 Safety Street");
          await page.getByLabel("City",{exact:true}).fill("X");
          await page.getByLabel("Region or province").fill("Punjab");
          await save();
          await feedback.getByText("Correct the highlighted fields and try again.",{exact:true}).waitFor({timeout:15000});
          assert.equal(await page.getByLabel("Address line 1",{exact:true}).inputValue(),"123 Safety Street","Rejected Contact save erased address.");
          assert.equal(await page.locator('input[name="city"]').count(),1,"Contact City field disappeared on "+page.url());
          assert.equal(await page.locator('input[name="city"]').inputValue(),"X","Rejected Contact save lost invalid city.");
          await page.locator('input[name="city"]').fill("Lahore");
          await save();
          await page.getByText("Profile section saved.",{exact:true}).waitFor({timeout:15000});
          await visit("professional");
          await page.getByLabel("Primary occupation or trade",{exact:true}).fill("Safety Officer");
          await page.getByLabel("Years of experience",{exact:true}).fill("70");
          await page.locator('select[name="employmentStatus"]').selectOption("");
          await page.getByLabel("Preferred work countries").fill("Saudi Arabia, Pakistan");
          await page.getByLabel("I am willing to relocate for suitable work.").check();
          await save();
          await feedback.getByText("Correct the highlighted fields and try again.",{exact:true}).waitFor({timeout:15000});
          assert.equal(await page.getByLabel("Primary occupation or trade",{exact:true}).inputValue(),"Safety Officer","Rejected Professional save lost occupation.");
          assert.equal(await page.getByLabel("Years of experience",{exact:true}).inputValue(),"70","Rejected Professional save lost years.");
          assert.equal(await page.getByLabel("I am willing to relocate for suitable work.").isChecked(),true);
          await page.getByLabel("Years of experience",{exact:true}).fill("8");
          await page.locator('select[name="employmentStatus"]').selectOption("employed");
          await save();
          await page.getByText("Profile section saved.",{exact:true}).waitFor({timeout:15000});
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
        } finally{await browser.close();}
      }
    });
    assert.equal(run.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const rows=(await db.query("SELECT worker_sub,version,status,submitted_at,profile_document FROM worker_profiles WHERE worker_sub=$1",[fixture.credentials.worker.accountId])).rows;
      assert.equal(rows.length,1);
      const record=typeof rows[0].profile_document==="string"?JSON.parse(rows[0].profile_document):rows[0].profile_document;
      assert.equal(rows[0].version,3);
      assert.equal(rows[0].status,"ready");
      assert.equal(rows[0].submitted_at,null);
      assert.equal(record.personal.legalFirstName,"Navin");
      assert.equal(record.personal.preferredName,"Nav");
      assert.equal(record.contact.addressLine1,"123 Safety Street");
      assert.equal(record.contact.city,"Lahore");
      assert.equal(record.professional.yearsExperience,8);
      assert.equal(record.professional.willingToRelocate,true);
      assert.deepEqual(record.audit.filter(e=>e.action==="section_saved").map(e=>e.section),["personal","contact","professional"]);
      console.log("ACTUAL_M10702_DB exactly three successful section versions, no invalid attempt persisted, complete but not submitted, immutable section-save audit retained");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
