/**
 * Phase 4 (Profitability Brain Completion Program), section 4H. Research/
 * shadow only. `brokerAuthority: false` always. This module owns NO risk,
 * sizing, or execution authority -- it never gates an order, never adjusts
 * AEGIS, never adjusts `sizing.py`'s caps, and is never consumed by
 * `new-risk-orchestrator.ts` or any other runtime decision path.
 *
 * Confirmed absent from current source (searched `src/`, `bots/theta/quant/`
 * for any NORMAL/CAUTION/DEFENSIVE/PAUSE_NEW_RISK-shaped account-level
 * drawdown-regime state): no such framework exists today. Per the program's
 * own instruction ("do not invent production thresholds, research them"),
 * this module defines the RESEARCH CONTRACT SHAPE only -- the classification
 * function and its thresholds are explicitly unvalidated pending real
 * resolved Paper drawdown history (zero exists today, per this session's
 * standing finding). No numeric threshold here should ever be copied into
 * a Production risk file without a real, versioned, evidence-backed
 * research decision first.
 */
export const accountDrawdownRegimeResearchVersion = 'theta-account-drawdown-regime-research-v1' as const;

export type AccountDrawdownRegime = 'NORMAL' | 'CAUTION' | 'DEFENSIVE' | 'PAUSE_NEW_RISK';

export interface AccountDrawdownRegimeInputs {
  /** Peak-to-current equity drawdown, as a positive fraction (0.05 = 5%).
   * `null` when peak equity is not reliably known (e.g. account too new,
   * or equity history has a gap) -- never coerced to 0. */
  readonly currentDrawdownFraction: number | null;
  /** Trailing realized-loss streak length, purely descriptive -- this
   * module reads it only to REPORT the regime, never to size a trade
   * (that would violate the no-martingale invariant `sizing.py` already
   * enforces structurally). */
  readonly trailingLossEpisodeCount: number | null;
  readonly asOf: string;
}

export interface AccountDrawdownRegimeThresholdPolicy {
  readonly policyVersion: string;
  /** Every threshold below is an explicit RESEARCH CANDIDATE, not a
   * Production value -- see module docstring. */
  readonly cautionDrawdownFraction: number;
  readonly defensiveDrawdownFraction: number;
  readonly pauseNewRiskDrawdownFraction: number;
}

export interface AccountDrawdownRegimeResult {
  readonly regime: AccountDrawdownRegime | 'UNKNOWN';
  readonly reason: string;
  readonly policyVersion: string;
  readonly evaluatedAt: string;
}

/**
 * Pure, deterministic classification -- never called from any runtime
 * decision path. `UNKNOWN` (never a silent `NORMAL` default) when the input
 * drawdown is not reliably known.
 */
export function classifyAccountDrawdownRegime(
  inputs: AccountDrawdownRegimeInputs,
  policy: AccountDrawdownRegimeThresholdPolicy,
): AccountDrawdownRegimeResult {
  if (inputs.currentDrawdownFraction === null) {
    return {
      regime: 'UNKNOWN',
      reason: 'currentDrawdownFraction is UNKNOWN -- peak equity not reliably known; never defaulted to NORMAL.',
      policyVersion: policy.policyVersion,
      evaluatedAt: inputs.asOf,
    };
  }
  const dd = inputs.currentDrawdownFraction;
  if (dd >= policy.pauseNewRiskDrawdownFraction) {
    return {
      regime: 'PAUSE_NEW_RISK',
      reason: `drawdown ${dd} >= pauseNewRiskDrawdownFraction ${policy.pauseNewRiskDrawdownFraction}`,
      policyVersion: policy.policyVersion, evaluatedAt: inputs.asOf,
    };
  }
  if (dd >= policy.defensiveDrawdownFraction) {
    return {
      regime: 'DEFENSIVE',
      reason: `drawdown ${dd} >= defensiveDrawdownFraction ${policy.defensiveDrawdownFraction}`,
      policyVersion: policy.policyVersion, evaluatedAt: inputs.asOf,
    };
  }
  if (dd >= policy.cautionDrawdownFraction) {
    return {
      regime: 'CAUTION',
      reason: `drawdown ${dd} >= cautionDrawdownFraction ${policy.cautionDrawdownFraction}`,
      policyVersion: policy.policyVersion, evaluatedAt: inputs.asOf,
    };
  }
  return {
    regime: 'NORMAL',
    reason: `drawdown ${dd} below all research thresholds`,
    policyVersion: policy.policyVersion, evaluatedAt: inputs.asOf,
  };
}
