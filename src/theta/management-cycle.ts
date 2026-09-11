import type { ThetaLifecycleState } from './runtime-state.js';
import type { PythonBridgeConfig } from './python-bridge.js';
import { runManagementOrchestration, type ManagementOrchestrationRequest } from './management-orchestrator.js';
import type { ManagementDecisionReceipt } from './management-assembly.js';
import { runAssignmentOrchestration, type AssignmentOrchestrationRequest } from './assignment-orchestrator.js';
import type { AssignmentDecisionReceipt } from './assignment-assembly.js';
import { runRecoveryOrchestration, type RecoveryOrchestrationRequest, type RecoveryDecisionReceipt } from './recovery-orchestrator.js';
import { runCoveredCallManagementOrchestration, type CoveredCallManagementReceipt } from './covered-call-management-orchestrator.js';

// R1H item K4: the unified management cycle. Routes each open THETA
// chain into the correct real management orchestrator (K1-K3), by its
// CURRENT ThetaLifecycleState (runtime-state.ts), and aggregates every
// resulting receipt into one deterministic list. Never submits an order
// -- every orchestrator this module calls is itself non-executing.
//
// KNOWN LIMITATION (documented for the Codex handoff, not silently
// assumed away): this module does NOT itself fetch real Alpaca positions
// or persist/track which ThetaLifecycleState each chain is currently in
// -- that persistence is R1H item M (interfaces only, Codex owns the
// production schema/migration). The caller supplies each chain's current
// lifecycleState and the already-assembled context for whichever route
// applies. This keeps the router honest about what it actually knows
// (routing + orchestration + aggregation) versus what it does not yet
// have wired (durable lifecycle tracking from real broker state).
//
// Routing table (a five-way split of the ELEVEN-state canonical
// lifecycle machine down to the four routes item K4 asks for, plus two
// terminal/no-op routes and an explicit UNKNOWN fail-closed route):
//
// - CSP_OPEN                    -> SHORT_PUT       (management-orchestrator: HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/REDEPLOY)
// - ROLL_DECISION                -> ASSIGNMENT_PENDING (assignment-orchestrator: ACCEPT_ASSIGNMENT vs CLOSE_STOCK, BEFORE assignment is final)
// - STOCK_HELD, RECOVERY_WAIT    -> STOCK_RECOVERY  (recovery-orchestrator: RECOVERY_WAIT/SELL_STOCK/SELL_CC)
// - CC_OPEN                      -> COVERED_CALL    (covered-call-management-orchestrator: HOLD_CC/CLOSE_CC/ROLL_CC/ALLOW_CALL_AWAY)
// - CALL_AWAY, CLOSE_STOCK, CLOSED -> CLOSED         (chain already resolved; nothing to manage)
// - WAIT, CSP_PROPOSED, BTC_CLOSE, EXPIRE_OTM, ASSIGNED, CC_PROPOSED,
//   CLOSE_CC, REDEPLOY            -> NOT_A_MANAGEMENT_STATE (these are
//   either pre-open/new-risk states, already-resolved decision markers,
//   or transient broker-fact states with no further management decision
//   to make from this cycle's perspective -- routing one of these here
//   would be guessing, so it fails closed as UNKNOWN instead)

export type ManagementRoute =
  | 'SHORT_PUT'
  | 'ASSIGNMENT_PENDING'
  | 'STOCK_RECOVERY'
  | 'COVERED_CALL'
  | 'CLOSED'
  | 'UNKNOWN';

const ROUTE_BY_LIFECYCLE_STATE: Readonly<Partial<Record<ThetaLifecycleState, ManagementRoute>>> = {
  CSP_OPEN: 'SHORT_PUT',
  ROLL_DECISION: 'ASSIGNMENT_PENDING',
  STOCK_HELD: 'STOCK_RECOVERY',
  RECOVERY_WAIT: 'STOCK_RECOVERY',
  CC_OPEN: 'COVERED_CALL',
  CALL_AWAY: 'CLOSED',
  CLOSE_STOCK: 'CLOSED',
  CLOSED: 'CLOSED',
};

export function routeForLifecycleState(state: ThetaLifecycleState): ManagementRoute {
  return ROUTE_BY_LIFECYCLE_STATE[state] ?? 'UNKNOWN';
}

