import pg from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { loadAlpacaContractIvHistory, paperBootstrapAlpacaContractIvPolicy } from '../src/theta/aegis-alpaca-iv-stress.js';
import { loadAegisSpreadHistory, paperBootstrapAegisSpreadStressPolicy,
  spreadDteBucket, spreadMoneynessBucket } from '../src/theta/aegis-spread-stress.js';

// Read-only, bounded evidence census. No contract/account identifiers, quotes,
// credentials, or connection errors are emitted. The protected runtime owns
// the actual assessment and Paper gate, this is an operator diagnostic.
const environment = loadEnvironmentFile('.env.local');
if (!environment.AIVEN_DATABASE_URL || environment.AIVEN_DATABASE_URL === '[SENSITIVE]') {
  process.stdout.write(`${JSON.stringify({ state: 'DATABASE_CREDENTIAL_UNAVAILABLE' })}\n`);
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: environment.AIVEN_DATABASE_URL,
  max: 1, connectionTimeoutMillis: 5000,
  options: '-c default_transaction_read_only=on -c statement_timeout=5000',
  application_name: 'theta-aegis-schema064-census' });
try {
  const asOf = new Date().toISOString();
  const jsonPathProbe = await pool.query(`SELECT '{"riskState":{"alpacaContractIvStress":{"assessmentsByContract":{"TEST":{"ok":true}}}}}'::jsonb
    #> ARRAY['riskState','alpacaContractIvStress','assessmentsByContract',$1::text] AS assessment`, ['TEST']);
  if ((jsonPathProbe.rows[0] as { assessment?: { ok?: boolean } } | undefined)?.assessment?.ok !== true)
    throw new Error('PERSISTED_IV_JSON_PATH_PROBE_FAILED');
  if (process.argv.includes('--path-probe-only')) {
    process.stdout.write(`${JSON.stringify({ state: 'PASS', persistedIvJsonPathSql: 'PASS' })}\n`);
  } else {
  const inventory = await pool.query(`SELECT
    (SELECT count(*)::int FROM trade.candidate_point_in_time_evidence) AS candidate_rows,
    (SELECT count(*)::int FROM research.option_contract_risk_history) AS risk_history_rows,
    (SELECT max(decision_time) FROM trade.candidate_point_in_time_evidence) AS latest_candidate_at,
    (SELECT max(decision_time) FROM research.option_contract_risk_history) AS latest_risk_at`);
  const schemaRow = inventory.rows[0] as Record<string, unknown>;
  const sample = await pool.query(`SELECT branch,contract_json->>'underlying' AS underlying,
    contract_json->>'contractSymbol' AS contract_symbol,
    jsonb_object_keys(contract_json) AS contract_key
    FROM trade.candidate_point_in_time_evidence
    ORDER BY decision_time DESC LIMIT 12`);
  const cohort = await pool.query(`SELECT contract_json->>'underlying' AS underlying,count(*)::int AS rows
    FROM trade.candidate_point_in_time_evidence
    WHERE decision_time >= ($1::timestamptz - interval '7 days')
    GROUP BY contract_json->>'underlying' ORDER BY count(*) DESC LIMIT 2`, [asOf]);
  const outputs = [];
  for (const underlying of cohort.rows.map((row) => String(row.underlying)).filter((value) => /^[A-Z.]{1,10}$/.test(value))) {
    const iv = await loadAlpacaContractIvHistory({ pool, underlying, decisionAsOf: asOf,
      lookbackDays: paperBootstrapAlpacaContractIvPolicy.lookbackDays });
    const spread = await loadAegisSpreadHistory({ pool, underlying, optionType: 'PUT',
      decisionAsOf: asOf, lookbackDays: paperBootstrapAegisSpreadStressPolicy.lookbackDays });
    const spreadCohorts = new Map<string, { rawN: number; sessions: Set<string> }>();
    for (const row of spread) {
      const bucket = spreadMoneynessBucket(row.moneyness);
      if (bucket === null) continue;
      const key = `${row.feed}:${spreadDteBucket(row.dte)}:${bucket}`;
      const entry = spreadCohorts.get(key) ?? { rawN: 0, sessions: new Set<string>() };
      entry.rawN += 1;
      entry.sessions.add(row.providerTimestamp.slice(0, 10));
      spreadCohorts.set(key, entry);
    }
    outputs.push({ underlying, alpacaIvSourceProvenRows: iv.observations.length,
      legacyIvSourceUnprovenRows: iv.sourceUnprovenN,
      alpacaIvSessionN: new Set(iv.observations.map((row) => row.quoteTimestamp.slice(0, 10))).size,
      spreadCohorts: [...spreadCohorts].sort(([a], [b]) => a.localeCompare(b)).map(([cohort, entry]) => ({
        cohort, rawN: entry.rawN, sessionN: entry.sessions.size, effectiveNUpperBound: entry.sessions.size,
      })) });
  }
  process.stdout.write(`${JSON.stringify({ state: 'PASS', asOf, schema: '064_COMPATIBLE',
    persistedIvJsonPathSql: 'PASS',
    inventory: { candidateRows: schemaRow.candidate_rows, riskHistoryRows: schemaRow.risk_history_rows,
      latestCandidateAt: schemaRow.latest_candidate_at, latestRiskAt: schemaRow.latest_risk_at,
      recentBranches: [...new Set(sample.rows.map((row) => row.branch))],
      recentUnderlyings: [...new Set(sample.rows.map((row) => row.underlying))],
      recentContractKeys: [...new Set(sample.rows.map((row) => row.contract_key))] }, outputs })}\n`);
  }
} catch (error) {
  const code = error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code)
    ? error.code : 'UNCLASSIFIED_READ_FAILURE';
  process.stdout.write(`${JSON.stringify({ state: 'READ_FAILED', errorCode: code })}\n`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
