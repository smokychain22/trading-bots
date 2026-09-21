import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

export interface DatabaseTargetValidationReceipt {
  readonly state: 'VALIDATED';
  readonly invariantFileCount: number;
  readonly psqlOnlyInvariantFileCount: number;
  readonly migrationCount: number;
  readonly migrationHead: string;
  readonly schemaCount: number;
  readonly tableCount: number;
  readonly viewCount: number;
  readonly functionCount: number;
  readonly triggerCount: number;
  readonly indexCount: number;
  readonly sequenceCount: number;
  readonly databaseSizeBytes: number;
  readonly invalidIndexCount: number;
  readonly unvalidatedConstraintCount: number;
  readonly schemaFingerprint: string;
  readonly criticalRowCounts: Readonly<Record<string, number>>;
  readonly legacyParentCoverage: {
    readonly referencedFusionSnapshots: number;
    readonly fusionSnapshotsPresentInAiven: number;
    readonly referencedDecisions: number;
    readonly decisionsPresentInAiven: number;
  };
  readonly executionControl: {
    readonly pauseNewOrders: boolean;
    readonly masterExecutionEnabled: boolean;
    readonly followerExecutionEnabled: boolean;
  };
  readonly maxConnections: number;
  readonly clientConnectionsAtProbe: number;
  readonly nonIdleClientConnectionsAtProbe: number;
}

