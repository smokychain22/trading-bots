import type { Pool } from 'pg';
import { hashJson, type JsonValue } from '../market/fusion-snapshot.js';
import { assessBaselineMaturity, paperBootstrapStressColdStartPolicy, type BaselineMaturityAssessment,
  type BaselineSufficiencyPolicy } from '../research/aegis-stress-baseline-maturity.js';
import { parseOccOptionSymbol } from './account-exposure.js';
import { spreadDteBucket, spreadMoneynessBucket,
  type SpreadDteBucket, type SpreadMoneynessBucket } from './aegis-spread-stress.js';
import type { NormalizedOptionContract } from './option-contract.js';

export const alpacaContractIvDetectorVersion = 'theta-alpaca-contract-iv-cohort-shock-v1' as const;
export interface AlpacaContractIvHistoryRow {
  readonly evidenceId: string;
  readonly sourceHash: string;
  readonly underlying: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly optionSymbol: string;
  readonly dte: number;
  readonly moneyness: number;
  readonly iv: number;
  readonly feed: 'OPRA' | 'INDICATIVE';
  readonly quoteTimestamp: string;
  readonly ivAvailableAt: string;
  readonly decisionTime: string;
}
export interface AlpacaContractIvSessionReference {
  readonly sessionDate: string;
  readonly rawContractN: number;
  readonly sessionMedianIv: number;
  readonly feed: 'OPRA' | 'INDICATIVE';
  readonly dteBucket: SpreadDteBucket;
  readonly moneynessBucket: SpreadMoneynessBucket;
  readonly evidenceIds: readonly string[];
  readonly sourceHashes: readonly string[];
  readonly lineageSampleTruncated: boolean;
  readonly evidenceIdSetHash: string;
  readonly sourceHashSetHash: string;
  readonly firstIvAvailableAt: string;
  readonly lastIvAvailableAt: string;
}
export interface AlpacaContractIvPolicy {
  readonly policyVersion: string;
  readonly authority: 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL';
  readonly lookbackDays: number;
  readonly maximumBaselineSessions: number;
  readonly minimumAbsoluteIncrease: number;
  readonly minimumRelativeIncrease: number;
  readonly minimumRobustZ: number;
  readonly zeroMadFallback: 'ABSOLUTE_AND_RELATIVE';
  readonly maturity: BaselineSufficiencyPolicy;
}
export interface AlpacaContractIvAssessment {
  readonly contractVersion: typeof alpacaContractIvDetectorVersion;
  readonly methodology: 'ALPACA_CONTRACT_IV_COHORT_SHOCK';
  readonly candidateId: string;
  readonly underlying: string;
  readonly optionSymbol: string;
  readonly decisionAsOf: string;
  readonly currentIv: number | null;
  readonly currentIvAvailableAt: string | null;
  readonly currentIvProviderTimestamp: null;
  readonly currentQuoteProviderAt: string | null;
  readonly currentQuoteReceivedAt: string;
  readonly currentUnderlyingReferencePrice: number | null;
  readonly currentUnderlyingQuoteProviderAt: string | null;
  readonly currentUnderlyingQuoteReceivedAt: string | null;
  readonly currentUnderlyingQuoteSource: 'ALPACA_IEX' | null;
  readonly currentTimingAuthority: 'ALPACA_SNAPSHOT_IV_AVAILABLE_AT_RECEIPT';
  readonly currentFeed: 'OPRA' | 'INDICATIVE' | null;
  readonly currentState: 'QUALIFIED' | 'INVALID_OR_STALE';
  readonly currentReason: string;
  readonly dteBucket: SpreadDteBucket;
  readonly moneynessBucket: SpreadMoneynessBucket | null;
  readonly sessionReferences: readonly AlpacaContractIvSessionReference[];
  readonly baselineMedianIv: number | null;
  readonly baselineMadIv: number | null;
  readonly absoluteIncrease: number | null;
  readonly relativeIncrease: number | null;
  readonly robustZ: number | null;
  readonly dispersionState: 'MAD_POSITIVE' | 'MAD_ZERO' | 'MAD_UNAVAILABLE';
  readonly maturity: BaselineMaturityAssessment;
  readonly stressIvShockDetected: boolean | null;
  readonly policyVersion: string;
  readonly policyAuthority: AlpacaContractIvPolicy['authority'];
  readonly evidenceAuthority: 'ALPACA_OPTION_SNAPSHOT_CONTRACT_IV';
  readonly contentHash: string;
}
export type AlpacaContractIvAssessmentMap = Readonly<Record<string, AlpacaContractIvAssessment>>;
export type IvStressShadowComparison = 'AGREE_STRESS' | 'AGREE_NO_STRESS'
  | 'ALPACA_ONLY' | 'OPTIONOMICS_ONLY' | 'ONE_UNAVAILABLE';

