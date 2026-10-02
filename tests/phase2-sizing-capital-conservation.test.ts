import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveAccountExposure, deriveCandidateCapacityAssessment, deriveCandidateInclusiveAegisInputs, type DerivedAccountExposure,
} from '../src/theta/account-exposure.js';
import type { AlpacaOpenOrderSnapshot, AlpacaPositionSnapshot, MasterAccountSnapshot } from '../src/theta/alpaca-provider.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { paperBootstrapRuntimePolicy as P } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { parseStrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';

const NOW = '2026-09-14T15:00:00.000Z';
const account = (equity: number, optionsBuyingPower = equity): MasterAccountSnapshot => ({
  accountStatus: 'ACTIVE', equity, cash: equity, buyingPower: equity * 4, optionsBuyingPower, optionsApprovedLevel: 3,
  optionsTradingLevel: 3, tradingBlocked: false, transfersBlocked: false, maskedAccountId: '****', receivedAt: NOW });
const position = (o: Partial<AlpacaPositionSnapshot>): AlpacaPositionSnapshot => ({
  symbol: 'XYZ', assetClass: 'us_equity', quantity: 100, side: 'long', avgEntryPrice: 60, marketValue: 6_000, unrealizedPl: 0, receivedAt: NOW, ...o });
const order = (o: Partial<AlpacaOpenOrderSnapshot>): AlpacaOpenOrderSnapshot => ({
  orderId: 'o1', clientOrderId: null, symbol: 'XYZ261016P00100000', side: 'sell', positionIntent: 'sell_to_open', quantity: 1,
  limitPrice: 1, status: 'new', submittedAt: NOW, receivedAt: NOW, ...o });
const policy = {
  hardCapMultiplier: P.aegis.hardCapMultiplier, maxTickerConcentrationPct: P.aegis.maximumTickerConcentrationPct,
  maxSectorConcentrationPct: P.aegis.maximumSectorConcentrationPct, maxCorrelationClusterPct: P.aegis.maximumCorrelationClusterPct,
  maxPortfolioCapitalAtRiskPct: P.aegis.maximumPortfolioCapitalAtRiskPct, maxInventoryCapacityPct: P.aegis.maximumInventoryCapacityPct,
  maxAssignmentCapacityPct: P.aegis.maximumAssignmentCapacityPct, maxRecoveryCapacityPct: P.aegis.maximumRecoveryCapacityPct };
const capacityFor = (exposure: DerivedAccountExposure, orders: readonly AlpacaOpenOrderSnapshot[], underlying: string, unit: number, broker = 50) =>
  deriveCandidateCapacityAssessment(exposure, orders, { underlying, securedCollateralPerContract: unit }, broker, policy, 0);

test('capital conservation: positions, pending orders and stock are each counted exactly once per underlying', () => {
  const positions = [
    position({ symbol: 'XYZ261016P00050000', assetClass: 'us_option', quantity: -1, side: 'short', marketValue: -80 }),
    position({ symbol: 'XYZ', quantity: 100, marketValue: 6_000 }),
  ];
  const orders = [order({ orderId: 'a', symbol: 'XYZ261016P00045000', quantity: 2 }),
    order({ orderId: 'b', positionIntent: 'buy_to_close', side: 'buy', symbol: 'XYZ261016P00050000' })];
  const e = deriveAccountExposure(account(100_000), positions, orders);
  assert.equal(e.cspCollateralRequired, 5_000);
  assert.equal(e.stockInventoryValue, 6_000);
  assert.equal(e.pendingOpeningCapitalAtRisk, 9_000, 'buy_to_close reserves nothing; sell_to_open 2 x 4500 once');
  assert.equal(e.pendingAssignmentCollateral, 9_000);
  assert.equal(e.exposureByUnderlying.XYZ, 5_000 + 6_000 + 9_000, 'stock + open short put + pending order, no duplication');
  assert.equal(e.portfolioCapitalAtRiskPct, (5_000 + 6_000 + 9_000) / 100_000);
  const inclusive = deriveCandidateInclusiveAegisInputs(e, orders, { underlying: 'XYZ', securedCollateralPerContract: 10_000, quantity: 1 }, 0);
  assert.equal(inclusive.assignmentCapacityUsedPct, (5_000 + 9_000 + 10_000) / 100_000, 'assignment reserve = open + pending + candidate once');
  assert.equal(inclusive.inventoryCapacityUsedPct, 6_000 / 100_000, 'stock inventory is included');
  assert.equal(inclusive.tickerConcentrationPct, (5_000 + 6_000 + 9_000 + 10_000) / 100_000);
});

