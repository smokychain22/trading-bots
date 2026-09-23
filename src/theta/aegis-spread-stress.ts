import type { Pool } from 'pg';
import { hashJson, type JsonValue } from '../market/fusion-snapshot.js';
import {
  assessBaselineMaturity,
  type BaselineMaturityAssessment,
  type BaselineSufficiencyPolicy,
} from '../research/aegis-stress-baseline-maturity.js';
import type { NormalizedOptionContract } from './option-contract.js';

export const aegisSpreadStressDetectorVersion = 'theta-aegis-spread-stress-detector-v1' as const;

export type SpreadDteBucket = 'DTE_INVALID' | 'DTE_1_7' | 'DTE_8_21' | 'DTE_22_45' | 'DTE_46_90' | 'DTE_91_PLUS';
export type SpreadMoneynessBucket = 'ATM_0_3PCT' | 'NEAR_3_10PCT' | 'FAR_OVER_10PCT';

export interface AegisSpreadStressPolicy {
  readonly policyVersion: string;
  readonly authority: 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL';
  readonly lookbackDays: number;
  readonly maximumBaselineObservations: number;
  readonly minimumRelativeIncrease: number;
  readonly minimumRobustZ: number;
  readonly maturity: BaselineSufficiencyPolicy;
}

export interface SpreadHistoryObservation {
  readonly evidenceId: string;
  readonly underlying: string;
  readonly optionType: 'CALL' | 'PUT';
  readonly contractSymbol: string;
  readonly dte: number;
  readonly moneyness: number;
  readonly relativeSpread: number;
  readonly providerTimestamp: string;
  readonly ingestionTimestamp: string;
  readonly decisionTime: string;
  readonly source: 'ALPACA';
  readonly feed: 'OPRA' | 'INDICATIVE';
  readonly dataQuality: 'GOOD';
}

export interface AegisSpreadStressAssessment {
  readonly contractVersion: typeof aegisSpreadStressDetectorVersion;
  readonly underlying: string;
  readonly optionSymbol: string;
  readonly decisionAsOf: string;
  readonly dteBucket: SpreadDteBucket;
  readonly moneynessBucket: SpreadMoneynessBucket | null;
  readonly currentRelativeSpread: number | null;
  readonly currentQuoteProviderAt: string | null;
  readonly currentQuoteReceivedAt: string;
  readonly baselineMedianRelativeSpread: number | null;
  readonly baselineMadRelativeSpread: number | null;
  readonly relativeIncrease: number | null;
  readonly robustZ: number | null;
  readonly baselineEvidenceIds: readonly string[];
  readonly maturity: BaselineMaturityAssessment;
  readonly stressSpreadWideningDetected: boolean | null;
  readonly policyVersion: string;
  readonly policyAuthority: AegisSpreadStressPolicy['authority'];
  readonly evidenceAuthority: 'ALPACA_EXECUTABLE_MARKET';
  readonly contentHash: string;
}

export type AegisSpreadStressAssessmentMap = Readonly<Record<string, AegisSpreadStressAssessment>>;

export const paperBootstrapAegisSpreadStressPolicy: AegisSpreadStressPolicy = Object.freeze({
  policyVersion: 'aegis-spread-widening-paper-bootstrap-v1',
  authority: 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL',
  lookbackDays: 120,
  maximumBaselineObservations: 500,
  minimumRelativeIncrease: 0.5,
  minimumRobustZ: 3,
  maturity: {
    policyVersion: 'aegis-spread-baseline-paper-bootstrap-v1',
    minimumRawN: 20,
    minimumSessionN: 5,
    minimumDistinctUnderlyingN: 1,
    minimumTemporalSpanDays: 4,
    maxCurrentObservationAgeSeconds: 30,
  },
});

const validIso = (value: string): boolean => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function spreadDteBucket(dte: number): SpreadDteBucket {
  if (!Number.isSafeInteger(dte) || dte < 1) return 'DTE_INVALID';
  if (dte <= 7) return 'DTE_1_7';
  if (dte <= 21) return 'DTE_8_21';
  if (dte <= 45) return 'DTE_22_45';
  if (dte <= 90) return 'DTE_46_90';
  return 'DTE_91_PLUS';
}

export function spreadMoneynessBucket(moneyness: number | null): SpreadMoneynessBucket | null {
  if (moneyness === null || !Number.isFinite(moneyness)) return null;
  const distance = Math.abs(moneyness);
  if (distance <= 0.03) return 'ATM_0_3PCT';
  if (distance <= 0.1) return 'NEAR_3_10PCT';
  return 'FAR_OVER_10PCT';
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : sorted[middle] as number;
}

