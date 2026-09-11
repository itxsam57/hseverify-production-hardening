import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyPendingMigrations,
  migrationStatus,
  rollbackLatestMigration
} from "./lib/migrations.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "artifacts", "independent-audit");
await mkdir(OUT, { recursive: true });
const findings = [];
const checkpoints = [];
function add(severity, category, message, evidence = null) { findings.push({ severity, category, message, evidence }); }
async function checkpoint(name, fn) {
  const started = Date.now();
  try { const detail = await fn(); checkpoints.push({ name, status: "PASS", ms: Date.now() - started, detail: detail ?? null }); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); checkpoints.push({ name, status: "FAIL", ms: Date.now() - started, error: message }); add("high", "database-checkpoint", `${name} failed.`, message); }
}

const dir = path.join(ROOT, "database", "migrations");
const names = (await readdir(dir)).sort();
const up = names.filter((name) => name.endsWith(".up.sql"));
const down = names.filter((name) => name.endsWith(".down.sql")).sort().reverse();
const upByKey = new Map(up.map((name) => [name.replace(/\.up\.sql$/, ""), name]));
const downByKey = new Map(down.map((name) => [name.replace(/\.down\.sql$/, ""), name]));
for (const key of new Set([...upByKey.keys(), ...downByKey.keys()])) {
  if (!upByKey.has(key) || !downByKey.has(key)) add("high", "migration-pair", `Migration ${key} is missing an up/down partner.`);
}

async function executeFile(db, filename) {
  const sql = await readFile(path.join(dir, filename), "utf8");
  await db.exec(sql);
}
async function applyAll(db) { for (const name of up) await executeFile(db, name); }
async function publicTables(db) {
  const rows = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  return rows.rows.map((row) => row.tablename);
}