test('broker buying power is never treated as usable capital: usable new-risk capital is the capped integer budget', () => {
  const e = deriveAccountExposure(account(1_000_000), [], []);
  const unit = 19_000;
  const id = 'THETA_CONVENTIONAL:AAPL261016P00190000';
  const sym = 'AAPL261016P00190000';
  const frontier = buildCanonicalStrategyFrontier({
    snapshotId: 's', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: null, aegisNewRiskState: 'ALLOW_FULL',
    buyingPower: 1_000_000, brokerAllowedQty: 52, eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
    optionomicsContext: { state: 'UNKNOWN' }, capitalBudgetAccountEvidence: { observedAt: NOW, exposure: e },
    sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6, tailRiskQtyCap: 3,
      correlationQtyCap: 3, liquidityQtyCap: 3, reducedStateMultiplier: 0.5 },
    contracts: [normalizeOptionContract({ source: 'ALPACA', underlying: 'AAPL', optionSymbol: sym, occSymbol: sym, optionType: 'PUT', strike: 190,
      expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200,
      underlyingTimestamp: NOW, bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1, quoteTimestamp: NOW,
      tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22,
      gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
      maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2 }, NOW)],
    routing: parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 's', timestamp: NOW, policyVersion: 'r',
      results: ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'].map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q',
        eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
        reasons: [{ code: 'R', polarity: 0, detail: 't' }], policyVersion: 'r' })) }),
  } as never);
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates.find((c) => c.candidateId === id);
  assert.ok(candidate);
  const budget = candidate.sizing.waterfall.capitalBudget;
  assert.equal(budget.brokerBuyingPower.value, 1_000_000);
  assert.equal(budget.brokerBuyingPower.reason, 'BROKER_BUYING_POWER_NOT_THETA_RISK_BUDGET');
  assert.equal(budget.availableNewRiskCapital.value, 3 * unit, 'usable capital is the capped quantity budget, not buying power');
  assert.notEqual(budget.availableNewRiskCapital.value, budget.brokerBuyingPower.value);
  assert.equal(budget.finalCapitalBudget.value, candidate.sizing.quantity * unit);
  assert.equal(budget.authority, 'EXPLAINS_EXISTING_CANONICAL_CAPS_NO_INDEPENDENT_SIZING');
  assert.equal(budget.cashReserve.state, 'NOT_CONFIGURED', 'absent reserve policy is explicit, never an implied zero');
  assert.equal(budget.maxStrategyCapital.state, 'NOT_CONFIGURED');
  assert.equal(budget.assignmentReserve.value, 0);
});

test('a pending sell-to-open reserves capital exactly like a filled position, and repeated retries cannot over-allocate', () => {
  const E = 100_000, unit = 10_000;
  const asPending = deriveAccountExposure(account(E), [], [order({ symbol: 'XYZ261016P00100000', quantity: 1 })]);
  const asFilled = deriveAccountExposure(account(E), [position({ symbol: 'XYZ261016P00100000', assetClass: 'us_option', quantity: -1, side: 'short', marketValue: -100 })], []);
  const capPending = capacityFor(asPending, [order({ symbol: 'XYZ261016P00100000', quantity: 1 })], 'XYZ', unit);
  const capFilled = capacityFor(asFilled, [], 'XYZ', unit);
  assert.equal(capPending.quantityCap, capFilled.quantityCap, 'pending and filled reserve the same capital (no free pending capacity, no double count)');
  assert.equal(capPending.inputsAtQuantityCap.tickerConcentrationPct, capFilled.inputsAtQuantityCap.tickerConcentrationPct);
  const empty = capacityFor(deriveAccountExposure(account(E), [], []), [], 'XYZ', unit);
  assert.ok(capPending.quantityCap < empty.quantityCap, 'the pending intent shrinks next-cycle capacity');

  // Sequential retry cycles: each cycle sees the previous cycle's still-open order and options BP net of it.
  let pending: AlpacaOpenOrderSnapshot[] = [];
  let reserved = 0;
  const hardUsd = E * policy.maxTickerConcentrationPct * policy.hardCapMultiplier;
  const quantities: number[] = [];
  for (let cycle = 0; cycle < 8; cycle++) {
    const exposure = deriveAccountExposure(account(E, E - reserved), [], pending);
    const bp = E - reserved;
    const broker = Math.floor(bp / unit);
    const cap = capacityFor(exposure, pending, 'XYZ', unit, broker);
    // final quantity here is bounded by the capacity the same AEGIS evaluation used (the SAFE regime for this strike/equity)
    const qty = Math.min(cap.quantityCap, 1);
    quantities.push(qty);
    if (qty === 0) break;
    pending = [...pending, order({ orderId: `c${cycle}`, symbol: 'XYZ261016P00100000', quantity: qty })];
    reserved += qty * unit;
    assert.ok(reserved < hardUsd, `cycle ${cycle}: reserved ${reserved} reached the hard threshold ${hardUsd}`);
  }
  assert.equal(quantities.at(-1), 0, 'retries terminate at zero capacity instead of accumulating without bound');
  assert.ok(reserved >= unit && reserved < hardUsd);
});

