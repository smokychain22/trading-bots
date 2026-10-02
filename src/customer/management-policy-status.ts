import { paperBootstrapManagementPolicyVersion } from '../theta/paper-bootstrap-management-policy.js';

/**
 * D7 (MGMT-API-POLICY-STATE). The operator status must report the policy that actually runs and whether it can currently
 * submit new-risk management actions, derived from the policy constant and the live execution control -- never a pinned
 * string. The bootstrap policy selects ROLL / SELL_CC / ROLL_CC (all open new short risk), so new-risk management actions
 * are available exactly when master Paper execution is enabled and new orders are not paused. They still pass AEGIS,
 * quote, coverage, quantity and in-flight gates downstream and execute at the PAPER_EVIDENCE tier only.
 */
export interface PaperBootstrapManagementPolicyStatus {
  readonly status: 'READY';
  readonly policy_version: typeof paperBootstrapManagementPolicyVersion;
  readonly authority: 'PAPER_BOOTSTRAP_MANAGEMENT_POLICY';
  readonly empirical_profitability_claimed: false;
  readonly new_risk_management_actions: 'ENABLED_PAPER_EVIDENCE_TIER_GATED' | 'DISABLED';
}

export function paperBootstrapManagementPolicyStatus(control: {
  readonly masterEnabled: boolean;
  readonly pauseNewOrders: boolean;
}): PaperBootstrapManagementPolicyStatus {
  return {
    status: 'READY',
    policy_version: paperBootstrapManagementPolicyVersion,
    authority: 'PAPER_BOOTSTRAP_MANAGEMENT_POLICY',
    empirical_profitability_claimed: false,
    new_risk_management_actions: control.masterEnabled && !control.pauseNewOrders
      ? 'ENABLED_PAPER_EVIDENCE_TIER_GATED' : 'DISABLED',
  };
}
