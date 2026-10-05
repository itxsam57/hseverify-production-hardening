import assert from "node:assert/strict";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";

const { DatabaseOutboxRepository } = loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const { processNextOutboxJob } = loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");

export async function verifySecurityNotifications({ browser, root, environment, baseUrl, port, credentials, roles, cookies, titles }) {
  const open = () => openScriptDatabase({ databaseDriver: "pglite", pgliteDataDir: environment.HSE_PGLITE_DATA_DIR });
  const database = await open();
  try {
    const repository = new DatabaseOutboxRepository(Promise.resolve(database));
    for (let i = 0; i < roles.length * titles.length; i++) {
      const job = await processNextOutboxJob({ repository, database });
      assert.equal(job?.status, "succeeded");
      assert.equal(job.attemptCount, 1);
    }
    assert.equal(await processNextOutboxJob({ repository, database }), null);
  } finally { await database.close(); }
  await runDevelopmentServer({
    args: ["--hostname", "127.0.0.1", "--port", String(port)],
    probeUrl: baseUrl + "/worker/login", projectRoot: root, environment,
    probe: async () => {
      for (const role of roles) {
        const context = await browser.newContext();
        try {
          await context.addCookies(cookies[role]);
          const page = await context.newPage();
          await page.goto(baseUrl + "/" + role + "/notifications");
          assert.equal(new URL(page.url()).pathname, "/" + role + "/notifications");
          for (let i = 0; i < titles.length; i++) {
            const item = page.locator(".notification-center-item").filter({ has: page.getByRole("heading", { name: titles[i], exact: true }) });
            await item.getByText("Unread", { exact: true }).waitFor();
            assert.equal(await page.locator(".notification-center-summary strong").innerText(), String(titles.length - i));
            await item.getByRole("button", { name: "Mark read", exact: true }).click();
            await item.getByText("Read", { exact: true }).waitFor();
            await item.getByRole("button", { name: "Open", exact: true }).click();
            await page.waitForURL("**/account/security");
            await page.getByRole("heading", { name: "Security settings", exact: true }).waitFor();
            await page.goto(baseUrl + "/" + role + "/notifications");
          }
          assert.equal(await page.locator(".notification-center-summary strong").innerText(), "0");
          console.log("ACTUAL_SECURITY_NOTIFICATION_BROWSER", role, titles.length, "normal producer, real worker, unread/read and authenticated deep link");
        } finally { await context.close(); }
      }
    }
  });
  const persisted = await open();
  try {
    for (const role of roles) {
      const rows = (await persisted.query("SELECT n.title,n.read_at,n.recipient_role,e.account_id,e.active_role,j.status,j.attempt_count FROM platform_notifications n JOIN auth_security_events e ON e.event_id=n.metadata->>'eventRef' JOIN platform_outbox_jobs j ON j.job_id=n.source_job_id WHERE n.recipient_account_id=$1", [credentials[role].accountId])).rows;
      assert.equal(rows.length, titles.length);
      assert.deepEqual(rows.map(r => r.title).sort(), [...titles].sort());
      for (const row of rows) {
        assert.ok(row.read_at);
        assert.equal(row.recipient_role, role);
        assert.equal(row.active_role, role);
        assert.equal(row.account_id, credentials[role].accountId);
        assert.equal(row.status, "succeeded");
        assert.equal(row.attempt_count, 1);
      }
    }
    console.log("ACTUAL_SECURITY_NOTIFICATION_DB exact recipients, authoritative source events, read persistence and successful jobs");
  } finally { await persisted.close(); }
}