const db = await PGlite.create("memory://");
let baselineTables = [];
try {
  await checkpoint("Fresh full migration stack applies", async () => {
    await applyAll(db);
    baselineTables = await publicTables(db);
    if (baselineTables.length < 1) throw new Error("No public tables were created.");
    return { migrations: up.length, tables: baselineTables.length };
  });

  await checkpoint("Every public table has an explicit primary key unless it is a documented join/ledger exception", async () => {
    const result = await db.query(`
      SELECT t.tablename
      FROM pg_tables t
      LEFT JOIN pg_constraint c
        ON c.conrelid = (quote_ident(t.schemaname)||'.'||quote_ident(t.tablename))::regclass
       AND c.contype='p'
      WHERE t.schemaname='public' AND c.oid IS NULL
      ORDER BY t.tablename`);
    const missing = result.rows.map((r) => r.tablename);
    for (const table of missing) add("medium", "schema-primary-key", `Public table ${table} has no primary key. Confirm this is intentional.`);
    return { missingPrimaryKey: missing };
  });

  await checkpoint("History tables do not cascade-delete from parent records", async () => {
    const result = await db.query(`
      SELECT conrelid::regclass::text AS child_table, confrelid::regclass::text AS parent_table, conname
      FROM pg_constraint
      WHERE contype='f' AND confdeltype='c'
      ORDER BY 1,2,3`);
    const risky = result.rows.filter((row) => /audit|event|version|generated_assessment|assessment_attempt_answer|evidence|credential|history/i.test(String(row.child_table)));
    for (const row of risky) add("high", "history-cascade", `History-like table ${row.child_table} cascades deletion from ${row.parent_table}.`, row.conname);
    return { cascadeForeignKeys: result.rows.length, riskyHistoryCascades: risky.length };
  });

  await checkpoint("Critical append-only history has database triggers", async () => {
    const triggerRows = await db.query(`
      SELECT c.relname AS table_name, t.tgname AS trigger_name, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace
      ORDER BY c.relname,t.tgname`);
    const byTable = new Map();
    for (const row of triggerRows.rows) {
      const list = byTable.get(row.table_name) ?? [];
      list.push(`${row.trigger_name} ${row.definition}`);
      byTable.set(row.table_name, list);
    }
    const critical = [
      "platform_audit_events",
      "generated_assessment_forms",
      "generated_assessment_form_items",
      "assessment_blueprint_versions",
      "assessment_question_versions",
      "assessment_catalogue_versions",
      "assessment_attempt_answers"
    ];
    const missing = [];
    for (const table of critical) {
      const defs = (byTable.get(table) ?? []).join(" ");
      if (!/UPDATE OR DELETE|DELETE OR UPDATE|BEFORE UPDATE|BEFORE DELETE/i.test(defs)) {
        missing.push(table);
        add(table === "platform_audit_events" ? "critical" : "high", "append-only", `${table} has no visible UPDATE/DELETE immutability trigger.`);
      }
    }
    return { auditedTables: critical.length, missing };
  });

  await checkpoint("Session and credential lookup secrets are uniquely constrained", async () => {
    const checks = [
      ["auth_sessions", "token_hash"],
      ["auth_staff_invitations", "token_hash"],
      ["auth_accounts", "email_normalized"]
    ];
    const missing = [];
    for (const [table, column] of checks) {
      const result = await db.query(`
        SELECT 1
        FROM pg_index i
        JOIN pg_class c ON c.oid=i.indrelid
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum = ANY(i.indkey)
        WHERE c.relname=$1 AND a.attname=$2 AND i.indisunique
        LIMIT 1`, [table, column]);
      if (!result.rows[0]) { missing.push(`${table}.${column}`); add("critical", "secret-uniqueness", `${table}.${column} is not protected by a unique index/constraint.`); }
    }
    return { missing };
  });

  await checkpoint("Audit action domain and database constraint stay synchronized", async () => {
    const source = await readFile(path.join(ROOT, "src/lib/audit/audit-domain.ts"), "utf8");
    const marker = source.indexOf("AUDIT_ACTIONS");
    const tail = marker >= 0 ? source.slice(marker, source.indexOf("] as const", marker) + 10) : "";
    const domainActions = new Set([...tail.matchAll(/["']([a-z0-9_.-]+)["']/g)].map((m) => m[1]).filter((v) => v.includes(".")));
    const result = await db.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='platform_audit_events_action_key_check' LIMIT 1`);
    const def = String(result.rows[0]?.def ?? "");
    const dbActions = new Set([...def.matchAll(/'([a-z0-9_.-]+)'/g)].map((m) => m[1]));
    const missingInDb = [...domainActions].filter((a) => !dbActions.has(a));
    const missingInDomain = [...dbActions].filter((a) => !domainActions.has(a));
    if (missingInDb.length || missingInDomain.length) add("critical", "audit-action-sync", "Audit action vocabulary differs between TypeScript and database CHECK constraint.", { missingInDb, missingInDomain });
    return { domain: domainActions.size, database: dbActions.size, missingInDb, missingInDomain };
  });

  await checkpoint("Supported latest-migration rollback and reapply preserves schema contract", async () => {
    const rollbackDb = await PGlite.create("memory://");
    const previousRollbackPermission = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
    try {
      const applied = await applyPendingMigrations(rollbackDb, "independent-audit");
      if (applied.length !== up.length) {
        throw new Error(`Expected ${up.length} freshly applied migrations, got ${applied.length}.`);
      }
      const beforeRollbackTables = await publicTables(rollbackDb);
      const beforeStatus = await migrationStatus(rollbackDb);
      const latestApplied = [...beforeStatus].reverse().find((migration) => migration.applied);
      if (!latestApplied) throw new Error("No latest applied migration was available for rollback.");

      const rolledBackId = await rollbackLatestMigration(rollbackDb, { appEnvironment: "test" });
      if (rolledBackId !== latestApplied.id) {
        throw new Error(`Expected rollback of ${latestApplied.id}, got ${rolledBackId ?? "none"}.`);
      }
      const afterRollbackStatus = await migrationStatus(rollbackDb);
      const rolledBackStatus = afterRollbackStatus.find((migration) => migration.id === rolledBackId);
      if (!rolledBackStatus || rolledBackStatus.applied) {
        throw new Error(`Migration ${rolledBackId} remained recorded as applied after rollback.`);
      }

      const reappliedIds = await applyPendingMigrations(rollbackDb, "independent-audit-reapply");
      if (reappliedIds.length !== 1 || reappliedIds[0] !== rolledBackId) {
        throw new Error(`Expected only ${rolledBackId} to reapply, got ${reappliedIds.join(", ") || "none"}.`);
      }
      const afterReapplyTables = await publicTables(rollbackDb);
      const missing = beforeRollbackTables.filter((table) => !afterReapplyTables.includes(table));
      const extra = afterReapplyTables.filter((table) => !beforeRollbackTables.includes(table));
      if (missing.length || extra.length) {
        add("high", "migration-reapply", "Schema table set changed after supported latest rollback/reapply.", { missing, extra, rolledBackId });
      }
      return {
        contract: "latest applied migration only; destructive rollback allowed only in local/test with explicit acknowledgement",
        rolledBackId,
        reappliedIds,
        missingAfterReapply: missing,
        extraAfterReapply: extra
      };
    } finally {
      if (previousRollbackPermission === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
      else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previousRollbackPermission;
      await rollbackDb.close();
    }
  });

  await checkpoint("Assessment committed-answer immutability trigger is present and enabled", async () => {
    const result = await db.query(`
      SELECT t.tgenabled, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relname='assessment_attempt_answers' AND t.tgname='assessment_attempt_answers_append_only' AND NOT t.tgisinternal`);
    const row = result.rows[0];
    if (!row || row.tgenabled === 'D') throw new Error("assessment_attempt_answers_append_only is missing or disabled.");
    if (!/UPDATE OR DELETE|DELETE OR UPDATE/i.test(String(row.def))) throw new Error("assessment_attempt_answers append-only trigger does not guard both UPDATE and DELETE.");
    return { enabled: row.tgenabled, definition: row.def };
  });
} finally {
  await db.close();
}

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
findings.sort((a,b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || a.category.localeCompare(b.category));
const counts = Object.fromEntries(["critical","high","medium","low","info"].map((s) => [s, findings.filter((f) => f.severity === s).length]));
const report = { auditedAt: new Date().toISOString(), basis: "fresh PGlite schema created directly from migration SQL plus supported migration-runner rollback/reapply contract; no milestone assertions used", migrationCount: up.length, tableCount: baselineTables.length, checkpoints, counts, findings };
await writeFile(path.join(OUT, "database.json"), JSON.stringify(report, null, 2));
let md = `# Independent database audit\n\nBasis: fresh PGlite schema created directly from migration SQL plus supported migration-runner rollback/reapply contract; no milestone assertions used.\n\n## Checkpoints\n\n${checkpoints.map((c) => `- ${c.status === "PASS" ? "✅" : "❌"} ${c.name}${c.error ? ` — ${c.error}` : ""}`).join("\n")}\n\n## Findings\n\n`;
md += findings.length ? findings.map((f,i) => `${i+1}. **${f.severity.toUpperCase()} — ${f.category}** — ${f.message}${f.evidence ? ` — \`${JSON.stringify(f.evidence).replaceAll("`", "'")}\`` : ""}`).join("\n") : "No findings.\n";
await writeFile(path.join(OUT, "database.md"), md + "\n");
console.log(JSON.stringify({ checkpoints: checkpoints.map((c) => [c.name,c.status]), counts }, null, 2));
