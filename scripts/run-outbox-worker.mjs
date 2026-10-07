import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const once = process.argv.includes("--once");
if (process.argv.slice(2).some(argument => argument !== "--once")) {
  throw new Error("Usage: node scripts/run-outbox-worker.mjs [--once]");
}
if (!once && process.env.HSE_DATABASE_DRIVER !== "postgres") {
  throw new Error("Continuous worker requires PostgreSQL; --once permits an offline test database.");
}
const entry = resolve(".outbox-worker-dist/outbox/outbox-worker.js");
if (!existsSync(entry)) throw new Error("Build the outbox worker before starting it.");
const require = createRequire(import.meta.url);
const { processNextOutboxJob } = require(entry);
const {reconcileInterviewScheduledNotifications} = require(resolve(".outbox-worker-dist/notifications/interview-notification-projector.js"));
const {reconcileInterviewScheduledEmails} = require(resolve(".outbox-worker-dist/email-delivery/interview-email-handler.js"));
const { getDatabaseClient } = require(resolve(".outbox-worker-dist/database/database.js"));
const { DatabaseOutboxRepository } = require(resolve(".outbox-worker-dist/outbox/outbox-repository.js"));
let stopping = false;
process.on("SIGINT",() => { stopping = true; });
process.on("SIGTERM",() => { stopping = true; });
let database;
try {
  database = await getDatabaseClient();
  const repository = new DatabaseOutboxRepository(Promise.resolve(database));
  do {
    const repair=await reconcileInterviewScheduledNotifications(database);
    if(repair.deferred) console.error("Interview notification enqueue temporarily unavailable; durable source retained for retry.");
    const emailRepair=await reconcileInterviewScheduledEmails(database);
    if(emailRepair.deferred) console.error("Interview email enqueue temporarily unavailable; durable source retained for retry.");
    const job = await processNextOutboxJob({database,repository});
    if (once) {
      console.log(JSON.stringify({processed:job ? 1 : 0,status:job?.status ?? "idle"}));
      if (job && job.status !== "succeeded") process.exitCode = 1;
      break;
    }
    if (!job) await new Promise(resolveWait => setTimeout(resolveWait,1000));
  } while (!stopping);
} catch {
  console.error("Outbox worker stopped after a runtime failure.");
  process.exitCode = 1;
} finally {
  await database?.close();
}