/** Descriptive only. The two methodologies never average or inherit authority. */
export function compareIvStressSignals(input: {
  readonly alpacaByContract: AlpacaContractIvAssessmentMap;
  readonly optionomics: Readonly<{ stressIvShockDetected: boolean | null }> | null;
}): Readonly<Record<string, IvStressShadowComparison>> {
  return Object.fromEntries(Object.entries(input.alpacaByContract).map(([symbol, alpaca]) => {
    const left = alpaca.stressIvShockDetected;
    const right = input.optionomics?.stressIvShockDetected ?? null;
    const state: IvStressShadowComparison = left === null || right === null ? 'ONE_UNAVAILABLE'
      : left && right ? 'AGREE_STRESS' : !left && !right ? 'AGREE_NO_STRESS'
        : left ? 'ALPACA_ONLY' : 'OPTIONOMICS_ONLY';
    return [symbol, state];
  }));
}

export const paperBootstrapAlpacaContractIvPolicy: AlpacaContractIvPolicy = Object.freeze({
  policyVersion: 'aegis-alpaca-contract-iv-paper-bootstrap-v1',
  authority: 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL',
  lookbackDays: 120, maximumBaselineSessions: 40,
  minimumAbsoluteIncrease: 0.03, minimumRelativeIncrease: 0.25, minimumRobustZ: 3,
  zeroMadFallback: 'ABSOLUTE_AND_RELATIVE',
  maturity: {
    policyVersion: 'aegis-alpaca-contract-iv-baseline-paper-bootstrap-v1',
    minimumRawN: 20, minimumSessionN: 20, minimumDistinctUnderlyingN: 1,
    minimumTemporalSpanDays: 0, maxCurrentObservationAgeSeconds: 30,
  },
});

