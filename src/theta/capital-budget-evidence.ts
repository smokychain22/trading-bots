import type { DerivedAccountExposure } from './account-exposure.js';

export interface CapitalBudgetAccountEvidence {
  readonly observedAt: string;
  readonly exposure: DerivedAccountExposure;
}

type BudgetValue = { readonly value: number | null; readonly state: 'KNOWN' | 'UNKNOWN' | 'NOT_CONFIGURED'; readonly reason: string };

/** Translate the already-governed integer capacities into candidate USD
 * budgets. This is an explanation of canonical sizing, never a second
 * allocator. Unconfigured reserve/strategy policy stays explicit. */
export function buildCapitalBudgetEvidence(input: {
  candidateId: string; snapshotId: string; asOf: string; buyingPower: number | null;
  collateralPerUnit: number | null; quantity: number; preAegisQuantity: number | null;
  caps: readonly { name: string; value: number | null; state: 'KNOWN' | 'MISSING' | 'INVALID' }[];
  account: CapitalBudgetAccountEvidence | null; policyVersion: string | null;
}) {
  const value = (amount: number | null, reason: string): BudgetValue => ({
    value: amount !== null && Number.isFinite(amount) && amount >= 0 ? amount : null,
    state: amount !== null && Number.isFinite(amount) && amount >= 0 ? 'KNOWN' : 'UNKNOWN', reason,
  });
  const unit = input.collateralPerUnit;
  const capital = (qty: number | null, reason: string) => value(qty !== null && Number.isSafeInteger(qty) && qty >= 0
    && unit !== null && Number.isFinite(unit) && unit >= 0 ? qty * unit : null, reason);
  const cap = (name: string) => {
    const row = input.caps.find(entry => entry.name === name);
    return capital(row?.state === 'KNOWN' ? row.value : null, `CANONICAL_INTEGER_CAP:${name}`);
  };
  const account = input.account;
  const pitValid = account !== null && Number.isFinite(Date.parse(account.observedAt))
    && Number.isFinite(Date.parse(input.asOf)) && Date.parse(account.observedAt) <= Date.parse(input.asOf);
  const exposure = pitValid ? account.exposure : null;
  const assignment = exposure?.cspCollateralRequired !== null && exposure?.cspCollateralRequired !== undefined
    && exposure.pendingAssignmentCollateral !== null
    ? exposure.cspCollateralRequired + exposure.pendingAssignmentCollateral : null;
  const notConfigured = (reason: string): BudgetValue => ({ value: null, state: 'NOT_CONFIGURED', reason });
  return {
    version: 'theta-canonical-capital-budget-evidence-v1', candidateId: input.candidateId,
    snapshotId: input.snapshotId, asOf: input.asOf, unit: 'USD', policyVersion: input.policyVersion,
    authority: 'EXPLAINS_EXISTING_CANONICAL_CAPS_NO_INDEPENDENT_SIZING',
    budgetBasis: 'INCREMENTAL_COLLATERAL_OR_DEFINED_MAX_LOSS',
    accountObservedAt: pitValid ? account.observedAt : null,
    accountEquity: value(exposure?.equity ?? null, 'BROKER_ACCOUNT'),
    accountCash: value(exposure?.cash ?? null, 'BROKER_ACCOUNT'),
    brokerBuyingPower: value(input.buyingPower, 'BROKER_BUYING_POWER_NOT_THETA_RISK_BUDGET'),
    assignmentReserve: value(assignment, 'CURRENT_SHORT_PUT_AND_PENDING_ASSIGNMENT_COLLATERAL'),
    availableNewRiskCapital: capital(input.preAegisQuantity, 'MINIMUM_EXISTING_INTEGER_CAPS_BEFORE_AEGIS'),
    maxTradeCapital: cap('RISK_BUDGET'), maxUnderlyingCapital: cap('CONCENTRATION_CAP'),
    maxCorrelatedClusterCapital: cap('CORRELATION_CAP'),
    maxStrategyCapital: notConfigured('NO_DISTINCT_STRATEGY_DOLLAR_ALLOCATION_IN_CURRENT_BOOTSTRAP_POLICY'),
    cashReserve: notConfigured('NO_EXTRA_CASH_RESERVE_RULE_IN_CURRENT_BOOTSTRAP_POLICY'),
    finalCapitalBudget: capital(input.quantity, 'FINAL_CANONICAL_QUANTITY_TIMES_UNIT_COLLATERAL'),
    capacities: input.caps.map(row => ({ name: row.name, capital: cap(row.name) })),
    policyCompleteness: 'EXPLICIT_BOOTSTRAP_CAPS_WITH_UNCONFIGURED_ADDITIONAL_RESERVE_AND_STRATEGY_ALLOCATION',
    executionAuthorized: false,
  };
}

export type CapitalBudgetEvidence = ReturnType<typeof buildCapitalBudgetEvidence>;
