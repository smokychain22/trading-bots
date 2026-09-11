import { invokeAndValidate, type PythonBridgeConfig } from './python-bridge.js';
import { recoveryContractVersion, parseRecoveryDecisionResponse } from './recovery-contract.js';
import { runCoveredCallOrchestration, type CoveredCallCandidateInput, type StockRetainedContextInput } from './covered-call-orchestrator.js';

// R1H item K2: real end-to-end orchestrator for stock-recovery
// management (RECOVERY_WAIT / SELL_STOCK / SELL_CC). Calls the real
// Python recovery_contract.py (wrapping models/recovery_decision.py).
//
// Per the R1 roadmap's explicit instruction, SELL_CC must be compared
// against holding stock unhedged or reducing stock economically, never
// selected merely because stock is assigned -- so when covered-call
// candidates are supplied, this orchestrator first runs the REAL
// covered-call frontier (covered-call-orchestrator.ts, wrapping
// covered_call_ranker.py's WAIT/SELL_STOCK/SELL_CC comparison) to derive
// bestCcUtility, and only then feeds that already-derived, already-
// compared utility into recovery_decision.py -- it never invents or
// assumes a CC utility itself.
//
// A failed pipeline stage fails closed to RECOVERY_WAIT is NOT safe by
// default here (waiting is not automatically conservative -- an
// unbounded wait is exactly what H-A-02 forbids), so a pipeline failure
// instead reports an explicit UNKNOWN action with boundExceeded left
// null/unknown, forcing the caller to treat this as "cannot confirm any
// action" rather than silently continuing to wait.

export interface RecoveryPolicyInput {
  readonly policyVersion: string;
  readonly maxWaitDays: number;
  readonly thesisInvalidationTriggersExit?: boolean;
}

export interface RecoveryCandidateInput {
  readonly daysInRecovery: number;
  readonly thesisInvalidated: boolean;
  readonly coveredCallPolicy: { readonly policyVersion: string; readonly executionCostPerContract: number } | null;
  readonly coveredCallCandidates: readonly CoveredCallCandidateInput[];
  readonly stock: StockRetainedContextInput | null;
}

export interface RecoveryOrchestrationRequest {
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly policy: RecoveryPolicyInput;
  readonly candidate: RecoveryCandidateInput;
}

export interface RecoveryDecisionReceipt {
  readonly decisionId: string;
  readonly snapshotId: string;
  readonly fusionSnapshotHash: string;
  readonly timestamp: string;
  readonly chainId: string;
  readonly action: 'RECOVERY_WAIT' | 'SELL_STOCK' | 'SELL_CC' | 'UNKNOWN';
  readonly boundExceeded: boolean | null;
  readonly reasonCodes: readonly string[];
  readonly coveredCallDecision: { readonly selectedLabel: string; readonly utility: number | null } | null;
  readonly partialSellStockModeled: false;
  readonly failClosedReason: string | null;
  readonly policyVersion: string;
}

export async function runRecoveryOrchestration(
  bridge: PythonBridgeConfig,
  request: RecoveryOrchestrationRequest,
): Promise<RecoveryDecisionReceipt> {
  let bestCcUtility: number | null = null;
  let coveredCallAvailable = false;
  let coveredCallDecision: { selectedLabel: string; utility: number | null } | null = null;

  if (request.candidate.coveredCallPolicy !== null && request.candidate.stock !== null && request.candidate.coveredCallCandidates.length > 0) {
    coveredCallAvailable = true;
    const ccReceipt = await runCoveredCallOrchestration(bridge, {
      snapshotId: request.snapshotId, fusionSnapshotHash: request.fusionSnapshotHash, timestamp: request.timestamp,
      chainId: request.chainId, policy: request.candidate.coveredCallPolicy,
      candidates: request.candidate.coveredCallCandidates, stock: request.candidate.stock,
    });
    if (ccReceipt.failClosedReason !== null) {
      return {
        decisionId: `${request.snapshotId}:${request.chainId}`, snapshotId: request.snapshotId,
        fusionSnapshotHash: request.fusionSnapshotHash, timestamp: request.timestamp, chainId: request.chainId,
        action: 'UNKNOWN', boundExceeded: null,
        reasonCodes: ['PIPELINE_STAGE_FAILED:COVERED_CALL_RANKER'],
        coveredCallDecision: null, partialSellStockModeled: false,
        failClosedReason: ccReceipt.failClosedReason, policyVersion: request.policy.policyVersion,
      };
    }
    const selected = ccReceipt.valuations.find((v) => v.label === ccReceipt.selectedLabel) ?? null;
    coveredCallDecision = { selectedLabel: ccReceipt.selectedLabel, utility: selected?.utility ?? null };
    if (ccReceipt.selectedLabel.startsWith('SELL_CC')) {
      bestCcUtility = selected?.utility ?? null;
    }
  }

  const result = await invokeAndValidate(
    bridge, 'recovery',
    {
      contractVersion: recoveryContractVersion,
      decisionId: `${request.snapshotId}:${request.chainId}`,
      snapshotId: request.snapshotId,
      fusionSnapshotHash: request.fusionSnapshotHash,
      timestamp: request.timestamp,
      policy: {
        policyVersion: request.policy.policyVersion,
        maxWaitDays: request.policy.maxWaitDays,
        ...(request.policy.thesisInvalidationTriggersExit !== undefined
          ? { thesisInvalidationTriggersExit: request.policy.thesisInvalidationTriggersExit }
          : {}),
      },
      candidate: {
        daysInRecovery: request.candidate.daysInRecovery,
        thesisInvalidated: request.candidate.thesisInvalidated,
        coveredCallAvailable,
        bestCcUtility,
      },
    },
    (payload) => parseRecoveryDecisionResponse(payload, request.fusionSnapshotHash),
  );

  if (!result.ok) {
    return {
      decisionId: `${request.snapshotId}:${request.chainId}`, snapshotId: request.snapshotId,
      fusionSnapshotHash: request.fusionSnapshotHash, timestamp: request.timestamp, chainId: request.chainId,
      action: 'UNKNOWN', boundExceeded: null,
      reasonCodes: ['PIPELINE_STAGE_FAILED:RECOVERY_DECISION'],
      coveredCallDecision, partialSellStockModeled: false,
      failClosedReason: result.detail, policyVersion: request.policy.policyVersion,
    };
  }

  return {
    decisionId: result.data.decisionId,
    snapshotId: result.data.snapshotId,
    fusionSnapshotHash: result.data.fusionSnapshotHash,
    timestamp: result.data.timestamp,
    chainId: request.chainId,
    action: result.data.action,
    boundExceeded: result.data.boundExceeded,
    reasonCodes: result.data.reasons.map((r) => r.code),
    coveredCallDecision,
    partialSellStockModeled: false,
    failClosedReason: null,
    policyVersion: result.data.policyVersion,
  };
}