const validIso = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return false;
  const date = value.slice(0, 10);
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7)), day = Number(date.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === date;
};
const sessionDate = (value: string): string => new Date(value).toISOString().slice(0, 10);
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2
    : ordered[middle] as number;
}
function currentReason(contract: NormalizedOptionContract, decisionAsOf: string, policy: AlpacaContractIvPolicy): string {
  const parsed = contract.occSymbol === null ? null : parseOccOptionSymbol(contract.occSymbol);
  if (parsed === null || contract.occSymbol !== contract.optionSymbol || parsed.underlying !== contract.underlying
    || parsed.optionType !== contract.optionType || parsed.expiration !== contract.expiration || parsed.strike !== contract.strike)
    return 'EXACT_OCC_IDENTITY_UNVERIFIED';
  if (contract.source !== 'ALPACA' || contract.greeksSource !== 'ALPACA'
    || contract.iv === null || !Number.isFinite(contract.iv) || contract.iv < 0 || contract.iv > 5)
    return 'ALPACA_CONTRACT_IV_UNAVAILABLE';
  if (contract.dataQuality !== 'GOOD' || !contract.executable || (contract.feed !== 'OPRA' && contract.feed !== 'INDICATIVE'))
    return 'EXACT_CONTRACT_MARKET_NOT_QUALIFIED';
  if (contract.greeksTimestamp === null || !validIso(contract.greeksTimestamp)
    || !validIso(contract.receivedAt) || contract.greeksTimestamp !== contract.receivedAt)
    return 'IV_RECEIPT_TIMING_UNVERIFIED';
  if (contract.quoteTimestamp === null || !validIso(contract.quoteTimestamp)) return 'EXACT_BBO_TIMESTAMP_UNAVAILABLE';
  if (contract.underlyingQuoteSource !== 'ALPACA_IEX'
    || contract.underlyingTimestamp === null || !validIso(contract.underlyingTimestamp)
    || typeof contract.underlyingQuoteReceivedAt !== 'string' || !validIso(contract.underlyingQuoteReceivedAt)
    || contract.underlyingReferencePrice === null || contract.underlyingReferencePrice <= 0
    || spreadMoneynessBucket(contract.moneyness) === null)
    return 'UNDERLYING_MONEYNESS_REFERENCE_UNQUALIFIED';
  const decisionMs = Date.parse(decisionAsOf), receivedMs = Date.parse(contract.receivedAt);
  const quoteMs = Date.parse(contract.quoteTimestamp);
  const underlyingReceivedMs = Date.parse(contract.underlyingQuoteReceivedAt);
  const underlyingQuoteMs = Date.parse(contract.underlyingTimestamp);
  if (receivedMs > decisionMs || quoteMs > receivedMs || quoteMs > decisionMs
    || underlyingReceivedMs > decisionMs || underlyingQuoteMs > underlyingReceivedMs)
    return 'CURRENT_EVIDENCE_AFTER_DECISION';
  if ((decisionMs - quoteMs) / 1000 > policy.maturity.maxCurrentObservationAgeSeconds)
    return 'EXACT_BBO_STALE';
  if ((decisionMs - underlyingQuoteMs) / 1000 > policy.maturity.maxCurrentObservationAgeSeconds)
    return 'UNDERLYING_MONEYNESS_REFERENCE_STALE';
  return 'QUALIFIED_EXACT_ALPACA_SNAPSHOT_AND_BBO';
}

