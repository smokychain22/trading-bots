import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { deriveCandidateCapacityAssessment, type DerivedAccountExposure } from '../src/theta/account-exposure.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { paperBootstrapRuntimePolicy as P } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { parseStrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';

// Phase 2 sizing properties over the real structuralSizing (via buildCanonicalStrategyFrontier).
// Quantity zero is a valid outcome; nothing here ever expects a forced 1.

const NOW = '2026-09-14T15:00:00.000Z';
const optionSymbolFor = (strike: number) => `AAPL261016P${String(Math.round(strike * 1000)).padStart(8, '0')}`;
function put(strike: number) {
  const sym = optionSymbolFor(strike);
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: sym, occSymbol: sym, optionType: 'PUT', strike, expiration: '2026-10-16',
    asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1, quoteTimestamp: NOW, tradeTimestamp: NOW,
    volume: 250, volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01,
    theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
  }, NOW);
}
const routing = parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'].map((strategyFamily) => ({
    strategyFamily, eligible: strategyFamily === 'THETA_Q',
    eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'ROUTE', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })),
});
type Caps = { riskBudgetQtyCap: number; collateralQtyCap: number; concentrationQtyCap: number; assignmentCapacityQtyCap: number;
  tailRiskQtyCap: number; correlationQtyCap: number; liquidityQtyCap: number; reducedStateMultiplier: number };
const wideCaps: Caps = { riskBudgetQtyCap: 99, collateralQtyCap: 99, concentrationQtyCap: 99, assignmentCapacityQtyCap: 99,
  tailRiskQtyCap: 99, correlationQtyCap: 99, liquidityQtyCap: 99, reducedStateMultiplier: 0.5 };
const bootstrapCaps: Caps = { riskBudgetQtyCap: P.sizing.riskBudgetQuantityCap, collateralQtyCap: P.sizing.collateralQuantityCap,
  concentrationQtyCap: P.sizing.concentrationQuantityCap, assignmentCapacityQtyCap: P.sizing.assignmentCapacityQuantityCap,
  tailRiskQtyCap: P.sizing.tailRiskQuantityCap, correlationQtyCap: P.sizing.correlationQuantityCap,
  liquidityQtyCap: P.sizing.liquidityQuantityCap, reducedStateMultiplier: P.sizing.reducedStateMultiplier };

type Aegis = 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | null;
interface Scenario { strike: number; buyingPower: number; caps: Caps; broker: number; assignment: number | null; aegis: Aegis }
const defaults: Scenario = { strike: 190, buyingPower: 1_000_000, caps: wideCaps, broker: 99, assignment: null, aegis: 'ALLOW_FULL' };

function sizingOf(s: Scenario) {
  const id = `THETA_CONVENTIONAL:${optionSymbolFor(s.strike)}`;
  const frontier = buildCanonicalStrategyFrontier({
    snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: s.assignment,
    aegisNewRiskState: s.aegis, buyingPower: s.buyingPower, brokerAllowedQty: s.broker, sizingPolicy: s.caps,
    eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: { state: 'UNKNOWN' },
    contracts: [put(s.strike)], routing } as never);
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates.find((c) => c.candidateId === id);
  assert.ok(candidate, `candidate visible for strike ${s.strike}`);
  return candidate.sizing;
}
const qtyOf = (s: Scenario) => sizingOf(s).quantity;

function prng(seed: number) { let x = seed >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; }; }

test('final quantity equals the minimum of every legitimate cap (random grid, ALLOW_FULL)', () => {
  const rnd = prng(20261002);
  const unit = 190 * 100;
  for (let i = 0; i < 400; i++) {
    const draw = (max: number) => Math.floor(rnd() * (max + 1));
    const caps: Caps = { riskBudgetQtyCap: draw(8), collateralQtyCap: draw(8), concentrationQtyCap: draw(8), assignmentCapacityQtyCap: draw(8),
      tailRiskQtyCap: draw(8), correlationQtyCap: draw(8), liquidityQtyCap: draw(8), reducedStateMultiplier: 0.5 };
    const broker = draw(9); const assignment = draw(9); const buyingPower = Math.round(rnd() * 12 * unit * 100) / 100;
    const expected = Math.min(caps.riskBudgetQtyCap, caps.collateralQtyCap, caps.concentrationQtyCap, caps.assignmentCapacityQtyCap,
      caps.tailRiskQtyCap, caps.correlationQtyCap, caps.liquidityQtyCap, broker, assignment, Math.floor(buyingPower / unit));
    const sizing = sizingOf({ ...defaults, caps, broker, assignment, buyingPower });
    assert.equal(sizing.quantity, expected, JSON.stringify({ caps, broker, assignment, buyingPower }));
    const reduced = sizingOf({ ...defaults, caps, broker, assignment, buyingPower, aegis: 'ALLOW_REDUCED' }).quantity;
    assert.equal(reduced, Math.floor(expected * 0.5), 'ALLOW_REDUCED floors the minimum, quantity zero stays zero');
    assert.ok(reduced <= sizing.quantity);
  }
});

