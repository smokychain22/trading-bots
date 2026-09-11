import type { AssignmentEvaluationResponse } from './assignment-contract.js';
import type { AssignmentCapacityAssessment } from './account-exposure.js';

// R1H item K1: combines assignment_model.py's economic/ownership
// recommendation with the account-exposure quantities TS already derives
// (account-exposure.ts) into one final receipt. Neither half re-derives
// the other's math -- Python owns economics/ownership policy, TS owns
// exposure/capacity arithmetic over already-fetched account state.

export interface AssignmentAssemblyInput {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly evaluation: AssignmentEvaluationResponse;
  readonly strike: number;
  readonly multiplier: number;
  readonly contracts: number;
  readonly assignmentCapacity: AssignmentCapacityAssessment;
  readonly tickerConcentrationPct: number | null; // BEFORE assignment, from account-exposure.ts
  readonly stockValueAlreadyHeldForUnderlying: number | null; // 0 if none currently held
  readonly equity: number | null;
  readonly providerStateGood: boolean;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly requiredModelVersions: Readonly<Record<string, string>>;
}

export interface AssignmentDecisionReceipt {
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly recommendation: AssignmentEvaluationResponse['recommendation'];
  readonly assignmentFeasible: boolean | null; // null (UNKNOWN) if capacity itself is unknown
  readonly requiredCash: number; // strike * multiplier * contracts -- contract-derived multiplier, never assumed 100
  readonly resultingShareQuantity: number; // multiplier * contracts
  readonly expectedBasisPerShare: number;
  readonly accountConcentrationAfterAssignmentPct: number | null;
  readonly assignmentCapacityUsedPct: number | null;
  readonly ownershipAcceptable: boolean | null;
  readonly mechanicalCloseRealizedPnl: number | null;
  readonly acceptAssignmentTailPenalty: number | null;
  readonly reasonCodes: readonly string[];
  readonly plainEnglishExplanation: string;
  readonly failClosedReason: string | null;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
}

const failClosed = (input: AssignmentAssemblyInput, code: string, detail: string): AssignmentDecisionReceipt => ({
  decisionId: `${input.snapshotId}:${input.chainId}`,
  snapshotId: input.snapshotId,
  fusionSnapshotHash: input.fusionSnapshotHash,
  timestamp: input.timestamp,
  chainId: input.chainId,
  recommendation: 'UNKNOWN',
  assignmentFeasible: null,
  requiredCash: input.strike * input.multiplier * input.contracts,
  resultingShareQuantity: input.multiplier * input.contracts,
  expectedBasisPerShare: input.strike,
  accountConcentrationAfterAssignmentPct: null,
  assignmentCapacityUsedPct: null,
  ownershipAcceptable: null,
  mechanicalCloseRealizedPnl: null,
  acceptAssignmentTailPenalty: null,
  reasonCodes: [code],
  plainEnglishExplanation: `Assignment evaluation failed closed: ${detail}. Treating as UNKNOWN rather than assuming safe.`,
  failClosedReason: detail,
  policyVersion: input.policyVersion,
  modelVersions: input.modelVersions,
});

export function assembleAssignmentDecision(input: AssignmentAssemblyInput): AssignmentDecisionReceipt {
  if (!input.providerStateGood) {
    return failClosed(input, 'PROVIDER_STATE_INVALID', 'account/provider state was not confirmed GOOD');
  }
  for (const [family, requiredVersion] of Object.entries(input.requiredModelVersions)) {
    if (input.modelVersions[family] !== requiredVersion) {
      return failClosed(input, 'MODEL_VERSION_MISMATCH', `model family ${family} version mismatch`);
    }
  }
  if (input.fusionSnapshotHash !== input.evaluation.fusionSnapshotHash) {
    return failClosed(input, 'SNAPSHOT_MISMATCH', 'assignment evaluation belongs to a different FusionSnapshot');
  }

  const requiredCash = input.strike * input.multiplier * input.contracts;
  const resultingShareQuantity = input.multiplier * input.contracts;

  const additionalCapitalCommitted =
    input.stockValueAlreadyHeldForUnderlying !== null ? requiredCash + input.stockValueAlreadyHeldForUnderlying : null;
  const accountConcentrationAfterAssignmentPct =
    additionalCapitalCommitted !== null && input.equity !== null && input.equity > 0
      ? additionalCapitalCommitted / input.equity
      : null;

  const assignmentFeasible =
    input.assignmentCapacity.availableAssignmentCapital === null
      ? null
      : input.assignmentCapacity.availableAssignmentCapital >= requiredCash;

  const reasonCodes = input.evaluation.reasons.map((reason) => reason.code);
  if (assignmentFeasible === false) {
    reasonCodes.push('ASSIGNMENT_CAPACITY_INSUFFICIENT');
  } else if (assignmentFeasible === null) {
    reasonCodes.push('ASSIGNMENT_CAPACITY_UNKNOWN');
  }

  const recommendation =
    input.evaluation.recommendation === 'ACCEPT_ASSIGNMENT' && assignmentFeasible === false
      ? 'UNKNOWN'
      : input.evaluation.recommendation;

  return {
    decisionId: `${input.snapshotId}:${input.chainId}`,
    snapshotId: input.snapshotId,
    fusionSnapshotHash: input.fusionSnapshotHash,
    timestamp: input.timestamp,
    chainId: input.chainId,
    recommendation,
    assignmentFeasible,
    requiredCash,
    resultingShareQuantity,
    expectedBasisPerShare: input.evaluation.economicBasisPerShare,
    accountConcentrationAfterAssignmentPct,
    assignmentCapacityUsedPct: input.assignmentCapacity.assignmentCapacityUsedPct,
    ownershipAcceptable: input.evaluation.ownershipAcceptable,
    mechanicalCloseRealizedPnl: input.evaluation.mechanicalCloseRealizedPnl,
    acceptAssignmentTailPenalty: input.evaluation.acceptAssignmentTailPenalty,
    reasonCodes,
    plainEnglishExplanation:
      recommendation === 'ACCEPT_ASSIGNMENT'
        ? 'Ownership acceptable, tail risk known, and assignment capacity sufficient -- accepting assignment rather than mechanically closing.'
        : recommendation === 'CLOSE_STOCK'
          ? 'Ownership unacceptable for this underlying -- mechanically closing before assignment.'
          : 'Insufficient information (or insufficient capacity) to recommend accepting assignment -- reporting UNKNOWN rather than a default.',
    failClosedReason: null,
    policyVersion: input.policyVersion,
    modelVersions: input.modelVersions,
  };
}
