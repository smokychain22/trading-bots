import type { DataQualityState } from './data-freshness.js';
import type { NormalizedOptionContract } from './option-contract.js';
import type { HistoricalBar } from './underlying-history.js';

// R1 Phase 2 item E: further real AEGIS-input derivations, ADDITIVE to the
// existing tickerConcentrationPct/portfolioCapitalAtRiskPct merge in
// account-exposure.ts. Every function here returns null (UNKNOWN) rather
// than a fabricated safe-by-default value whenever its own required
// evidence is missing -- per bots/theta/quant/models/aegis.py's own
// AegisInputs dataclass, providerState/liquidityAcceptable/
// executionQualityAcceptable are all `Optional` fields specifically so a
// genuine UNKNOWN can be sent through the JSON boundary as `null` (Python
// `None`), never coerced to a guessed boolean/string.
//
// Deliberately NOT implemented this pass (documented gaps, never silently
// assumed false/0/safe):
//   - sectorConcentrationPct: no real point-in-time sector-classification
//     source exists yet (neither Alpaca's asset registry nor Optionomics
//     document one) -- remains exactly what the caller supplies.
//   - correlationClusterExposurePct: a real price-return-correlation
//     baseline is POSSIBLE with point-in-time bars across held positions'
//     underlyings, but requires fetching bars for every distinct held
//     underlying (not just the candidate's), which this pass does not
//     yet do -- remains exactly what the caller supplies.
//   - stressIvShockDetected is produced separately by aegis-iv-stress.ts
//     from exact-session Optionomics ATM-IV observations and an explicit
//     maturity policy. stressSpreadWideningDetected is produced per contract
//     by aegis-spread-stress.ts from persisted Alpaca BBO cohorts. Missing,
//     stale, invalid, or immature evidence remains null, never an
//     unevidenced false. Only the explicit versioned Paper cold-start policy
//     can classify an accumulating historical detector as not applicable.

/**
 * Derives AEGIS's `providerState` string (or null/UNKNOWN) from the
 * required-for-new-risk capability qualities already computed this cycle.
 * Mirrors aegis.py's own precedence exactly: any INVALID/NOT_ENTITLED
 * capability maps to the literal string "INVALID" (which aegis.py treats
 * as an immediate HARD_VETO); all GOOD maps to "OK"; anything else
 * (STALE/DEGRADED/UNKNOWN, none of them INVALID) is genuinely UNKNOWN --
 * null, never guessed as "OK" or as a fabricated failure string.
 */
export function deriveProviderState(requiredCapabilityQualities: readonly DataQualityState[]): string | null {
  if (requiredCapabilityQualities.length === 0) return null;
  if (requiredCapabilityQualities.some((q) => q === 'INVALID' || q === 'NOT_ENTITLED')) return 'INVALID';
  if (requiredCapabilityQualities.every((q) => q === 'GOOD')) return 'OK';
  return null;
}

/**
 * Derives a coarse, cycle-level liquidityAcceptable signal from this
 * cycle's actual candidate contracts: true if at least one candidate has
 * a known, executable spread within the policy floor; false only when
 * EVERY candidate's spread is known and exceeds it; null (UNKNOWN) when
 * there is nothing to judge (no candidates, or every candidate's spread
 * itself is unknown). This is a portfolio/account-level AEGIS precondition
 * signal, not a substitute for the real per-candidate execution-quality
 * model that runs later in the pipeline.
 */
export function deriveLiquidityAcceptable(
  candidateContracts: readonly NormalizedOptionContract[],
  maxAcceptableSpreadPct: number,
): boolean | null {
  const known = candidateContracts.filter((c) => c.spreadPct !== null);
  if (known.length === 0) return null;
  if (known.some((c) => (c.spreadPct as number) <= maxAcceptableSpreadPct)) return true;
  return false;
}

/**
 * Derives a coarse executionQualityAcceptable signal: true if at least one
 * candidate has a genuinely executable quote (both bid and ask known,
 * GOOD data quality) this cycle; false only when every candidate is known
 * to lack one; null when there is nothing to judge.
 */
export function deriveExecutionQualityAcceptable(candidateContracts: readonly NormalizedOptionContract[]): boolean | null {
  if (candidateContracts.length === 0) return null;
  if (candidateContracts.some((c) => c.executable)) return true;
  const everyFailureObserved = candidateContracts.every((c) =>
    c.bid !== null && c.ask !== null && c.quoteTimestamp !== null && c.dataQuality !== 'UNKNOWN');
  return everyFailureObserved ? false : null;
}

/** AEGIS's PER_TRADE and EXECUTION inputs must describe the exact option
 * under assessment. A cycle-level "one quote was good" result is never
 * evidence that a different candidate has an executable market. */
export function deriveCandidateMarketQuality(contract: NormalizedOptionContract, maxAcceptableSpreadPct: number): {
  readonly liquidityAcceptable: boolean | null;
  readonly executionQualityAcceptable: boolean | null;
} {
  if (!Number.isFinite(maxAcceptableSpreadPct) || maxAcceptableSpreadPct < 0)
    throw new Error('AEGIS_CANDIDATE_SPREAD_POLICY_INVALID');
  const spreadKnown = contract.spreadPct !== null && Number.isFinite(contract.spreadPct)
    && contract.spreadPct >= 0;
  const liquidityAcceptable = spreadKnown ? (contract.spreadPct as number) <= maxAcceptableSpreadPct : null;
  const quoteKnown = contract.bid !== null && contract.ask !== null && contract.quoteTimestamp !== null
    && contract.feed !== null && contract.source === 'ALPACA' && contract.dataQuality !== 'UNKNOWN';
  const executionQualityAcceptable = contract.executable && contract.dataQuality === 'GOOD'
    && quoteKnown && liquidityAcceptable === true ? true
    : quoteKnown ? false : null;
  return { liquidityAcceptable, executionQualityAcceptable };
}

