import { paperBootstrapAlpacaContractIvPolicy, type AlpacaContractIvHistoryRow } from './aegis-alpaca-iv-stress.js';
import { paperBootstrapAegisSpreadStressPolicy, spreadDteBucket, spreadMoneynessBucket,
  type SpreadHistoryObservation } from './aegis-spread-stress.js';

export interface NextSessionCohort {
  readonly underlying: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly feed: 'OPRA' | 'INDICATIVE';
  readonly dteBucket: string;
  readonly moneynessBucket: string;
}

/** History-only eligibility. No future quote, stress value, or trading authority is inferred. */
export function assessNextSessionHistoryEligibility(input: {
  readonly nextSession: string;
  readonly cohort: NextSessionCohort;
  readonly ivHistory: readonly AlpacaContractIvHistoryRow[];
  readonly spreadHistory: readonly SpreadHistoryObservation[];
}) {
  const { nextSession, cohort } = input;
  const nextSessionMillis = Date.parse(`${nextSession}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextSession) || !Number.isFinite(nextSessionMillis)
    || new Date(nextSessionMillis).toISOString().slice(0, 10) !== nextSession)
    throw new Error('NEXT_SESSION_INVALID');
  const matching = (row: { underlying: string; optionType: string; feed: string; dte: number; moneyness: number }) =>
    row.underlying === cohort.underlying && row.optionType === cohort.optionType && row.feed === cohort.feed
    && spreadDteBucket(row.dte) === cohort.dteBucket
    && spreadMoneynessBucket(row.moneyness) === cohort.moneynessBucket;
  const iv = input.ivHistory.filter((row) => matching(row) && row.quoteTimestamp.slice(0, 10) < nextSession);
  const ivBySession = new Map<string, Set<string>>();
  for (const row of iv) {
    const session = row.quoteTimestamp.slice(0, 10);
    const contracts = ivBySession.get(session) ?? new Set<string>();
    contracts.add(row.optionSymbol);
    ivBySession.set(session, contracts);
  }
  const selectedIvSessions = [...ivBySession].sort(([a], [b]) => b.localeCompare(a))
    .slice(0, paperBootstrapAlpacaContractIvPolicy.maximumBaselineSessions);
  const ivRawN = selectedIvSessions.reduce((sum, [, contracts]) => sum + contracts.size, 0);
  const ivSessionN = selectedIvSessions.length;
  const spread = input.spreadHistory.filter((row) => matching(row)
    && row.providerTimestamp.slice(0, 10) < nextSession)
    .sort((a, b) => b.providerTimestamp.localeCompare(a.providerTimestamp) || b.evidenceId.localeCompare(a.evidenceId))
    .slice(0, paperBootstrapAegisSpreadStressPolicy.maximumBaselineObservations);
  const spreadSessions = [...new Set(spread.map((row) => row.providerTimestamp.slice(0, 10)))].sort();
  const spreadSpanDays = spreadSessions.length < 2 ? 0
    : (Date.parse(`${spreadSessions.at(-1)}T00:00:00Z`) - Date.parse(`${spreadSessions[0]}T00:00:00Z`)) / 86_400_000;
  const ivMissing = [
    ivRawN < paperBootstrapAlpacaContractIvPolicy.maturity.minimumRawN ? 'MINIMUM_RAW_OBSERVATIONS' : null,
    ivSessionN < paperBootstrapAlpacaContractIvPolicy.maturity.minimumSessionN ? 'MINIMUM_DISTINCT_SESSIONS' : null,
  ].filter((value): value is string => value !== null);
  const spreadMissing = [
    spread.length < paperBootstrapAegisSpreadStressPolicy.maturity.minimumRawN ? 'MINIMUM_RAW_OBSERVATIONS' : null,
    spreadSessions.length < paperBootstrapAegisSpreadStressPolicy.maturity.minimumSessionN ? 'MINIMUM_DISTINCT_SESSIONS' : null,
    spreadSpanDays < paperBootstrapAegisSpreadStressPolicy.maturity.minimumTemporalSpanDays ? 'MINIMUM_TEMPORAL_SPAN' : null,
  ].filter((value): value is string => value !== null);
  return {
    contractVersion: 'theta-aegis-next-session-history-eligibility-v1' as const,
    authority: 'READ_ONLY_HISTORY_DIAGNOSTIC' as const, nextSession, cohort,
    currentQuoteObserved: false as const, stressAssessmentAvailable: false as const,
    iv: { rawN: ivRawN, sessionN: ivSessionN, minimumRawN: paperBootstrapAlpacaContractIvPolicy.maturity.minimumRawN,
      minimumSessionN: paperBootstrapAlpacaContractIvPolicy.maturity.minimumSessionN,
      historySufficient: ivMissing.length === 0, missing: ivMissing },
    spread: { rawN: spread.length, sessionN: spreadSessions.length, temporalSpanDays: spreadSpanDays,
      minimumRawN: paperBootstrapAegisSpreadStressPolicy.maturity.minimumRawN,
      minimumSessionN: paperBootstrapAegisSpreadStressPolicy.maturity.minimumSessionN,
      minimumTemporalSpanDays: paperBootstrapAegisSpreadStressPolicy.maturity.minimumTemporalSpanDays,
      historySufficient: spreadMissing.length === 0, missing: spreadMissing },
  };
}
