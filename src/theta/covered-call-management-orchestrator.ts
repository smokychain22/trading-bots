import { runManagementOrchestration } from './management-orchestrator.js';
import type { ManagementOrchestrationRequest, OpenOptionLegInput, RollCandidateInput } from './management-orchestrator.js';
import type { PythonBridgeConfig } from './python-bridge.js';
import type { ManagementDecisionReceipt } from './management-assembly.js';

// R1H item K3 (managing an ALREADY-OPEN covered-call leg): HOLD_CC /
// CLOSE_CC / ROLL_CC / ALLOW_CALL_AWAY.
//
// This deliberately does NOT introduce a second Python model. The
// generic open-option-leg action-value math in
// models/management_action_value.py (already wired end to end via
// management_contract.py / management-orchestrator.ts for CSP legs) is
// agnostic to put vs. call -- entry_credit_per_share, current bid/ask,
// strike, multiplier, and dte mean exactly the same thing for a short
// call as for a short put. Building a second, parallel Python model here
// would risk the two option-leg managers' formulas silently drifting
// apart, which is exactly what management_action_value.py's own
// VALUATION CONVENTION section warns against.
//
// This module's only job is the semantic mapping: a covered call's
// CLOSE means CLOSE_CC (buy back the call before assignment), its ASSIGN
// means ALLOW_CALL_AWAY (shares called away at the strike -- an ECONOMIC
// EVENT, never itself a naive rule), its EXPIRE means the call expired
// OTM and the stock + full premium is retained, and its ROLL means
// ROLL_CC. HOLD stays HOLD_CC. No fixed-percentage or "always roll ITM"
// heuristic exists anywhere in this mapping -- every decision still
// comes from the real bid/ask-driven ManagementUtility comparison.

export type CoveredCallManagementAction = 'HOLD_CC' | 'CLOSE_CC' | 'ROLL_CC' | 'ALLOW_CALL_AWAY' | 'EXPIRE_RETAIN_STOCK' | 'REDEPLOY';

const ACTION_LABELS: Readonly<Record<ManagementDecisionReceipt['selectedAction'], CoveredCallManagementAction>> = {
  HOLD: 'HOLD_CC',
  CLOSE: 'CLOSE_CC',
  ROLL: 'ROLL_CC',
  ASSIGN: 'ALLOW_CALL_AWAY',
  EXPIRE: 'EXPIRE_RETAIN_STOCK',
  REDEPLOY: 'REDEPLOY',
  SELL_CC: 'HOLD_CC', // unreachable for an already-open CC leg -- management_action_value.py never selects SELL_CC/CLOSE_STOCK/CALL_AWAY (theta-q-only enum members)
  CLOSE_STOCK: 'HOLD_CC',
  CALL_AWAY: 'ALLOW_CALL_AWAY',
};

export interface CoveredCallManagementReceipt {
  readonly underlying: ManagementDecisionReceipt;
  readonly coveredCallAction: CoveredCallManagementAction;
}

export async function runCoveredCallManagementOrchestration(
  bridge: PythonBridgeConfig,
  request: ManagementOrchestrationRequest,
): Promise<CoveredCallManagementReceipt> {
  const receipt = await runManagementOrchestration(bridge, request);
  return {
    underlying: receipt,
    coveredCallAction: ACTION_LABELS[receipt.selectedAction],
  };
}

export type { OpenOptionLegInput, RollCandidateInput };
