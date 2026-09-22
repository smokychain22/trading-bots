import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalJson, hashJson, type JsonValue } from '../market/fusion-snapshot.js';
import {
  assessBaselineMaturity,
  type BaselineMaturityAssessment,
  type BaselineSufficiencyPolicy,
} from '../research/aegis-stress-baseline-maturity.js';
import {
  fetchOptionomicsContextObservation,
  type NormalizedOptionomicsContextObservation,
  type OptionomicsProviderConfig,
} from './optionomics-provider.js';

export const optionomicsIvSessionObservationVersion = 'theta-optionomics-atm-iv-session-v1' as const;
export const aegisIvStressDetectorVersion = 'theta-aegis-iv-stress-detector-v1' as const;

export interface OptionomicsIvSessionObservation {
  readonly observationId: string;
  readonly underlying: string;
  readonly sessionDate: string;
  readonly requestedAt: string;
  readonly retrievedAt: string;
  readonly providerTimestamp: string | null;
  readonly thetaFirstObservedAt: string;
  readonly atmIv: number;
  readonly normalizedUnits: 'DECIMAL_BY_CONSERVATIVE_RANGE_VALIDATION';
  readonly providerUnits: string;
  readonly operationAlias: string;
  readonly contractVersion: string;
  readonly evidenceAuthority: 'OPTIONOMICS_SESSION_RESEARCH';
  readonly responseHash: string;
  readonly requestParameters: Readonly<Record<string, string>>;
  readonly rawPayload: unknown;
  readonly contentHash: string;
}

export type OptionomicsIvObservationResult =
  | { readonly state: 'KNOWN'; readonly observation: OptionomicsIvSessionObservation }
  | { readonly state: 'UNKNOWN' | 'INVALID'; readonly reason: string };

export interface AegisIvStressPolicy {
  readonly policyVersion: string;
  readonly authority: 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL';
  readonly maximumBaselineSessions: number;
  readonly minimumAbsoluteIncrease: number;
  readonly minimumRelativeIncrease: number;
  readonly minimumRobustZ: number;
  readonly maturity: BaselineSufficiencyPolicy;
}

export interface AegisIvStressAssessment {
  readonly contractVersion: typeof aegisIvStressDetectorVersion;
  readonly underlying: string;
  readonly decisionAsOf: string;
  readonly currentObservationId: string;
  readonly baselineObservationIds: readonly string[];
  readonly policyVersion: string;
  readonly policyAuthority: AegisIvStressPolicy['authority'];
  readonly maturity: BaselineMaturityAssessment;
  readonly currentIv: number;
  readonly baselineMedianIv: number | null;
  readonly baselineMadIv: number | null;
  readonly absoluteIncrease: number | null;
  readonly relativeIncrease: number | null;
  readonly robustZ: number | null;
  readonly stressIvShockDetected: boolean | null;
  readonly evidenceAuthority: 'OPTIONOMICS_SESSION_RESEARCH';
  readonly contentHash: string;
}

export interface AegisIvStressRefreshResult {
  readonly state: 'READY' | 'BASELINE_IMMATURE' | 'PROVIDER_ERROR' | 'OBSERVATION_UNKNOWN' | 'INVALID';
  readonly assessment: AegisIvStressAssessment | null;
  readonly reason: string;
}

