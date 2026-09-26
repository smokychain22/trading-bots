/**
 * COMMAND 4 item 18 (COMMAND 2 §19, COMMAND 3 §27). Typed integration
 * receipt wrapping the real, existing `bots/theta/quant/research/
 * selection_bias.py` (Python, quant-owned Deflated Sharpe Ratio + PBO
 * implementation, confirmed real and NOT rewritten here). This module
 * defines the TS-side receipt shape a Python-side runner would produce;
 * it does not reimplement DSR/PBO math.
 *
 * `returnNormalizationVersion` is a required, explicit, PRE-REGISTERED
 * field -- never silently raw dollar P&L. `numberOfTrials` must include
 * every trial ever run, including discarded ones (the exact winner's-curse
 * guard the directive requires) -- `trialIdentities.length` is validated
 * to equal `numberOfTrials` so a caller cannot under-report the trial
 * count while still listing every identity.
 */

export const selectionBiasReceiptVersion = 'theta-selection-bias-receipt-v1' as const;

export interface DsrResult {
  readonly deflatedSharpeRatio: number;
  readonly expectedMaxSharpeUnderNull: number;
  readonly pValue: number;
}

export interface PboResult {
  readonly probabilityOfBacktestOverfitting: number;
  readonly numberOfCombinatorialSplits: number;
}

export interface SelectionBiasReceipt {
  readonly contractVersion: typeof selectionBiasReceiptVersion;
  readonly researchCampaignId: string;
  readonly returnNormalizationVersion: string;
  readonly numberOfTrials: number;
  readonly trialIdentities: readonly string[];
  readonly dsr: DsrResult;
  readonly pbo: PboResult;
  readonly inputDatasetHash: string;
  readonly dependencyGroupingVersion: string;
  readonly codeSha: string;
  readonly createdAt: string;
}

/**
 * Rare binary-event targets (e.g. assignment rate, severe-drawdown
 * incidence) should NOT use this receipt's DSR arm -- DSR's Sharpe-like
 * continuous-return assumptions do not fit a binary/rare-event target.
 * This function exists purely to make that scope boundary explicit and
 * checkable by a caller before invoking the Python DSR runner at all.
 */
export function isDsrApplicableTargetKind(targetKind: 'CONTINUOUS_RETURN_SERIES' | 'RARE_BINARY_EVENT'): boolean {
  return targetKind === 'CONTINUOUS_RETURN_SERIES';
}

export function buildSelectionBiasReceipt(
  input: Omit<SelectionBiasReceipt, 'contractVersion'>,
): SelectionBiasReceipt {
  if (input.trialIdentities.length !== input.numberOfTrials) throw new Error('SELECTION_BIAS_TRIAL_COUNT_MISMATCH');
  if (new Set(input.trialIdentities).size !== input.trialIdentities.length) throw new Error('SELECTION_BIAS_DUPLICATE_TRIAL_IDENTITY');
  if (input.returnNormalizationVersion.trim().length === 0) throw new Error('SELECTION_BIAS_RETURN_NORMALIZATION_REQUIRED');
  return { contractVersion: selectionBiasReceiptVersion, ...input };
}
