import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";



const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode32(value) {
  let bits = 0, acc = 0;
  const bytes = [];
  for (const char of value.toUpperCase().replace(/=+$/g, "")) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
      acc &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}
function totp(secret, stepOffset = 0) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepOffset));
  const digest = createHmac("sha1", decode32(secret)).update(message).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("Could not allocate port."));
        else resolve(address.port);
      });
    });
  });
}
async function login(page, baseUrl, identity, role, offset = 0) {
  await page.goto(baseUrl + "/" + role + "/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if (identity.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret, offset));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/" + role + "/dashboard", { timeout: 20_000 });
}
test("Five invited staff roles activate MFA, retain fixed role and sign in through their portal", {timeout:300000}, async () => {
  const root = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-staff-role-activation-"));
  const port = await freePort(), baseUrl = "http://127.0.0.1:" + port;
  const environment = {...process.env, HSE_APP_ENV: "development", HSE_DATABASE_DRIVER: "pglite", HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "staff-role-activation-probe", HSE_SESSION_SECRET: "staff-role-activation-session-secret-more-than-thirty-two",
    HSE_AUTH_PEPPER: "staff-role-activation-auth-pepper-more-than-thirty-two", HSE_ENABLE_WORKER_DEMO_AUTH: "false", HSE_USE_WORKER_DEMO_DATA: "false"};
  const roles = ["company", "assessor", "verifier", "admin", "root"], outcomes = [];
  try {
    for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs"]) {
      const r = spawnSync(process.execPath, [script], {cwd: root, env: environment, encoding: "utf8"});
      assert.equal(r.status, 0, r.stderr || r.stdout);
    }
    const credentials = JSON.parse(await readFile("/tmp/independent-audit-credentials.json", "utf8"));
    await runDevelopmentServer({args:["--hostname", "127.0.0.1", "--port", String(port)], probeUrl:baseUrl + "/root/login", projectRoot:root, environment,
      probe: async () => {
        const browser = await chromium.launch({headless:true});
        try {
          const issuer = await browser.newPage();
          await login(issuer, baseUrl, credentials.root, "root");
          for (const role of roles) {
            await issuer.goto(baseUrl + "/root/staff");
            const email = "activation." + role + "@example.test";
            await issuer.getByLabel("Staff email").fill(email);
            await issuer.getByLabel("Portal role").selectOption(role);
            await issuer.getByRole("button", {name:"Create one-time invitation",exact:true}).click();
            await issuer.locator(".security-key-card strong").waitFor();
            const invitationPath = await issuer.locator(".security-key-card strong").innerText();
            const context = await browser.newContext(), page = await context.newPage();
            const password = "StaffActivation!Password2026";
            await page.goto(baseUrl + invitationPath);
            await page.getByLabel("Full name").fill("Invited " + role + " Account");
            await page.getByLabel("Create password", {exact:true}).fill(password);
            await page.getByLabel("Confirm password", {exact:true}).fill(password);
            await page.getByRole("button", {name:"Continue to authenticator setup",exact:true}).click();
            await page.getByRole("heading", {name:"Add HSE Verify to an authenticator app",exact:true}).waitFor();
            const secret = await page.locator(".security-key-card strong").innerText();
            const premature = await context.newPage();
            await premature.goto(baseUrl + "/" + role + "/login");
            await premature.getByLabel("Email address").fill(email);
            await premature.getByLabel("Password").fill(password);
            await premature.getByLabel("Authenticator code").fill(totp(secret));
            await premature.getByRole("button", {name:"Sign in",exact:true}).click();
            await premature.locator('[role="alert"]').waitFor();
            await premature.goto(baseUrl + "/" + role + "/dashboard");
            assert.equal(new URL(premature.url()).pathname, "/" + role + "/login");
            await premature.close();
            await page.getByLabel("Authenticator code").fill(totp(secret));
            await page.getByRole("button", {name:"Activate MFA and finish enrollment",exact:true}).click();
            await page.waitForURL("**/" + role + "/login?reason=enrollment-complete");
            const reused = await browser.newContext(), usedPage = await reused.newPage();
            await usedPage.goto(baseUrl + invitationPath);
            await usedPage.getByRole("heading", {name:"Invitation unavailable",exact:true}).waitFor();
            await reused.close();
            try {
              await login(page, baseUrl, {email,password,totpSecret:secret}, role, 1);
              outcomes.push({role, login:"passed", path:new URL(page.url()).pathname});
            } catch {
              outcomes.push({role, login:"failed", path:new URL(page.url()).pathname, headings:await page.locator("h1,h2").allTextContents()});
            }
            await context.close();
            console.log("ACTUAL_STAFF_ROLE_BROWSER", JSON.stringify(outcomes.at(-1)));
          }
        } finally {await browser.close();}
      }});
    const db = new PGlite(databaseDirectory);
    try {
      for (const role of roles) {
        const rows = (await db.query(`SELECT invitations.invitation_status, accounts.account_id, accounts.account_status,
          roles.role, factors.factor_status, flows.current_step
          FROM auth_staff_invitations AS invitations
          JOIN auth_accounts AS accounts ON accounts.account_id=invitations.accepted_by_account_id
          JOIN auth_account_roles AS roles ON roles.account_id=accounts.account_id
          JOIN auth_mfa_factors AS factors ON factors.account_id=accounts.account_id
          JOIN auth_staff_enrollment_flows AS flows ON flows.invitation_id=invitations.invitation_id
          WHERE invitations.email_normalized=$1`, ["activation." + role + "@example.test"])).rows;
        assert.equal(rows.length,1);assert.equal(rows[0].invitation_status,"accepted");assert.equal(rows[0].account_status,"active");
        assert.equal(rows[0].role,role);assert.equal(rows[0].factor_status,"active");assert.equal(rows[0].current_step,"complete");
        const sessions = (await db.query("SELECT active_role,revoked_at FROM auth_sessions WHERE account_id=$1", [rows[0].account_id])).rows;
        assert.deepEqual(sessions, [{active_role:role,revoked_at:null}], "Exactly one invited-role session must exist.");
        console.log("ACTUAL_STAFF_ROLE_DB",JSON.stringify({role,accepted:true,sessions:sessions.map(s=>({role:s.active_role,revoked:s.revoked_at!==null}))}));
      }
    } finally {await db.close();}
    assert.equal(outcomes.length,5);
    assert.deepEqual(outcomes.filter(o=>o.login!=="passed"), [], "Accepted invited staff cannot sign into their fixed portal.");
  } finally {await rm(databaseDirectory,{recursive:true,force:true});}
});