export async function validateDatabaseTarget(
  connectionString: string,
  invariantDirectory = resolve(process.cwd(), 'tests', 'sql'),
): Promise<DatabaseTargetValidationReceipt> {
  const allFiles = (await readdir(invariantDirectory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (allFiles.length === 0) throw codedError('NO_BUNDLED_INVARIANTS');
  const loaded = await Promise.all(allFiles.map(async (file) => ({
    file,
    sql: await readFile(resolve(invariantDirectory, file), 'utf8'),
  })));
  const protocolSafe = loaded.filter(({ sql }) => !/^\\/m.test(sql));
  const psqlOnlyInvariantFileCount = loaded.length - protocolSafe.length;

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 1_000,
    application_name: 'theta-aiven-canonical-validation',
  });
  const client = await pool.connect();
  try {
    for (const { file, sql } of protocolSafe) {
      await client.query('BEGIN');
      try {
        const rollbackWrappedSql = sql
          .replace(/^\s*BEGIN;\s*/i, '')
          .replace(/\s*ROLLBACK;\s*$/i, '');
        await client.query(rollbackWrappedSql);
        await client.query('ROLLBACK');
      } catch {
        try { await client.query('ROLLBACK'); } catch { /* rollback best effort */ }
        throw codedError(`INV_${file.slice(0, 3)}_FAILED`);
      }
    }

    const summary = await client.query(`SELECT
      (SELECT count(*)::integer FROM core.schema_migration) AS migration_count,
      (SELECT version FROM core.schema_migration ORDER BY version DESC LIMIT 1) AS migration_head,
      (SELECT count(*)::integer FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog','information_schema')) AS schema_count,
      (SELECT count(*)::integer FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog','information_schema')) AS table_count,
      (SELECT count(*)::integer FROM information_schema.views
        WHERE table_schema NOT IN ('pg_catalog','information_schema')) AS view_count,
      (SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog','information_schema')) AS function_count,
      (SELECT count(*)::integer FROM information_schema.triggers
        WHERE trigger_schema NOT IN ('pg_catalog','information_schema')) AS trigger_count,
      (SELECT count(*)::integer FROM pg_indexes
        WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS index_count,
      (SELECT count(*)::integer FROM information_schema.sequences
        WHERE sequence_schema NOT IN ('pg_catalog','information_schema')) AS sequence_count,
      (SELECT count(*)::integer FROM pg_index WHERE NOT indisvalid) AS invalid_index_count,
      (SELECT count(*)::integer FROM pg_constraint WHERE NOT convalidated) AS unvalidated_constraint_count,
      pg_database_size(current_database())::bigint AS database_size_bytes,
      current_setting('max_connections')::integer AS max_connections,
      (SELECT count(*)::integer FROM pg_stat_activity WHERE backend_type='client backend') AS client_connections,
      (SELECT count(*)::integer FROM pg_stat_activity
        WHERE backend_type='client backend' AND state<>'idle') AS non_idle_client_connections`);
    const fingerprintRows = await client.query(`SELECT table_schema,table_name,column_name,ordinal_position,
      data_type,is_nullable,column_default FROM information_schema.columns
      WHERE table_schema IN ('iam','copy','core','market','strategy','execution','risk','analytics',
        'trade','ops','research','legacy_neon')
      ORDER BY table_schema,table_name,ordinal_position`);
    const schemaFingerprint = createHash('sha256').update(JSON.stringify(fingerprintRows.rows)).digest('hex');
    const counts = await client.query(`SELECT
      (SELECT count(*)::integer FROM iam.customer_identity) AS customer_identities,
      (SELECT count(*)::integer FROM copy.alpaca_oauth_token) AS encrypted_broker_credentials,
      (SELECT count(*)::integer FROM copy.follower_account) AS broker_accounts,
      (SELECT count(*)::integer FROM copy.follower_account WHERE account_role='MASTER_THETA_PAPER') AS master_accounts,
      (SELECT count(*)::integer FROM trade.order_intent) AS order_intents,
      (SELECT count(*)::integer FROM trade.broker_order) AS broker_orders,
      (SELECT count(*)::integer FROM trade.fill) AS fills,
      (SELECT count(*)::integer FROM trade.broker_activity_fact) AS broker_activity_facts,
      (SELECT count(*)::integer FROM market.optionomics_raw_observation) AS optionomics_raw_observations,
      (SELECT count(*)::integer FROM market.optionomics_event_first_observation) AS optionomics_event_revisions,
      (SELECT count(*)::integer FROM research.optionomics_capability_qualification_receipt)
        AS optionomics_capability_receipts,
      (SELECT count(*)::integer FROM trade.candidate_point_in_time_evidence
        WHERE jsonb_typeof(volatility_json->'iv')='number') AS candidate_iv_observations,
      (SELECT count(*)::integer FROM market.execution_quote_observation
        WHERE observation_role='DECISION' AND bid IS NOT NULL AND ask IS NOT NULL) AS decision_two_sided_quote_observations,
      (SELECT count(*)::integer FROM research.option_contract_risk_history) AS option_contract_risk_history_rows,
      (SELECT count(*)::integer FROM legacy_neon.import_batch) AS legacy_import_batches,
      (SELECT count(*)::integer FROM legacy_neon.artifact_record) AS legacy_artifact_records,
      (SELECT count(*)::integer FROM legacy_neon.promotion_batch) AS legacy_promotion_batches,
      (SELECT count(*)::integer FROM legacy_neon.promotion_record) AS legacy_promotion_records,
      (SELECT count(*)::integer FROM research.legacy_neon_recovered_evidence) AS legacy_promoted_research_rows,
      (SELECT count(*)::integer FROM legacy_neon.reconstruction_sweep) AS legacy_reconstruction_sweeps,
      (SELECT count(*)::integer FROM legacy_neon.reconstruction_source) AS legacy_reconstruction_sources,
      (SELECT count(*)::integer FROM legacy_neon.family_recovery_assessment) AS legacy_family_assessments,
      (SELECT count(*)::integer FROM legacy_neon.local_forensic_sweep) AS local_forensic_sweeps,
      (SELECT count(*)::integer FROM legacy_neon.local_forensic_source) AS local_forensic_sources,
      (SELECT count(*)::integer FROM legacy_neon.research_export_variant) AS research_export_variants,
      (SELECT count(*)::integer FROM legacy_neon.missing_record_forensic_search) AS missing_record_searches`);
    const parentCoverage = await client.query(`WITH
      fusion_refs AS (
        SELECT DISTINCT payload->>'fusionSnapshotId' AS id
        FROM research.legacy_neon_recovered_evidence
        WHERE payload ? 'fusionSnapshotId' AND NULLIF(payload->>'fusionSnapshotId','') IS NOT NULL
      ),
      decision_refs AS (
        SELECT DISTINCT payload->>'decisionId' AS id
        FROM research.legacy_neon_recovered_evidence
        WHERE payload ? 'decisionId' AND NULLIF(payload->>'decisionId','') IS NOT NULL
      )
      SELECT
        (SELECT count(*)::integer FROM fusion_refs) AS referenced_fusion_snapshots,
        (SELECT count(*)::integer FROM fusion_refs r JOIN trade.fusion_snapshot f ON f.fusion_snapshot_id::text=r.id)
          AS fusion_snapshots_present,
        (SELECT count(*)::integer FROM decision_refs) AS referenced_decisions,
        (SELECT count(*)::integer FROM decision_refs r JOIN trade.decision d ON d.decision_id::text=r.id)
          AS decisions_present`);
    const control = await client.query(`SELECT pause_new_orders,master_execution_enabled,follower_execution_enabled,authorization_event_id
      FROM ops.paper_execution_control WHERE singleton=true`);
    const row = summary.rows[0];
    const controlRow = control.rows[0];
    const locked=controlRow?.pause_new_orders===true&&controlRow?.master_execution_enabled===false
      &&controlRow?.follower_execution_enabled===false;
    const ownerAuthorized=controlRow?.master_execution_enabled===true&&controlRow?.follower_execution_enabled===false
      &&typeof controlRow?.authorization_event_id==='string';
    if (!locked&&!ownerAuthorized) throw codedError('PAPER_EXECUTION_AUTHORIZATION_INVALID');
    return {
      state: 'VALIDATED',
      invariantFileCount: protocolSafe.length,
      psqlOnlyInvariantFileCount,
      migrationCount: Number(row.migration_count),
      migrationHead: String(row.migration_head),
      schemaCount: Number(row.schema_count),
      tableCount: Number(row.table_count),
      viewCount: Number(row.view_count),
      functionCount: Number(row.function_count),
      triggerCount: Number(row.trigger_count),
      indexCount: Number(row.index_count),
      sequenceCount: Number(row.sequence_count),
      databaseSizeBytes: Number(row.database_size_bytes),
      invalidIndexCount: Number(row.invalid_index_count),
      unvalidatedConstraintCount: Number(row.unvalidated_constraint_count),
      schemaFingerprint,
      criticalRowCounts: Object.fromEntries(Object.entries(counts.rows[0]).map(([key, value]) => [key, Number(value)])),
      legacyParentCoverage: {
        referencedFusionSnapshots:Number(parentCoverage.rows[0].referenced_fusion_snapshots),
        fusionSnapshotsPresentInAiven:Number(parentCoverage.rows[0].fusion_snapshots_present),
        referencedDecisions:Number(parentCoverage.rows[0].referenced_decisions),
        decisionsPresentInAiven:Number(parentCoverage.rows[0].decisions_present),
      },
      executionControl: {
        pauseNewOrders: controlRow.pause_new_orders === true,
        masterExecutionEnabled: controlRow.master_execution_enabled === true,
        followerExecutionEnabled: controlRow.follower_execution_enabled === true,
      },
      maxConnections: Number(row.max_connections),
      clientConnectionsAtProbe: Number(row.client_connections),
      nonIdleClientConnectionsAtProbe: Number(row.non_idle_client_connections),
    };
  } finally {
    client.release();
    await pool.end();
  }
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