test('stale or mismatched pending-order evidence is UNKNOWN, never silently free capacity', () => {
  const orders = [order({ symbol: 'XYZ261016P00100000', quantity: 3 })];
  const e = deriveAccountExposure(account(100_000), [], orders);
  const stale = deriveCandidateInclusiveAegisInputs(e, [], { underlying: 'XYZ', securedCollateralPerContract: 1_000, quantity: 1 }, 0);
  assert.equal(stale.evidenceState, 'UNKNOWN_INSUFFICIENT_ACCOUNT_STATE');
  assert.ok(stale.unknownReasons.includes('PENDING_ORDER_SNAPSHOT_MISMATCH'));
  assert.equal(stale.tickerConcentrationPct, null, 'unknown stays null, not 0');
  const unclassified = deriveAccountExposure(account(100_000), [], [order({ positionIntent: null })]);
  assert.equal(unclassified.pendingOpeningCapitalAtRisk, null);
  assert.equal(unclassified.portfolioCapitalAtRiskPct === null || unclassified.pendingAssignmentCollateral === null, true);
  const shortCall = deriveAccountExposure(account(100_000), [], [order({ symbol: 'XYZ261016C00100000' })]);
  assert.equal(shortCall.pendingAssignmentCollateral, null, 'an uncovered-or-covered short call order is not assumed zero risk');
});

test('equity down, reserved capital up, pending exposure up and collateral up never increase risk capacity', () => {
  const unit = 10_000;
  const q = (equity: number, reserved: number, u = unit) => {
    const pending = reserved === 0 ? [] : [order({ symbol: 'XYZ261016P00100000', quantity: reserved / 10_000 })];
    return capacityFor(deriveAccountExposure(account(equity), [], pending), pending, 'XYZ', u).quantityCap;
  };
  let prev = Infinity;
  for (const equity of [1_000_000, 500_000, 250_000, 100_000, 50_000, 25_000, 10_000, 5_000]) { const v = q(equity, 0); assert.ok(v <= prev, `equity ${equity}`); prev = v; }
  prev = Infinity;
  for (const reserved of [0, 10_000, 20_000, 30_000, 40_000, 50_000]) { const v = q(1_000_000, reserved); assert.ok(v <= prev, `reserved ${reserved}`); prev = v; }
  prev = Infinity;
  for (const u of [1_000, 5_000, 10_000, 20_000, 50_000, 100_000]) { const v = q(500_000, 0, u); assert.ok(v <= prev, `collateral ${u}`); prev = v; }
});

