// R1C: differentiated data-quality/freshness classification. Different
// observation classes have genuinely different acceptable staleness --
// an open-interest snapshot from minutes ago is routine; a bid/ask quote
// from minutes ago is not. This module intentionally uses ONE arbitrary
// global constant nowhere: every class gets its own versioned threshold.
//
// UNKNOWN != STALE != INVALID != 0. A missing value stays missing (null,
// upstream) -- this module only classifies the QUALITY of an observation
// that exists, given its age and the provider's own reported entitlement/
// reachability state; it never fabricates a value for a class it cannot
// observe.

export type DataQualityState = 'GOOD' | 'DEGRADED' | 'STALE' | 'UNKNOWN' | 'INVALID' | 'NOT_ENTITLED';

export type ObservationClass =
  | 'UNDERLYING_QUOTE'
  | 'OPTION_QUOTE'
  | 'OPTION_GREEKS'
  | 'OPTION_OPEN_INTEREST'
  | 'OPTION_VOLUME'
  | 'ACCOUNT'
  | 'POSITIONS'
  | 'ORDERS'
  | 'MARKET_CLOCK'
  | 'EVENT_DATA'
  | 'OPTIONOMICS_ANALYTICS';

export interface FreshnessPolicy {
  readonly policyVersion: string;
  // Age (seconds) at or below which an observation is GOOD; between good
  // and stale is DEGRADED (still usable, flagged); at or beyond stale is
  // STALE (not usable for a fresh decision without an explicit fallback).
  readonly goodMaxAgeSeconds: number;
  readonly staleMinAgeSeconds: number; // must be >= goodMaxAgeSeconds
}

// Defaults are explicitly research/engineering placeholders, not asserted
// production-optimal (same discipline as every other versioned policy in
// this repo) -- a real deployment supplies its own versioned
// FreshnessPolicy per class rather than trusting these forever.
export const DEFAULT_FRESHNESS_POLICIES: Readonly<Record<ObservationClass, FreshnessPolicy>> = {
  UNDERLYING_QUOTE: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 5, staleMinAgeSeconds: 30 },
  OPTION_QUOTE: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 10, staleMinAgeSeconds: 60 },
  OPTION_GREEKS: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 60, staleMinAgeSeconds: 300 },
  OPTION_OPEN_INTEREST: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 3600, staleMinAgeSeconds: 86_400 },
  OPTION_VOLUME: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 300, staleMinAgeSeconds: 3600 },
  ACCOUNT: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 30, staleMinAgeSeconds: 300 },
  POSITIONS: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 30, staleMinAgeSeconds: 300 },
  ORDERS: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 10, staleMinAgeSeconds: 60 },
  MARKET_CLOCK: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 300, staleMinAgeSeconds: 3600 },
  EVENT_DATA: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 3600, staleMinAgeSeconds: 86_400 },
  OPTIONOMICS_ANALYTICS: { policyVersion: 'freshness-v1', goodMaxAgeSeconds: 300, staleMinAgeSeconds: 3600 },
};

export interface ObservationInput {
  readonly observationClass: ObservationClass;
  readonly observedAt: string | null; // provider-reported timestamp; null = UNKNOWN
  readonly receivedAt: string; // when THETA's process received this observation
  readonly providerEntitlement: 'ENTITLED' | 'NOT_ENTITLED' | 'UNKNOWN';
  readonly providerReachable: boolean; // false = the provider call itself failed (network/5xx/etc.)
  readonly valuePresent: boolean; // false = the provider responded but omitted this specific field (e.g. no Greeks in this snapshot)
}

export interface ObservationQuality {
  readonly observationClass: ObservationClass;
  readonly state: DataQualityState;
  readonly ageSeconds: number | null;
  readonly policyVersion: string;
  readonly reason: string;
}

/**
 * Classifies one observation's quality against its class's OWN freshness
 * policy. Precedence, most restrictive first: unreachable provider ->
 * UNKNOWN; NOT_ENTITLED -> NOT_ENTITLED; missing value -> UNKNOWN; missing
 * timestamp (value present but no observedAt) -> UNKNOWN (never assumed
 * fresh); age >= staleMinAgeSeconds -> STALE; age > goodMaxAgeSeconds ->
 * DEGRADED; otherwise GOOD.
 */
export function classifyObservation(
  input: ObservationInput,
  policy: FreshnessPolicy,
): ObservationQuality {
  const base = { observationClass: input.observationClass, policyVersion: policy.policyVersion };

  if (!input.providerReachable) {
    return { ...base, state: 'UNKNOWN', ageSeconds: null, reason: 'Provider was unreachable for this observation.' };
  }
  if (input.providerEntitlement === 'NOT_ENTITLED') {
    return { ...base, state: 'NOT_ENTITLED', ageSeconds: null, reason: 'Provider reports this capability is not entitled for this account/plan.' };
  }
  if (!input.valuePresent) {
    return { ...base, state: 'UNKNOWN', ageSeconds: null, reason: 'Provider response omitted this field -- UNKNOWN, never coerced to zero/default.' };
  }
  if (input.observedAt === null) {
    return { ...base, state: 'UNKNOWN', ageSeconds: null, reason: 'Value present but no observation timestamp -- freshness cannot be confirmed.' };
  }

  const ageSeconds = (new Date(input.receivedAt).getTime() - new Date(input.observedAt).getTime()) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return { ...base, state: 'INVALID', ageSeconds: null, reason: 'observedAt/receivedAt could not be parsed into a valid non-negative age.' };
  }
  if (ageSeconds >= policy.staleMinAgeSeconds) {
    return { ...base, state: 'STALE', ageSeconds, reason: `age ${ageSeconds}s >= staleMinAgeSeconds ${policy.staleMinAgeSeconds}s for ${input.observationClass}.` };
  }
  if (ageSeconds > policy.goodMaxAgeSeconds) {
    return { ...base, state: 'DEGRADED', ageSeconds, reason: `age ${ageSeconds}s exceeds goodMaxAgeSeconds ${policy.goodMaxAgeSeconds}s for ${input.observationClass}, but is not yet STALE.` };
  }
  return { ...base, state: 'GOOD', ageSeconds, reason: `age ${ageSeconds}s within goodMaxAgeSeconds ${policy.goodMaxAgeSeconds}s for ${input.observationClass}.` };
}

export function classifyObservations(
  inputs: readonly ObservationInput[],
  policies: Readonly<Record<ObservationClass, FreshnessPolicy>> = DEFAULT_FRESHNESS_POLICIES,
): readonly ObservationQuality[] {
  return inputs.map((input) => classifyObservation(input, policies[input.observationClass]));
}