test("All staff roles reject fresh and cached enrollment after persisted invitation expiry", {timeout:300000}, async () => {
  const root = process.cwd(), databaseDirectory = await mkdtemp(join(tmpdir(), "hse-staff-expiry-"));
  const port = await freePort(), baseUrl = "http://127.0.0.1:" + port;
  const environment = {...process.env, HSE_APP_ENV:"development", HSE_DATABASE_DRIVER:"pglite", HSE_PGLITE_DATA_DIR:databaseDirectory,
    // Keep framework action encryption stable across this deliberate test-server restart.
    // Bound useActionState forms otherwise fail before application expiry guards run.
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:Buffer.alloc(32,19).toString("base64"),
    HSE_RELEASE_SHA:"staff-expiry-browser", HSE_SESSION_SECRET:"staff-expiry-session-secret-more-than-thirty-two",
    HSE_AUTH_PEPPER:"staff-expiry-auth-pepper-more-than-thirty-two", HSE_ENABLE_WORKER_DEMO_AUTH:"false", HSE_USE_WORKER_DEMO_DATA:"false"};
  const roles = ["company","assessor","verifier","admin","root"], held = [];
  let browser;
  try {
    for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs"]) {
      const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);
    }
    const credentials=JSON.parse(await readFile("/tmp/independent-audit-credentials.json","utf8"));
    browser=await chromium.launch({headless:true});
    const serverOptions={args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/root/login",projectRoot:root,environment};
    await runDevelopmentServer({...serverOptions,probe:async()=>{
      const issuer=await browser.newPage();await login(issuer,baseUrl,credentials.root,"root");
      for(const role of [...roles,"control"]) {
        const email=role==="control"?"unexpired.control@example.test":"expired."+role+"@example.test", password="ExpiredStaff!Password2026";
        await issuer.goto(baseUrl+"/root/staff");await issuer.getByLabel("Staff email").fill(email);await issuer.getByLabel("Portal role").selectOption(role==="control"?"verifier":role);
        await issuer.getByRole("button",{name:"Create one-time invitation",exact:true}).click();await issuer.locator(".security-key-card strong").waitFor();
        const invitationPath=await issuer.locator(".security-key-card strong").innerText();
        // Plain SSR forms retain their real action/cookie across development-server restart; no HMR replacement.
        const context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();await page.goto(baseUrl+invitationPath);
        await page.getByLabel("Full name").fill("Expired "+role+" Staff");await page.getByLabel("Create password",{exact:true}).fill(password);await page.getByLabel("Confirm password",{exact:true}).fill(password);
        const mfa=role==="assessor"||role==="admin";
        let secret=null;
        if(mfa) {
          await page.getByRole("button",{name:"Continue to authenticator setup",exact:true}).click();
          await page.getByRole("heading",{name:"Add HSE Verify to an authenticator app",exact:true}).waitFor();secret=await page.locator(".security-key-card strong").innerText();
        }
        held.push({role,email,invitationPath,context,page,mfa,secret});
      }
      await issuer.close();
    }});
    const fixture=new PGlite(databaseDirectory);
    try {
      await fixture.query(`UPDATE auth_staff_invitations SET created_at=CURRENT_TIMESTAMP-INTERVAL '72 hours', expires_at=CURRENT_TIMESTAMP-INTERVAL '1 minute'
        WHERE email_normalized LIKE 'expired.%@example.test'`);
      assert.equal((await fixture.query("SELECT invitation_id FROM auth_staff_invitations WHERE email_normalized LIKE 'expired.%@example.test' AND expires_at<CURRENT_TIMESTAMP")).rows.length,5);
    } finally {await fixture.close();}
    await runDevelopmentServer({...serverOptions,probe:async()=>{
      // Compile the actual enrollment route after restart before dispatching its cached actions.
      const warmContext=await browser.newContext(),warmPage=await warmContext.newPage();
      await warmPage.goto(baseUrl+"/staff/invite/accept");
      await warmPage.getByRole("heading",{name:"Invitation unavailable",exact:true}).waitFor();
      await warmContext.close();
      const control=held.find(row=>row.role==="control");
      const controlPosted=control.page.waitForResponse(response=>response.request().method()==="POST");
      await control.page.getByRole("button",{name:"Continue to authenticator setup",exact:true}).click();
      const controlResponse=await controlPosted;
      assert.equal(controlResponse.status(),303, "Unexpired cached profile must reach the normal redirect.");
      await control.page.getByRole("heading",{name:"Add HSE Verify to an authenticator app",exact:true}).waitFor({timeout:5000});
      console.log("CACHED_UNEXPIRED_CONTROL_ACTUAL_PROFILE_SUCCESS");
      for(const row of held.filter(row=>row.role!=="control")) {
        const posted=row.page.waitForResponse(response=>response.request().method()==="POST");
        if(row.mfa) {
          await row.page.getByLabel("Authenticator code").fill(totp(row.secret));
          await row.page.getByRole("button",{name:"Activate MFA and finish enrollment",exact:true}).click();
        } else await row.page.getByRole("button",{name:"Continue to authenticator setup",exact:true}).click();
        const response=await posted;
        assert.equal(response.status(),200, "Expired action must return its normal denial page.");
        await row.page.getByRole("heading",{name:"Invitation unavailable",exact:true})
          .or(row.page.getByText("This staff invitation is invalid, expired or already used.",{exact:true})).first().waitFor();
        const fresh=await browser.newContext(),freshPage=await fresh.newPage();await freshPage.goto(baseUrl+row.invitationPath);
        await freshPage.getByRole("heading",{name:"Invitation unavailable",exact:true}).waitFor();await fresh.close();
        console.log("ACTUAL_EXPIRED_FRESH_AND_CACHED_STAFF_DENIED",row.role,row.mfa?"valid_mfa":"profile");
      }
    }});
    const db=new PGlite(databaseDirectory);
    try {
      for(const row of held.filter(row=>row.role!=="control")) {
        const invitations=(await db.query("SELECT invitation_status,accepted_at,revoked_at FROM auth_staff_invitations WHERE email_normalized=$1",[row.email])).rows;
        assert.deepEqual(invitations,[{invitation_status:"pending",accepted_at:null,revoked_at:null}]);
        const accounts=(await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1",[row.email])).rows;
        assert.equal(accounts.length,row.mfa?1:0);
        if(row.mfa) {
          assert.deepEqual((await db.query("SELECT factor_status FROM auth_mfa_factors WHERE account_id=$1",[accounts[0].account_id])).rows,[{factor_status:"pending"}]);
          assert.equal((await db.query("SELECT session_id FROM auth_sessions WHERE account_id=$1",[accounts[0].account_id])).rows.length,0);
        }
        const flows=(await db.query("SELECT current_step FROM auth_staff_enrollment_flows WHERE invitation_id IN (SELECT invitation_id FROM auth_staff_invitations WHERE email_normalized=$1)",[row.email])).rows;
        assert.deepEqual(flows,[{current_step:row.mfa?"totp":"profile"}]);
      }
      assert.equal((await db.query("SELECT audit_event_id FROM platform_audit_events WHERE action_key='authentication.invitation.accepted'")).rows.length,0);
      console.log("ACTUAL_EXPIRED_STAFF_DB_NO_ACCEPTANCE_SESSION_OR_PREMATURE_ACCOUNT");
    } finally {await db.close();}
  } finally {if(browser)await browser.close();await rm(databaseDirectory,{recursive:true,force:true});}
});

