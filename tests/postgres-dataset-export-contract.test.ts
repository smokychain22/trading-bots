import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresDatasetExporter } from '../src/research/postgres-dataset-export.js';

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
  assert.match(sql, /so\.outcome AS "decisionDisposition"/);
  assert.match(sql, /theta_shadow_management_policy_evidence shadow_policy/);
  assert.match(sql, /theta_option_chain_decision_evidence/);
  assert.doesNotMatch(sql, /so\.outcome,so\.wait_reason/);
  assert.match(sql, /quote_observation_id AS "quoteObservationId"/);
  assert.equal(artifact.schemaVersion, 'theta-r6-dataset-v3');
  assert.equal(artifact.rowCounts.optionChainDecisions, 0);
  assert.equal(artifact.rowCounts.candidates, 0);
  assert.match(artifact.datasetHash, /^[0-9a-f]{64}$/);
});
