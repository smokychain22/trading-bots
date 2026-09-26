/**
 * COMMAND 5C-7 item 54: strategy completion matrix. Code-backed, honest:
 * mechanics-complete never implies profitability-proven (§55's explicit
 * distinction). Values below are populated from this session's own
 * confirmed source-of-truth findings (Commands 1-5B), not invented.
 */

export const strategyCompletionMatrixVersion = 'theta-strategy-completion-matrix-v1' as const;

export type StrategyCompletionField =
  | 'MECHANICS_IMPLEMENTED' | 'FEATURES_IMPLEMENTED' | 'DATA_CAPTURE_READY' | 'OUTCOME_BUILDER_READY'
  | 'MANAGEMENT_RESEARCH_READY' | 'EMPIRICAL_MODEL_READY' | 'CALIBRATION_READY' | 'OOS_READY'
  | 'EMPIRICAL_VALIDATION' | 'BROKER_AUTHORITY';

export type CompletionValue = 'YES' | 'NO' | 'PARTIAL';

export type StrategyRow = 'Q' | 'H' | 'D' | 'A' | 'C' | 'WAIT' | 'MANAGEMENT';

export type StrategyCompletionMatrix = Readonly<Record<StrategyRow, Readonly<Record<StrategyCompletionField, CompletionValue>>>>;

/**
 * Populated per Commands 1-5B's own confirmed findings:
 *  - MECHANICS_IMPLEMENTED: real for all 5 strategies + WAIT + management
 *    (Command 1's Q/H/D/Recovery/CC candidate-construction audit).
 *  - EMPIRICAL_MODEL_READY / CALIBRATION_READY / OOS_READY /
 *    EMPIRICAL_VALIDATION: NO across the board -- zero real resolved
 *    episodes exist (the one fact every command this session has
 *    independently reconfirmed).
 *  - BROKER_AUTHORITY: NO everywhere, structurally (Command 1's finding
 *    that `executionEnabled:false` on all 5 branches, and this whole
 *    build wave's `brokerAuthority: false` discipline).
 */
export const STRATEGY_COMPLETION_MATRIX: StrategyCompletionMatrix = {
  Q: {
    MECHANICS_IMPLEMENTED: 'YES', FEATURES_IMPLEMENTED: 'PARTIAL', DATA_CAPTURE_READY: 'YES', OUTCOME_BUILDER_READY: 'YES',
    MANAGEMENT_RESEARCH_READY: 'YES', EMPIRICAL_MODEL_READY: 'NO', CALIBRATION_READY: 'NO', OOS_READY: 'NO',
    EMPIRICAL_VALIDATION: 'NO', BROKER_AUTHORITY: 'NO',
  },
  H: {
    MECHANICS_IMPLEMENTED: 'YES', FEATURES_IMPLEMENTED: 'PARTIAL', DATA_CAPTURE_READY: 'YES', OUTCOME_BUILDER_READY: 'YES',
    MANAGEMENT_RESEARCH_READY: 'YES', EMPIRICAL_MODEL_READY: 'NO', CALIBRATION_READY: 'NO', OOS_READY: 'NO',
    EMPIRICAL_VALIDATION: 'NO', BROKER_AUTHORITY: 'NO',
  },
  D: {
    MECHANICS_IMPLEMENTED: 'YES', FEATURES_IMPLEMENTED: 'PARTIAL', DATA_CAPTURE_READY: 'YES', OUTCOME_BUILDER_READY: 'YES',
    MANAGEMENT_RESEARCH_READY: 'YES', EMPIRICAL_MODEL_READY: 'NO', CALIBRATION_READY: 'NO', OOS_READY: 'NO',
    EMPIRICAL_VALIDATION: 'NO', BROKER_AUTHORITY: 'NO',
  },
  A: {
    MECHANICS_IMPLEMENTED: 'YES', FEATURES_IMPLEMENTED: 'PARTIAL', DATA_CAPTURE_READY: 'YES', OUTCOME_BUILDER_READY: 'YES',
    MANAGEMENT_RESEARCH_READY: 'YES', EMPIRICAL_MODEL_READY: 'NO', CALIBRATION_READY: 'NO', OOS_READY: 'NO',
    EMPIRICAL_VALIDATION: 'NO', BROKER_AUTHORITY: 'NO',
  },
  C: {
    MECHANICS_IMPLEMENTED: 'YES', FEATURES_IMPLEMENTED: 'PARTIAL', DATA_CAPTURE_READY: 'YES', OUTCOME_BUILDER_READY: 'YES',
    MANAGEMENT_RESEARCH_READY: 'YES', EMPIRICAL_MODEL_READY: 'NO', CALIBRATION_READY: 'NO', OOS_READY: 'NO',
    EMPIRICAL_VALIDATION: 'NO', BROKER_AUTHORITY: 'NO',
  },
  WAIT: {
    MECHANICS_IMPLEMENTED: 'YES', FEATURES_IMPLEMENTED: 'PARTIAL', DATA_CAPTURE_READY: 'YES', OUTCOME_BUILDER_READY: 'PARTIAL',
    MANAGEMENT_RESEARCH_READY: 'YES', EMPIRICAL_MODEL_READY: 'NO', CALIBRATION_READY: 'NO', OOS_READY: 'NO',
    EMPIRICAL_VALIDATION: 'NO', BROKER_AUTHORITY: 'NO',
  },
  MANAGEMENT: {
    MECHANICS_IMPLEMENTED: 'YES', FEATURES_IMPLEMENTED: 'PARTIAL', DATA_CAPTURE_READY: 'YES', OUTCOME_BUILDER_READY: 'YES',
    MANAGEMENT_RESEARCH_READY: 'YES', EMPIRICAL_MODEL_READY: 'NO', CALIBRATION_READY: 'NO', OOS_READY: 'NO',
    EMPIRICAL_VALIDATION: 'NO', BROKER_AUTHORITY: 'NO',
  },
};

/** Structural proof (§55): no row may claim EMPIRICAL_VALIDATION=YES
 * while any of its prerequisite fields (EMPIRICAL_MODEL_READY,
 * CALIBRATION_READY, OOS_READY) is NO -- a real, checkable invariant, not
 * just a documentation promise. */
export function assertMechanicsCompleteNeverImpliesValidated(matrix: StrategyCompletionMatrix): void {
  for (const [row, fields] of Object.entries(matrix) as [StrategyRow, StrategyCompletionMatrix[StrategyRow]][]) {
    if (fields.EMPIRICAL_VALIDATION === 'YES'
      && (fields.EMPIRICAL_MODEL_READY !== 'YES' || fields.CALIBRATION_READY !== 'YES' || fields.OOS_READY !== 'YES')) {
      throw new Error(`STRATEGY_COMPLETION_MATRIX_INVALID_VALIDATION_CLAIM:${row}`);
    }
  }
}
