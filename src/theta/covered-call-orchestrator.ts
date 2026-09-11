import { invokeAndValidate, type PythonBridgeConfig } from './python-bridge.js';
import { coveredCallContractVersion, parseCoveredCallDecisionResponse, type CoveredCallDecisionResponse } from './covered-call-contract.js';

// R1H item K2/K3: real end-to-end orchestrator for the covered-call
// OPENING decision (WAIT / SELL_STOCK / SELL_CC(candidates)). Calls the
// real Python covered_call_contract.py (wrapping the already-tested
// models/covered_call_ranker.py). Performs no quantitative computation
// itself. A failed pipeline stage fails closed to WAIT (retain full
// stock upside, never force a sale or a call sale on an unverified
// result).

export interface CoveredCallPolicyInput {
  readonly policyVersion: string;
  readonly executionCostPerContract: number;
}

export interface CoveredCallCandidateInput {
  readonly strike: number;
  readonly dte: number;
  readonly creditPerShare: number | null;
  readonly multiplier: number;
  readonly callAwayRegretPerShare: number | null;
  readonly eventRiskPenalty: number | null;
}

export interface StockRetainedContextInput {
  readonly shares: number;
  readonly economicBasisPerShare: number;
  readonly currentPricePerShare: number | null;
  readonly stockEvIfUncapped: number | null;
}

export interface CoveredCallOrchestrationRequest {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly policy: CoveredCallPolicyInput;
  readonly candidates: readonly CoveredCallCandidateInput[];
  readonly stock: StockRetainedContextInput;
}

export interface CoveredCallDecisionReceipt {
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly selectedLabel: string;
  readonly valuations: CoveredCallDecisionResponse['valuations'];
  readonly reasonCodes: readonly string[];
  readonly failClosedReason: string | null;
  readonly policyVersion: string;
}

const failClosedReceipt = (request: CoveredCallOrchestrationRequest, detail: string): CoveredCallDecisionReceipt => ({
  decisionId: `${request.snapshotId}:${request.chainId}`,
  snapshotId: request.snapshotId,
  fusionSnapshotHash: request.fusionSnapshotHash,
  timestamp: request.timestamp,
  chainId: request.chainId,
  selectedLabel: 'WAIT',
  valuations: [],
  reasonCodes: [`PIPELINE_STAGE_FAILED:COVERED_CALL_RANKER`],
  failClosedReason: detail,
  policyVersion: request.policy.policyVersion,
});

export async function runCoveredCallOrchestration(
  bridge: PythonBridgeConfig,
  request: CoveredCallOrchestrationRequest,
): Promise<CoveredCallDecisionReceipt> {
  const result = await invokeAndValidate(
    bridge, 'coveredCall',
    {
      contractVersion: coveredCallContractVersion,
      decisionId: `${request.snapshotId}:${request.chainId}`,
      snapshotId: request.snapshotId,
      fusionSnapshotHash: request.fusionSnapshotHash,
      timestamp: request.timestamp,
      policy: { policyVersion: request.policy.policyVersion, executionCostPerContract: request.policy.executionCostPerContract },
      candidates: request.candidates.map((c) => ({
        strike: c.strike, dte: c.dte, creditPerShare: c.creditPerShare, multiplier: c.multiplier,
        callAwayRegretPerShare: c.callAwayRegretPerShare, eventRiskPenalty: c.eventRiskPenalty,
      })),
      stock: {
        shares: request.stock.shares, economicBasisPerShare: request.stock.economicBasisPerShare,
        currentPricePerShare: request.stock.currentPricePerShare, stockEvIfUncapped: request.stock.stockEvIfUncapped,
      },
    },
    (payload) => parseCoveredCallDecisionResponse(payload, request.fusionSnapshotHash),
  );

  if (!result.ok) {
    return failClosedReceipt(request, result.detail);
  }

  return {
    decisionId: result.data.decisionId,
    snapshotId: result.data.snapshotId,
    fusionSnapshotHash: result.data.fusionSnapshotHash,
    timestamp: result.data.timestamp,
    chainId: request.chainId,
    selectedLabel: result.data.selectedLabel,
    valuations: result.data.valuations,
    reasonCodes: result.data.selectedReasons.map((r) => r.code),
    failClosedReason: null,
    policyVersion: result.data.policyVersion,
  };
}
