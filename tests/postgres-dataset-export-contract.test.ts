import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresDatasetExporter, researchExportSafeFailureCode } from '../src/research/postgres-dataset-export.js';

test('research export failures remain typed without exposing provider diagnostics', () => {
  assert.equal(researchExportSafeFailureCode(Object.assign(new Error('quota detail'), { code: '53000' })),
    'RESEARCH_EXPORT_POSTGRES_RESOURCE_LIMIT');
  assert.equal(researchExportSafeFailureCode(new Error('postgres://user:secret@host')),
    'RESEARCH_EXPORT_UNCLASSIFIED_FAILURE');
  assert.equal(researchExportSafeFailureCode(new Error('NO_POINT_IN_TIME_EVIDENCE_TO_EXPORT')),
    'NO_POINT_IN_TIME_EVIDENCE_TO_EXPORT');
  assert.equal(researchExportSafeFailureCode(new Error('timeout exceeded when trying to connect')),
    'RESEARCH_EXPORT_POSTGRES_CONNECTION_ACQUISITION_TIMEOUT');
});

test('latest export bounds the source to one UTC decision day instead of all history', async () => {
  const statements: string[] = [];
  const parameters: unknown[][] = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      statements.push(sql);
      parameters.push(values ?? []);
      return statements.length === 1
        ? { rows: [{ latest: new Date('2026-09-29T23:59:59.000Z') }] }
        : { rows: [{ rows: 7 }] };
    },
  } as unknown as Pool;
  assert.deepEqual(await new PostgresDatasetExporter(pool).newestEvidenceWindow(), {
    start: '2026-09-29T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z', rows: 7,
  });
  assert.match(statements[0] ?? '', /ORDER BY decision_time DESC LIMIT 1/);
  assert.deepEqual(parameters[1], ['2026-09-29T00:00:00.000Z', '2026-09-30T00:00:00.000Z']);
  assert.doesNotMatch(statements.join('\n'), /min\(decision_time\)/i);
});

test('latest export preserves no-evidence and invalid-timestamp states', async () => {
  const empty = { query: async () => ({ rows: [{ latest: null }] }) } as unknown as Pool;
  assert.equal(await new PostgresDatasetExporter(empty).newestEvidenceWindow(), null);
  const invalid = { query: async () => ({ rows: [{ latest: 'invalid' }] }) } as unknown as Pool;
  await assert.rejects(new PostgresDatasetExporter(invalid).newestEvidenceWindow(),
    /LATEST_DATASET_DECISION_TIME_INVALID/);
});

test('Production exporter emits the stable camel-case research wire contract', async () => {
  const statements: string[] = [];
  const pool = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  const artifact = await new PostgresDatasetExporter(pool).export({
    start: '2026-09-14T00:00:00.000Z', end: '2026-09-15T00:00:00.000Z',
    exportedAt: '2026-09-15T01:00:00.000Z', featureSetVersion: 'feature-v1',
  });
  const sql = statements.join('\n');
  assert.match(sql, /contract_json AS contract/);
  assert.match(sql, /market_json AS market/);
  assert.match(sql, /volatility_json AS volatility/);
  assert.match(sql, /decision_authority_version AS "decisionAuthorityVersion"/);
  assert.match(sql, /canonical_strategy_branch_evidence branch_evidence/);
  assert.match(sql, /canonical_strategy_candidate_evidence candidate_evidence/);
  assert.match(sql, /jsonb_array_elements\(COALESCE\(frontier_json->'branches'/);
  assert.match(sql, /so\.outcome AS "decisionDisposition"/);
  assert.match(sql, /theta_shadow_management_policy_evidence shadow_policy/);
  assert.match(sql, /theta_option_chain_decision_evidence/);
  assert.doesNotMatch(sql, /so\.outcome,so\.wait_reason/);
  assert.match(sql, /quote_observation_id AS "quoteObservationId"/);
  assert.equal(artifact.schemaVersion, 'theta-r6-dataset-v6');
  assert.equal(artifact.rowCounts.resolvedOutcomeLabels, 0);
  assert.equal(artifact.rowCounts.optionChainDecisions, 0);
  assert.equal(artifact.rowCounts.candidates, 0);
  assert.equal(artifact.rowCounts.policyLearningRecords, 0);
  assert.equal(artifact.rowCounts.positionPathCheckpoints, 0);
  assert.equal(artifact.rowCounts.entryChainLinks, 0);
  assert.match(sql, /EXPLICIT_CSP_ENTRY_LEDGER_JOIN_V1/);
  assert.match(sql, /cp\.candidate_id=d\.selected_candidate_id/);
  assert.match(sql, /cp\.decision_id=d\.decision_id/);
  assert.match(sql, /ol\.rolled_from_option_leg_id IS NULL/);
  assert.match(sql, /prior\.opened_at<=ol\.opened_at/);
  assert.match(sql, /theta_position_path_checkpoint/);
  assert.match(sql, /theta_policy_learning_record/);
  assert.match(artifact.datasetHash, /^[0-9a-f]{64}$/);
});

test('research export holds at most two database queries in flight across its 18-read fanout', async () => {
  let inFlight = 0;
  let maximumInFlight = 0;
  let completed = 0;
  const pool = {
    query: async () => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 3));
        completed += 1;
        return { rows: [], rowCount: 0 };
      } finally { inFlight -= 1; }
    },
  } as unknown as Pool;
  const timings: Array<{ relation:string; rows:number; outcome:string }> = [];
  await new PostgresDatasetExporter(pool,(timing)=>timings.push(timing)).export({
    start: '2026-09-14T00:00:00.000Z', end: '2026-09-15T00:00:00.000Z',
    exportedAt: '2026-09-15T01:00:00.000Z', featureSetVersion: 'feature-v1',
  });
  assert.equal(maximumInFlight, 2);
  assert.equal(inFlight, 0);
  assert.equal(completed, 19);
  assert.equal(timings.length, 19);
  assert.ok(timings.every((timing)=>timing.outcome==='OK'&&timing.rows===0));
  assert.ok(timings.some((timing)=>timing.relation==='research.theta_dataset_export'));
});

test('research export timing observer failure cannot turn valid evidence into a failed export', async () => {
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Pool;
  const artifact = await new PostgresDatasetExporter(pool, () => { throw new Error('LOG_SINK_DOWN'); }).export({
    start: '2026-09-14T00:00:00.000Z', end: '2026-09-15T00:00:00.000Z',
    exportedAt: '2026-09-15T01:00:00.000Z', featureSetVersion: 'feature-v1',
  });
  assert.match(artifact.datasetHash, /^[0-9a-f]{64}$/);
});
