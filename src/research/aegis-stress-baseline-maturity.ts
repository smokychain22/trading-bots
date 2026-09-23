/**
 * AEGIS stress-baseline maturity contract (Wave 4 item 4). Research-only,
 * `brokerAuthority: false`. A live risk detector cannot honestly require a
 * historical baseline that does not yet exist and then permanently freeze
 * the bot with no explicit policy -- but `null -> false` is equally
 * forbidden (this engagement's standing rule). This module gives the two
 * currently-missing AEGIS stress producers (`stressIvShockDetected`,
 * `stressSpreadWideningDetected`) a real maturity state machine so a
 * detector -- once built -- can honestly report whether it has enough
 * real, PIT-safe evidence to produce a trustworthy boolean, distinct from
 * simply not having been asked yet.
 *
 * This module does NOT decide Production policy (that is
 * `THETA_AEGIS_FIRST_PAPER_POLICY_OPTIONS_V2.md`'s job, handed to Codex/
 * owner) and does NOT invent a universal sample-size threshold -- every
 * sufficiency threshold below is a required, explicit, caller-supplied
 * parameter, never a hidden default.
 */

export const aegisStressBaselineMaturityVersion = 'theta-aegis-stress-baseline-maturity-v1' as const;

export type StressBaselineState =
  | 'BASELINE_NOT_STARTED' | 'BASELINE_ACCUMULATING' | 'BASELINE_SUFFICIENT' | 'BASELINE_INVALID'
  | 'CURRENT_OBSERVATION_STALE' | 'CURRENT_OBSERVATION_INVALID'
  | 'DETECTOR_READY' | 'DETECTOR_PROVIDER_LIMITED';

export const paperBootstrapStressColdStartPolicy = Object.freeze({
  policyVersion: 'aegis-stress-paper-cold-start-v1',
  authority: 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL',
  effectiveAt: '2026-09-23T00:00:00.000Z',
  reviewCondition: 'Review after each detector has at least 20 observations across 5 independent sessions.',
} as const);

export type StressDetectorApplicability = 'REQUIRED' | 'PAPER_COLD_START_NOT_APPLICABLE';

/** Only a real, partially collected historical baseline gets the bounded
 * Paper cold-start exception. Missing providers, stale current evidence,
 * invalid inputs, and an entirely unstarted producer stay REQUIRED and
 * therefore fail closed. No UNKNOWN boolean is converted to false. */
export function paperBootstrapStressApplicability(state: StressBaselineState | null): StressDetectorApplicability {
  return state === 'BASELINE_ACCUMULATING' ? 'PAPER_COLD_START_NOT_APPLICABLE' : 'REQUIRED';
}

export interface BaselineEvidenceCounts {
  readonly rawN: number;
  readonly sessionN: number;
  readonly distinctUnderlyingN: number;
  /** Independent, non-overlapping observation count after accounting for
   * dependence (e.g. same-contract same-session observations are NOT
   * independent) -- `null` when not yet computed. Never assumed equal to `rawN`. */
  readonly effectiveN: number | null;
}

export interface BaselineSufficiencyPolicy {
  readonly policyVersion: string;
  readonly minimumRawN: number;
  readonly minimumSessionN: number;
  readonly minimumDistinctUnderlyingN: number;
  /** Optional because the bootstrap policy predates an effective-N gate.
   * When absent, effective N is observed but never claimed as a policy test. */
  readonly minimumEffectiveN?: number;
  /** Calendar days the evidence must span, minimum. */
  readonly minimumTemporalSpanDays: number;
  /** Max age, in seconds, for the CURRENT observation feeding a live
   * boolean -- separate from the historical baseline's own span. */
  readonly maxCurrentObservationAgeSeconds: number;
}

export interface CurrentObservationEvidence {
  readonly observedAt: string;
  readonly valid: boolean;
  readonly invalidReason: string | null;
}

