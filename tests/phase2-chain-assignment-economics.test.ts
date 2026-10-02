import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssignmentState, evaluateAssignmentUtility } from '../src/theta/assignment-utility.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import { buildRecoveryState } from '../src/theta/recovery-state.js';
import { AssignmentRegistry, detectAssignment } from '../src/execution/lifecycle-reconciliation.js';
import { computeEffectiveStockBasis, computeWholeChainPnl, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';

// PHASE 2 (offline deterministic economic correctness): assignment economics and whole-chain accounting identities.

const close = (actual: number | null, expected: number, message?: string): void => {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `${message ?? ''} expected ${expected} got ${actual}`);
};
const knownSum = (legs: readonly { amount: number | null }[]): number =>
  legs.reduce((total, leg) => total + (leg.amount ?? 0), 0);

const flat: WholeChainComponents = {
  cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: 0, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0,
  assignmentStrike: null, stockSharesAssigned: 0, dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
  stockSaleOrCallAwayProceeds: null, fees: 0, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: null,
  currentStockMarkPerShare: null, openStockShares: 0,
};

const managementState = (overrides: Record<string, unknown> = {}, observedAt = '2026-09-12T14:00:00.000Z') => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: 'CSP_OPEN', underlying_id: 'underlying', underlying: 'AAPL',
  option_leg_id: 'leg', option_contract_id: 'contract', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: '2026-10-16', multiplier: '100', bid: '1', ask: '1.1', quote_as_of: observedAt,
  feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0', open_stock_shares: '0', stock_basis_per_share: null,
  realized_stock_pnl: '0', dividends: '0', fees: '0', buying_power: '50000', options_buying_power: '40000',
  account_as_of: observedAt, fusion_snapshot_id: 'fusion', reconciliation_quality: 'GOOD',
  broker_option_symbol: 'AAPL261016P00200000', broker_option_quantity: '1', broker_option_side: 'short',
  broker_option_asset_class: 'us_option', broker_option_observed_at: observedAt, ledger_option_contract_quantity: '1',
  snapshot_json: { underlyingState: { last: 205 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  broker_position: null, ...overrides,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt });

test('put expires OTM: premium is the whole-chain P&L, no stock leg appears, and there is no basis to compute', () => {
  const components = { ...flat, initialPutPremium: 250 };
  const result = computeWholeChainPnl(components);
  close(result.wholeChainPnl, 250);
  assert.ok(!result.legLevelPnl.some(leg => leg.label.startsWith('STOCK') || leg.label.startsWith('UNREALIZED')));
  assert.deepEqual(computeEffectiveStockBasis(components).missingComponents, ['NO_ASSIGNMENT_RECORDED']);
  assert.equal(computeEffectiveStockBasis(components).effectiveStockBasisPerShare, null);
});

test('put expires ITM and is assigned: cash deduction is strike*100*shares and the P&L equals premium - cash paid + stock value', () => {
  for (const strike of [0.5, 12.5, 37.35, 99.99, 199.99, 512]) {
    for (const lots of [1, 2, 3, 7]) {
      const shares = 100 * lots;
      const mark = Math.round((strike * 0.93) * 100) / 100;
      const premium = Math.round(strike * 1.1 * lots * 100) / 100;
      const components = { ...flat, initialPutPremium: premium, assignmentStrike: strike, stockSharesAssigned: shares,
        openStockShares: shares, currentStockMarkPerShare: mark, dividends: 0 };
      const cashPaid = Math.round(strike * 100) * 100 * lots / 100; // integer-cent exact strike*100*shares/100
      assert.ok(Math.abs(cashPaid - strike * shares) < 1e-6);
      const pnl = computeWholeChainPnl(components);
      close(pnl.wholeChainPnl, premium - cashPaid + mark * shares, `strike=${strike} lots=${lots}`);
      close(pnl.legLevelPnl.find(leg => leg.label === 'UNREALIZED_STOCK_MTM')?.amount ?? null, (mark - strike) * shares);
      // Open stock is MTM, never realized: no realized-stock leg exists until shares leave inventory.
      assert.ok(!pnl.legLevelPnl.some(leg => leg.label === 'STOCK_PNL_AT_SALE_OR_CALL_AWAY'));
    }
  }
});