export const paperBootstrapAegisIvStressPolicy: AegisIvStressPolicy = Object.freeze({
  policyVersion: 'aegis-iv-shock-paper-bootstrap-v1',
  authority: 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL',
  maximumBaselineSessions: 40,
  minimumAbsoluteIncrease: 0.03,
  minimumRelativeIncrease: 0.25,
  minimumRobustZ: 3,
  maturity: {
    policyVersion: 'aegis-iv-baseline-paper-bootstrap-v1',
    minimumRawN: 20,
    minimumSessionN: 20,
    minimumDistinctUnderlyingN: 1,
    // Exact distinct trading sessions already carry the economic time span.
    // Historical backfill is first observed in one bounded run, so requiring
    // an artificial wall-clock collection delay would create false paralysis.
    minimumTemporalSpanDays: 0,
    maxCurrentObservationAgeSeconds: 86_400,
  },
});

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(createHash('sha256').update(value).digest('hex').slice(0, 32), 'hex');
  const version = bytes.at(6), variant = bytes.at(8);
  if (version === undefined || variant === undefined) throw new Error('IV_STRESS_UUID_HASH_INVALID');
  bytes[6] = (version & 0x0f) | 0x40;
  bytes[8] = (variant & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function validIso(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function valueRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>> : null;
}

export function normalizeOptionomicsAtmIvObservation(
  input: NormalizedOptionomicsContextObservation,
  thetaFirstObservedAt = input.retrievedAt,
): OptionomicsIvObservationResult {
  if (input.family !== 'METRICS' || input.operationAlias !== 'optionomics.get_symbol_metrics') {
    return { state: 'INVALID', reason: 'OPTIONOMICS_METRICS_OPERATION_REQUIRED' };
  }
  if (input.underlying === null || !/^[A-Z0-9._-]{1,16}$/.test(input.underlying.toUpperCase())) {
    return { state: 'INVALID', reason: 'UNDERLYING_INVALID' };
  }
  if (input.sessionDate === null || !validDate(input.sessionDate)) {
    return { state: 'UNKNOWN', reason: 'SERVED_SESSION_DATE_UNAVAILABLE' };
  }
  const requestedDate = input.requestParameters.date;
  if (requestedDate !== undefined && requestedDate !== input.sessionDate) {
    return { state: 'INVALID', reason: 'REQUESTED_SERVED_SESSION_MISMATCH' };
  }
  if (!validIso(input.requestedAt) || !validIso(input.retrievedAt) || !validIso(thetaFirstObservedAt)
    || Date.parse(input.requestedAt) > Date.parse(input.retrievedAt)
    || Date.parse(input.retrievedAt) > Date.parse(thetaFirstObservedAt)) {
    return { state: 'INVALID', reason: 'OBSERVATION_TIME_INVALID' };
  }
  if (input.providerTimestamp !== null
    && (!validIso(input.providerTimestamp) || Date.parse(input.providerTimestamp) > Date.parse(thetaFirstObservedAt))) {
    return { state: 'INVALID', reason: 'PROVIDER_TIMESTAMP_INVALID_OR_FUTURE' };
  }
  const atmIv = valueRecord(input.normalized.atmIv);
  if (atmIv?.state !== 'KNOWN') return { state: 'UNKNOWN', reason: 'ATM_IV_NOT_KNOWN' };
  const value = atmIv.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 5) {
    return { state: 'INVALID', reason: 'ATM_IV_NOT_FINITE_DECIMAL_RANGE' };
  }
  const identity = {
    version: optionomicsIvSessionObservationVersion,
    underlying: input.underlying.toUpperCase(), sessionDate: input.sessionDate,
    requestedAt: input.requestedAt, retrievedAt: input.retrievedAt,
    providerTimestamp: input.providerTimestamp, thetaFirstObservedAt, atmIv: value,
    normalizedUnits: 'DECIMAL_BY_CONSERVATIVE_RANGE_VALIDATION',
    providerUnits: typeof atmIv.units === 'string' ? atmIv.units : 'PROVIDER_REPORTED_UNVERIFIED',
    operationAlias: input.operationAlias, contractVersion: input.contractVersion,
    evidenceAuthority: 'OPTIONOMICS_SESSION_RESEARCH', responseHash: input.responseHash,
    requestParameters: input.requestParameters,
  } as const;
  const contentHash = hashJson(identity as unknown as JsonValue);
  return { state: 'KNOWN', observation: {
    ...identity, observationId: deterministicUuid(`optionomics-iv-session:${contentHash}`),
    rawPayload: input.rawPayload, contentHash,
  } };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : sorted[middle] as number;
}

function assessmentHash(value: Omit<AegisIvStressAssessment, 'contentHash'>): string {
  return hashJson(value as unknown as JsonValue);
}