export function assessAlpacaContractIvStress(input: {
  readonly current: NormalizedOptionContract;
  readonly history: readonly AlpacaContractIvHistoryRow[];
  readonly decisionAsOf: string;
  readonly policy: AlpacaContractIvPolicy;
}): AlpacaContractIvAssessment {
  const { current, policy, decisionAsOf } = input;
  if (!validIso(decisionAsOf) || policy.authority !== 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL'
    || !policy.policyVersion || !Number.isSafeInteger(policy.lookbackDays) || policy.lookbackDays < 1
    || !Number.isSafeInteger(policy.maximumBaselineSessions) || policy.maximumBaselineSessions < 1
    || ![policy.minimumAbsoluteIncrease, policy.minimumRelativeIncrease, policy.minimumRobustZ]
      .every((value) => Number.isFinite(value) && value >= 0)
    || policy.zeroMadFallback !== 'ABSOLUTE_AND_RELATIVE') throw new Error('AEGIS_ALPACA_IV_POLICY_INVALID');
  const dteBucket = spreadDteBucket(current.dte);
  const moneynessBucket = spreadMoneynessBucket(current.moneyness);
  const reason = currentReason(current, decisionAsOf, policy);
  const currentState = reason === 'QUALIFIED_EXACT_ALPACA_SNAPSHOT_AND_BBO' ? 'QUALIFIED' as const : 'INVALID_OR_STALE' as const;
  const currentSession = current.quoteTimestamp === null || !validIso(current.quoteTimestamp)
    ? decisionAsOf.slice(0, 10) : sessionDate(current.quoteTimestamp);
  const cutoff = Date.parse(decisionAsOf) - policy.lookbackDays * 86_400_000;
  const eligible = moneynessBucket === null ? [] : input.history.filter((row) =>
    row.underlying === current.underlying && row.optionType === current.optionType
    && row.feed === current.feed && spreadDteBucket(row.dte) === dteBucket
    && spreadMoneynessBucket(row.moneyness) === moneynessBucket
    && Number.isFinite(row.iv) && row.iv >= 0 && row.iv <= 5
    && validIso(row.quoteTimestamp) && validIso(row.ivAvailableAt) && validIso(row.decisionTime)
    && sessionDate(row.quoteTimestamp) < currentSession
    && Date.parse(row.ivAvailableAt) <= Date.parse(row.decisionTime)
    && Date.parse(row.decisionTime) < Date.parse(decisionAsOf)
    && Date.parse(row.ivAvailableAt) >= cutoff
    && /^[a-f0-9]{64}$/.test(row.sourceHash)
    && (() => { const identity = parseOccOptionSymbol(row.optionSymbol);
      return identity !== null && identity.underlying === row.underlying && identity.optionType === row.optionType; })());
  const bySession = new Map<string, AlpacaContractIvHistoryRow[]>();
  for (const row of eligible) {
    const session = sessionDate(row.quoteTimestamp);
    const rows = bySession.get(session) ?? []; rows.push(row); bySession.set(session, rows);
  }
  const sessionReferences: AlpacaContractIvSessionReference[] = [...bySession].sort(([a], [b]) => b.localeCompare(a))
    .slice(0, policy.maximumBaselineSessions).sort(([a], [b]) => a.localeCompare(b))
    .map(([sessionDate, rows]) => {
      // One contract contributes at most once to a session reference. A
      // frequently rescanned strike cannot outweigh the rest of the chain.
      const byContract = new Map<string, AlpacaContractIvHistoryRow>();
      for (const row of rows) {
        const prior = byContract.get(row.optionSymbol);
        if (prior === undefined || row.ivAvailableAt > prior.ivAvailableAt
          || (row.ivAvailableAt === prior.ivAvailableAt && row.evidenceId > prior.evidenceId))
          byContract.set(row.optionSymbol, row);
      }
      const distinct = [...byContract.values()];
      const evidenceIds = distinct.map((row) => row.evidenceId).sort();
      const sourceHashes = distinct.map((row) => row.sourceHash).sort();
      const availableTimes = distinct.map((row) => row.ivAvailableAt).sort();
      return {
        sessionDate, rawContractN: distinct.length, sessionMedianIv: median(distinct.map((row) => row.iv)) as number,
        feed: current.feed as 'OPRA' | 'INDICATIVE', dteBucket,
        moneynessBucket: moneynessBucket as SpreadMoneynessBucket,
        evidenceIds: evidenceIds.slice(0, 8), sourceHashes: sourceHashes.slice(0, 8),
        lineageSampleTruncated: distinct.length > 8,
        evidenceIdSetHash: hashJson(evidenceIds as JsonValue),
        sourceHashSetHash: hashJson(sourceHashes as JsonValue),
        firstIvAvailableAt: availableTimes[0] as string,
        lastIvAvailableAt: availableTimes.at(-1) as string,
      };
    });
  const values = sessionReferences.map((row) => row.sessionMedianIv);
  const baselineMedianIv = median(values);
  const baselineMadIv = baselineMedianIv === null ? null : median(values.map((value) => Math.abs(value - baselineMedianIv)));
  const absoluteIncrease = current.iv === null || baselineMedianIv === null ? null : current.iv - baselineMedianIv;
  const relativeIncrease = absoluteIncrease === null || baselineMedianIv === null || baselineMedianIv <= 0
    ? null : absoluteIncrease / baselineMedianIv;
  const robustZ = absoluteIncrease === null || baselineMadIv === null || baselineMadIv <= 0
    ? null : absoluteIncrease / (1.4826 * baselineMadIv);
  const dispersionState = baselineMadIv === null ? 'MAD_UNAVAILABLE' as const
    : baselineMadIv === 0 ? 'MAD_ZERO' as const : 'MAD_POSITIVE' as const;
  const availableTimes = sessionReferences.flatMap((row) => [row.firstIvAvailableAt, row.lastIvAvailableAt]).sort();
  const maturity = assessBaselineMaturity('IV_SHOCK', decisionAsOf,
    'ALPACA_CONTRACT_IV_SAME_FEED_SESSION_COHORT', alpacaContractIvDetectorVersion,
    { rawN: sessionReferences.reduce((sum, row) => sum + row.rawContractN, 0),
      sessionN: sessionReferences.length, distinctUnderlyingN: sessionReferences.length === 0 ? 0 : 1,
      effectiveN: sessionReferences.length }, availableTimes.at(0) ?? null, availableTimes.at(-1) ?? null,
    policy.maturity, { observedAt: current.receivedAt, valid: currentState === 'QUALIFIED',
      invalidReason: currentState === 'QUALIFIED' ? null : reason }, false);
  const stressIvShockDetected = maturity.state !== 'DETECTOR_READY' || currentState !== 'QUALIFIED'
    || absoluteIncrease === null || relativeIncrease === null || dispersionState === 'MAD_UNAVAILABLE'
    ? null : absoluteIncrease >= policy.minimumAbsoluteIncrease && relativeIncrease >= policy.minimumRelativeIncrease
      && (dispersionState === 'MAD_ZERO' || (robustZ !== null && robustZ >= policy.minimumRobustZ));
  const withoutHash = {
    contractVersion: alpacaContractIvDetectorVersion, methodology: 'ALPACA_CONTRACT_IV_COHORT_SHOCK',
    candidateId: current.optionSymbol, underlying: current.underlying, optionSymbol: current.optionSymbol,
    decisionAsOf, currentIv: current.iv, currentIvAvailableAt: current.greeksTimestamp,
    currentIvProviderTimestamp: null, currentQuoteProviderAt: current.quoteTimestamp,
    currentQuoteReceivedAt: current.receivedAt,
    currentUnderlyingReferencePrice: current.underlyingReferencePrice,
    currentUnderlyingQuoteProviderAt: current.underlyingTimestamp,
    currentUnderlyingQuoteReceivedAt: current.underlyingQuoteReceivedAt ?? null,
    currentUnderlyingQuoteSource: current.underlyingQuoteSource ?? null,
    currentTimingAuthority: 'ALPACA_SNAPSHOT_IV_AVAILABLE_AT_RECEIPT', currentFeed: current.feed,
    currentState, currentReason: reason, dteBucket, moneynessBucket, sessionReferences,
    baselineMedianIv, baselineMadIv, absoluteIncrease, relativeIncrease, robustZ, dispersionState, maturity,
    stressIvShockDetected, policyVersion: policy.policyVersion, policyAuthority: policy.authority,
    evidenceAuthority: 'ALPACA_OPTION_SNAPSHOT_CONTRACT_IV',
  } as const;
  return { ...withoutHash, contentHash: hashJson(withoutHash as unknown as JsonValue) };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function parseAlpacaContractIvHistoryRow(raw: Record<string, unknown>): AlpacaContractIvHistoryRow | null {
  const contract = record(raw.contract_json), market = record(raw.market_json), volatility = record(raw.volatility_json);
  if (contract === null || market === null || volatility === null
    || volatility.ivSource !== 'ALPACA' || volatility.ivEvidenceAuthority !== 'ALPACA_OPTION_SNAPSHOT_CONTRACT_IV'
    || (volatility.ivFeed !== 'OPRA' && volatility.ivFeed !== 'INDICATIVE')
    || market.feed !== volatility.ivFeed || market.dataQuality !== 'GOOD'
    || market.quoteSource !== 'ALPACA' || typeof market.quoteReceivedAt !== 'string'
    || market.underlyingQuoteSource !== 'ALPACA_IEX'
    || typeof market.underlyingQuoteTimestamp !== 'string'
    || typeof market.underlyingQuoteReceivedAt !== 'string'
    || typeof market.underlyingReferencePrice !== 'number'
    || typeof volatility.iv !== 'number' || !Number.isFinite(volatility.iv) || volatility.iv < 0 || volatility.iv > 5
    || typeof contract.underlying !== 'string' || typeof contract.contractSymbol !== 'string'
    || (contract.optionType !== 'PUT' && contract.optionType !== 'CALL')
    || typeof contract.dte !== 'number' || typeof contract.moneyness !== 'number'
    || typeof contract.strike !== 'number' || typeof contract.expiration !== 'string'
    || typeof market.quoteTimestamp !== 'string' || typeof volatility.ivAvailableAt !== 'string'
    || typeof raw.decision_time !== 'string' || typeof raw.candidate_id !== 'string'
    || typeof raw.content_hash !== 'string') return null;
  const parsed = parseOccOptionSymbol(contract.contractSymbol);
  if (parsed === null || parsed.underlying !== contract.underlying || parsed.optionType !== contract.optionType
    || parsed.strike !== contract.strike || parsed.expiration !== contract.expiration
    || !validIso(market.quoteTimestamp) || !validIso(market.quoteReceivedAt)
    || !validIso(market.underlyingQuoteTimestamp) || !validIso(market.underlyingQuoteReceivedAt)
    || !validIso(volatility.ivAvailableAt) || !validIso(raw.decision_time)
    || market.quoteReceivedAt !== volatility.ivAvailableAt
    || market.underlyingReferencePrice <= 0
    || Math.abs((market.underlyingReferencePrice - contract.strike) / contract.strike - contract.moneyness) > 1e-9
    || Date.parse(market.underlyingQuoteTimestamp) > Date.parse(market.underlyingQuoteReceivedAt)
    || Date.parse(market.underlyingQuoteReceivedAt) > Date.parse(raw.decision_time)
    || (Date.parse(raw.decision_time) - Date.parse(market.underlyingQuoteTimestamp)) / 1000
      > paperBootstrapAlpacaContractIvPolicy.maturity.maxCurrentObservationAgeSeconds
    || Date.parse(market.quoteReceivedAt) - Date.parse(market.quoteTimestamp) >
      paperBootstrapAlpacaContractIvPolicy.maturity.maxCurrentObservationAgeSeconds * 1000
    || Date.parse(market.quoteTimestamp) > Date.parse(volatility.ivAvailableAt)
    || Date.parse(volatility.ivAvailableAt) > Date.parse(raw.decision_time)) return null;
  return { evidenceId: raw.candidate_id, sourceHash: raw.content_hash, underlying: contract.underlying,
    optionType: contract.optionType, optionSymbol: contract.contractSymbol, dte: contract.dte,
    moneyness: contract.moneyness, iv: volatility.iv, feed: volatility.ivFeed,
    quoteTimestamp: market.quoteTimestamp, ivAvailableAt: volatility.ivAvailableAt,
    decisionTime: raw.decision_time };
}

export async function loadAlpacaContractIvHistory(input: {
  readonly pool: Pool; readonly underlying: string; readonly decisionAsOf: string; readonly lookbackDays: number;
}): Promise<{ readonly observations: readonly AlpacaContractIvHistoryRow[]; readonly sourceUnprovenN: number }> {
  // Bounded recent-row read on the existing schema-064 immutable PIT table.
  // Legacy IV without explicit Alpaca lineage is counted, never upgraded by inference.
  const result = await input.pool.query(`SELECT candidate_id::text,decision_time,content_hash,
      jsonb_build_object('underlying',contract_json->'underlying','contractSymbol',contract_json->'contractSymbol',
        'optionType',contract_json->'optionType','strike',contract_json->'strike',
        'expiration',contract_json->'expiration','dte',contract_json->'dte',
        'moneyness',contract_json->'moneyness') AS contract_json,
      jsonb_build_object('feed',market_json->'feed','dataQuality',market_json->'dataQuality',
        'quoteSource',market_json->'quoteSource','quoteTimestamp',market_json->'quoteTimestamp',
        'quoteReceivedAt',market_json->'quoteReceivedAt',
        'underlyingQuoteSource',market_json->'underlyingQuoteSource',
        'underlyingQuoteTimestamp',market_json->'underlyingQuoteTimestamp',
        'underlyingQuoteReceivedAt',market_json->'underlyingQuoteReceivedAt',
        'underlyingReferencePrice',market_json->'underlyingReferencePrice') AS market_json,
      jsonb_build_object('iv',volatility_json->'iv','ivSource',volatility_json->'ivSource',
        'ivEvidenceAuthority',volatility_json->'ivEvidenceAuthority',
        'ivFeed',volatility_json->'ivFeed','ivAvailableAt',volatility_json->'ivAvailableAt') AS volatility_json
    FROM trade.candidate_point_in_time_evidence
    WHERE branch='THETA_CONVENTIONAL' AND decision_time < $1
      AND decision_time >= ($1::timestamptz - ($2::int * interval '1 day'))
      AND contract_json->>'underlying'=$3
    ORDER BY decision_time DESC,candidate_id DESC LIMIT 5000`,
  [input.decisionAsOf, input.lookbackDays, input.underlying.toUpperCase()]);
  const observations: AlpacaContractIvHistoryRow[] = [];
  let sourceUnprovenN = 0;
  for (const raw of result.rows as Record<string, unknown>[]) {
    const row = { ...raw, decision_time: new Date(raw.decision_time as string).toISOString() };
    const parsed = parseAlpacaContractIvHistoryRow(row);
    if (parsed !== null) observations.push(parsed);
    else if (typeof record(raw.volatility_json)?.iv === 'number'
      && record(raw.volatility_json)?.ivSource !== 'ALPACA') sourceUnprovenN++;
  }
  return { observations, sourceUnprovenN };
}

export async function assessAlpacaContractIvStressForContracts(input: {
  readonly pool: Pool; readonly contracts: readonly NormalizedOptionContract[];
  readonly decisionAsOf: string; readonly policy?: AlpacaContractIvPolicy;
}): Promise<AlpacaContractIvAssessmentMap> {
  const policy = input.policy ?? paperBootstrapAlpacaContractIvPolicy;
  const byUnderlying = new Map<string, Awaited<ReturnType<typeof loadAlpacaContractIvHistory>>>();
  const output: Record<string, AlpacaContractIvAssessment> = {};
  for (const contract of input.contracts) {
    let history = byUnderlying.get(contract.underlying);
    if (history === undefined) {
      history = await loadAlpacaContractIvHistory({ pool: input.pool, underlying: contract.underlying,
        decisionAsOf: input.decisionAsOf, lookbackDays: policy.lookbackDays });
      byUnderlying.set(contract.underlying, history);
    }
    output[contract.optionSymbol] = assessAlpacaContractIvStress({ current: contract,
      history: history.observations, decisionAsOf: input.decisionAsOf, policy });
  }
  return output;
}

/** Reads the committed FusionSnapshot by its primary key. An in-memory
 * assessment, including one that passed a unit test, grants no Paper authority. */
export async function verifyPersistedAlpacaContractIvAssessment(input: {
  readonly pool: Pool; readonly fusionSnapshotId: string;
  readonly optionSymbol: string; readonly underlying: string; readonly decisionAsOf: string;
}): Promise<{ readonly ready: boolean; readonly reason: string; readonly assessment: AlpacaContractIvAssessment | null }> {
  const result = await input.pool.query(`SELECT snapshot_json #>
      ARRAY['riskState','alpacaContractIvStress','assessmentsByContract',$2::text] AS assessment
    FROM trade.fusion_snapshot WHERE fusion_snapshot_id=$1::uuid`,
  [input.fusionSnapshotId, input.optionSymbol]);
  const value = record((result.rows[0] as Record<string, unknown> | undefined)?.assessment);
  if (value === null) return { ready: false, reason: 'PERSISTED_ALPACA_IV_ASSESSMENT_MISSING', assessment: null };
  const { contentHash, ...body } = value;
  if (typeof contentHash !== 'string' || contentHash !== hashJson(body as JsonValue))
    return { ready: false, reason: 'PERSISTED_ALPACA_IV_HASH_MISMATCH', assessment: null };
  const assessment = value as unknown as AlpacaContractIvAssessment;
  const maturity = record(value.maturity);
  if (assessment.contractVersion !== alpacaContractIvDetectorVersion
    || assessment.methodology !== 'ALPACA_CONTRACT_IV_COHORT_SHOCK'
    || assessment.evidenceAuthority !== 'ALPACA_OPTION_SNAPSHOT_CONTRACT_IV'
    || assessment.policyVersion !== paperBootstrapAlpacaContractIvPolicy.policyVersion
    || assessment.policyAuthority !== 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL'
    || assessment.optionSymbol !== input.optionSymbol || assessment.candidateId !== input.optionSymbol
    || assessment.underlying !== input.underlying || assessment.decisionAsOf !== input.decisionAsOf
    || assessment.currentState !== 'QUALIFIED'
    || assessment.currentTimingAuthority !== 'ALPACA_SNAPSHOT_IV_AVAILABLE_AT_RECEIPT'
    || assessment.currentIvProviderTimestamp !== null
    || !Number.isFinite(assessment.currentIv) || (assessment.currentIv as number) < 0
    || (assessment.currentIv as number) > 5
    || (assessment.currentFeed !== 'OPRA' && assessment.currentFeed !== 'INDICATIVE')
    || assessment.currentUnderlyingQuoteSource !== 'ALPACA_IEX'
    || !Number.isFinite(assessment.currentUnderlyingReferencePrice)
    || (assessment.currentUnderlyingReferencePrice as number) <= 0
    || maturity === null || maturity.signal !== 'IV_SHOCK'
    || maturity.source !== 'ALPACA_CONTRACT_IV_SAME_FEED_SESSION_COHORT'
    || maturity.sourceVersion !== alpacaContractIvDetectorVersion
    || maturity.asOf !== input.decisionAsOf
    || !validIso(assessment.currentIvAvailableAt ?? '')
    || !validIso(assessment.currentQuoteProviderAt ?? '')
    || !validIso(assessment.currentQuoteReceivedAt)
    || !validIso(assessment.currentUnderlyingQuoteProviderAt ?? '')
    || !validIso(assessment.currentUnderlyingQuoteReceivedAt ?? '')
    || Date.parse(assessment.currentIvAvailableAt as string) > Date.parse(input.decisionAsOf)
    || Date.parse(assessment.currentQuoteReceivedAt) > Date.parse(input.decisionAsOf)
    || Date.parse(assessment.currentQuoteProviderAt as string) > Date.parse(assessment.currentQuoteReceivedAt)
    || Date.parse(assessment.currentUnderlyingQuoteProviderAt as string)
      > Date.parse(assessment.currentUnderlyingQuoteReceivedAt as string)
    || Date.parse(assessment.currentUnderlyingQuoteReceivedAt as string) > Date.parse(input.decisionAsOf)
    || (Date.parse(input.decisionAsOf) - Date.parse(assessment.currentQuoteProviderAt as string)) / 1000
      > paperBootstrapAlpacaContractIvPolicy.maturity.maxCurrentObservationAgeSeconds
    || (Date.parse(input.decisionAsOf) - Date.parse(assessment.currentUnderlyingQuoteProviderAt as string)) / 1000
      > paperBootstrapAlpacaContractIvPolicy.maturity.maxCurrentObservationAgeSeconds)
    return { ready: false, reason: 'PERSISTED_ALPACA_IV_AUTHORITY_INVALID', assessment: null };
  if (maturity.state === 'DETECTOR_READY' && typeof assessment.stressIvShockDetected === 'boolean')
    return { ready: true, reason: 'PERSISTED_ALPACA_IV_DETECTOR_READY', assessment };
  if (maturity.state === 'BASELINE_ACCUMULATING'
    && assessment.stressIvShockDetected === null
    && Date.parse(input.decisionAsOf) >= Date.parse(paperBootstrapStressColdStartPolicy.effectiveAt))
    return { ready: true, reason: 'PERSISTED_ALPACA_IV_GOVERNED_COLD_START', assessment };
  return { ready: false, reason: `PERSISTED_ALPACA_IV_${maturity.state}`, assessment };
}