test('buildAssignmentState: secured cash is exactly strike*multiplier*contracts, unknown terms stay null (never one contract, never zero)', () => {
  for (const strike of ['12.5', '37.35', '199.99']) {
    for (const quantity of ['1', '2', '5']) {
      const state = buildAssignmentState(managementState({ strike, quantity, ledger_option_contract_quantity: quantity, broker_option_quantity: quantity }));
      close(state.securedCashDollars, Math.round(Number(strike) * 100) * 100 * Number(quantity) / 100);
      assert.equal(state.sharesIfAssigned, 100 * Number(quantity));
      assert.equal(state.capitalLockedDollars, state.securedCashDollars);
    }
  }
  const unknownStrike = buildAssignmentState(managementState({ strike: null }));
  assert.equal(unknownStrike.securedCashDollars, null);
  assert.equal(unknownStrike.capitalLockedDollars, null);
  const unknownQuantity = buildAssignmentState(managementState({ quantity: null, ledger_option_contract_quantity: null }));
  assert.equal(unknownQuantity.securedCashDollars, null, 'a missing quantity must not default to one contract');
  assert.equal(unknownQuantity.sharesIfAssigned, null);
});

test('early assignment and expiry assignment are identical chain economics; only timing (capital days) can differ', () => {
  const components: WholeChainComponents = { ...flat, initialPutPremium: 310, rollCredits: 120, rollCloseCosts: 260, assignmentStrike: 48,
    stockSharesAssigned: 200, openStockShares: 200, currentStockMarkPerShare: 46.5, fees: 3.25 };
  const early = computeWholeChainPnl(components);
  const expiry = computeWholeChainPnl({ ...components });
  assert.deepEqual(early, expiry);
  const buildAt = (assignedAt: string) => buildRecoveryState(
    managementState({ lifecycle_state: 'RECOVERY_WAIT', open_stock_shares: '200', stock_basis_per_share: '48', option_leg_id: null,
      option_contract_id: null, contract_symbol: null, option_type: null, strike: null, quantity: null, bid: null, ask: null,
      entry_credit_debit: null, ledger_option_contract_quantity: '0', broker_option_symbol: null, broker_option_quantity: null,
      broker_option_side: null, broker_option_asset_class: null, broker_option_observed_at: null,
      broker_position: { currentPrice: 46.5 } }), assignedAt, 0.05, components, 30);
  const early1 = buildAt('2026-09-01T14:00:00.000Z');
  const late1 = buildAt('2026-09-11T14:00:00.000Z');
  assert.equal(early1.canonicalEffectiveBasisPerShare, late1.canonicalEffectiveBasisPerShare);
  assert.equal(early1.forwardOpportunityCostDollars, late1.forwardOpportunityCostDollars, 'forward cost cannot depend on how long ago assignment happened');
  assert.notEqual(early1.capitalDaysSoFar, late1.capitalDaysSoFar);
});

test('effective basis = strike - prior option premium net of realized option losses (+ costs); no option loss disappears when stock appears', () => {
  // premium 300, losing roll: close 500, new credit 400 -> net 200 retained, basis 95 - 2.00.
  const rolled = { ...flat, initialPutPremium: 300, rollCredits: 400, rollCloseCosts: 500, assignmentStrike: 95, stockSharesAssigned: 100 };
  close(computeEffectiveStockBasis(rolled).effectiveStockBasisPerShare, 93);
  // costs raise basis exactly by cost/shares
  close(computeEffectiveStockBasis({ ...rolled, fees: 6.5, executionCostNotEmbeddedInCashflows: 1 }).effectiveStockBasisPerShare, 93.075);
  // a chain whose option side lost money: net premium -800 -> basis ABOVE strike
  const loser = { ...flat, initialPutPremium: 100, rollCredits: 0, rollCloseCosts: 900, assignmentStrike: 50, stockSharesAssigned: 100 };
  close(computeEffectiveStockBasis(loser).effectiveStockBasisPerShare, 58);
  // selling the stock at the strike: the full -800 option loss is still in the chain total
  const sold = { ...loser, stockSaleOrCallAwayProceeds: 5000 };
  close(computeWholeChainPnl(sold).wholeChainPnl, -800);
  // selling at the effective basis is exactly breakeven
  close(computeWholeChainPnl({ ...loser, stockSaleOrCallAwayProceeds: 58 * 100 }).wholeChainPnl, 0);
  // partial close of a put (terminal partial buyback) is a real debit in the basis, not dropped
  const partial = { ...flat, initialPutPremium: 600, putCloseCosts: 150, assignmentStrike: 50, stockSharesAssigned: 200 };
  close(computeEffectiveStockBasis(partial).effectiveStockBasisPerShare, 50 - (600 - 150) / 200);
});