test('the waterfall names every cap it applied and the binding constraint is one of them (no unexplained zero)', () => {
  const sizing = sizingOf({ ...defaults, caps: { ...bootstrapCaps }, broker: 5, buyingPower: 38_000, assignment: 7 });
  const names = sizing.waterfall.caps.map((c) => c.name);
  for (const required of ['RISK_BUDGET', 'COLLATERAL_CAP', 'CONCENTRATION_CAP', 'ASSIGNMENT_CAPACITY_CAP', 'TAIL_RISK_CAP',
    'CORRELATION_CAP', 'LIQUIDITY_CAP', 'BROKER_ALLOWED', 'BUYING_POWER_AFFORDABLE', 'REAL_ASSIGNMENT_CAPACITY']) {
    assert.ok(names.includes(required), `waterfall omits ${required}`);
  }
  assert.equal(sizing.quantity, 2);
  assert.equal(sizing.bindingConstraint, 'BUYING_POWER_AFFORDABLE');
  assert.equal(sizing.waterfall.preAegisQuantity, 2);
  // zero outcomes always carry a named binding constraint and at least one reason
  for (const aegis of ['HARD_VETO', 'HOLD_ONLY', null] as const) {
    const zero = sizingOf({ ...defaults, aegis });
    assert.equal(zero.quantity, 0);
    assert.ok(zero.bindingConstraint.length > 0 && zero.reasons.length > 0, `unexplained zero for AEGIS ${String(aegis)}`);
  }
  assert.equal(sizingOf({ ...defaults, buyingPower: 18_999.99 }).bindingConstraint, 'BUYING_POWER_AFFORDABLE');
  assert.equal(sizingOf({ ...defaults, buyingPower: 18_999.99 }).quantity, 0);
  assert.equal(sizingOf({ ...defaults, caps: { ...wideCaps, concentrationQtyCap: 0 } }).bindingConstraint, 'CONCENTRATION_CAP');
});

test('raising collateral, reserving capital or shrinking buying power never increases quantity; zero stays zero', () => {
  const grid = (xs: number[], f: (x: number) => Scenario) => { let prev = Infinity;
    for (const x of xs) { const q = qtyOf(f(x)); assert.ok(q <= prev, `${x}: ${q} > ${prev}`); prev = q; } };
  grid([5, 50, 190, 400, 700, 2_000, 10_000], (strike) => ({ ...defaults, strike, buyingPower: 250_000 })); // collateral up
  const equityBp = 250_000;
  grid([0, 5_000, 40_000, 100_000, 200_000, 249_999.99, 250_000], (reserved) => ({ ...defaults, buyingPower: equityBp - reserved, strike: 190 })); // reserve up
  grid([1_000_000, 100_000, 38_000, 19_000, 18_999.99, 1, 0], (buyingPower) => ({ ...defaults, buyingPower })); // BP down
  assert.equal(qtyOf({ ...defaults, buyingPower: 0 }), 0);
  assert.equal(qtyOf({ ...defaults, strike: 10_000, buyingPower: 999_999.99 }), 0, 'collateral above BP is zero, never one');
});

// ---- account-size matrix -------------------------------------------------------------------

