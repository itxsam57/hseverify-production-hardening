import "server-only";

import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";

import { getServerEnvironment } from "@/lib/config/server-environment";
import {
  ensurePgliteDataDirectoryParent,
  normalizePgliteDataDirectory
} from "@/lib/database/pglite-path.mjs";

export type DatabaseQueryResult<T> = {
  rows: T[];
  affectedRows: number;
};

export interface DatabaseClient {
  query<T>(
    statement: string,
    parameters?: readonly unknown[]
  ): Promise<DatabaseQueryResult<T>>;
  execute(statement: string): Promise<void>;
  transaction<T>(
    operation: (client: DatabaseClient) => Promise<T>
  ): Promise<T>;
  close(): Promise<void>;
}

type PGliteExecutor = Pick<PGlite, "query" | "exec">;

class PGliteDatabaseClient implements DatabaseClient {
  constructor(
    private readonly database: PGliteExecutor,
    private readonly owner: PGlite | null
  ) {}

  async query<T>(
    statement: string,
    parameters: readonly unknown[] = []
  ): Promise<DatabaseQueryResult<T>> {
    const result = await this.database.query<T>(statement, [...parameters]);
    return {
      rows: result.rows,
      affectedRows: result.affectedRows ?? 0
    };
  }

  async execute(statement: string): Promise<void> {
    await this.database.exec(statement);
  }

  async transaction<T>(
    operation: (client: DatabaseClient) => Promise<T>
  ): Promise<T> {
    if (!this.owner) {
      return operation(this);
    }
    return this.owner.transaction(async (transaction) =>
      operation(new PGliteDatabaseClient(transaction, null))
    );
  }

  async close(): Promise<void> {
    if (this.owner) {
      await this.owner.close();
    }
  }
}

type PostgresSql = ReturnType<typeof postgres>;
type PostgresExecutor = Pick<PostgresSql, "unsafe">;

class PostgresTransactionClient implements DatabaseClient {
  constructor(private readonly sql: PostgresExecutor) {}

  async query<T>(
    statement: string,
    parameters: readonly unknown[] = []
  ): Promise<DatabaseQueryResult<T>> {
    const result = await this.sql.unsafe(
      statement,
      [...parameters] as never[]
    );
    const count = (result as unknown as { count?: number }).count;
    return {
      rows: Array.from(result) as T[],
      affectedRows: typeof count === "number" ? count : result.length
    };
  }

  async execute(statement: string): Promise<void> {
    await this.sql.unsafe(statement);
  }

  async transaction<T>(
    operation: (client: DatabaseClient) => Promise<T>
  ): Promise<T> {
    return operation(this);
  }

  async close(): Promise<void> {
    // The parent transaction owns this connection.
  }
}

class PostgresDatabaseClient implements DatabaseClient {
  private readonly sql: PostgresSql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false
    });
  }

  async query<T>(
    statement: string,
    parameters: readonly unknown[] = []
  ): Promise<DatabaseQueryResult<T>> {
    const result = await this.sql.unsafe(
      statement,
      [...parameters] as never[]
    );
    const count = (result as unknown as { count?: number }).count;
    return {
      rows: Array.from(result) as T[],
      affectedRows: typeof count === "number" ? count : result.length
    };
  }

  async execute(statement: string): Promise<void> {
    await this.sql.unsafe(statement);
  }

  async transaction<T>(
    operation: (client: DatabaseClient) => Promise<T>
  ): Promise<T> {
    return this.sql.begin(async (transaction) =>
      operation(
        new PostgresTransactionClient(
          transaction as unknown as PostgresExecutor
        )
      )
    ) as Promise<T>;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

async function createDatabaseClient(): Promise<DatabaseClient> {
  const environment = getServerEnvironment();
  if (environment.databaseDriver === "postgres") {
    if (!environment.databaseUrl) {
      throw new Error(
        "Validated PostgreSQL configuration is missing DATABASE_URL."
      );
    }
    return new PostgresDatabaseClient(environment.databaseUrl);
  }

  const configuredDataDirectory = environment.pgliteDataDir ?? "memory://";
  const dataDirectory = normalizePgliteDataDirectory(configuredDataDirectory);
  await ensurePgliteDataDirectoryParent(dataDirectory);
  const database = await PGlite.create(dataDirectory);

  return new PGliteDatabaseClient(database, database);
}

declare global {
  var __hseDatabaseClient: Promise<DatabaseClient> | undefined;
}

export function getDatabaseClient(): Promise<DatabaseClient> {
  globalThis.__hseDatabaseClient ??= createDatabaseClient();
  return globalThis.__hseDatabaseClient;
}