test('multi-candidate competition: one selection per cycle, order independent, never more than the single best candidate capacity', () => {
  const strikes = [100, 105, 110, 115, 120, 125];
  const sym = (s: number) => `XYZ261016P${String(s * 1000).padStart(8, '0')}`;
  const make = (s: number) => normalizeOptionContract({ source: 'ALPACA', underlying: 'XYZ', optionSymbol: sym(s), occSymbol: sym(s), optionType: 'PUT', strike: s,
    expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 129.9, underlyingAsk: 130.1, underlyingLast: 130, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1, quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA',
    openInterest: 1200, openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW,
    greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2 }, NOW);
  const routing = parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 's', timestamp: NOW, policyVersion: 'r',
    results: ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'].map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q',
      eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE', reasons: [{ code: 'R', polarity: 0, detail: 't' }], policyVersion: 'r' })) });
  const BP = 40_000;
  const run = (order: readonly number[]) => buildCanonicalStrategyFrontier({ snapshotId: 's', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: null,
    aegisNewRiskState: 'ALLOW_FULL', buyingPower: BP, brokerAllowedQty: 99, eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
    optionomicsContext: { state: 'UNKNOWN' }, sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6,
      tailRiskQtyCap: 3, correlationQtyCap: 3, liquidityQtyCap: 3, reducedStateMultiplier: 0.5 },
    contracts: order.map(make), routing } as never);
  const reference = run(strikes);
  const candidates = reference.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates ?? [];
  const sumIndependent = candidates.reduce((s, c) => s + c.sizing.quantity * (c.legs[0]?.strike ?? 0) * 100, 0);
  assert.ok(sumIndependent > BP, 'each same-symbol candidate is sized against the full BP independently (this is why only ONE may be executed)');
  assert.ok(reference.selectedCandidateId !== null);
  const selected = candidates.find((c) => c.candidateId === reference.selectedCandidateId);
  assert.ok(selected);
  assert.ok(reference.selectedQuantity * (selected.legs[0]?.strike ?? 0) * 100 <= BP, 'the single executed intent fits the buying power');
  for (const permutation of [[...strikes].reverse(), [115, 100, 125, 105, 120, 110], [110, 120, 100, 125, 115, 105]]) {
    const other = run(permutation);
    assert.equal(other.selectedCandidateId, reference.selectedCandidateId, 'candidate order does not change the selection');
    assert.equal(other.selectedQuantity, reference.selectedQuantity, 'candidate order does not change the allocation');
  }
});

test('no unexplained zero: every structural zero path carries a named binding constraint and reason', () => {
  const sym = 'AAPL261016P00190000';
  const contract = normalizeOptionContract({ source: 'ALPACA', underlying: 'AAPL', optionSymbol: sym, occSymbol: sym, optionType: 'PUT', strike: 190, expiration: '2026-10-16',
    asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW, bid: 2, ask: 2.1, bidSize: 20,
    askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1, quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS',
    feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2 }, NOW);
  const routing = parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 's', timestamp: NOW, policyVersion: 'r',
    results: ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'].map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q',
      eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE', reasons: [{ code: 'R', polarity: 0, detail: 't' }], policyVersion: 'r' })) });
  const full = { riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6, tailRiskQtyCap: 3, correlationQtyCap: 3,
    liquidityQtyCap: 3, reducedStateMultiplier: 0.5 };
  const base = { snapshotId: 's', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: null, aegisNewRiskState: 'ALLOW_FULL', buyingPower: 1_000_000,
    brokerAllowedQty: 9, eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: { state: 'UNKNOWN' },
    sizingPolicy: full, contracts: [contract], routing };
  const cases: Array<[string, Record<string, unknown>]> = [
    ['missing policy', { sizingPolicy: undefined }], ['missing cap', { sizingPolicy: { ...full, tailRiskQtyCap: undefined } }],
    ['invalid cap', { sizingPolicy: { ...full, liquidityQtyCap: -1 } }], ['fractional cap', { sizingPolicy: { ...full, riskBudgetQtyCap: 1.5 } }],
    ['unknown BP', { buyingPower: null }], ['negative BP', { buyingPower: -1 }], ['aegis unknown', { aegisNewRiskState: null }],
    ['aegis hold', { aegisNewRiskState: 'HOLD_ONLY' }], ['aegis veto', { aegisNewRiskState: 'HARD_VETO' }], ['broker zero', { brokerAllowedQty: 0 }],
    ['assignment zero', { assignmentCapacityQty: 0 }],
    ['reduced no multiplier', { aegisNewRiskState: 'ALLOW_REDUCED', sizingPolicy: { ...full, reducedStateMultiplier: null } }],
    ['reduced invalid multiplier', { aegisNewRiskState: 'ALLOW_REDUCED', sizingPolicy: { ...full, reducedStateMultiplier: 1.5 } }],
  ];
  for (const [label, override] of cases) {
    const frontier = buildCanonicalStrategyFrontier({ ...base, ...override } as never);
    const sizing = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0]?.sizing;
    assert.ok(sizing, label);
    assert.equal(sizing.quantity, 0, `${label} must size to zero (never forced to one)`);
    assert.ok(sizing.bindingConstraint.length > 0 && sizing.reasons.length > 0, `${label}: unexplained zero`);
    assert.equal(sizing.waterfall.version, 'theta-canonical-sizing-waterfall-v1');
  }
  // An absent per-candidate broker cap is recorded MISSING in the waterfall; buying power / collateral (the same
  // floor(BP / collateral) figure the broker cap is derived from) still bounds quantity, so this is not fail-open.
  const noBroker = buildCanonicalStrategyFrontier({ ...base, brokerAllowedQty: undefined, buyingPower: 38_000 } as never)
    .branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0]?.sizing;
  assert.equal(noBroker?.quantity, 2);
  assert.equal(noBroker?.waterfall.caps.find((c) => c.name === 'BROKER_ALLOWED')?.state, 'MISSING');
});

