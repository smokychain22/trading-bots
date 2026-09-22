/**
 * Management outcome dataset (Wave 17 section 7). Research-only,
 * `brokerAuthority: false`. Real, tested atomic-row schema for a
 * management-lifecycle decision (HOLD/CLOSE/ROLL/ACCEPT_ASSIGNMENT/
 * RECOVERY_WAIT/SELL_STOCK/SELL_CC/HOLD_CC/CLOSE_CC/ROLL_CC/
 * ALLOW_CALL_AWAY) plus a SEPARATE cohort aggregator -- per this wave's
 * explicit instruction, atomic rows and cohort statistics must never be
 * mixed into the same object (no ProfitFactor/ExpectedShortfall/
 * MaxDrawdown on a single row).
 */

export const managementOutcomeDatasetVersion = 'theta-management-outcome-dataset-v1' as const;

export type ManagementAction = 'HOLD' | 'CLOSE' | 'ROLL' | 'LET_EXPIRE' | 'ACCEPT_ASSIGNMENT'
  | 'RECOVERY_WAIT' | 'SELL_STOCK' | 'SELL_CC' | 'HOLD_CC' | 'CLOSE_CC' | 'ROLL_CC' | 'ALLOW_CALL_AWAY';

export interface ManagementOutcomeRow {
  readonly contractVersion: typeof managementOutcomeDatasetVersion;
  readonly episodeId: string;
  readonly chainId: string;
  readonly decisionId: string;
  readonly decisionAsOf: string;

  readonly lifecycleState: string;
  readonly knownEvidenceStates: readonly string[];
  readonly unknownEvidenceStates: readonly string[];

  readonly feasibleActions: readonly ManagementAction[];
  readonly selectedAction: ManagementAction;
  readonly selectedCandidateId: string | null;
  readonly rejectedAlternatives: readonly { readonly action: ManagementAction; readonly candidateId: string | null; readonly reason: string }[];

  readonly lossCauseEvidenceRef: string | null;
  readonly eventEvidenceRef: string | null;
  readonly volatilityEvidenceRef: string | null;
  readonly executionEvidenceRef: string | null;
  readonly portfolioEvidenceRef: string | null;

  /** null while the episode remains censored/open -- never a guessed
   * final value. */
  readonly futureWholeChainNetPnl: number | null;
  readonly fees: number | null;
  readonly slippage: number | null;
  readonly tca: number | null;
  readonly capitalDays: number | null;
  readonly mae: number | null;
  readonly mfe: number | null;

  readonly assignmentOccurred: boolean | null;
  readonly recoveryDuration: number | null;
  readonly coveredCallOpened: boolean | null;
  readonly callAwayOccurred: boolean | null;
  readonly terminalState: string | null;

  readonly featureAvailableAt: string;
  readonly labelAvailableAt: string | null;
}

export function buildManagementOutcomeRow(input: Omit<ManagementOutcomeRow, 'contractVersion'>): ManagementOutcomeRow {
  if (!Number.isFinite(Date.parse(input.decisionAsOf))) throw new Error('MGMT_OUTCOME_INVALID_DECISION_ASOF');
  if (!Number.isFinite(Date.parse(input.featureAvailableAt))) throw new Error('MGMT_OUTCOME_INVALID_FEATURE_AVAILABLE_AT');
  if (Date.parse(input.featureAvailableAt) > Date.parse(input.decisionAsOf)) throw new Error('MGMT_OUTCOME_FUTURE_FEATURE_AVAILABLE_AT');
  if (!input.feasibleActions.includes(input.selectedAction)) throw new Error('MGMT_OUTCOME_SELECTED_ACTION_NOT_FEASIBLE');
  if (input.labelAvailableAt !== null) {
    const labelMs = Date.parse(input.labelAvailableAt);
    if (!Number.isFinite(labelMs)) throw new Error('MGMT_OUTCOME_INVALID_LABEL_AVAILABLE_AT');
    if (labelMs < Date.parse(input.decisionAsOf)) throw new Error('MGMT_OUTCOME_LABEL_BEFORE_DECISION');
  }
  if (input.futureWholeChainNetPnl !== null && input.labelAvailableAt === null) throw new Error('MGMT_OUTCOME_PNL_WITHOUT_LABEL_AVAILABLE_AT');
  // ROLL must preserve the old leg's realized loss separately -- this
  // schema does not fold roll economics into a single net number without
  // the caller supplying the components; enforced by requiring lossCauseEvidenceRef
  // whenever the action is ROLL (the real per-roll economics live there,
  // per the already-built loss-cause-integration-contract.ts, reused not rebuilt).
  if (input.selectedAction === 'ROLL' && input.lossCauseEvidenceRef === null) {
    throw new Error('MGMT_OUTCOME_ROLL_REQUIRES_LOSS_CAUSE_EVIDENCE_REF');
  }
  return { contractVersion: managementOutcomeDatasetVersion, ...input };
}

