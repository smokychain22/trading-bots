/**
 * CAPZERO-LABEL: the single canonical vocabulary for "a valid candidate whose account cannot size one contract".
 *
 * Surfaces that must agree (each derives from this module, none carries its own list):
 *  - structuralSizing binding constraint (a named cap: one of `accountCapacityBindingConstraints`),
 *  - the AEGIS-side hard blocker `NO_ASSIGNMENT_CAPACITY` / the frontier blocker `ACCOUNT_POLICY_INCOMPATIBILITY`,
 *  - the runtime diagnostic sizing-zero cause `ACCOUNT_CAPACITY_ZERO` (classifySizingZero),
 *  - the global WAIT reason `PORTFOLIO_CAPACITY` (decision-evidence).
 * It is a sizing/capacity outcome, never an AEGIS HARD_VETO and never an earned WAIT.
 */
export const accountCapacityZeroCause = 'ACCOUNT_CAPACITY_ZERO' as const;

/** Frontier hard blocker for a shortlist-bound candidate whose minimum executable unit is PROVEN to exceed the account/risk policy. */
export const accountPolicyIncompatibilityBlocker = 'ACCOUNT_POLICY_INCOMPATIBILITY' as const;

/** structuralSizing bindings that mean the account (buying power, broker, AEGIS-assessed risk capacity or a configured cap) allows zero contracts. */
export const accountCapacityBindingConstraints: ReadonlySet<string> = new Set([
  'RISK_BUDGET', 'COLLATERAL_CAP', 'CONCENTRATION_CAP', 'ASSIGNMENT_CAPACITY_CAP', 'TAIL_RISK_CAP', 'CORRELATION_CAP',
  'LIQUIDITY_CAP', 'BROKER_ALLOWED', 'BUYING_POWER_AFFORDABLE', 'REAL_ASSIGNMENT_CAPACITY', 'AEGIS_RISK_CAPACITY',
]);

/** Hard blockers that already say the account cannot size one contract. */
export const accountCapacityBlockers: ReadonlySet<string> = new Set([
  'NO_ASSIGNMENT_CAPACITY', accountPolicyIncompatibilityBlocker,
]);

export const isAccountCapacityBinding = (binding: string | null | undefined): boolean =>
  binding !== null && binding !== undefined && accountCapacityBindingConstraints.has(binding);
