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
  | 'BASELINE_NOT_STARTED' | 'BASELINE_ACCUMULATING' | 'BASELINE_SUFFICIENT'
  | 'CURRENT_OBSERVATION_STALE' | 'CURRENT_OBSERVATION_INVALID'
  | 'DETECTOR_READY' | 'DETECTOR_PROVIDER_LIMITED';

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
 *  3. `BASELINE_ACCUMULATING` -- some evidence, but below `policy`'s
 *     minimums on ANY dimension (raw N, session N, distinct underlyings,
 *     temporal span).
 *  4. `BASELINE_SUFFICIENT` but `CURRENT_OBSERVATION_INVALID` -- baseline
 *     is real, but the live observation this cycle failed validity.
 *  5. `BASELINE_SUFFICIENT` but `CURRENT_OBSERVATION_STALE` -- baseline is
 *     real, but the live observation is older than
 *     `maxCurrentObservationAgeSeconds`.
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
  };

  if (providerLimited) {
    return { ...base, state: 'DETECTOR_PROVIDER_LIMITED', reason: 'Provider cannot supply this signal; not a data-volume problem.' };
  }
  if (evidence.rawN === 0) {
    return { ...base, state: 'BASELINE_NOT_STARTED', reason: 'Zero raw observations collected.' };
  }
  const insufficient: string[] = [];
  if (evidence.rawN < policy.minimumRawN) insufficient.push(`rawN(${evidence.rawN})<min(${policy.minimumRawN})`);
  if (evidence.sessionN < policy.minimumSessionN) insufficient.push(`sessionN(${evidence.sessionN})<min(${policy.minimumSessionN})`);
  if (evidence.distinctUnderlyingN < policy.minimumDistinctUnderlyingN) insufficient.push(`distinctUnderlyingN(${evidence.distinctUnderlyingN})<min(${policy.minimumDistinctUnderlyingN})`);
  if (temporalSpanDays === null || temporalSpanDays < policy.minimumTemporalSpanDays) insufficient.push(`temporalSpanDays(${temporalSpanDays})<min(${policy.minimumTemporalSpanDays})`);
  if (insufficient.length > 0) {
    return { ...base, state: 'BASELINE_ACCUMULATING', reason: `Below policy minimums: ${insufficient.join(', ')}.` };
  }

  if (currentObservation === null) {
    return { ...base, state: 'BASELINE_SUFFICIENT', reason: 'Baseline meets every policy minimum; no current observation supplied this cycle.' };
  }
  if (!currentObservation.valid) {
    return { ...base, state: 'CURRENT_OBSERVATION_INVALID', reason: currentObservation.invalidReason ?? 'Current observation marked invalid.' };
  }
  const ageSeconds = (Date.parse(asOf) - Date.parse(currentObservation.observedAt)) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > policy.maxCurrentObservationAgeSeconds) {
    return { ...base, state: 'CURRENT_OBSERVATION_STALE', reason: `Current observation age ${ageSeconds}s exceeds policy max ${policy.maxCurrentObservationAgeSeconds}s (or is invalid/future).` };
  }

  return { ...base, state: 'DETECTOR_READY', reason: 'Baseline sufficient and current observation fresh/valid -- a trustworthy boolean may be produced.' };
}