/**
 * Derives stressGapDetected from the already-computed most-recent 1-day
 * return. A genuine move whose magnitude exceeds the versioned policy
 * threshold is detected. Missing history remains UNKNOWN so AEGIS can fail
 * closed. Absence of evidence must never be rewritten as evidence of no gap.
 */
export function deriveStressGapDetected(ret1d: number | null, thresholdAbsReturn: number): boolean | null {
  if (ret1d === null || !Number.isFinite(ret1d) || !Number.isFinite(thresholdAbsReturn)
    || thresholdAbsReturn <= 0) return null;
  return Math.abs(ret1d) >= thresholdAbsReturn;
}

export interface AegisGapStressPolicy {
  readonly policyVersion: string;
  readonly authority: 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL';
  readonly absoluteReturnThreshold: number;
  readonly returnHorizon: 'CURRENT_SESSION_OPEN_VS_PREVIOUS_COMPLETED_CLOSE';
  readonly barSource: 'ALPACA_1DAY_SPLIT_ADJUSTED_IEX';
  readonly barUnit: 'DECIMAL_RETURN';
  readonly requiredCompletedSessions: 1;
  readonly maxPreviousBarAgeDays: number;
  readonly sessionCalendarAuthority: 'ALPACA_CLOCK_AND_CURRENT_CALENDAR';
}

export interface AegisGapStressAssessment {
  readonly state: 'READY' | 'UNKNOWN';
  readonly reason: string;
  readonly policyVersion: string;
  readonly currentSession: string;
  readonly previousSession: string | null;
  readonly gapReturn: number | null;
  readonly stressGapDetected: boolean | null;
}

/** Uses today's observed open, never today's incomplete daily close. The
 * previous close must come from an earlier daily bar. If Alpaca has not yet
 * published today's bar, the hard-risk input remains unknown. */
export function assessAegisGapStress(input: {
  readonly bars: readonly HistoricalBar[];
  readonly decisionAsOf: string;
  readonly currentSession: string;
  readonly currentSessionConfirmed: boolean;
  readonly policy: AegisGapStressPolicy;
}): AegisGapStressAssessment {
  const { policy, currentSession } = input;
  if (!policy.policyVersion || policy.authority !== 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL'
    || policy.returnHorizon !== 'CURRENT_SESSION_OPEN_VS_PREVIOUS_COMPLETED_CLOSE'
    || policy.barSource !== 'ALPACA_1DAY_SPLIT_ADJUSTED_IEX' || policy.barUnit !== 'DECIMAL_RETURN'
    || policy.requiredCompletedSessions !== 1
    || !Number.isFinite(policy.absoluteReturnThreshold) || policy.absoluteReturnThreshold <= 0
    || !Number.isSafeInteger(policy.maxPreviousBarAgeDays) || policy.maxPreviousBarAgeDays < 1)
    throw new Error('AEGIS_GAP_POLICY_INVALID');
  const unknown = (reason: string, previousSession: string | null = null): AegisGapStressAssessment => ({
    state: 'UNKNOWN', reason, policyVersion: policy.policyVersion, currentSession,
    previousSession, gapReturn: null, stressGapDetected: null,
  });
  const decisionMs = Date.parse(input.decisionAsOf);
  if (!Number.isFinite(decisionMs) || !/^\d{4}-\d{2}-\d{2}$/.test(currentSession)
    || !input.currentSessionConfirmed) return unknown('CURRENT_SESSION_UNCONFIRMED');
  const eligible = input.bars.filter((bar) => bar.provider === 'ALPACA' && bar.feed === 'iex'
    && Number.isFinite(Date.parse(bar.timestamp)) && Date.parse(bar.timestamp) <= decisionMs
    && Number.isFinite(Date.parse(bar.receivedAt)) && Date.parse(bar.receivedAt) <= decisionMs)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const today = eligible.find((bar) => bar.timestamp.slice(0, 10) === currentSession);
  if (today === undefined || !Number.isFinite(today.open) || today.open <= 0) return unknown('CURRENT_SESSION_OPEN_UNAVAILABLE');
  const previous = eligible.find((bar) => bar.timestamp.slice(0, 10) < currentSession);
  if (previous === undefined || !Number.isFinite(previous.close) || previous.close <= 0)
    return unknown('PREVIOUS_COMPLETED_CLOSE_UNAVAILABLE');
  const previousSession = previous.timestamp.slice(0, 10);
  const ageDays = (Date.parse(`${currentSession}T00:00:00.000Z`)
    - Date.parse(`${previousSession}T00:00:00.000Z`)) / 86_400_000;
  if (ageDays <= 0 || ageDays > policy.maxPreviousBarAgeDays) return unknown('PREVIOUS_COMPLETED_CLOSE_STALE', previousSession);
  const gapReturn = (today.open - previous.close) / previous.close;
  return { state: 'READY', reason: 'CURRENT_OPEN_AND_PREVIOUS_CLOSE_OBSERVED',
    policyVersion: policy.policyVersion, currentSession, previousSession,
    gapReturn, stressGapDetected: Math.abs(gapReturn) >= policy.absoluteReturnThreshold };
}