test('UNKNOWN fees keep basis and total UNKNOWN but the known legs remain visible and sum to the known cash flows', () => {
  const components: WholeChainComponents = { ...flat, initialPutPremium: 420, rollCredits: 100, rollCloseCosts: 130, assignmentStrike: 40,
    stockSharesAssigned: 100, coveredCallPremium: 75, coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: 4100, fees: null };
  const result = computeWholeChainPnl(components);
  assert.equal(result.wholeChainPnl, null);
  assert.equal(computeEffectiveStockBasis(components).effectiveStockBasisPerShare, null);
  assert.ok(computeEffectiveStockBasis(components).missingComponents.includes('fees'));
  const feeLeg = result.legLevelPnl.find(leg => leg.label === 'FEES');
  assert.equal(feeLeg?.amount, null, 'unknown fee is a null leg, never a zero leg');
  // KNOWN cash flows: 420 + 100 - 130 + 75 + (4100 - 4000)
  close(knownSum(result.legLevelPnl), 420 + 100 - 130 + 75 + 100);
});

test('UNKNOWN dividends keep the total UNKNOWN but the effective basis (which excludes dividends) stays computable', () => {
  const components: WholeChainComponents = { ...flat, initialPutPremium: 200, assignmentStrike: 30, stockSharesAssigned: 100,
    dividends: null, stockSaleOrCallAwayProceeds: 3100 };
  assert.equal(computeWholeChainPnl(components).wholeChainPnl, null);
  close(computeEffectiveStockBasis(components).effectiveStockBasisPerShare, 28);
  const withKnownZero = computeWholeChainPnl({ ...components, dividends: 0 });
  close(withKnownZero.wholeChainPnl, 200 + 100);
  close(computeWholeChainPnl({ ...components, dividends: 12.5 }).wholeChainPnl, 312.5);
});

test('unknown stock sale proceeds after shares left inventory, unknown mark with shares held, and invalid share identity all stay UNKNOWN', () => {
  const exited = { ...flat, initialPutPremium: 100, assignmentStrike: 20, stockSharesAssigned: 100, openStockShares: 0, stockSaleOrCallAwayProceeds: null };
  assert.equal(computeWholeChainPnl(exited).wholeChainPnl, null);
  const unmarked = { ...exited, openStockShares: 100, currentStockMarkPerShare: null };
  assert.equal(computeWholeChainPnl(unmarked).wholeChainPnl, null);
  assert.equal(computeWholeChainPnl({ ...exited, openStockShares: 300, currentStockMarkPerShare: 10 }).wholeChainPnl, null);
});

