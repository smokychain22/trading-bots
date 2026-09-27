const safeCode = (value) => typeof value === 'string' && /^[A-Z0-9_]{2,64}$/.test(value)
  ? value
  : null;

const sqlState = (value) => typeof value === 'string' && /^(?=.*[0-9])[0-9A-Z]{5}$/.test(value)
  ? value
  : null;

export function classifyMigrationFailure(error) {
  const code = safeCode(error?.code);
  const message = typeof error?.message === 'string' ? error.message : '';
  if (code === 'EAI_AGAIN' || code === 'ENOTFOUND') {
    return { normalizedFailureCode: 'MIGRATION_DB_DNS_FAILURE', failureClass: 'DNS', sqlState: null, providerError: code };
  }
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(code)) {
    return { normalizedFailureCode: 'MIGRATION_DB_CONNECTION_FAILURE', failureClass: 'CONNECTION', sqlState: null, providerError: code };
  }
  if (code === 'SELF_SIGNED_CERT_IN_CHAIN' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    || /certificate|tls|ssl/i.test(message)) {
    return { normalizedFailureCode: 'MIGRATION_DB_TLS_FAILURE', failureClass: 'TLS', sqlState: null, providerError: code };
  }
  const state = sqlState(code);
  if (state === '57P03' || state?.startsWith('08')) {
    return { normalizedFailureCode: 'MIGRATION_DB_CONNECTION_FAILURE', failureClass: 'CONNECTION',
      sqlState: state, providerError: state === '57P03' ? 'POSTGRES_57P03' : null };
  }
  if (state === '53000') {
    return { normalizedFailureCode: 'MIGRATION_DB_RESOURCE_FAILURE', failureClass: 'RESOURCE',
      sqlState: state, providerError: 'POSTGRES_53000' };
  }
  if (state === '28P01') {
    return { normalizedFailureCode: 'MIGRATION_DB_AUTHENTICATION_FAILURE', failureClass: 'AUTHENTICATION',
      sqlState: state, providerError: null };
  }
  if (state) {
    return {
      normalizedFailureCode: `MIGRATION_STATEMENT_SQLSTATE_${state}`,
      failureClass: 'SQLSTATEMENT', sqlState: state, providerError: null,
    };
  }
  return {
    normalizedFailureCode: 'MIGRATION_UNKNOWN_CHILD_FAILURE',
    failureClass: 'UNKNOWN', sqlState: null, providerError: code,
  };
}

export async function observeMigrationLedger(client) {
  let result;
  try {
    result = await client.query('SELECT version FROM core.schema_migration ORDER BY version');
  } catch (error) {
    // A brand-new database has no migration ledger until the bootstrap
    // migration creates it. Preserve that supported starting state while
    // allowing every other ledger failure to remain visible.
    if (error?.code !== '42P01' && error?.code !== '3F000') throw error;
    return { migrations: [], schemaHead: null, migrationCount: 0 };
  }
  const migrations = result.rows.map((row) => String(row.version));
  return { migrations, schemaHead: migrations.at(-1) ?? null, migrationCount: migrations.length };
}

export async function runMigrationSequence({ client, files, readMigration, emit, now = () => new Date() }) {
  const initial = await observeMigrationLedger(client);
  const applied = new Set(initial.migrations);
  const receipts = [];
  for (const file of files) {
    const migrationId = file.replace(/\.sql$/, '');
    const before = await observeMigrationLedger(client);
    const startedAt = now().toISOString();
    if (applied.has(migrationId)) {
      const receipt = {
        contractVersion: 'theta-migration-child-v1', migrationId, state: 'SKIPPED_ALREADY_APPLIED',
        program: 'node', command: 'tools/database-migrate.mjs', startedAt, endedAt: now().toISOString(),
        processExitCode: 0, schemaHeadBefore: before.schemaHead, schemaHeadAfter: before.schemaHead,
        migrationLedgerChanged: false, sqlState: null, providerError: null,
        failureClass: null, normalizedFailureCode: null,
      };
      receipts.push(receipt); emit(receipt);
      continue;
    }
    emit({
      contractVersion: 'theta-migration-child-v1', migrationId, state: 'STARTED',
      program: 'node', command: 'tools/database-migrate.mjs', startedAt,
      schemaHeadBefore: before.schemaHead,
    });
    try {
      await client.query(await readMigration(file));
      const after = await observeMigrationLedger(client);
      if (!after.migrations.includes(migrationId)) {
        const error = Object.assign(new Error('MIGRATION_LEDGER_DID_NOT_ADVANCE'), { code: 'MIGRATION_LEDGER_CONFLICT' });
        throw error;
      }
      applied.add(migrationId);
      const receipt = {
        contractVersion: 'theta-migration-child-v1', migrationId, state: 'COMPLETED',
        program: 'node', command: 'tools/database-migrate.mjs', startedAt, endedAt: now().toISOString(),
        processExitCode: 0, schemaHeadBefore: before.schemaHead, schemaHeadAfter: after.schemaHead,
        migrationLedgerChanged: after.migrationCount !== before.migrationCount,
        sqlState: null, providerError: null, failureClass: null, normalizedFailureCode: null,
      };
      receipts.push(receipt); emit(receipt);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      let after = before;
      try { after = await observeMigrationLedger(client); } catch {}
      const classification = error?.code === 'MIGRATION_LEDGER_CONFLICT'
        ? { normalizedFailureCode: 'MIGRATION_LEDGER_CONFLICT', failureClass: 'LEDGER', sqlState: null, providerError: null }
        : classifyMigrationFailure(error);
      const receipt = {
        contractVersion: 'theta-migration-child-v1', migrationId, state: 'FAILED',
        program: 'node', command: 'tools/database-migrate.mjs', startedAt, endedAt: now().toISOString(),
        processExitCode: 1, schemaHeadBefore: before.schemaHead, schemaHeadAfter: after.schemaHead,
        migrationLedgerChanged: after.migrationCount !== before.migrationCount,
        ...classification,
      };
      receipts.push(receipt); emit(receipt);
      return { state: 'FAILED', initial, final: after, receipts, failure: receipt };
    }
  }
  return { state: 'MIGRATED', initial, final: await observeMigrationLedger(client), receipts, failure: null };
}
