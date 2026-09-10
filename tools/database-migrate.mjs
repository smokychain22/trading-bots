import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_MIGRATION_URL
  ?? process.env.DATABASE_URL_UNPOOLED
  ?? process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) throw new Error("DATABASE_MIGRATION_CONNECTION_NOT_CONFIGURED");

const directory = resolve("migrations");
const files = (await readdir(directory))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .sort();

if (files.length === 0) throw new Error("NO_MIGRATIONS_FOUND");

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock($1)", [863_801_009]);
  for (const file of files) {
    await client.query(await readFile(resolve(directory, file), "utf8"));
    process.stdout.write(`applied ${file}\n`);
  }
  const history = await client.query(
    "SELECT version FROM core.schema_migration ORDER BY version",
  );
  const tables = await client.query(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('iam','copy','core','market','strategy','execution','risk','analytics')",
  );
  process.stdout.write(JSON.stringify({
    state: "MIGRATED",
    migrationCount: history.rowCount,
    migrations: history.rows.map((row) => row.version),
    canonicalTableCount: tables.rows[0]?.count ?? 0,
  }) + "\n");
} finally {
  try { await client.query("SELECT pg_advisory_unlock($1)", [863_801_009]); } catch {}
  await client.end();
}

