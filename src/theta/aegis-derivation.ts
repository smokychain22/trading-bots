import type { DataQualityState } from './data-freshness.js';
import type { NormalizedOptionContract } from './option-contract.js';

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
//   - stressIvShockDetected / stressSpreadWideningDetected: aegis.py
//     requires these as concrete (non-nullable) booleans, and no real IV-
//     history or spread-history baseline exists yet to detect a genuine
//     shock/widening against -- they stay caller-supplied `false`
//     (meaning "not detected by any implemented rule", never "confirmed
//     absent"), per aegis.py's own detector-flag semantics.

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
  return false;
}

/**
 * Derives stressGapDetected -- a REQUIRED (non-nullable) boolean in
 * aegis.py -- from the already-computed most-recent 1-day return. A
 * genuine, real adverse move today that exceeds the policy threshold
 * counts as a detected gap; a null ret1d (insufficient history) honestly
 * reports false ("not detected by this rule"), never true, since there is
 * no evidence to detect anything from.
 */
export function deriveStressGapDetected(ret1d: number | null, thresholdAbsReturn: number): boolean {
  if (ret1d === null) return false;
  return Math.abs(ret1d) >= thresholdAbsReturn;
}
