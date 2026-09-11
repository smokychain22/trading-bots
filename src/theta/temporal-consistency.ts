import { classifyObservation, type DataQualityState, type FreshnessPolicy, type ObservationClass } from './data-freshness.js';

// R1 Phase 2 item B: versioned point-in-time temporal-consistency policy.
// Two SEPARATE questions, never collapsed into one:
//   1. Is EACH observation individually fresh enough for its own class? --
//      already answered per-observation by data-freshness.ts's
//      classifyObservation/FreshnessPolicy (goodMaxAge/staleMinAge PER
//      CLASS -- an OI snapshot from an hour ago is routine; a bid/ask
//      quote from an hour ago is not).
//   2. Do the observations THIS DECISION combines actually describe the
//      SAME moment in the market closely enough to be treated as one
//      coherent state? -- answered here: pairwise SKEW across the
//      REQUIRED observations' own timestamps, never a single global TTL.
//
// A decision that fails either question is SYSTEM_HOLD with a PRECISE
// reason (SYSTEM_HOLD_STALE_<CLASS> or SYSTEM_HOLD_DATA_SKEW) -- never a
// strategy WAIT/PASS and never HARD_VETO. Both are runtime preconditions,
// not economic evaluations or risk prohibitions.
//
// No forward-filled future values: an observedAt strictly after
// decisionTimeUtc (receivedAt) is never treated as valid -- classifyObservation
// already reports that as INVALID (negative age), and this module treats
// INVALID the same as STALE for skew purposes (never silently ignored).

export type DecisionKind = 'NEW_RISK' | 'MANAGEMENT';

export interface TemporalConsistencyPolicy {
  readonly policyVersion: string;
  // Per-class individual freshness -- reused, not reinvented. Different
  // policies are expected for NEW_RISK vs MANAGEMENT decisions (e.g. a
  // management decision on a position with low DTE/high gamma may need a
  // stricter OPTION_QUOTE policy than routine new-risk scanning).
  readonly freshnessPolicies: Readonly<Partial<Record<ObservationClass, FreshnessPolicy>>>;
  // Maximum tolerated pairwise skew (seconds) between any two REQUIRED
  // observations' own timestamps for this decision kind. A single global
  // constant per decisionKind, not per pair -- if a future need arises for
  // per-pair tolerance, that is a versioned policy revision, not a silent
  // code change.
  readonly maxSkewSeconds: number;
}

export interface TemporalObservationInput {
  readonly observationClass: ObservationClass;
  readonly observedAt: string | null;
  readonly required: boolean; // only required observations gate the decision or count toward skew
  readonly valuePresent: boolean;
  readonly providerReachable: boolean;
  readonly providerEntitlement: 'ENTITLED' | 'NOT_ENTITLED' | 'UNKNOWN';
}

export type TemporalConsistencyResult =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly reasonCode: string; readonly detail: string };

/**
 * Checks BOTH individual per-class freshness and cross-observation skew
 * for one decision's set of real observations. Returns the FIRST failure
 * found (individual staleness before skew, since a single stale required
 * observation is a more specific, more actionable reason than a vague
 * skew report) -- never both silently merged into one message.
 */
export function checkTemporalConsistency(
  observations: readonly TemporalObservationInput[],
  receivedAt: string,
  policy: TemporalConsistencyPolicy,
): TemporalConsistencyResult {
  const required = observations.filter((o) => o.required);

  // Question 1: per-class individual freshness.
  for (const observation of required) {
    const classPolicy = policy.freshnessPolicies[observation.observationClass];
    if (classPolicy === undefined) continue; // no policy configured for this class -- not this function's concern
    const quality = classifyObservation(
      {
        observationClass: observation.observationClass, observedAt: observation.observedAt, receivedAt,
        providerEntitlement: observation.providerEntitlement, providerReachable: observation.providerReachable,
        valuePresent: observation.valuePresent,
      },
      classPolicy,
    );
    if (quality.state === 'STALE' || quality.state === 'INVALID') {
      return {
        ok: false,
        reasonCode: `SYSTEM_HOLD_STALE_${observation.observationClass}`,
        detail: `${observation.observationClass} is ${quality.state}: ${quality.reason}`,
      };
    }
  }

  // Question 2: pairwise skew across required observations with a KNOWN,
  // valid (non-future) timestamp. Observations with no timestamp (already
  // UNKNOWN per classifyObservation) cannot contribute to a skew
  // computation and are simply excluded -- their own UNKNOWN-ness is a
  // separate, already-handled fact, never silently treated as "in sync."
  const ages: number[] = [];
  for (const observation of required) {
    if (observation.observedAt === null) continue;
    const ageSeconds = (new Date(receivedAt).getTime() - new Date(observation.observedAt).getTime()) / 1000;
    if (Number.isFinite(ageSeconds) && ageSeconds >= 0) ages.push(ageSeconds);
  }
  if (ages.length >= 2) {
    const skewSeconds = Math.max(...ages) - Math.min(...ages);
    if (skewSeconds > policy.maxSkewSeconds) {
      return {
        ok: false,
        reasonCode: 'SYSTEM_HOLD_DATA_SKEW',
        detail: `Required observations span ${skewSeconds.toFixed(1)}s, exceeding the ${policy.maxSkewSeconds}s tolerance for this ${policy.policyVersion} policy -- not treated as one coherent market state.`,
      };
    }
  }

  return { ok: true, detail: 'All required observations are individually fresh and mutually consistent within tolerance.' };
}

// Versioned, research-placeholder defaults -- explicitly NOT asserted
// production-optimal, same discipline as every other policy default in
// this repo. NEW_RISK uses the existing OPTION_QUOTE/ACCOUNT/MARKET_CLOCK
// freshness policies at their normal tolerance; MANAGEMENT is stricter on
// OPTION_QUOTE (a low-DTE/high-gamma position needs a fresher quote before
// a close/roll decision) and on skew overall.
export const DEFAULT_TEMPORAL_CONSISTENCY_POLICIES: Readonly<Record<DecisionKind, TemporalConsistencyPolicy>> = {
  NEW_RISK: {
    policyVersion: 'temporal-consistency-v1-new-risk',
    freshnessPolicies: {
      ACCOUNT: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 30, staleMinAgeSeconds: 300 },
      OPTION_QUOTE: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 10, staleMinAgeSeconds: 60 },
      MARKET_CLOCK: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 300, staleMinAgeSeconds: 3600 },
    },
    maxSkewSeconds: 120,
  },
  MANAGEMENT: {
    policyVersion: 'temporal-consistency-v1-management',
    freshnessPolicies: {
      ACCOUNT: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 30, staleMinAgeSeconds: 180 },
      POSITIONS: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 30, staleMinAgeSeconds: 180 },
      OPTION_QUOTE: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 5, staleMinAgeSeconds: 30 },
      MARKET_CLOCK: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 300, staleMinAgeSeconds: 3600 },
    },
    maxSkewSeconds: 60,
  },
};

export type { DataQualityState };