test("Unknown invitation token creates no enrollment, account, session or audit acceptance", {timeout:120000}, async () => {
  const root=process.cwd(),databaseDirectory=await mkdtemp(join(tmpdir(),"hse-staff-invalid-"));
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:databaseDirectory,
    HSE_RELEASE_SHA:"staff-invalid-browser",HSE_SESSION_SECRET:"staff-invalid-session-secret-more-than-thirty-two",
    HSE_AUTH_PEPPER:"staff-invalid-auth-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
  const tables=["auth_accounts","auth_staff_invitations","auth_staff_enrollment_flows","auth_mfa_factors","auth_sessions","platform_audit_events"],before={};
  try {
    const migration=spawnSync(process.execPath,["scripts/db-migrate.mjs"],{cwd:root,env:environment,encoding:"utf8"});assert.equal(migration.status,0,migration.stderr||migration.stdout);
    const fixture=new PGlite(databaseDirectory);
    try {for(const table of tables)before[table]=(await fixture.query("SELECT count(*)::int AS count FROM "+table)).rows[0].count;}finally{await fixture.close();}
    await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/root/login",projectRoot:root,environment,probe:async()=>{
      const browser=await chromium.launch({headless:true});
      try {
        const page=await browser.newPage();
        for(const token of ["not-issued-staff-invitation-token", "malformed"]) {
          await page.goto(baseUrl+"/staff/invite/"+token);
          await page.getByRole("heading",{name:"Invitation unavailable",exact:true}).waitFor();
          assert.equal(await page.getByRole("button",{name:"Continue to authenticator setup",exact:true}).count(),0);
          assert.equal(await page.getByRole("button",{name:"Activate MFA and finish enrollment",exact:true}).count(),0);
        }
      }finally{await browser.close();}
    }});
    const db=new PGlite(databaseDirectory);
    try {for(const table of tables)assert.equal((await db.query("SELECT count(*)::int AS count FROM "+table)).rows[0].count,before[table],table+" changed after unknown token");}finally{await db.close();}
    console.log("ACTUAL_UNKNOWN_STAFF_TOKEN_NO_PERSISTED_EFFECTS");
  }finally{await rm(databaseDirectory,{recursive:true,force:true});}
});