export function assessAegisIvStress(input: {
  readonly current: OptionomicsIvSessionObservation;
  readonly history: readonly OptionomicsIvSessionObservation[];
  readonly decisionAsOf: string;
  readonly policy: AegisIvStressPolicy;
}): AegisIvStressAssessment {
  if (!validIso(input.decisionAsOf) || input.policy.policyVersion.trim() === ''
    || input.policy.authority !== 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL'
    || !Number.isSafeInteger(input.policy.maximumBaselineSessions) || input.policy.maximumBaselineSessions < 1
    || !Number.isFinite(input.policy.minimumAbsoluteIncrease) || input.policy.minimumAbsoluteIncrease < 0
    || !Number.isFinite(input.policy.minimumRelativeIncrease) || input.policy.minimumRelativeIncrease < 0
    || !Number.isFinite(input.policy.minimumRobustZ) || input.policy.minimumRobustZ < 0) {
    throw new Error('AEGIS_IV_STRESS_POLICY_INVALID');
  }
  if (Date.parse(input.current.thetaFirstObservedAt) > Date.parse(input.decisionAsOf)) {
    throw new Error('AEGIS_IV_STRESS_CURRENT_EVIDENCE_FROM_FUTURE');
  }
  const eligible = input.history.filter((row) => row.underlying === input.current.underlying
      && row.sessionDate < input.current.sessionDate
      && Date.parse(row.thetaFirstObservedAt) <= Date.parse(input.decisionAsOf))
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate)
      || b.thetaFirstObservedAt.localeCompare(a.thetaFirstObservedAt));
  const bySession = new Map<string, OptionomicsIvSessionObservation>();
  for (const row of eligible) if (!bySession.has(row.sessionDate)) bySession.set(row.sessionDate, row);
  const baseline = [...bySession.values()].slice(0, input.policy.maximumBaselineSessions)
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const values = baseline.map((row) => row.atmIv);
  const baselineMedianIv = median(values);
  const baselineMadIv = baselineMedianIv === null ? null : median(values.map((value) => Math.abs(value - baselineMedianIv)));
  const maturity = assessBaselineMaturity('IV_SHOCK', input.decisionAsOf,
    'OPTIONOMICS_ATM_IV_EXACT_SESSION', optionomicsIvSessionObservationVersion,
    { rawN: baseline.length, sessionN: baseline.length, distinctUnderlyingN: baseline.length === 0 ? 0 : 1, effectiveN: null },
    baseline.at(0)?.thetaFirstObservedAt ?? null, baseline.at(-1)?.thetaFirstObservedAt ?? null,
    input.policy.maturity,
    { observedAt: input.current.thetaFirstObservedAt, valid: true, invalidReason: null }, false);
  const absoluteIncrease = baselineMedianIv === null ? null : input.current.atmIv - baselineMedianIv;
  const relativeIncrease = baselineMedianIv === null || baselineMedianIv === 0 ? null : absoluteIncrease as number / baselineMedianIv;
  const robustZ = baselineMadIv === null || baselineMadIv === 0 || absoluteIncrease === null
    ? null : absoluteIncrease / (1.4826 * baselineMadIv);
  const stressIvShockDetected = maturity.state !== 'DETECTOR_READY' || absoluteIncrease === null || relativeIncrease === null
    ? null
    : absoluteIncrease >= input.policy.minimumAbsoluteIncrease
      && relativeIncrease >= input.policy.minimumRelativeIncrease
      && (robustZ === null || robustZ >= input.policy.minimumRobustZ);
  const withoutHash = {
    contractVersion: aegisIvStressDetectorVersion,
    underlying: input.current.underlying, decisionAsOf: input.decisionAsOf,
    currentObservationId: input.current.observationId,
    baselineObservationIds: baseline.map((row) => row.observationId),
    policyVersion: input.policy.policyVersion, policyAuthority: input.policy.authority,
    maturity, currentIv: input.current.atmIv, baselineMedianIv, baselineMadIv,
    absoluteIncrease, relativeIncrease, robustZ, stressIvShockDetected,
    evidenceAuthority: 'OPTIONOMICS_SESSION_RESEARCH',
  } as const;
  return { ...withoutHash, contentHash: assessmentHash(withoutHash) };
}

export class PostgresAegisIvStressStore {
  constructor(private readonly pool: Pool) {}

  async persistObservation(observation: OptionomicsIvSessionObservation): Promise<void> {
    await this.pool.query(`INSERT INTO market.optionomics_iv_session_observation(
      observation_id,underlying,session_date,requested_at,retrieved_at,provider_timestamp,theta_first_observed_at,
      atm_iv,normalized_units,provider_units,operation_alias,contract_version,evidence_authority,response_hash,
      request_parameters_json,raw_payload_json,content_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17)
      ON CONFLICT(underlying,session_date,response_hash) DO NOTHING`, [
      observation.observationId, observation.underlying, observation.sessionDate, observation.requestedAt,
      observation.retrievedAt, observation.providerTimestamp, observation.thetaFirstObservedAt, observation.atmIv,
      observation.normalizedUnits, observation.providerUnits, observation.operationAlias, observation.contractVersion,
      observation.evidenceAuthority, observation.responseHash, canonicalJson(observation.requestParameters as JsonValue),
      canonicalJson(observation.rawPayload as JsonValue), observation.contentHash,
    ]);
  }