export interface ManagementCycleCandidate {
  readonly chainId: string;
  readonly lifecycleState: ThetaLifecycleState;
  readonly csp: ManagementOrchestrationRequest | null;
  readonly assignment: AssignmentOrchestrationRequest | null;
  readonly recovery: RecoveryOrchestrationRequest | null;
  readonly coveredCall: ManagementOrchestrationRequest | null;
}

export interface ManagementCycleResult {
  readonly chainId: string;
  readonly lifecycleState: ThetaLifecycleState;
  readonly route: ManagementRoute;
  readonly shortPut: ManagementDecisionReceipt | null;
  readonly assignmentPending: AssignmentDecisionReceipt | null;
  readonly stockRecovery: RecoveryDecisionReceipt | null;
  readonly coveredCall: CoveredCallManagementReceipt | null;
  readonly failClosedReason: string | null;
}

const noContextResult = (candidate: ManagementCycleCandidate, route: ManagementRoute, missing: string): ManagementCycleResult => ({
  chainId: candidate.chainId, lifecycleState: candidate.lifecycleState, route,
  shortPut: null, assignmentPending: null, stockRecovery: null, coveredCall: null,
  failClosedReason: `route ${route} requires ${missing}, which the caller did not supply for chain ${candidate.chainId}`,
});

export async function runThetaManagementCycle(
  bridge: PythonBridgeConfig,
  candidates: readonly ManagementCycleCandidate[],
): Promise<readonly ManagementCycleResult[]> {
  const results: ManagementCycleResult[] = [];

  for (const candidate of candidates) {
    const route = routeForLifecycleState(candidate.lifecycleState);

    if (route === 'SHORT_PUT') {
      if (candidate.csp === null) {
        results.push(noContextResult(candidate, route, 'a CSP management context'));
        continue;
      }
      const receipt = await runManagementOrchestration(bridge, candidate.csp);
      results.push({
        chainId: candidate.chainId, lifecycleState: candidate.lifecycleState, route,
        shortPut: receipt, assignmentPending: null, stockRecovery: null, coveredCall: null,
        failClosedReason: receipt.failClosedReason,
      });
    } else if (route === 'ASSIGNMENT_PENDING') {
      if (candidate.assignment === null) {
        results.push(noContextResult(candidate, route, 'an assignment evaluation context'));
        continue;
      }
      const receipt = await runAssignmentOrchestration(bridge, candidate.assignment);
      results.push({
        chainId: candidate.chainId, lifecycleState: candidate.lifecycleState, route,
        shortPut: null, assignmentPending: receipt, stockRecovery: null, coveredCall: null,
        failClosedReason: receipt.failClosedReason,
      });
    } else if (route === 'STOCK_RECOVERY') {
      if (candidate.recovery === null) {
        results.push(noContextResult(candidate, route, 'a recovery context'));
        continue;
      }
      const receipt = await runRecoveryOrchestration(bridge, candidate.recovery);
      results.push({
        chainId: candidate.chainId, lifecycleState: candidate.lifecycleState, route,
        shortPut: null, assignmentPending: null, stockRecovery: receipt, coveredCall: null,
        failClosedReason: receipt.failClosedReason,
      });
    } else if (route === 'COVERED_CALL') {
      if (candidate.coveredCall === null) {
        results.push(noContextResult(candidate, route, 'a covered-call management context'));
        continue;
      }
      const receipt = await runCoveredCallManagementOrchestration(bridge, candidate.coveredCall);
      results.push({
        chainId: candidate.chainId, lifecycleState: candidate.lifecycleState, route,
        shortPut: null, assignmentPending: null, stockRecovery: null, coveredCall: receipt,
        failClosedReason: receipt.underlying.failClosedReason,
      });
    } else if (route === 'CLOSED') {
      results.push({
        chainId: candidate.chainId, lifecycleState: candidate.lifecycleState, route,
        shortPut: null, assignmentPending: null, stockRecovery: null, coveredCall: null,
        failClosedReason: null,
      });
    } else {
      results.push({
        chainId: candidate.chainId, lifecycleState: candidate.lifecycleState, route: 'UNKNOWN',
        shortPut: null, assignmentPending: null, stockRecovery: null, coveredCall: null,
        failClosedReason: `lifecycleState ${candidate.lifecycleState} has no defined management route -- refusing to guess`,
      });
    }
  }

  return results;
}