export function assessAegisSpreadStress(input: {
  readonly current: NormalizedOptionContract;
  readonly history: readonly SpreadHistoryObservation[];
  readonly decisionAsOf: string;
  readonly policy: AegisSpreadStressPolicy;
}): AegisSpreadStressAssessment {
  if (!validIso(input.decisionAsOf) || input.policy.authority !== 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL'
    || input.policy.policyVersion.trim() === '' || !Number.isSafeInteger(input.policy.maximumBaselineObservations)
    || input.policy.maximumBaselineObservations < 1 || !Number.isSafeInteger(input.policy.lookbackDays)
    || input.policy.lookbackDays < 1 || !Number.isFinite(input.policy.minimumRelativeIncrease)
    || input.policy.minimumRelativeIncrease < 0 || !Number.isFinite(input.policy.minimumRobustZ)
    || input.policy.minimumRobustZ < 0) throw new Error('AEGIS_SPREAD_STRESS_POLICY_INVALID');
  if (Date.parse(input.current.receivedAt) > Date.parse(input.decisionAsOf)) {
    throw new Error('AEGIS_SPREAD_STRESS_CURRENT_EVIDENCE_FROM_FUTURE');
  }
  const dteBucket = spreadDteBucket(input.current.dte);
  const moneynessBucket = spreadMoneynessBucket(input.current.moneyness);
  const currentSessionDate = input.current.quoteTimestamp?.slice(0, 10) ?? input.decisionAsOf.slice(0, 10);
  const eligible = moneynessBucket === null ? [] : input.history.filter((row) =>
    row.underlying === input.current.underlying && row.optionType === input.current.optionType
    && spreadDteBucket(row.dte) === dteBucket && spreadMoneynessBucket(row.moneyness) === moneynessBucket
    && row.relativeSpread >= 0 && Number.isFinite(row.relativeSpread)
    && row.providerTimestamp.slice(0, 10) < currentSessionDate
    && Date.parse(row.providerTimestamp) <= Date.parse(input.decisionAsOf)
    && Date.parse(row.ingestionTimestamp) <= Date.parse(input.decisionAsOf))
    .sort((a, b) => b.providerTimestamp.localeCompare(a.providerTimestamp) || b.evidenceId.localeCompare(a.evidenceId))
    .slice(0, input.policy.maximumBaselineObservations)
    .sort((a, b) => a.providerTimestamp.localeCompare(b.providerTimestamp) || a.evidenceId.localeCompare(b.evidenceId));
  const values = eligible.map((row) => row.relativeSpread);
  const baselineMedianRelativeSpread = median(values);
  const baselineMadRelativeSpread = baselineMedianRelativeSpread === null ? null
    : median(values.map((value) => Math.abs(value - baselineMedianRelativeSpread)));
  const sessions = new Set(eligible.map((row) => row.providerTimestamp.slice(0, 10)));
  const independent = new Set(eligible.map((row) => `${row.contractSymbol}:${row.providerTimestamp.slice(0, 10)}`));
  const ingestionTimes = eligible.map((row) => row.ingestionTimestamp).toSorted();
  const currentValid = input.current.source === 'ALPACA' && input.current.dataQuality === 'GOOD'
    && input.current.feed !== null && input.current.quoteTimestamp !== null
    && input.current.spreadPct !== null && Number.isFinite(input.current.spreadPct) && input.current.spreadPct >= 0
    && moneynessBucket !== null && dteBucket !== 'DTE_INVALID';
  const assessedMaturity = assessBaselineMaturity('SPREAD_WIDENING', input.decisionAsOf,
    'ALPACA_PERSISTED_EXECUTABLE_BBO', aegisSpreadStressDetectorVersion,
    { rawN: eligible.length, sessionN: sessions.size, distinctUnderlyingN: eligible.length === 0 ? 0 : 1,
      effectiveN: independent.size },
    ingestionTimes.at(0) ?? null, ingestionTimes.at(-1) ?? null,
    input.policy.maturity,
    { observedAt: input.current.quoteTimestamp ?? input.current.receivedAt, valid: currentValid,
      invalidReason: currentValid ? null : 'CURRENT_ALPACA_BBO_OR_COHORT_INPUT_INVALID' }, false);
  const maturity: BaselineMaturityAssessment = assessedMaturity.state === 'DETECTOR_READY'
    && baselineMedianRelativeSpread === 0
    ? { ...assessedMaturity, state: 'BASELINE_INVALID', reason: 'Baseline median spread is zero; relative widening is undefined.' }
    : assessedMaturity;
  const currentRelativeSpread = input.current.spreadPct;
  const relativeIncrease = currentRelativeSpread === null || baselineMedianRelativeSpread === null
    || baselineMedianRelativeSpread === 0 ? null
    : (currentRelativeSpread - baselineMedianRelativeSpread) / baselineMedianRelativeSpread;
  const robustZ = currentRelativeSpread === null || baselineMedianRelativeSpread === null
    || baselineMadRelativeSpread === null || baselineMadRelativeSpread === 0 ? null
    : (currentRelativeSpread - baselineMedianRelativeSpread) / (1.4826 * baselineMadRelativeSpread);
  const stressSpreadWideningDetected = maturity.state !== 'DETECTOR_READY' || relativeIncrease === null
    ? null
    : relativeIncrease >= input.policy.minimumRelativeIncrease
      && (robustZ === null || robustZ >= input.policy.minimumRobustZ);
  const withoutHash = {
    contractVersion: aegisSpreadStressDetectorVersion, underlying: input.current.underlying,
    optionSymbol: input.current.optionSymbol, decisionAsOf: input.decisionAsOf, dteBucket, moneynessBucket,
    currentRelativeSpread, currentQuoteProviderAt: input.current.quoteTimestamp,
    currentQuoteReceivedAt: input.current.receivedAt, baselineMedianRelativeSpread, baselineMadRelativeSpread,
    relativeIncrease, robustZ, baselineEvidenceIds: eligible.map((row) => row.evidenceId), maturity,
    stressSpreadWideningDetected, policyVersion: input.policy.policyVersion,
    policyAuthority: input.policy.authority, evidenceAuthority: 'ALPACA_EXECUTABLE_MARKET',
  } as const;
  return { ...withoutHash, contentHash: hashJson(withoutHash as unknown as JsonValue) };
}