export interface BaselineMaturityAssessment {
  readonly contractVersion: typeof aegisStressBaselineMaturityVersion;
  readonly signal: 'IV_SHOCK' | 'SPREAD_WIDENING';
  readonly asOf: string;
  readonly evidence: BaselineEvidenceCounts;
  readonly firstObservationAvailableAt: string | null;
  readonly lastObservationAvailableAt: string | null;
  readonly temporalSpanDays: number | null;
  readonly effectiveNPolicyState: 'EFFECTIVE_N_NOT_GOVERNING_POLICY' | 'EFFECTIVE_N_REQUIRED' | 'EFFECTIVE_N_SUFFICIENT' | 'EFFECTIVE_N_INSUFFICIENT';
  readonly source: string;
  readonly sourceVersion: string;
  readonly state: StressBaselineState;
  readonly reason: string;
}

function daysBetween(fromIso: string | null, toIso: string | null): number | null {
  if (fromIso === null || toIso === null) return null;
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, (to - from) / 86_400_000);
}

/**
 * Assesses whether a real historical baseline is sufficient to support a
 * trustworthy live stress boolean, AND whether the current observation
 * (if any) is fresh/valid enough to combine with that baseline. Every
 * threshold in `policy` is required -- this function never substitutes an
 * invented default for a missing policy field.
 *
 * State precedence (checked in this order):
 *  1. `DETECTOR_PROVIDER_LIMITED` -- the provider itself cannot supply this
 *     signal at all (caller must know this independently; this function
 *     does not infer it from absence of evidence, since absence of
 *     evidence here could also mean "not yet queried").
 *  2. `BASELINE_NOT_STARTED` -- zero raw observations.
 *  3. `CURRENT_OBSERVATION_INVALID` -- some baseline evidence exists, but
 *     the live observation this cycle failed validity.
 *  4. `CURRENT_OBSERVATION_STALE` -- some baseline evidence exists, but
 *     the live observation is older than
 *     `maxCurrentObservationAgeSeconds`.
 *  5. `BASELINE_ACCUMULATING` -- the current observation is valid and
 *     fresh, but historical evidence is below `policy`'s minimums on ANY
 *     dimension (raw N, session N, distinct underlyings, temporal span).
 *  6. `DETECTOR_READY` -- baseline sufficient AND current observation
 *     fresh and valid. This is the ONLY state in which this module
 *     considers the detector trustworthy enough to produce a real boolean.
 */
