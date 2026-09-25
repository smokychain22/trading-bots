import { Pool } from 'pg';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { fetchMarketCalendar, fetchMarketClock, type AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';
import {
  assessAegisIvStress,
  normalizeOptionomicsAtmIvObservation,
  paperBootstrapAegisIvStressPolicy,
  PostgresAegisIvStressStore,
} from '../src/theta/aegis-iv-stress.js';
import { fetchOptionomicsContextObservation } from '../src/theta/optionomics-provider.js';
import { optionomicsConfigFromEnvironment } from '../src/theta/theta-shadow-once.js';

const environmentFile = process.argv.find((value) => value.startsWith('--environment-file='))
  ?.slice('--environment-file='.length);
if (!environmentFile) throw new Error('EXPLICIT_ENVIRONMENT_FILE_REQUIRED');
const environment = loadEnvironmentFile(environmentFile);
if (environment.MASTER_PAPER_EXECUTION_ENABLED || environment.FOLLOWER_PAPER_EXECUTION_ENABLED
  || !environment.PAPER_PAUSE_NEW_ORDERS) throw new Error('READ_ONLY_SAFETY_FLAGS_REQUIRED');
if (!environment.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
if (!environment.ALPACA_API_KEY || !environment.ALPACA_SECRET_KEY || !environment.ALPACA_BASE_URL) {
  throw new Error('ALPACA_PAPER_CONFIG_REQUIRED');
}
const optionomics = optionomicsConfigFromEnvironment(environment);
if (optionomics === null) throw new Error('OPTIONOMICS_CONFIG_REQUIRED');
const alpaca: AlpacaProviderConfig = {
  tradingApiBase: environment.ALPACA_BASE_URL,
  marketDataApiBase: 'https://data.alpaca.markets',
  apiKey: environment.ALPACA_API_KEY,
  apiSecret: environment.ALPACA_SECRET_KEY,
};
const underlying = (process.argv.find((value) => value.startsWith('--underlying='))
  ?.slice('--underlying='.length) ?? 'SPY').toUpperCase();
if (!/^[A-Z0-9._-]{1,16}$/.test(underlying)) throw new Error('UNDERLYING_INVALID');
const maxSessionsRaw = Number(process.argv.find((value) => value.startsWith('--sessions='))
  ?.slice('--sessions='.length) ?? 30);
if (!Number.isSafeInteger(maxSessionsRaw) || maxSessionsRaw < 21 || maxSessionsRaw > 60) {
  throw new Error('SESSION_COUNT_MUST_BE_21_TO_60');
}

const today = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
const [calendar, clock] = await Promise.all([
  fetchMarketCalendar(alpaca, start, today),
  fetchMarketClock(alpaca, new Date().toISOString()),
]);
const openSessionDate = clock.isOpen === true && clock.timestamp !== null
  ? clock.timestamp.slice(0, 10)
  : null;
const sessions = calendar.map((row) => row.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && date !== openSessionDate)
  .sort().slice(-maxSessionsRaw);
if (sessions.length < 21) throw new Error('INSUFFICIENT_ALPACA_TRADING_SESSIONS');

const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1,
  application_name: 'theta-backfill-aegis-iv-stress' });
const store = new PostgresAegisIvStressStore(pool);
let known = 0, unknown = 0, invalid = 0, requestErrors = 0;
try {
  for (const sessionDate of sessions) {
    const outcome = await fetchOptionomicsContextObservation(optionomics, 'METRICS', underlying, { sessionDate });
    if (outcome.kind !== 'VALUE_PRESENT') {
      if (outcome.kind === 'REQUEST_ERROR') requestErrors++; else unknown++;
      continue;
    }
    const normalized = normalizeOptionomicsAtmIvObservation(outcome.value);
    if (normalized.state === 'KNOWN') {
      await store.persistObservation(normalized.observation);
      known++;
    } else if (normalized.state === 'UNKNOWN') unknown++;
    else invalid++;
  }
  const decisionAsOf = new Date().toISOString();
  const persisted = await store.listObservations(underlying, decisionAsOf);
  const current = persisted.toSorted((a, b) => b.sessionDate.localeCompare(a.sessionDate)
    || b.thetaFirstObservedAt.localeCompare(a.thetaFirstObservedAt))[0];
  if (current === undefined) throw new Error('NO_KNOWN_IV_OBSERVATION');
  const assessment = assessAegisIvStress({ current, history: persisted, decisionAsOf,
    policy: paperBootstrapAegisIvStressPolicy });
  await store.persistAssessment(assessment);
  process.stdout.write(`${JSON.stringify({
    provider: 'OPTIONOMICS', authority: assessment.evidenceAuthority, underlying,
    sessionsRequested: sessions.length, observationsKnown: known, observationsUnknown: unknown,
    observationsInvalid: invalid, requestErrors, currentSession: current.sessionDate,
    decisionSession: assessment.decisionSession, sessionState: assessment.sessionState,
    openSessionExcluded: openSessionDate,
    currentProviderTimestampPresent: current.providerTimestamp !== null,
    firstObservedAt: current.thetaFirstObservedAt,
    baselineState: assessment.maturity.state,
    baselineSessionCount: assessment.maturity.evidence.sessionN,
    stressIvShockDetected: assessment.stressIvShockDetected,
    policyVersion: assessment.policyVersion, policyAuthority: assessment.policyAuthority,
    orderSubmissionAttempted: false, brokerMutations: 0,
  })}\n`);
} finally {
  await pool.end();
}