// ---- OPEN DEFECT RISK-CAP-01 -----------------------------------------------------------------
// AEGIS is evaluated at deriveCandidateCapacityAssessment().quantityCap (the largest quantity that
// stays below every hard threshold), but riskCapacityQtyCap is not an input to canonical sizing, so
// final quantity = min(count caps, BP) can exceed the quantity AEGIS actually approved. Reachable
// when 2 * collateral reaches the hard threshold while 1 * collateral is still below the soft cap
// (collateral/equity in [0.1125, 0.15)): AEGIS sees ALLOW_FULL at 1 contract, canonical sizing
// returns up to 3. Latent today at $100k SPY (collateral/equity >= 0.30); real once equity scales.
function pipelineQty(equity: number, strike: number) {
  const unit = strike * 100;
  const exposure = deriveAccountExposure(account(equity), [], []);
  const broker = Math.floor(equity / unit);
  const cap = capacityFor(exposure, [], 'AEGIS', unit, broker);
  const i = cap.inputsAtQuantityCap;
  const rows: Array<[number | null, number]> = [[i.tickerConcentrationPct, policy.maxTickerConcentrationPct], [i.sectorConcentrationPct, policy.maxSectorConcentrationPct],
    [i.correlationClusterExposurePct, policy.maxCorrelationClusterPct], [i.portfolioCapitalAtRiskPct, policy.maxPortfolioCapitalAtRiskPct],
    [i.inventoryCapacityUsedPct, policy.maxInventoryCapacityPct], [i.assignmentCapacityUsedPct, policy.maxAssignmentCapacityPct], [i.recoveryCapacityUsedPct, policy.maxRecoveryCapacityPct]];
  let aegis: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HARD_VETO' = 'ALLOW_FULL';
  for (const [v, c] of rows) { if (v === null) throw new Error('unknown'); if (v >= c * policy.hardCapMultiplier) aegis = 'HARD_VETO'; else if (v >= c && aegis === 'ALLOW_FULL') aegis = 'ALLOW_REDUCED'; }
  return { unit, riskCapacityQty: cap.quantityCap, aegis };
}

test('RISK-CAP-01 evidence: AEGIS approval quantity is the risk capacity quantity (capacity 1, ALLOW_FULL) at collateral/equity 0.12', () => {
  const approved = pipelineQty(100_000, 120); // unit 12,000 = 12% of equity
  assert.equal(approved.riskCapacityQty, 1);
  assert.equal(approved.aegis, 'ALLOW_FULL');
});

function riskCapFrontier(riskCapacityQtyByCandidateId: Record<string, number | null> | undefined) {
  const sym = 'XYZ261016P00120000';
  const contract = normalizeOptionContract({ source: 'ALPACA', underlying: 'XYZ', optionSymbol: sym, occSymbol: sym, optionType: 'PUT', strike: 120, expiration: '2026-10-16',
    asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 129.9, underlyingAsk: 130.1, underlyingLast: 130, underlyingTimestamp: NOW, bid: 2, ask: 2.1, bidSize: 20, askSize: 18,
    lastTradePrice: 2.05, lastTradeSize: 1, quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS',
    iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2 }, NOW);
  const routing = parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 's', timestamp: NOW, policyVersion: 'r',
    results: ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'].map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q',
      eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE', reasons: [{ code: 'R', polarity: 0, detail: 't' }], policyVersion: 'r' })) });
  const approved = pipelineQty(100_000, 120);
  return { approved, frontier: buildCanonicalStrategyFrontier({ snapshotId: 's', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: null,
    aegisNewRiskState: approved.aegis, ...(riskCapacityQtyByCandidateId === undefined ? {} : { riskCapacityQtyByCandidateId }), buyingPower: 100_000, brokerAllowedQty: Math.floor(100_000 / approved.unit), eventState: 'CLEAR', unmanagedBrokerPositionCount: 0,
    unevaluatedUnderlyingCount: 0, optionomicsContext: { state: 'UNKNOWN' }, contracts: [contract], routing,
    sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6, tailRiskQtyCap: 3, correlationQtyCap: 3, liquidityQtyCap: 3,
      reducedStateMultiplier: 0.5 } } as never) };
}
const conventionalSizing = (frontier: ReturnType<typeof buildCanonicalStrategyFrontier>) => {
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(candidate);
  return candidate.sizing;
};
const RISK_ID = 'THETA_CONVENTIONAL:XYZ261016P00120000';

