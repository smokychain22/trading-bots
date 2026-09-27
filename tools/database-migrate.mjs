import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseConnection } from "./database-connection.mjs";
import { classifyMigrationFailure, runMigrationSequence } from "./database-migration-runner.mjs";

const emit = (receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`);
const processStartedAt = new Date().toISOString();
let client = null;
try {
  const { connectionString, authority } = resolveDatabaseConnection(process.env, "migration");
  if (authority === "AIVEN" && process.env.THETA_MIGRATION_CHECKPOINT_ACTIVE !== "VERIFIED_LOCAL_BACKUP") {
    const error = Object.assign(new Error("AIVEN_PRODUCTION_MIGRATION_REQUIRES_VERIFIED_LOCAL_BACKUP_WORKFLOW"),
      { code: "MIGRATION_CHECKPOINT_REQUIRED" });
    throw error;
  }
  const directory = resolve("migrations");
  const files = (await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (files.length === 0) throw Object.assign(new Error("NO_MIGRATIONS_FOUND"), { code: "NO_MIGRATIONS_FOUND" });
  client = new pg.Client({ connectionString });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [863_801_009]);
  const result = await runMigrationSequence({
    client, files, readMigration: (file) => readFile(resolve(directory, file), "utf8"), emit,
  });
  if (result.state === 'FAILED') {
    process.exitCode = 1;
  } else {
    const tables = await client.query(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('iam','copy','core','market','strategy','execution','risk','analytics')",
    );
    emit({ contractVersion: 'theta-migration-run-v1', state: 'MIGRATED',
      migrationCount: result.final.migrationCount, migrations: result.final.migrations,
      canonicalTableCount: tables.rows[0]?.count ?? 0 });
  }
} catch (error) {
  const classification = error?.code === 'MIGRATION_CHECKPOINT_REQUIRED'
    ? { normalizedFailureCode: 'MIGRATION_CHECKPOINT_REQUIRED', failureClass: 'POLICY', sqlState: null, providerError: null }
    : error?.code === 'NO_MIGRATIONS_FOUND'
      ? { normalizedFailureCode: 'NO_MIGRATIONS_FOUND', failureClass: 'SOURCE', sqlState: null, providerError: null }
      : classifyMigrationFailure(error);
  emit({ contractVersion: 'theta-migration-child-v1', migrationId: 'MIGRATION_PROCESS', state: 'FAILED',
    program: 'node', command: 'tools/database-migrate.mjs', startedAt: processStartedAt, endedAt: new Date().toISOString(),
    processExitCode: 1, schemaHeadBefore: null, schemaHeadAfter: null, migrationLedgerChanged: false,
    ...classification });
  process.exitCode = 1;
} finally {
  if (client) {
    try { await client.query("SELECT pg_advisory_unlock($1)", [863_801_009]); } catch {}
    try { await client.end(); } catch {}
  }
}
