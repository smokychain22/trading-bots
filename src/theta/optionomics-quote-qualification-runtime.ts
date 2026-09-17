import type { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { PostgresRuntimeCycleStore } from './autonomous-runtime.js';
import { fetchOptionomicsOptionChain } from './optionomics-provider.js';
import { assessOptionomicsQuoteQualification, type OptionomicsQuoteQualificationReport, type OptionomicsQuoteQualificationSample } from './optionomics-quote-qualification.js';
import { optionomicsConfigFromEnvironment } from './theta-shadow-once.js';

export async function runOptionomicsQuoteQualification(environment: Environment, pool: Pool): Promise<OptionomicsQuoteQualificationReport> {
  const optionomics = optionomicsConfigFromEnvironment(environment);
  if (optionomics === null) throw new Error('OPTIONOMICS_CONFIGURATION_NOT_AVAILABLE');
  const master = await new PostgresRuntimeCycleStore(pool).resolveMasterContext(environment);
  const clock = await master.broker.getClock();
  const marketSession = clock.isOpen === true ? 'OPEN' : clock.isOpen === false ? 'CLOSED' : 'UNKNOWN';
  const symbols = ['SPY', 'QQQ', 'AAPL'] as const;
  const samples: OptionomicsQuoteQualificationSample[] = [];
  if (marketSession === 'OPEN') {
    for (const symbol of symbols) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const requestedAt = new Date().toISOString();
        const result = await fetchOptionomicsOptionChain(optionomics, symbol);
        samples.push(result.kind === 'VALUE_PRESENT'
          ? { symbol, requestedAt, chain: result.value, operationAlias: 'OPTION_CHAIN', httpStatus: result.httpStatus,
              failureCode: null, retryAfterSeconds: null, attemptCount: 1 }
          : { symbol, requestedAt, chain: null, operationAlias: 'OPTION_CHAIN', httpStatus: result.httpStatus,
              failureCode: result.kind === 'REQUEST_ERROR' ? result.errorClass : 'UNRECOGNIZED_RESPONSE',
              retryAfterSeconds: result.kind === 'REQUEST_ERROR' ? result.retryAfterSeconds : null,
              attemptCount: result.kind === 'REQUEST_ERROR' ? result.attemptCount : 1 });
      }
    }
  } else {
    for (const symbol of symbols) samples.push({ symbol, requestedAt: new Date().toISOString(), chain: null,
      operationAlias: 'OPTION_CHAIN', httpStatus: null, failureCode: `MARKET_SESSION_${marketSession}`,
      retryAfterSeconds: null, attemptCount: 0 });
  }
  const report = assessOptionomicsQuoteQualification({ runAt: new Date().toISOString(), marketSession, maximumAgeMs: 15_000, samples });
  await pool.query(`INSERT INTO research.optionomics_quote_qualification_run(
    qualification_run_id,run_at,market_session,symbols_json,samples_requested,samples_observed,two_sided_observations,
    fresh_observations,semantic_authority,readiness_state,ready,evidence_json,content_hash)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) ON CONFLICT(content_hash) DO NOTHING`,
  [report.qualificationRunId,report.runAt,report.marketSession,JSON.stringify(report.symbols),report.samplesRequested,
    report.samplesObserved,report.twoSidedObservations,report.freshObservations,report.semanticAuthority,
    report.readinessState,report.ready,JSON.stringify({blockers:report.blockers,samples:report.sampleEvidence,
      contractVersion:report.contractVersion}),report.contentHash]);
  return report;
}

export function sanitizeQualificationReport(report: OptionomicsQuoteQualificationReport): Record<string, unknown> {
  return {
    marketSession:report.marketSession, symbols:report.symbols, samplesRequested:report.samplesRequested,
    samplesObserved:report.samplesObserved, twoSidedObservations:report.twoSidedObservations,
    freshObservations:report.freshObservations, productionAuth:report.productionAuth,
    authenticationFailure:report.authenticationFailure, readinessState:report.readinessState, ready:report.ready,
    blockers:report.blockers, sampleEvidence:report.sampleEvidence.map((sample) => ({
      symbol:sample.symbol, operationAlias:sample.operationAlias, httpStatus:sample.httpStatus,
      observationCount:sample.observationCount, twoSidedCount:sample.twoSidedCount,
      timestampedCount:sample.timestampedCount,freshCount:sample.freshCount,
      oldestProviderTimestamp:sample.oldestProviderTimestamp,latestProviderTimestamp:sample.latestProviderTimestamp,
      failureCode:sample.failureCode,
      retryAfterSeconds:sample.retryAfterSeconds, attemptCount:sample.attemptCount,
    })),
  };
}