const matrixEquities = [5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
function exposure(equity: number, extra: Partial<DerivedAccountExposure> = {}): DerivedAccountExposure {
  return { equity, cash: equity, buyingPower: equity * 4, optionsBuyingPower: equity, cspCollateralRequired: 0, stockInventoryValue: 0,
    longOptionValue: 0, stockValueByUnderlying: {}, shortPutCount: 0, shortCallCount: 0, longPutCount: 0, longCallCount: 0, openOrderCount: 0,
    pendingOpeningCapitalAtRisk: 0, pendingAssignmentCollateral: 0, pendingExposureByUnderlying: {}, unclassifiedOpenOrderIds: [],
    portfolioCapitalAtRiskPct: 0, tickerConcentrationPct: 0, largestConcentrationUnderlying: null, exposureByUnderlying: {},
    riskyUnderlyings: [], unparsedOptionSymbols: [], unclassifiedPositionSymbols: [], ...extra };
}
const policy = {
  hardCapMultiplier: P.aegis.hardCapMultiplier, maxTickerConcentrationPct: P.aegis.maximumTickerConcentrationPct,
  maxSectorConcentrationPct: P.aegis.maximumSectorConcentrationPct, maxCorrelationClusterPct: P.aegis.maximumCorrelationClusterPct,
  maxPortfolioCapitalAtRiskPct: P.aegis.maximumPortfolioCapitalAtRiskPct, maxInventoryCapacityPct: P.aegis.maximumInventoryCapacityPct,
  maxAssignmentCapacityPct: P.aegis.maximumAssignmentCapacityPct, maxRecoveryCapacityPct: P.aegis.maximumRecoveryCapacityPct };

/** Mirrors Python aegis._threshold_assessment over the candidate-inclusive ratios at the capacity quantity. */
function aegisStateFor(ratios: Array<[number | null, number]>): 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HARD_VETO' | 'HOLD_ONLY' {
  let state: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HARD_VETO' | 'HOLD_ONLY' = 'ALLOW_FULL';
  for (const [value, cap] of ratios) {
    if (value === null) return 'HOLD_ONLY';
    if (value >= cap * policy.hardCapMultiplier) state = 'HARD_VETO';
    else if (value >= cap && state === 'ALLOW_FULL') state = 'ALLOW_REDUCED';
  }
  return state;
}
function pipeline(equity: number, strike: number, exp: DerivedAccountExposure = exposure(equity), buyingPower = exp.optionsBuyingPower as number) {
  const unit = strike * 100;
  const broker = Math.floor(buyingPower / unit);
  const cap = deriveCandidateCapacityAssessment(exp, [], { underlying: 'AAPL', securedCollateralPerContract: unit }, broker, policy, 0);
  const i = cap.inputsAtQuantityCap;
  const aegis = aegisStateFor([[i.tickerConcentrationPct, policy.maxTickerConcentrationPct], [i.sectorConcentrationPct, policy.maxSectorConcentrationPct],
    [i.correlationClusterExposurePct, policy.maxCorrelationClusterPct], [i.portfolioCapitalAtRiskPct, policy.maxPortfolioCapitalAtRiskPct],
    [i.inventoryCapacityUsedPct, policy.maxInventoryCapacityPct], [i.assignmentCapacityUsedPct, policy.maxAssignmentCapacityPct],
    [i.recoveryCapacityUsedPct, policy.maxRecoveryCapacityPct]]);
  const sizing = sizingOf({ strike, buyingPower, caps: bootstrapCaps, broker, assignment: null, aegis });
  return { unit, broker, riskCapacityQty: cap.quantityCap, aegis, sizing };
}

test('account-size matrix: hard-threshold fit is exactly "final quantity >= 1"; soft cap and zero are never forced to one', () => {
  const rows: string[] = [];
  const strikes = [5, 20, 50, 100, 190, 300, 375, 450, 706];
  for (const equity of matrixEquities) {
    const softUsd = equity * policy.maxTickerConcentrationPct;
    const hardUsd = softUsd * policy.hardCapMultiplier;
    for (const strike of strikes) {
      const { unit, aegis, sizing } = pipeline(equity, strike);
      const hardFit = !(unit / equity >= policy.maxTickerConcentrationPct * policy.hardCapMultiplier) && unit <= equity;
      assert.equal(sizing.quantity >= 1, hardFit, `equity ${equity} strike ${strike}: qty ${sizing.quantity} AEGIS ${aegis}`);
      if (!hardFit) assert.equal(sizing.quantity, 0, 'no fit means zero, not one');
      if (unit / equity >= policy.maxTickerConcentrationPct * policy.hardCapMultiplier) assert.equal(aegis, 'HARD_VETO');
      assert.ok(sizing.quantity <= Math.min(3, Math.floor(equity / unit)), 'never above min(count caps, BP/collateral)');
      rows.push(`${equity}|${strike}|soft ${softUsd.toFixed(0)}|hard ${hardUsd.toFixed(0)}|unit ${unit}|${sizing.quantity}`);
    }
  }
  assert.ok(rows.length === matrixEquities.length * strikes.length);
  // $5k..$25k cannot hold even a $50 strike contract under the 22.5% hard threshold: it is an account fit result, not a bug.
  assert.equal(pipeline(5_000, 50).sizing.quantity, 0);
  // $19,000 is above the 15% soft cap ($15,000) but below the hard threshold ($22,499.99): reduced-only, floor(3 * 0.5) = 1.
  assert.equal(pipeline(100_000, 190).aegis, 'ALLOW_REDUCED');
  assert.equal(pipeline(100_000, 190).sizing.quantity, 1);
  assert.equal(pipeline(100_000, 190).sizing.bindingConstraint, 'AEGIS_ALLOW_REDUCED');
});