test('whole-chain identity over every component: known total == direct signed cash-flow sum, with no double premium or proceeds', () => {
  const cashFlows = {
    cspOpen: 280, cspCloseDebit: -90, rollOldCloseDebit: -340, rollNewCredit: 310, ccOpen: 140, ccCloseDebit: -60,
    ccRollCloseDebit: -50, ccRollNewCredit: 95, assignmentCashOut: -4500, stockSaleOrCallAway: 4700, dividend: 22, fee: -9.75, executionCost: -2,
  };
  const components: WholeChainComponents = {
    ...flat, initialPutPremium: cashFlows.cspOpen, putCloseCosts: -cashFlows.cspCloseDebit,
    rollCredits: cashFlows.rollNewCredit, rollCloseCosts: -cashFlows.rollOldCloseDebit,
    coveredCallPremium: cashFlows.ccOpen + cashFlows.ccRollNewCredit, coveredCallCloseCosts: -(cashFlows.ccCloseDebit + cashFlows.ccRollCloseDebit),
    assignmentStrike: 45, stockSharesAssigned: 100, stockSaleOrCallAwayProceeds: cashFlows.stockSaleOrCallAway,
    dividends: cashFlows.dividend, fees: -cashFlows.fee, executionCostNotEmbeddedInCashflows: -cashFlows.executionCost,
  };
  const direct = Object.values(cashFlows).reduce((total, value) => total + value, 0);
  const result = computeWholeChainPnl(components);
  close(result.wholeChainPnl, direct);
  close(knownSum(result.legLevelPnl), direct);
  // sensitivity: each classic accounting bug moves the total away from the direct sum
  const mutants: Record<string, WholeChainComponents> = {
    doublePremium: { ...components, initialPutPremium: (components.initialPutPremium as number) * 2 },
    missingCloseDebit: { ...components, putCloseCosts: 0 },
    missingRollClose: { ...components, rollCloseCosts: 0 },
    doubleStockProceeds: { ...components, stockSaleOrCallAwayProceeds: (components.stockSaleOrCallAwayProceeds as number) * 2 },
    duplicatedAssignmentShares: { ...components, stockSharesAssigned: 200 },
    laundered: { ...components, rollCloseCosts: 0, rollCredits: 0 },
  };
  for (const [name, mutant] of Object.entries(mutants)) {
    const mutated = computeWholeChainPnl(mutant).wholeChainPnl;
    assert.ok(mutated === null || Math.abs(mutated - direct) > 1e-6, `${name} must not reproduce the direct cash-flow sum`);
  }
});

test('identical assignment is never counted twice: the registry keeps one cash flow per assignment key, provisional upgrades in place', () => {
  const candidate = { executionAccountId: 'acct', chainId: 'chain', optionSymbol: 'AAPL261016P00200000', underlyingSymbol: 'AAPL',
    occurrenceDate: '2026-10-16', contracts: 2, multiplier: 100 };
  const previous = [{ symbol: 'AAPL261016P00200000', quantity: -2 }];
  const current = [{ symbol: 'AAPL', quantity: 200 }];
  const provisional = detectAssignment(candidate as never, previous as never, current as never, []);
  const confirmed = detectAssignment(candidate as never, previous as never, current as never,
    [{ id: 'act-1', activityType: 'OPASN', symbol: candidate.optionSymbol }] as never);
  assert.equal(provisional?.state, 'PROVISIONAL');
  assert.equal(confirmed?.state, 'CONFIRMED');
  assert.equal(provisional?.stockQuantity, 200);
  const registry = new AssignmentRegistry();
  registry.upsert(provisional as never);
  registry.upsert(confirmed as never);
  registry.upsert(confirmed as never);
  registry.upsert(provisional as never);
  assert.equal(registry.size, 1);
  assert.equal(confirmed?.stockQuantity, 200, 'shares from one assignment are never doubled by re-detection');
  // an unknown prior stock position is UNKNOWN, not zero shares: no provisional assignment is invented
  assert.equal(detectAssignment(candidate as never, previous as never, [{ symbol: 'AAPL', quantity: null }] as never, []), null);
});

test('assignment utility never lets premium already collected change ACCEPT_ASSIGNMENT forward cash flow, and unknown close cost never becomes a free CLOSE', () => {
  const lowPremium = evaluateAssignmentUtility(managementState({ entry_credit_debit: '10' }), null, null);
  const highPremium = evaluateAssignmentUtility(managementState({ entry_credit_debit: '9000' }), null, null);
  for (const comparison of [lowPremium, highPremium]) {
    const accept = comparison.assessments.find(item => item.action === 'ACCEPT_ASSIGNMENT');
    const closeAssessment = comparison.assessments.find(item => item.action === 'CLOSE');
    assert.equal(accept?.forwardCashFlowDollars, 0);
    assert.equal(closeAssessment?.forwardCashFlowDollars, null);
    assert.equal(closeAssessment?.utility, null);
    assert.notEqual(comparison.best?.action, 'CLOSE');
  }
  assert.deepEqual(lowPremium.assessments.map(item => [item.action, item.utility]),
    highPremium.assessments.map(item => [item.action, item.utility]), 'sunk premium is not a forward economic input');
});
