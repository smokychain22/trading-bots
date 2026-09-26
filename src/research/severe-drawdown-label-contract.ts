/**
 * COMMAND 4 item 6 / COMMAND 3 correction 6. Severe-drawdown research label
 * contract. Research-only, `brokerAuthority: false`.
 *
 * Resolved chain + threshold breached at any point pre-resolution -> factual
 * positive. Resolved chain + threshold never breached -> factual negative
 * (NEVER censored -- a completed negative example must not be discarded or
 * mislabeled as censored). Chain still open at observation cutoff -> right-
 * censored. The threshold itself is a versioned RESEARCH parameter supplied
 * by the caller -- this module never hardcodes a new Production risk limit.
 */

export const severeDrawdownLabelContractVersion = 'theta-severe-drawdown-label-contract-v1' as const;

export type SevereDrawdownLabel = 'FACTUAL_POSITIVE' | 'FACTUAL_NEGATIVE' | 'RIGHT_CENSORED';

export interface SevereDrawdownThresholdContract {
  readonly thresholdVersion: string;
  /** Fraction of collateral/capital-at-risk defining "severe" -- a research
   * parameter, never a Production AEGIS/risk threshold. */
  readonly severeDrawdownFraction: number;
}

export interface SevereDrawdownLabelInput {
  readonly wholeChainId: string;
  readonly threshold: SevereDrawdownThresholdContract;
  /** The maximum observed adverse excursion as a fraction of capital-at-
   * risk, over the chain's full observed path so far. `null` if no mark
   * path evidence exists at all. */
  readonly peakAdverseExcursionFraction: number | null;
  readonly isResolved: boolean;
}

export interface SevereDrawdownLabelResult {
  readonly contractVersion: typeof severeDrawdownLabelContractVersion;
  readonly wholeChainId: string;
  readonly label: SevereDrawdownLabel;
  readonly thresholdVersion: string;
}

export function buildSevereDrawdownLabel(input: SevereDrawdownLabelInput): SevereDrawdownLabelResult {
  if (!Number.isFinite(input.threshold.severeDrawdownFraction) || input.threshold.severeDrawdownFraction <= 0) {
    throw new Error('SEVERE_DRAWDOWN_INVALID_THRESHOLD');
  }
  if (!input.isResolved) {
    return {
      contractVersion: severeDrawdownLabelContractVersion, wholeChainId: input.wholeChainId,
      label: 'RIGHT_CENSORED', thresholdVersion: input.threshold.thresholdVersion,
    };
  }
  if (input.peakAdverseExcursionFraction === null) {
    // Resolved but no mark-path evidence at all -- this is a real data gap,
    // not a resolved observation either way. Treated as censored for THIS
    // label rather than fabricating a negative from missing evidence.
    return {
      contractVersion: severeDrawdownLabelContractVersion, wholeChainId: input.wholeChainId,
      label: 'RIGHT_CENSORED', thresholdVersion: input.threshold.thresholdVersion,
    };
  }
  const breached = input.peakAdverseExcursionFraction >= input.threshold.severeDrawdownFraction;
  return {
    contractVersion: severeDrawdownLabelContractVersion, wholeChainId: input.wholeChainId,
    label: breached ? 'FACTUAL_POSITIVE' : 'FACTUAL_NEGATIVE', thresholdVersion: input.threshold.thresholdVersion,
  };
}