// ---- boundary: one cent below / exact / one cent above, strike * 100 exactly once ----------

test('buying-power boundary is exact for exactly representable collateral, and strike*100 is applied exactly once', () => {
  for (const strike of [1, 5, 12.5, 50, 100, 190, 706, 2_500]) {
    const unit = strike * 100;
    for (const k of [1, 2, 3]) {
      assert.equal(qtyOf({ ...defaults, strike, buyingPower: k * unit }), k, `exact ${k}x at strike ${strike}`);
      assert.equal(qtyOf({ ...defaults, strike, buyingPower: k * unit - 0.01 }), k - 1, `one cent below ${k}x at strike ${strike}`);
      assert.equal(qtyOf({ ...defaults, strike, buyingPower: k * unit + 0.01 }), k, `one cent above ${k}x at strike ${strike}`);
    }
    const waterfall = sizingOf({ ...defaults, strike, buyingPower: 2 * unit }).waterfall.capitalBudget;
    assert.equal(waterfall.finalCapitalBudget.value, 2 * unit, 'capital budget uses strike*100 once (not x10000, not x1)');
    assert.equal(waterfall.brokerBuyingPower.reason, 'BROKER_BUYING_POWER_NOT_THETA_RISK_BUDGET', 'BP is labelled as not usable capital');
  }
});

// SIZE-FLOAT-01 (fixed): integer-cents affordability helper.
test('cents-granular strikes: exact-fit buying power must give the exact contract count', () => {
  let wrong = 0, over = 0;
  for (let cents = 100; cents <= 2_000; cents += 1) {
    const strike = cents / 100;
    const q = qtyOf({ ...defaults, strike, buyingPower: cents }); // exact one-contract buying power in dollars (strike*100 === cents)
    if (q < 1) wrong += 1;
    if (q > 1) over += 1;
  }
  assert.equal(over, 0, 'must never over-size at an exact boundary');
  assert.equal(wrong, 0, `${wrong} cents-granular strikes under-size an exact one-contract fit`);
});

test('the float defect only ever fails closed (never over-sizes) one cent below an exact fit', () => {
  for (let cents = 100; cents <= 2_000; cents += 1) {
    const strike = cents / 100;
    assert.equal(qtyOf({ ...defaults, strike, buyingPower: Math.round((cents - 0.01) * 100) / 100 }), 0, `strike ${strike}`);
  }
});

// ---- forced-one scan of the trade path -----------------------------------------------------

test('no forced-one quantity construct exists in the sizing / frontier / decision / execution source', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(ts|py)$/.test(entry.name) ? [path.join(dir, entry.name)] : []);
  const files = [...walk('src/theta'), ...walk('src/execution'), 'bots/theta/quant/models/sizing.py', 'bots/theta/quant/models/theta_q_baseline.py']
    .map((file) => file.split(path.sep).join('/'));
  const forbidden = [/\bMath\.max\(\s*1\s*,\s*(?:\w+\.)*(?:qty|quantity|contracts|size)\b/i, /\bmax\(\s*1\s*,\s*(?:qty|quantity|contracts|size)\b/i,
    /\b(?:qty|quantity|contracts)\s*(?:\?\?|\|\|)\s*1\b/, /minimumTradeQuantity\s*[:=]\s*1/, /\b(?:default|fallback)(?:Quantity|Qty)\b/i];
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|#)/.test(line) || line.includes('``')) return; // comments / docstrings quoting the rule
      if (forbidden.some((re) => re.test(line))) hits.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
