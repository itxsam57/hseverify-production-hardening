import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";

import {
  ensurePgliteDataDirectoryParent,
  normalizePgliteDataDirectory
} from "../../src/lib/database/pglite-path.mjs";
import { readProjectEnvironment } from "./environment.mjs";

function wrapPglite(executor) {
  return {
    async query(statement, parameters = []) {
      const result = await executor.query(statement, parameters);
      return {
        rows: result.rows,
        affectedRows: result.affectedRows ?? 0
      };
    },
    async execute(statement) {
      await executor.exec(statement);
    }
  };
}

function wrapPostgres(executor) {
  return {
    async query(statement, parameters = []) {
      const result = await executor.unsafe(statement, parameters);
      return {
        rows: Array.from(result),
        affectedRows: typeof result.count === "number" ? result.count : result.length
      };
    },
    async execute(statement) {
      await executor.unsafe(statement);
    }
  };
}

function wrapNestedTransactionClient(client) {
  const nested = {
    ...client,
    async transaction(callback) {
      return callback(nested);
    },
    async close() {
      // The outer test database transaction owns the connection.
    }
  };
  return nested;
}

export async function openScriptDatabase(environment = readProjectEnvironment()) {
  if (environment.databaseDriver === "pglite") {
    const configuredDataDirectory = environment.pgliteDataDir ?? "memory://";
    const dataDirectory = normalizePgliteDataDirectory(configuredDataDirectory);
    await ensurePgliteDataDirectoryParent(dataDirectory);
    const database = await PGlite.create(dataDirectory);
    const client = wrapPglite(database);
    return {
      ...client,
      driver: "pglite",
      dataDirectory,
      async transaction(callback) {
        return database.transaction(async (transaction) =>
          callback(wrapNestedTransactionClient(wrapPglite(transaction)))
        );
      },
      // In-process PGlite is single-connection; the transaction boundary below
      // already serializes its operations.
      async withMigrationLock(operation) {
        return operation();
      },
      async close() {
        await database.close();
      }
    };
  }

  const sql = postgres(environment.databaseUrl, {
    max: 2,
    idle_timeout: 10,
    connect_timeout: 10,
    // Query parameters already encode JSON; preserve text for inferred json/jsonb OIDs.
    types: {
      json: {
        to: 114,
        from: [114, 3802],
        serialize: (value) => typeof value === "string" ? value : JSON.stringify(value),
        parse: JSON.parse
      }
    },
    prepare: false
  });
  const client = wrapPostgres(sql);
  return {
    ...client,
    driver: "postgres",
    dataDirectory: null,
    // Reserve one dedicated PostgreSQL connection for a session advisory lock,
    // while migrations use the second pool connection and retain their
    // individual transactions. This also serializes the very first
    // CREATE TABLE IF NOT EXISTS hse_schema_migrations across deploy processes.
    async withMigrationLock(operation) {
      const lock = await sql.reserve();
      let acquired = false;
      try {
        await lock.unsafe("SELECT pg_advisory_lock(1213418033, 10102)");
        acquired = true;
        return await operation();
      } finally {
        try {
          if (acquired) {
            const result = await lock.unsafe(
              "SELECT pg_advisory_unlock(1213418033, 10102) AS unlocked"
            );
            if (result[0]?.unlocked !== true) {
              throw new Error("Migration advisory lock release failed.");
            }
          }
        } finally {
          lock.release();
        }
      }
    },
    async transaction(callback) {
      return sql.begin(async (transaction) =>
        callback(wrapNestedTransactionClient(wrapPostgres(transaction)))
      );
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