export function assessBaselineMaturity(
  signal: 'IV_SHOCK' | 'SPREAD_WIDENING', asOf: string, source: string, sourceVersion: string,
  evidence: BaselineEvidenceCounts, firstObservationAvailableAt: string | null, lastObservationAvailableAt: string | null,
  policy: BaselineSufficiencyPolicy, currentObservation: CurrentObservationEvidence | null,
  providerLimited: boolean,
): BaselineMaturityAssessment {
  const temporalSpanDays = daysBetween(firstObservationAvailableAt, lastObservationAvailableAt);
  const base = {
    contractVersion: aegisStressBaselineMaturityVersion, signal, asOf, evidence,
    firstObservationAvailableAt, lastObservationAvailableAt, temporalSpanDays, source, sourceVersion,
    effectiveNPolicyState: policy.minimumEffectiveN === undefined ? 'EFFECTIVE_N_NOT_GOVERNING_POLICY' as const
      : evidence.effectiveN === null ? 'EFFECTIVE_N_REQUIRED' as const
      : evidence.effectiveN < policy.minimumEffectiveN ? 'EFFECTIVE_N_INSUFFICIENT' as const
      : 'EFFECTIVE_N_SUFFICIENT' as const,
  };

  const asOfMs = Date.parse(asOf);
  const firstMs = firstObservationAvailableAt === null ? null : Date.parse(firstObservationAvailableAt);
  const lastMs = lastObservationAvailableAt === null ? null : Date.parse(lastObservationAvailableAt);
  const counts = [evidence.rawN, evidence.sessionN, evidence.distinctUnderlyingN, evidence.effectiveN]
    .filter((value): value is number => value !== null);
  const minimums = [policy.minimumRawN, policy.minimumSessionN, policy.minimumDistinctUnderlyingN];
  if (!Number.isFinite(asOfMs) || counts.some((value) => !Number.isSafeInteger(value) || value < 0)
    || minimums.some((value) => !Number.isSafeInteger(value) || value < 0)
    || (policy.minimumEffectiveN !== undefined && (!Number.isSafeInteger(policy.minimumEffectiveN) || policy.minimumEffectiveN < 0))
    || !Number.isFinite(policy.minimumTemporalSpanDays) || policy.minimumTemporalSpanDays < 0
    || !Number.isFinite(policy.maxCurrentObservationAgeSeconds) || policy.maxCurrentObservationAgeSeconds < 0
    || policy.policyVersion.trim() === '' || source.trim() === '' || sourceVersion.trim() === ''
    || (firstMs !== null && !Number.isFinite(firstMs)) || (lastMs !== null && !Number.isFinite(lastMs))
    || (firstMs !== null && lastMs !== null && firstMs > lastMs)
    || (firstMs !== null && firstMs > asOfMs) || (lastMs !== null && lastMs > asOfMs)
    || evidence.sessionN > evidence.rawN || evidence.distinctUnderlyingN > evidence.rawN
    || (evidence.effectiveN !== null && evidence.effectiveN > evidence.rawN)) {
    return { ...base, state: 'BASELINE_INVALID', reason: 'Baseline counts, policy, or point-in-time timestamps are invalid.' };
  }

  if (providerLimited) {
    return { ...base, state: 'DETECTOR_PROVIDER_LIMITED', reason: 'Provider cannot supply this signal; not a data-volume problem.' };
  }
  if (evidence.rawN === 0) {
    return { ...base, state: 'BASELINE_NOT_STARTED', reason: 'Zero raw observations collected.' };
  }

  // A cold-start exception applies only to historical baseline maturity.
  // It must never conceal a stale or invalid current observation. Check the
  // live input before returning BASELINE_ACCUMULATING so callers cannot turn
  // bad current evidence into PAPER_COLD_START_NOT_APPLICABLE.
  if (currentObservation !== null && !currentObservation.valid) {
    return { ...base, state: 'CURRENT_OBSERVATION_INVALID', reason: currentObservation.invalidReason ?? 'Current observation marked invalid.' };
  }
  if (currentObservation !== null) {
    const ageSeconds = (Date.parse(asOf) - Date.parse(currentObservation.observedAt)) / 1000;
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > policy.maxCurrentObservationAgeSeconds) {
      return { ...base, state: 'CURRENT_OBSERVATION_STALE', reason: `Current observation age ${ageSeconds}s exceeds policy max ${policy.maxCurrentObservationAgeSeconds}s (or is invalid/future).` };
    }
  }
  const insufficient: string[] = [];
  if (evidence.rawN < policy.minimumRawN) insufficient.push(`rawN(${evidence.rawN})<min(${policy.minimumRawN})`);
  if (evidence.sessionN < policy.minimumSessionN) insufficient.push(`sessionN(${evidence.sessionN})<min(${policy.minimumSessionN})`);
  if (evidence.distinctUnderlyingN < policy.minimumDistinctUnderlyingN) insufficient.push(`distinctUnderlyingN(${evidence.distinctUnderlyingN})<min(${policy.minimumDistinctUnderlyingN})`);
  if (policy.minimumEffectiveN !== undefined && (evidence.effectiveN === null || evidence.effectiveN < policy.minimumEffectiveN))
    insufficient.push(`effectiveN(${evidence.effectiveN})<min(${policy.minimumEffectiveN})`);
  if (temporalSpanDays === null || temporalSpanDays < policy.minimumTemporalSpanDays) insufficient.push(`temporalSpanDays(${temporalSpanDays})<min(${policy.minimumTemporalSpanDays})`);
  if (insufficient.length > 0) {
    return { ...base, state: 'BASELINE_ACCUMULATING', reason: `Below policy minimums: ${insufficient.join(', ')}.` };
  }

  if (currentObservation === null) {
    return { ...base, state: 'BASELINE_SUFFICIENT', reason: 'Baseline meets every policy minimum; no current observation supplied this cycle.' };
  }

  return { ...base, state: 'DETECTOR_READY', reason: 'Baseline sufficient and current observation fresh/valid -- a trustworthy boolean may be produced.' };
}