export interface ManagementCohortAggregate {
  readonly cohortKey: string;
  readonly episodeCount: number;
  readonly resolvedEpisodeCount: number;
  readonly winRate: number | null;
  readonly profitFactor: number | null;
  readonly avgWin: number | null;
  readonly avgLoss: number | null;
  readonly expectedShortfall: number | null;
  readonly maxDrawdown: number | null;
  readonly rpcd: number | null;
  readonly assignmentRate: number | null;
  readonly recoveryRate: number | null;
  readonly avgRecoveryDuration: number | null;
  readonly callAwayRate: number | null;
}

/** Aggregates a real batch of RESOLVED rows (futureWholeChainNetPnl !==
 * null) into cohort statistics -- structurally a SEPARATE type from
 * ManagementOutcomeRow, never merged onto a single episode. Rows still
 * censored (futureWholeChainNetPnl === null) are excluded from the
 * resolved-N denominators, never treated as a loss or a zero. */
export function aggregateManagementCohort(cohortKey: string, rows: readonly ManagementOutcomeRow[]): ManagementCohortAggregate {
  const resolved = rows.filter((r) => r.futureWholeChainNetPnl !== null);
  if (resolved.length === 0) {
    return {
      cohortKey, episodeCount: rows.length, resolvedEpisodeCount: 0, winRate: null, profitFactor: null,
      avgWin: null, avgLoss: null, expectedShortfall: null, maxDrawdown: null, rpcd: null,
      assignmentRate: null, recoveryRate: null, avgRecoveryDuration: null, callAwayRate: null,
    };
  }
  const pnls = resolved.map((r) => r.futureWholeChainNetPnl as number);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const capitalDaysKnown = resolved.filter((r) => r.capitalDays !== null).map((r) => r.capitalDays as number);
  const sortedPnl = pnls.toSorted((a, b) => a - b);
  const tailCount = Math.max(1, Math.floor(sortedPnl.length * 0.05));
  const expectedShortfall = sortedPnl.slice(0, tailCount).reduce((a, b) => a + b, 0) / tailCount;
  const recoveryDurations = resolved.filter((r) => r.recoveryDuration !== null).map((r) => r.recoveryDuration as number);
  const assignmentKnown = resolved.filter((r) => r.assignmentOccurred !== null);
  const callAwayKnown = resolved.filter((r) => r.callAwayOccurred !== null);

  return {
    cohortKey, episodeCount: rows.length, resolvedEpisodeCount: resolved.length,
    winRate: wins.length / resolved.length,
    profitFactor: grossLoss === 0 ? null : grossWin / grossLoss,
    avgWin: wins.length === 0 ? null : grossWin / wins.length,
    avgLoss: losses.length === 0 ? null : -grossLoss / losses.length,
    expectedShortfall,
    maxDrawdown: Math.min(...pnls),
    rpcd: capitalDaysKnown.length === 0 ? null
      : pnls.reduce((a, b) => a + b, 0) / capitalDaysKnown.reduce((a, b) => a + b, 1),
    assignmentRate: assignmentKnown.length === 0 ? null : assignmentKnown.filter((r) => r.assignmentOccurred === true).length / assignmentKnown.length,
    recoveryRate: assignmentKnown.length === 0 ? null : assignmentKnown.filter((r) => r.recoveryDuration !== null).length / assignmentKnown.length,
    avgRecoveryDuration: recoveryDurations.length === 0 ? null : recoveryDurations.reduce((a, b) => a + b, 0) / recoveryDurations.length,
    callAwayRate: callAwayKnown.length === 0 ? null : callAwayKnown.filter((r) => r.callAwayOccurred === true).length / callAwayKnown.length,
  };
}