export async function loadAegisSpreadHistory(input: {
  readonly pool: Pool;
  readonly underlying: string;
  readonly optionType: 'CALL' | 'PUT';
  readonly decisionAsOf: string;
  readonly lookbackDays: number;
}): Promise<readonly SpreadHistoryObservation[]> {
  const result = await input.pool.query(`SELECT candidate_id::text,contract_symbol,dte,moneyness::float8,
    relative_spread::float8,provider_timestamp,ingestion_timestamp,decision_time,source,feed,data_quality,
    quote_content_hash
    FROM research.option_contract_risk_history
    WHERE underlying=$1 AND upper(option_type)=upper($2) AND decision_time < $3
      AND decision_time >= ($3::timestamptz - ($4::int * interval '1 day'))
      AND provider_timestamp::date < $3::timestamptz::date
      AND dte >= 1 AND moneyness IS NOT NULL AND relative_spread IS NOT NULL
      AND relative_spread >= 0 AND source='ALPACA' AND feed IN ('OPRA','INDICATIVE')
      AND data_quality='GOOD' AND provider_timestamp IS NOT NULL AND ingestion_timestamp IS NOT NULL
      AND provider_timestamp <= $3 AND ingestion_timestamp <= $3
    ORDER BY provider_timestamp DESC,candidate_id DESC LIMIT 5000`, [
    input.underlying.toUpperCase(), input.optionType, input.decisionAsOf, input.lookbackDays,
  ]);
  return result.rows.map((row) => ({
    evidenceId: `${String(row.candidate_id)}:${String(row.quote_content_hash ?? 'NO_QUOTE_HASH')}`,
    underlying: input.underlying.toUpperCase(), optionType: input.optionType,
    contractSymbol: String(row.contract_symbol), dte: Number(row.dte), moneyness: Number(row.moneyness),
    relativeSpread: Number(row.relative_spread), providerTimestamp: new Date(row.provider_timestamp).toISOString(),
    ingestionTimestamp: new Date(row.ingestion_timestamp).toISOString(), decisionTime: new Date(row.decision_time).toISOString(),
    source: 'ALPACA', feed: String(row.feed) as 'OPRA' | 'INDICATIVE', dataQuality: 'GOOD',
  }));
}

export async function assessAegisSpreadStressForContracts(input: {
  readonly pool: Pool;
  readonly contracts: readonly NormalizedOptionContract[];
  readonly decisionAsOf: string;
  readonly policy?: AegisSpreadStressPolicy;
}): Promise<AegisSpreadStressAssessmentMap> {
  const policy = input.policy ?? paperBootstrapAegisSpreadStressPolicy;
  const historyByKey = new Map<string, readonly SpreadHistoryObservation[]>();
  const output: Record<string, AegisSpreadStressAssessment> = {};
  for (const contract of input.contracts) {
    const key = `${contract.underlying}:${contract.optionType}`;
    let history = historyByKey.get(key);
    if (history === undefined) {
      history = await loadAegisSpreadHistory({ pool: input.pool, underlying: contract.underlying,
        optionType: contract.optionType, decisionAsOf: input.decisionAsOf, lookbackDays: policy.lookbackDays });
      historyByKey.set(key, history);
    }
    output[contract.optionSymbol] = assessAegisSpreadStress({ current: contract, history, decisionAsOf: input.decisionAsOf, policy });
  }
  return output;
}
