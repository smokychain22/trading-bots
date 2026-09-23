import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { fetchMarketCalendar } from '../src/theta/alpaca-provider.js';
import { summarizeAegisBaselineProgress } from '../src/theta/aegis-baseline-progress.js';
import { loadAlpacaContractIvHistory, paperBootstrapAlpacaContractIvPolicy } from '../src/theta/aegis-alpaca-iv-stress.js';
import { assessNextSessionHistoryEligibility, type NextSessionCohort } from '../src/theta/aegis-next-session-eligibility.js';
import { loadAegisSpreadHistory, paperBootstrapAegisSpreadStressPolicy } from '../src/theta/aegis-spread-stress.js';
import { safeRuntimeFailure } from '../src/theta/autonomous-runtime.js';

const environmentFile = process.argv.find((arg) => arg.startsWith('--environment-file='))
  ?.slice('--environment-file='.length);
if (!environmentFile) throw new Error('EXPLICIT_ENVIRONMENT_FILE_REQUIRED');
const environment = loadEnvironmentFile(environmentFile);
if (environment.MASTER_PAPER_EXECUTION_ENABLED || environment.FOLLOWER_PAPER_EXECUTION_ENABLED
  || !environment.PAPER_PAUSE_NEW_ORDERS) throw new Error('READ_ONLY_SAFETY_FLAGS_REQUIRED');
if (!environment.DATABASE_URL || !environment.ALPACA_API_KEY || !environment.ALPACA_SECRET_KEY
  || environment.ALPACA_BASE_URL !== 'https://paper-api.alpaca.markets')
  throw new Error('PAPER_READ_CONFIG_UNAVAILABLE');
const today = new Date().toISOString().slice(0, 10);
const end = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000,
  options: '-c statement_timeout=5000', application_name: 'theta-aegis-next-session-read-only' });
pool.on('error', () => { process.exitCode = 1; });
let stage = 'ALPACA_CALENDAR';
try {
  const calendar = await fetchMarketCalendar({ tradingApiBase: environment.ALPACA_BASE_URL,
    marketDataApiBase: 'https://data.alpaca.markets', apiKey: environment.ALPACA_API_KEY,
    apiSecret: environment.ALPACA_SECRET_KEY }, today, end);
  const nextSession = calendar.map((item) => item.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && date > today).sort()[0];
  if (!nextSession) throw new Error('NEXT_ALPACA_SESSION_UNAVAILABLE');
  const decisionAsOf = `${nextSession}T00:00:00.000Z`;
  stage = 'LATEST_FUSION_SNAPSHOT';
  const result = await pool.query(`SELECT decision_time,snapshot_json->'riskState' AS risk_state,
    snapshot_json->'regimeState' AS regime_state FROM trade.fusion_snapshot
    ORDER BY decision_time DESC LIMIT 1`);
  const row = result.rows[0];
  const progress = summarizeAegisBaselineProgress({ decisionAsOf: row?.decision_time instanceof Date
    ? row.decision_time.toISOString() : null, riskState: row?.risk_state ?? null,
  regimeState: row?.regime_state ?? null });
  const cohorts = new Map<string, NextSessionCohort>();
  for (const item of progress.cohorts) {
    if ((item.optionType !== 'PUT' && item.optionType !== 'CALL')
      || (item.feed !== 'OPRA' && item.feed !== 'INDICATIVE')
      || item.dteBucket === null || item.moneynessBucket === null) continue;
    const cohort: NextSessionCohort = { underlying: item.underlying, optionType: item.optionType,
      feed: item.feed, dteBucket: item.dteBucket, moneynessBucket: item.moneynessBucket };
    cohorts.set(JSON.stringify(cohort), cohort);
  }
  const selected = [...cohorts.values()].slice(0, 8);
  const ivCache = new Map<string, Awaited<ReturnType<typeof loadAlpacaContractIvHistory>>>();
  const spreadCache = new Map<string, Awaited<ReturnType<typeof loadAegisSpreadHistory>>>();
  const observations = [];
  for (const cohort of selected) {
    stage = 'PERSISTED_AEGIS_HISTORY';
    let iv = ivCache.get(cohort.underlying);
    if (!iv) {
      iv = await loadAlpacaContractIvHistory({ pool, underlying: cohort.underlying,
        decisionAsOf, lookbackDays: paperBootstrapAlpacaContractIvPolicy.lookbackDays });
      ivCache.set(cohort.underlying, iv);
    }
    const spreadKey = `${cohort.underlying}:${cohort.optionType}`;
    let spread = spreadCache.get(spreadKey);
    if (!spread) {
      spread = await loadAegisSpreadHistory({ pool, underlying: cohort.underlying,
        optionType: cohort.optionType, decisionAsOf,
        lookbackDays: paperBootstrapAegisSpreadStressPolicy.lookbackDays });
      spreadCache.set(spreadKey, spread);
    }
    observations.push({ ...assessNextSessionHistoryEligibility({ nextSession, cohort,
      ivHistory: iv.observations, spreadHistory: spread }),
    ivSourceRead: { scannedN: iv.scannedN, rejectedLineageN: iv.rejectedLineageN,
      legacyNumericNonAlpacaIvN: iv.sourceUnprovenN, rejectionReasons: iv.rejectionReasons,
      queryLimitReached: iv.scannedN === 5000 },
    spreadSourceRead: { scannedN: spread.length, queryLimitReached: spread.length === 5000 } });
  }
  process.stdout.write(`${JSON.stringify({ contractVersion: 'theta-aegis-next-session-eligibility-read-v1',
    authority: 'READ_ONLY_HISTORY_DIAGNOSTIC', source: 'ALPACA_CALENDAR_AND_PERSISTED_AIVEN_PIT',
    nextSession, latestSnapshotDecisionAsOf: progress.decisionAsOf, cohortTotal: cohorts.size,
    cohortSampleTruncated: cohorts.size > selected.length, observations,
    currentQuoteObserved: false, stressAssessmentAvailable: false, brokerMutations: 0 })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ state: 'PROVIDER_OR_DATABASE_UNAVAILABLE',
    stage, safeErrorCode: safeRuntimeFailure(error).code,
    authority: 'READ_ONLY_HISTORY_DIAGNOSTIC', brokerMutations: 0 })}\n`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => { process.exitCode = 1; });
}
