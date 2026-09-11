import { PGlite } from "@electric-sql/pglite";

const database = await PGlite.create();
try {
  const result = await database.query(
    `SELECT CURRENT_TIMESTAMP AS now_value,
            CURRENT_TIMESTAMP + INTERVAL '2 hours' AS future_value`
  );
  const row = result.rows[0];
  if (!row) throw new Error("PGlite timestamp diagnostic returned no row.");

  const summarize = (value) => ({
    type: typeof value,
    constructor: value?.constructor?.name ?? null,
    text: String(value),
    isoIfDate: value instanceof Date ? value.toISOString() : null
  });

  console.log(
    `PGLITE_TIMESTAMP_SHAPE ${JSON.stringify({
      now: summarize(row.now_value),
      future: summarize(row.future_value)
    })}`
  );
} finally {
  await database.close();
}
