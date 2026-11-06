import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {chromium} from "playwright";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) bits += B32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page, baseUrl, credential, role) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000 });
}

export async function verifyAppealConsumerJourney({baseUrl,credentials,credentialId,foreignCredentialId,evidenceRecordId=null,httpCredentials,restart,outcomeAction="reassessment",output=()=>""}){
          assert.ok(["reassessment","suspend","revoke","rejected"].includes(outcomeAction));
          const currentStatus={reassessment:"reassessment_required",suspend:"suspended",revoke:"revoked",rejected:"valid"}[outcomeAction];
          const browser = await chromium.launch({ headless: true });
          const workerContext = await browser.newContext({ httpCredentials, viewport: { width: 1440, height: 1000 } });
          const adminContext = await browser.newContext({ httpCredentials, viewport: { width: 1440, height: 1000 } });
          const companyContext=await browser.newContext({httpCredentials});
          const publicContext=await browser.newContext({httpCredentials});
          const company=await companyContext.newPage();
          const publicPage=await publicContext.newPage();
          const worker = await workerContext.newPage();
          const admin = await adminContext.newPage();
          const errors = [];
          const consoleErrors=[];
          const inFlight=new Set(),outageRequests=new WeakSet(),expectedOutages=[];
          let restarting=false;
          for (const page of [worker, admin, company, publicPage]) {
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("request",request=>{inFlight.add(request);if(restarting&&request.method()==="GET")outageRequests.add(request);});
            page.on("requestfinished",request=>inFlight.delete(request));
            page.on("requestfailed",request=>inFlight.delete(request));
            page.on("response",response=>{
              const expected=response.status()===502&&response.request().method()==="GET"&&outageRequests.has(response.request());
              if(expected)expectedOutages.push({page,url:response.url(),at:Date.now(),consumed:false});
              else if(response.status()>=400&&!new URL(response.url()).pathname.endsWith("/favicon.ico"))errors.push("Unexpected HTTP "+response.status()+" "+new URL(response.url()).pathname);
            });
            page.on("console", (message) => {
              if (message.type() === "error") consoleErrors.push({page,text:message.text(),url:message.location().url,at:Date.now()});
            });
          }

          try {
            await publicPage.goto(`${baseUrl}/verify/result/${credentialId}`,{waitUntil:"domcontentloaded"});
            await publicPage.getByText("Valid",{exact:true}).waitFor();
            const existingPublicUrl=publicPage.url();
            await login(company,baseUrl,credentials.company,"company");
            await company.goto(`${baseUrl}/company/workers/company_worker_link_${"q".repeat(24)}`,{waitUntil:"domcontentloaded"});
            await company.locator("dt").filter({hasText:"Current competency state"}).locator("..").getByText("valid",{exact:true}).waitFor();
            await login(worker, baseUrl, credentials.worker, "worker");
            let existingShareUrl;
            if (restart) {
              await worker.goto(baseUrl + "/worker/share-links");
              await worker.getByLabel("Purpose", { exact: true }).fill("Appeal outcome competency verification");
              await worker.getByLabel("Qualifications", { exact: true }).uncheck();
              await worker.getByLabel("Competencies", { exact: true }).check();
              await worker.getByRole("button", { name: "Create secure link", exact: true }).click();
              const share = worker.getByRole("link", { name: "Open secure share link", exact: true });
              await share.waitFor();
              existingShareUrl = new URL(await share.getAttribute("href"), baseUrl).href;
              await publicPage.goto(existingShareUrl);
              await publicPage.getByRole("list", { name: "Shared competencies" }).getByText("valid · no expiry recorded", { exact: true }).waitFor();
            }
            await worker.goto(`${baseUrl}/worker/appeals`, { waitUntil: "domcontentloaded" });
            await worker.getByRole("heading", { name: "Credential appeals", exact: true }).waitFor();

            if (foreignCredentialId) {
              for (const invalidId of ["credential_id_missing_appeal_fixture", foreignCredentialId]) {
                await worker.goto(baseUrl + "/worker/appeals");
                await worker.getByLabel("Credential").evaluate((select, value) => {
                  select.add(new Option("Synthetic invalid credential", value));
                  select.value = value;
                }, invalidId);
                await worker.getByLabel("Appeal grounds").fill("Synthetic invalid credential probe");
                await worker.getByRole("button", { name: "Submit credential appeal" }).click();
                await worker.waitForURL(url => url.searchParams.get("error") === "credential");
              }
            }
            await worker.getByLabel("Credential").selectOption(credentialId);
            await worker.getByLabel("Appeal grounds").fill(
              "The issued competency should be reassessed because the retained qualification evidence was interpreted incorrectly."
            );
            if(evidenceRecordId) await worker.locator(`input[name="evidenceRecordIds"][value="${evidenceRecordId}"]`).check();
            await worker.getByRole("button", { name: "Submit credential appeal" }).click();
            await worker.waitForURL(/\/worker\/appeals\?status=submitted/, { timeout: 20_000 });
            await worker.getByText("Appeal submitted for independent review.", { exact: true }).waitFor();
            const workerAppeal = worker.locator("article").filter({ hasText: credentialId }).first();
            await workerAppeal.getByText(/Status: submitted/i).waitFor();
            if(evidenceRecordId) await workerAppeal.getByText(new RegExp(evidenceRecordId)).waitFor();

            await login(admin, baseUrl, credentials.admin, "admin");
            await admin.goto(`${baseUrl}/admin/appeals`, { waitUntil: "domcontentloaded" });
            await admin.getByRole("heading", { name: "Credential appeals", exact: true }).waitFor();
            let review = admin.locator("article").filter({ hasText: credentialId }).first();
            await review.getByText(/Status: submitted/i).waitFor();
            if (restart) {
              const appealId = await review.getAttribute("id");
              assert.ok(appealId);
              const response = await admin.request.post(baseUrl + "/api/credentials/appeals/" + encodeURIComponent(appealId), {
                headers: { origin: baseUrl },
                data: { status: "accepted", reason: "Synthetic invalid outcome probe", outcomeAction: "unsupported" },
              });
              assert.equal(response.status(), 400);
              assert.deepEqual(await response.json(), { error: "invalid_appeal_outcome_action" });
              await admin.reload({ waitUntil: "domcontentloaded" });
              await review.getByText(/Status: submitted/i).waitFor();
            }


            await review.getByLabel("Review status").selectOption("under_review");
            await review.getByLabel("Accepted-outcome action").selectOption("none");
            await review.getByLabel("Reasoned review outcome").fill(
              "Independent review opened against the original credential, appeal grounds and retained qualification evidence."
            );
            await review.getByRole("button", { name: "Record appeal review" }).click();
            await admin.waitForURL(/\/admin\/appeals\?status=updated/, { timeout: 20_000 });
            await admin.getByText("Appeal review recorded.", { exact: true }).waitFor();
            review = admin.locator("article").filter({ hasText: credentialId }).first();
            await review.getByText(/Status: under review/i).waitFor();

            const finalStatus = outcomeAction === "rejected" ? "rejected" : "accepted";
            if (finalStatus === "rejected") {
              await publicPage.goto(existingPublicUrl);
              await publicPage.getByText("Valid", { exact: true }).waitFor();
              await company.reload();
              await company.locator("dt").filter({ hasText: "Current competency state" }).locator("..").getByText("valid", { exact: true }).waitFor();
              await publicPage.goto(existingShareUrl);
              await publicPage.getByRole("list", { name: "Shared competencies" }).getByText("valid · no expiry recorded", { exact: true }).waitFor();
            }
            await review.getByLabel("Review status").selectOption(finalStatus);
            await review.getByLabel("Accepted-outcome action").selectOption(finalStatus === "rejected" ? "none" : outcomeAction);
            await review.getByLabel("Reasoned review outcome").fill(
              finalStatus === "rejected" ? "Appeal rejected. PRIVATE_REVIEW_STAGE_rejected must remain private." : outcomeAction==="reassessment" ? "Appeal accepted. The competency requires reassessment before the Living Record can return to valid." : "Appeal accepted. PRIVATE_REVIEW_STAGE_"+outcomeAction+" must remain private."
            );
            await review.getByRole("button", { name: "Record appeal review" }).click();
            await admin.waitForURL(/\/admin\/appeals\?status=updated/, { timeout: 20_000 });
            review = admin.locator("article").filter({ hasText: credentialId }).first();
            await review.getByText(new RegExp("Status: " + finalStatus, "i")).waitFor();
            if (finalStatus === "accepted") await review.getByText(new RegExp("Outcome action: "+outcomeAction,"i")).waitFor();

            await worker.goto(`${baseUrl}/worker/appeals`, { waitUntil: "domcontentloaded" });
            const outcome = worker.locator("article").filter({ hasText: credentialId }).first();
            await outcome.getByText(new RegExp("Status: " + finalStatus, "i")).waitFor();
            await outcome.getByText(new RegExp("Review outcome: Appeal " + finalStatus, "i")).waitFor();
            if (finalStatus === "accepted") await outcome.getByText(new RegExp("Credential/Living Record action: "+outcomeAction,"i")).waitFor();

            await worker.goto(`${baseUrl}/worker/passport`, { waitUntil: "domcontentloaded" });
            await worker.getByRole("heading", { name: "Living Record", exact: true }).waitFor();
            await worker.getByText("HSE Operational Assurance", { exact: true }).first().waitFor();
            await worker.getByText(new RegExp(currentStatus.replaceAll("_"," ")+" · no expiry recorded","i")).waitFor();
            await worker.getByText(new RegExp((finalStatus === "rejected" ? "Version 1 · " : "Version 2 · ")+currentStatus.replaceAll("_"," "),"i")).waitFor();
            if(restart){
              restarting=true;
              for(const request of inFlight)if(request.method()==="GET")outageRequests.add(request);
              try{await restart();}finally{restarting=false;}
            }
            const publicResponse = await publicPage.goto(existingPublicUrl,{waitUntil:"domcontentloaded"});
            await publicPage.getByText(currentStatus==="reassessment_required"?"Reassessment required":currentStatus==="suspended"?"Suspended":currentStatus==="valid"?"Valid":"Revoked",{exact:true}).waitFor();
            const companyResponse = await company.reload({waitUntil:"domcontentloaded"});
            await company.locator("dt").filter({hasText:"Current competency state"}).locator("..").getByText(currentStatus.replaceAll("_"," "),{exact:true}).waitFor();
            const publicCredentialContent = await publicPage.content();
            const publicResponseBody = await publicResponse.text();
            let shareResponse;
            if (existingShareUrl) {
              shareResponse = await publicPage.goto(existingShareUrl);
              const competency = publicPage.getByRole("list", { name: "Shared competencies" }).getByRole("listitem").filter({ hasText: "HSE Operational Assurance" });
              await competency.getByText(currentStatus.replaceAll("_", " ") + " · no expiry recorded", { exact: true }).waitFor();
            }
            const responseBodies = await Promise.all([companyResponse, shareResponse].filter(Boolean).map(response => response.text()));
            if (existingShareUrl) {
              const shareUrl = new URL(existingShareUrl);
              const shareApi = new URL("/api/share-links/public", baseUrl);
              shareApi.searchParams.set("token", decodeURIComponent(shareUrl.pathname.split("/").at(-1)));
              shareApi.searchParams.set("shareLinkId", shareUrl.searchParams.get("shareLinkId"));
              const [credentialJson, shareJson] = await Promise.all([
                publicPage.request.get(baseUrl + "/api/credentials/" + encodeURIComponent(credentialId)),
                publicPage.request.get(shareApi.href),
              ]);
              assert.equal(credentialJson.status(), 200);
              assert.equal(shareJson.status(), 200);
              const credentialPayload = await credentialJson.json();
              const sharePayload = await shareJson.json();
              assert.equal(credentialPayload.status, currentStatus);
              assert.equal(sharePayload.projection.qualifications, undefined);
              assert.equal(sharePayload.projection.competencies.find(item => item.title === "HSE Operational Assurance").status, currentStatus);
              responseBodies.push(await credentialJson.text(), await shareJson.text());

              for (const [recipient, url] of [[company, company.url()], [publicPage, existingPublicUrl], [publicPage, existingShareUrl]]) {
                const response = await recipient.request.get(url, { headers: { RSC: "1" } });
                assert.equal(response.status(), 200);
                assert.match(response.headers()["content-type"] ?? "", /text\/x-component/);
                responseBodies.push(await response.text());
              }
            }
            for(const content of [await company.content(), publicCredentialContent, await publicPage.content(), publicResponseBody, ...responseBodies]){
              assert.ok(!/retained qualification evidence was interpreted incorrectly|The competency requires reassessment before the Living Record can return to valid|PRIVATE_REVIEW_STAGE_|PRIVATE_EVIDENCE_STAGE/.test(content),"Recipient response exposed a private appeal marker");
            }


            for(const message of consoleErrors){
              const expected=message.text==="Failed to load resource: the server responded with a status of 502 ()"&&expectedOutages.find(outage=>!outage.consumed&&outage.page===message.page&&outage.url===message.url&&Math.abs(outage.at-message.at)<=1500);
              if(expected)expected.consumed=true;
              else errors.push(message.text);
            }
            if(expectedOutages.length)console.log("EXPECTED_OWNED_RESTART_GET_502",expectedOutages.length);
            assert.deepEqual(
              errors.filter((message) => !message.includes("favicon")),
              [],
              `Browser errors:\n${errors.join("\n")}\n${output()}`
            );
          } finally {
            await companyContext.close();
            await publicContext.close();
            await workerContext.close();
            await adminContext.close();
            await browser.close();
          }
        
}