test('RISK-CAP-01: final quantity must not exceed the quantity AEGIS approved', () => {
  const { approved, frontier } = riskCapFrontier({ [RISK_ID]: 1 });
  const sizing = conventionalSizing(frontier);
  assert.ok(sizing.quantity <= approved.riskCapacityQty, `final ${sizing.quantity} exceeds the ${approved.riskCapacityQty} AEGIS approved`);
  assert.equal(sizing.quantity, 1);
  assert.equal(sizing.bindingConstraint, 'AEGIS_RISK_CAPACITY');
  assert.ok(sizing.waterfall.caps.some((c) => c.name === 'AEGIS_RISK_CAPACITY' && c.value === 1 && c.state === 'KNOWN'));
});

test('RISK-CAP-01: unknown or invalid AEGIS risk capacity sizes to zero (fail closed), never a default', () => {
  const unknown = conventionalSizing(riskCapFrontier({ [RISK_ID]: null }).frontier);
  assert.equal(unknown.quantity, 0);
  assert.equal(unknown.bindingConstraint, 'AEGIS_RISK_CAPACITY_UNKNOWN');
  const missingEntry = conventionalSizing(riskCapFrontier({}).frontier);
  assert.equal(missingEntry.quantity, 0, 'a Conventional candidate absent from a supplied map is UNKNOWN capacity');
  assert.equal(missingEntry.bindingConstraint, 'AEGIS_RISK_CAPACITY_UNKNOWN');
  const invalid = conventionalSizing(riskCapFrontier({ [RISK_ID]: 1.5 }).frontier);
  assert.equal(invalid.quantity, 0);
  assert.equal(invalid.bindingConstraint, 'AEGIS_RISK_CAPACITY_INVALID');
});

test('RISK-CAP-01: capacity zero sizes to zero; a looser capacity never raises the quantity above the other caps', () => {
  assert.equal(conventionalSizing(riskCapFrontier({ [RISK_ID]: 0 }).frontier).quantity, 0);
  const loose = conventionalSizing(riskCapFrontier({ [RISK_ID]: 50 }).frontier);
  assert.equal(loose.quantity, 3, 'risk capacity is an upper bound only; the tightest existing cap still binds');
  assert.notEqual(loose.bindingConstraint, 'AEGIS_RISK_CAPACITY');
});

test('RISK-CAP-01: field absent (archived bundle / legacy caller) is "not supplied": no cap, no waterfall row', () => {
  const legacy = conventionalSizing(riskCapFrontier(undefined).frontier);
  assert.equal(legacy.quantity, 3);
  assert.ok(!legacy.waterfall.caps.some((c) => c.name === 'AEGIS_RISK_CAPACITY'));
});

test('RISK-CAP-01: the cycle lookup carries the AEGIS-evaluated quantity per Conventional candidate; absent capacity is null (UNKNOWN), never zero or a default', async () => {
  const { conventionalFrontierRiskLookups } = await import('../src/theta/theta-shadow-cycle.js');
  const lookups = conventionalFrontierRiskLookups([
    { optionSymbol: 'A', brokerAllowedQty: 5, riskCapacityQtyCap: 2 },
    { optionSymbol: 'B', brokerAllowedQty: 5, riskCapacityQtyCap: 0 },
    { optionSymbol: 'C', brokerAllowedQty: 5 },
    { optionSymbol: 'D', brokerAllowedQty: 5, riskCapacityQtyCap: null },
  ]);
  assert.deepEqual(lookups.riskCapacityQtyByCandidateId, {
    'THETA_CONVENTIONAL:A': 2, 'THETA_CONVENTIONAL:B': 0, 'THETA_CONVENTIONAL:C': null, 'THETA_CONVENTIONAL:D': null });
});
