import { PGlite } from "@electric-sql/pglite";
import { listMigrations } from "./lib/migrations.mjs";

const database = await PGlite.create();
let firstAccountMigration = null;
let firstRootMigration = null;

try {
  for (const migration of await listMigrations()) {
    await database.exec(migration.upSql);

    const accounts = await database.query("SELECT COUNT(*)::int AS count FROM auth_accounts").catch(() => ({ rows: [{ count: 0 }] }));
    const roots = await database.query("SELECT COUNT(*)::int AS count FROM auth_account_roles WHERE role = 'root'").catch(() => ({ rows: [{ count: 0 }] }));
    const accountCount = accounts.rows[0]?.count ?? 0;
    const rootCount = roots.rows[0]?.count ?? 0;

    if (!firstAccountMigration && accountCount > 0) firstAccountMigration = migration.id;
    if (!firstRootMigration && rootCount > 0) firstRootMigration = migration.id;

    if (accountCount > 0 || rootCount > 0) {
      console.log(`ROOT_FIXTURE_TRACE ${JSON.stringify({ migration: migration.id, accountCount, rootCount })}`);
    }
  }

  console.log(`ROOT_FIXTURE_ORIGIN ${JSON.stringify({ firstAccountMigration, firstRootMigration })}`);
} finally {
  await database.close();
}
