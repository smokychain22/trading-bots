import { invokeAndValidate, type PythonBridgeConfig } from './python-bridge.js';
import { managementContractVersion, parseManagementDecisionResponse } from './management-contract.js';
import { assembleManagementDecision, type ManagementDecisionReceipt } from './management-assembly.js';
import type { AegisAssessmentResponse } from './aegis-contract.js';
import type { ExecutionQualityResponse } from './execution-quality-contract.js';

// R1H item K: the real end-to-end management orchestrator -- calls the
// real Python management_contract.py (bots/theta/quant/runtime/
// management_contract.py, wrapping the already-tested
// models/management_action_value.py), then hands the result to the
// EXISTING, already-tested management-assembly.ts for fail-closed/exit-
// supremacy packaging into a final receipt. This module performs NO
// quantitative computation itself -- it only sequences the real
// subprocess call and composes its result, exactly mirroring
// new-risk-orchestrator.ts's own division of responsibility.
//
// AEGIS and execution-quality are NOT computed here -- the caller
// supplies already-computed results (reusing the same real subprocess
// pipeline new-risk-orchestrator.ts already exercises for those two
// contracts), since re-deriving that logic in a second place would risk
// the two orchestrators silently drifting apart.

export interface ManagementOrchestrationPolicy {
  readonly policyVersion: string;
  readonly executionCostPerContract: number;
  readonly capitalDaysPenaltyRate: number;
  readonly tailRiskPenaltyWeight: number;
}

export interface OpenOptionLegInput {
  readonly entryCreditPerShare: number;
  readonly currentBidPerShare: number | null;
  readonly currentAskPerShare: number | null;
  readonly strike: number;
  readonly multiplier: number;
  readonly dte: number;
}

export interface RollCandidateInput {
  readonly newStrike: number;
  readonly newDte: number;
  readonly newCreditPerShare: number | null;
  readonly estimatedFutureValue: number | null;
}

export interface ManagementContextInput {
  readonly asOf: string;
  readonly openOptionLeg: OpenOptionLegInput | null;
  readonly rollCandidate: RollCandidateInput | null;
  readonly assignAlternative: { readonly estimatedFutureValue: number | null } | null;
  readonly redeployAlternative: { readonly estimatedFutureValue: number | null } | null;
  readonly capitalCommitted: number | null;
  readonly holdForwardValue: number | null;
  readonly pSevereDrawdown: number | null;
  readonly atExpirationOtm: boolean;
}

export interface ManagementOrchestrationRequest {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly policy: ManagementOrchestrationPolicy;
  readonly context: ManagementContextInput;
  readonly aegis: AegisAssessmentResponse;
  readonly executionQuality: ExecutionQualityResponse | null;
  readonly policyVersion: string;
  readonly modelVersions: Readonly<Record<string, string>>;
  readonly requiredModelVersions: Readonly<Record<string, string>>;
  readonly providerStateGood: boolean;
}

const systemHoldReceipt = (request: ManagementOrchestrationRequest, stage: string, detail: string): ManagementDecisionReceipt => ({
  decisionId: `${request.snapshotId}:${request.chainId}`,
  snapshotId: request.snapshotId,
  fusionSnapshotHash: request.fusionSnapshotHash,
  timestamp: request.timestamp,
  chainId: request.chainId,
  selectedAction: 'HOLD',
  holdAdvantage: null,
  valuations: [],
  aegisState: request.aegis.newRiskState,
  executionRecommendedAction: null,
  executionAuthorized: false,
  reasonCodes: [`PIPELINE_STAGE_FAILED:${stage}`],
  plainEnglishExplanation: `Management orchestration failed closed at stage ${stage}: ${detail}. Holding rather than acting on an unverified pipeline result.`,
  failClosedReason: detail,
  policyVersion: request.policyVersion,
  modelVersions: request.modelVersions,
});

export async function runManagementOrchestration(
  bridge: PythonBridgeConfig,
  request: ManagementOrchestrationRequest,
): Promise<ManagementDecisionReceipt> {
  const managementResult = await invokeAndValidate(
    bridge, 'management',
    {
      contractVersion: managementContractVersion,
      decisionId: `${request.snapshotId}:${request.chainId}`,
      snapshotId: request.snapshotId,
      fusionSnapshotHash: request.fusionSnapshotHash,
      timestamp: request.timestamp,
      policy: {
        policyVersion: request.policy.policyVersion,
        executionCostPerContract: request.policy.executionCostPerContract,
        capitalDaysPenaltyRate: request.policy.capitalDaysPenaltyRate,
        tailRiskPenaltyWeight: request.policy.tailRiskPenaltyWeight,
      },
      context: request.context,
    },
    (payload) => parseManagementDecisionResponse(payload, request.fusionSnapshotHash),
  );

  if (!managementResult.ok) {
    return systemHoldReceipt(request, 'MANAGEMENT_ACTION_VALUE', managementResult.detail);
  }

  return assembleManagementDecision({
    snapshotId: request.snapshotId,
    fusionSnapshotHash: request.fusionSnapshotHash,
    timestamp: request.timestamp,
    chainId: request.chainId,
    management: managementResult.data,
    aegis: request.aegis,
    executionQuality: request.executionQuality,
    holdAdvantage: managementResult.data.holdAdvantage ?? null,
    policyVersion: request.policyVersion,
    modelVersions: request.modelVersions,
    requiredModelVersions: request.requiredModelVersions,
    providerStateGood: request.providerStateGood,
  });
}