  async listObservations(underlying: string, decisionAsOf: string): Promise<readonly OptionomicsIvSessionObservation[]> {
    const result = await this.pool.query(`SELECT observation_id,underlying,session_date::text,requested_at,retrieved_at,
      provider_timestamp,theta_first_observed_at,atm_iv::float8,normalized_units,provider_units,operation_alias,
      contract_version,evidence_authority,response_hash,request_parameters_json,raw_payload_json,content_hash
      FROM market.optionomics_iv_session_observation
      WHERE underlying=$1 AND theta_first_observed_at <= $2
      ORDER BY session_date,theta_first_observed_at,observation_id`, [underlying.toUpperCase(), decisionAsOf]);
    return result.rows.map((row) => ({
      observationId: String(row.observation_id), underlying: String(row.underlying), sessionDate: String(row.session_date),
      requestedAt: new Date(row.requested_at).toISOString(), retrievedAt: new Date(row.retrieved_at).toISOString(),
      providerTimestamp: row.provider_timestamp === null ? null : new Date(row.provider_timestamp).toISOString(),
      thetaFirstObservedAt: new Date(row.theta_first_observed_at).toISOString(), atmIv: Number(row.atm_iv),
      normalizedUnits: 'DECIMAL_BY_CONSERVATIVE_RANGE_VALIDATION', providerUnits: String(row.provider_units),
      operationAlias: String(row.operation_alias), contractVersion: String(row.contract_version),
      evidenceAuthority: 'OPTIONOMICS_SESSION_RESEARCH', responseHash: String(row.response_hash),
      requestParameters: row.request_parameters_json as Record<string, string>, rawPayload: row.raw_payload_json,
      contentHash: String(row.content_hash),
    }));
  }

  async persistAssessment(assessment: AegisIvStressAssessment): Promise<void> {
    const assessmentId = deterministicUuid(`aegis-iv-stress:${assessment.contentHash}`);
    await this.pool.query(`INSERT INTO risk.aegis_iv_stress_assessment(
      assessment_id,underlying,decision_as_of,current_observation_id,policy_version,baseline_state,
      stress_iv_shock_detected,current_iv,baseline_median_iv,baseline_mad_iv,absolute_increase,relative_increase,
      robust_z,raw_n,session_n,baseline_observation_ids_json,assessment_json,content_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18)
      ON CONFLICT(content_hash) DO NOTHING`, [assessmentId, assessment.underlying, assessment.decisionAsOf,
      assessment.currentObservationId, assessment.policyVersion, assessment.maturity.state,
      assessment.stressIvShockDetected, assessment.currentIv, assessment.baselineMedianIv, assessment.baselineMadIv,
      assessment.absoluteIncrease, assessment.relativeIncrease, assessment.robustZ, assessment.maturity.evidence.rawN,
      assessment.maturity.evidence.sessionN, canonicalJson(assessment.baselineObservationIds as unknown as JsonValue),
      canonicalJson(assessment as unknown as JsonValue), assessment.contentHash]);
  }
}

export async function refreshAegisIvStress(input: {
  readonly pool: Pool;
  readonly optionomics: OptionomicsProviderConfig;
  readonly underlying?: string;
  readonly decisionAsOf: string;
  readonly policy?: AegisIvStressPolicy;
}): Promise<AegisIvStressRefreshResult> {
  const underlying = (input.underlying ?? 'SPY').toUpperCase();
  const outcome = await fetchOptionomicsContextObservation(input.optionomics, 'METRICS', underlying);
  if (outcome.kind === 'REQUEST_ERROR') return {
    state: 'PROVIDER_ERROR', assessment: null,
    reason: `OPTIONOMICS_METRICS_${outcome.errorClass}`,
  };
  if (outcome.kind === 'VALUE_UNKNOWN_AFTER_SUCCESS') return {
    state: 'OBSERVATION_UNKNOWN', assessment: null,
    reason: 'OPTIONOMICS_METRICS_RESPONSE_UNRECOGNIZED',
  };
  const normalized = normalizeOptionomicsAtmIvObservation(outcome.value);
  if (normalized.state !== 'KNOWN') return {
    state: normalized.state === 'INVALID' ? 'INVALID' : 'OBSERVATION_UNKNOWN', assessment: null,
    reason: normalized.reason,
  };
  const store = new PostgresAegisIvStressStore(input.pool);
  await store.persistObservation(normalized.observation);
  const history = await store.listObservations(underlying, input.decisionAsOf);
  const assessment = assessAegisIvStress({ current: normalized.observation, history,
    decisionAsOf: input.decisionAsOf, policy: input.policy ?? paperBootstrapAegisIvStressPolicy });
  await store.persistAssessment(assessment);
  return assessment.maturity.state === 'DETECTOR_READY'
    ? { state: 'READY', assessment, reason: 'REAL_OPTIONOMICS_IV_BASELINE_AND_CURRENT_SESSION_READY' }
    : { state: 'BASELINE_IMMATURE', assessment, reason: assessment.maturity.reason };
}
