import { Pool, type PoolClient } from 'pg';

export type LegacyRecoveryStatus =
  | 'FULLY_RECOVERED'
  | 'PARTIALLY_RECOVERED'
  | 'RECONSTRUCTED_CURRENT_STATE'
  | 'RECONSTRUCTED_SCHEMA_ONLY'
  | 'TEMPORARILY_NEON_BLOCKED'
  | 'EMPTY_BY_DESIGN'
  | 'UNKNOWN';

export interface LegacyRecoveryMatrixRow {
  readonly schema: string;
  readonly table: string;
  readonly purpose: string;
  readonly currentAivenRowCount: number;
  readonly legacyStagingRowCount: number;
  readonly sourceExpected: readonly string[];
  readonly localExportAvailable: boolean;
  readonly gitReconstructable: 'SCHEMA_ONLY' | 'NO';
  readonly brokerReconstructable: boolean;
  readonly providerReconstructable: boolean;
  readonly neonOnly: boolean;
  readonly recoveryStatus: LegacyRecoveryStatus;
}

export interface LegacyRecoveryInventoryReceipt {
  readonly state: 'INVENTORIED';
  readonly runtimeAuthority: 'AIVEN';
  readonly legacySourceAuthority: false;
  readonly generatedAt: string;
  readonly tableCount: number;
  readonly statusCounts: Readonly<Record<LegacyRecoveryStatus, number>>;
  readonly stagingFamilyCounts: Readonly<Record<string, number>>;
  readonly rows: readonly LegacyRecoveryMatrixRow[];
  readonly executionAuthorized: false;
}

interface TableCount {
  readonly schema: string;
  readonly table: string;
  readonly rowCount: number;
}

const schemaPurpose: Readonly<Record<string, string>> = {
  iam: 'customer identity and session security',
  copy: 'broker connection and follower-copy state',
  core: 'versioned platform metadata and provider contracts',
  market: 'point-in-time market and provider observations',
  strategy: 'strategy registry and decisions',
  execution: 'execution state and evidence',
  risk: 'risk limits and AEGIS state',
  analytics: 'economic and performance analytics',
  trade: 'candidate, decision, order, lifecycle, and accounting truth',
  ops: 'worker, scheduler, provider, alert, and operator evidence',
  research: 'PIT research, shadow evidence, labels, and policy evaluation',
};

const localFamilyByTable: Readonly<Record<string, string>> = {
  'trade.candidate_set': 'candidateSets',
  'trade.candidate_point_in_time_evidence': 'candidates',
  'trade.shadow_opportunity': 'shadowCandidates',
  'trade.canonical_strategy_frontier': 'strategyFrontiers',
  'research.theta_option_chain_decision_evidence': 'optionChainDecisions',
  'market.execution_quote_observation': 'executionEvidence',
  'research.theta_outcome_subject': 'outcomeSubjects',
  'research.theta_outcome_resolution_receipt': 'outcomeResolutionReceipts',
  'research.theta_outcome_label': 'wholeChainOutcomes',
  'research.theta_resolved_outcome_label': 'resolvedOutcomeLabels',
  'research.theta_position_path_checkpoint': 'positionPathCheckpoints',
  'trade.management_input_snapshot': 'managementSnapshots',
};

const brokerReconstructableTables = new Set([
  'trade.account_snapshot', 'trade.broker_activity_fact', 'trade.broker_order', 'trade.broker_order_event',
  'trade.broker_position_snapshot', 'trade.broker_reconciliation_snapshot', 'trade.fill',
  'trade.assignment_event', 'trade.expiration_event', 'trade.dividend_event',
]);

const providerReconstructableTables = new Set([
  'core.provider_capability', 'core.provider_connection', 'core.provider_operation_registry',
  'ops.provider_verification', 'market.option_contract', 'market.option_quote_snapshot',
  'market.optionomics_raw_observation', 'market.optionomics_feature_snapshot',
  'market.optionomics_feature_observation_link', 'research.optionomics_provider_qualification_receipt',
  'research.optionomics_quote_qualification_run', 'research.quote_provider_qualification_receipt',
]);

const confirmedEmptyOrderTables = new Set([
  'trade.order_intent', 'trade.broker_order', 'trade.broker_order_event', 'trade.execution_attempt',
  'trade.fill', 'trade.assignment_event', 'trade.expiration_event', 'trade.economic_chain',
  'trade.option_leg', 'trade.stock_lot', 'copy.master_copy_event', 'copy.follower_order_intent',
  'copy.follower_fill',
]);

const currentStateTables = new Set([
  'iam.customer_identity', 'copy.alpaca_oauth_token', 'copy.follower_account',
  'trade.account_snapshot', 'trade.broker_activity_fact', 'trade.broker_position_snapshot',
  'trade.broker_reconciliation_snapshot', 'ops.paper_execution_control', 'ops.runtime_worker_status',
  'ops.runtime_worker_lease', 'ops.runtime_worker_cycle', 'ops.runtime_worker_event',
]);

