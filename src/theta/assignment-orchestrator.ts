import { invokeAndValidate, type PythonBridgeConfig } from './python-bridge.js';
import { assignmentContractVersion, parseAssignmentEvaluationResponse } from './assignment-contract.js';
import { assembleAssignmentDecision, type AssignmentDecisionReceipt } from './assignment-assembly.js';
import type { AssignmentCapacityAssessment } from './account-exposure.js';

// R1H item K1: the real end-to-end assignment orchestrator -- calls the
// real Python assignment_contract.py (wrapping the already-tested
// models/assignment_model.py), then hands the result to
// assignment-assembly.ts for combination with already-derived account
// exposure and fail-closed packaging into a final receipt. Performs NO
// quantitative computation itself, mirroring new-risk-orchestrator.ts and
// management-orchestrator.ts's own division of responsibility.

export interface AssignmentOrchestrationPolicy {
  readonly policyVersion: string;
  readonly ownershipAcceptabilityFloor: number;
  readonly tailRiskPenaltyWeight: number;
}

export interface AssignmentCandidateInput {
  readonly strike: number;
  readonly multiplier: number;
  readonly entryPremiumPerShare: number;
  readonly ownershipAcceptability: number | null;
  readonly pSevereDrawdown: number | null;
  readonly mechanicalCloseDebitPerShare: number | null;
  readonly capitalCommitted: number;
  readonly contracts: number;
}

export interface AssignmentOrchestrationRequest {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly policy: AssignmentOrchestrationPolicy;
  readonly candidate: AssignmentCandidateInput;
  readonly assignmentCapacity: AssignmentCapacityAssessment;
  readonly tickerConcentrationPct: number | null;
  readonly stockValueAlreadyHeldForUnderlying: number | null;
  readonly equity: number | null;
  readonly providerStateGood: boolean;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly requiredModelVersions: Readonly<Record<string, string>>;
}

const systemHoldReceipt = (
  request: AssignmentOrchestrationRequest,
  stage: string,
  detail: string,
): AssignmentDecisionReceipt => ({
  decisionId: `${request.snapshotId}:${request.chainId}`,
  snapshotId: request.snapshotId,
  fusionSnapshotHash: request.fusionSnapshotHash,
  timestamp: request.timestamp,
  chainId: request.chainId,
  recommendation: 'UNKNOWN',
  assignmentFeasible: null,
  requiredCash: request.candidate.strike * request.candidate.multiplier * request.candidate.contracts,
  resultingShareQuantity: request.candidate.multiplier * request.candidate.contracts,
  expectedBasisPerShare: request.candidate.strike,
  accountConcentrationAfterAssignmentPct: null,
  assignmentCapacityUsedPct: null,
  ownershipAcceptable: null,
  mechanicalCloseRealizedPnl: null,
  acceptAssignmentTailPenalty: null,
  reasonCodes: [`PIPELINE_STAGE_FAILED:${stage}`],
  plainEnglishExplanation: `Assignment orchestration failed closed at stage ${stage}: ${detail}. Reporting UNKNOWN rather than acting on an unverified pipeline result.`,
  failClosedReason: detail,
  policyVersion: request.policyVersion,
  modelVersions: request.modelVersions,
});

export async function runAssignmentOrchestration(
  bridge: PythonBridgeConfig,
  request: AssignmentOrchestrationRequest,
): Promise<AssignmentDecisionReceipt> {
  const evaluationResult = await invokeAndValidate(
    bridge, 'assignment',
    {
      contractVersion: assignmentContractVersion,
      decisionId: `${request.snapshotId}:${request.chainId}`,
      snapshotId: request.snapshotId,
      fusionSnapshotHash: request.fusionSnapshotHash,
      timestamp: request.timestamp,
      policy: {
        policyVersion: request.policy.policyVersion,
        ownershipAcceptabilityFloor: request.policy.ownershipAcceptabilityFloor,
        tailRiskPenaltyWeight: request.policy.tailRiskPenaltyWeight,
      },
      candidate: {
        strike: request.candidate.strike,
        multiplier: request.candidate.multiplier,
        entryPremiumPerShare: request.candidate.entryPremiumPerShare,
        ownershipAcceptability: request.candidate.ownershipAcceptability,
        pSevereDrawdown: request.candidate.pSevereDrawdown,
        mechanicalCloseDebitPerShare: request.candidate.mechanicalCloseDebitPerShare,
        capitalCommitted: request.candidate.capitalCommitted,
      },
    },
    (payload) => parseAssignmentEvaluationResponse(payload, request.fusionSnapshotHash),
  );

  if (!evaluationResult.ok) {
    return systemHoldReceipt(request, 'ASSIGNMENT_MODEL', evaluationResult.detail);
  }

  return assembleAssignmentDecision({
    snapshotId: request.snapshotId,
    fusionSnapshotHash: request.fusionSnapshotHash,
    timestamp: request.timestamp,
    chainId: request.chainId,
    evaluation: evaluationResult.data,
    strike: request.candidate.strike,
    multiplier: request.candidate.multiplier,
    contracts: request.candidate.contracts,
    assignmentCapacity: request.assignmentCapacity,
    tickerConcentrationPct: request.tickerConcentrationPct,
    stockValueAlreadyHeldForUnderlying: request.stockValueAlreadyHeldForUnderlying,
    equity: request.equity,
    providerStateGood: request.providerStateGood,
    policyVersion: request.policyVersion,
    modelVersions: request.modelVersions,
    requiredModelVersions: request.requiredModelVersions,
  });
}