export function classifyLegacyRecovery(
  qualifiedTable: string,
  currentAivenRowCount: number,
  legacyStagingRowCount: number,
): LegacyRecoveryStatus {
  if (legacyStagingRowCount > 0) return 'PARTIALLY_RECOVERED';
  if (qualifiedTable === 'core.schema_migration') return 'RECONSTRUCTED_SCHEMA_ONLY';
  if (currentStateTables.has(qualifiedTable) && currentAivenRowCount > 0) return 'RECONSTRUCTED_CURRENT_STATE';
  if (confirmedEmptyOrderTables.has(qualifiedTable) && currentAivenRowCount === 0) return 'EMPTY_BY_DESIGN';
  return 'TEMPORARILY_NEON_BLOCKED';
}

export async function inventoryLegacyRecovery(connectionString: string): Promise<LegacyRecoveryInventoryReceipt> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000, idleTimeoutMillis: 1_000,
    application_name: 'theta-legacy-recovery-inventory' });
  const client = await pool.connect();
  try {
    const tables = await loadTableCounts(client);
    const familyCountsResult = await client.query(`SELECT source_family,count(*)::integer AS row_count
      FROM legacy_neon.artifact_record GROUP BY source_family ORDER BY source_family`);
    const stagingFamilyCounts = Object.fromEntries(familyCountsResult.rows.map((row) =>
      [String(row.source_family), Number(row.row_count)]));
    const rows = tables.map((item) => buildMatrixRow(item, stagingFamilyCounts));
    const statuses: LegacyRecoveryStatus[] = [
      'FULLY_RECOVERED', 'PARTIALLY_RECOVERED', 'RECONSTRUCTED_CURRENT_STATE',
      'RECONSTRUCTED_SCHEMA_ONLY', 'TEMPORARILY_NEON_BLOCKED', 'EMPTY_BY_DESIGN', 'UNKNOWN',
    ];
    const statusCounts = Object.fromEntries(statuses.map((status) =>
      [status, rows.filter((row) => row.recoveryStatus === status).length])) as Record<LegacyRecoveryStatus, number>;
    return {
      state: 'INVENTORIED', runtimeAuthority: 'AIVEN', legacySourceAuthority: false,
      generatedAt: new Date().toISOString(), tableCount: rows.length, statusCounts, stagingFamilyCounts,
      rows, executionAuthorized: false,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function loadTableCounts(client: PoolClient): Promise<readonly TableCount[]> {
  const result = await client.query(`SELECT table_schema,table_name
    FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema IN (
      'iam','copy','core','market','strategy','execution','risk','analytics','trade','ops','research'
    ) ORDER BY table_schema,table_name`);
  const counts: TableCount[] = [];
  for (const row of result.rows) {
    const schema = String(row.table_schema);
    const table = String(row.table_name);
    const countResult = await client.query(`SELECT count(*)::integer AS row_count FROM ${quoteIdent(schema)}.${quoteIdent(table)}`);
    counts.push({ schema, table, rowCount: Number(countResult.rows[0]?.row_count ?? 0) });
  }
  return counts;
}

function buildMatrixRow(
  item: TableCount,
  stagingFamilyCounts: Readonly<Record<string, number>>,
): LegacyRecoveryMatrixRow {
  const qualifiedTable = `${item.schema}.${item.table}`;
  const localFamily = localFamilyByTable[qualifiedTable];
  const legacyStagingRowCount = localFamily === undefined ? 0 : Number(stagingFamilyCounts[localFamily] ?? 0);
  const brokerReconstructable = brokerReconstructableTables.has(qualifiedTable);
  const providerReconstructable = providerReconstructableTables.has(qualifiedTable);
  const sourceExpected = [
    'NEON_LEGACY',
    ...(localFamily === undefined ? [] : ['LOCAL_RESEARCH_EXPORT']),
    ...(brokerReconstructable ? ['ALPACA_CURRENT'] : []),
    ...(providerReconstructable ? ['OPTIONOMICS_OR_PROVIDER_CURRENT'] : []),
    'GIT_SCHEMA',
  ];
  return {
    schema: item.schema,
    table: item.table,
    purpose: `${schemaPurpose[item.schema] ?? 'canonical THETA data'}: ${humanize(item.table)}`,
    currentAivenRowCount: item.rowCount,
    legacyStagingRowCount,
    sourceExpected,
    localExportAvailable: localFamily !== undefined && legacyStagingRowCount > 0,
    gitReconstructable: 'SCHEMA_ONLY',
    brokerReconstructable,
    providerReconstructable,
    neonOnly: !brokerReconstructable && !providerReconstructable && localFamily === undefined,
    recoveryStatus: classifyLegacyRecovery(qualifiedTable, item.rowCount, legacyStagingRowCount),
  };
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ');
}
