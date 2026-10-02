import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { selectFinalistContractsForRefresh, type FinalistQuoteRefreshPolicy } from '../src/theta/finalist-quote-refresh.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { paperBootstrapRuntimePolicy } from '../src/theta/paper-bootstrap-runtime-policy.js';
import {
  buildQEntryFunnel, modelAegisConcentrationState, modelQFinalQuantity, qEntryFunnelPolicyFromRuntimePolicy,
  qFunnelFactsFromContract, qFunnelInvariantViolations, qFunnelStageOrder, qGates,
  type QEntryFunnelPolicy, type QFunnelAccount, type QFunnelCandidateFacts,
} from '../src/theta/q-entry-funnel.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 2 area Q: per-stage funnel receipt, metamorphic properties at the
// lattice/funnel level, finalist-shortlist blindness and the spread-rounding
// boundary fix. Synthetic data only.

const NOW = '2026-10-01T15:00:00.000Z';
const policy = qEntryFunnelPolicyFromRuntimePolicy();
const approvedAccount = (over: Partial<QFunnelAccount> = {}): QFunnelAccount => ({
  equity: 1_000_000, buyingPower: 1_000_000, instrumentApproval: { state: 'APPROVED', reason: null }, ...over,
});

function contract(overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261106P00500000', occSymbol: 'SPY261106P00500000',
    optionType: 'PUT', strike: 500, expiration: '2026-11-06', asOfDate: '2026-10-01', multiplier: 100,
    underlyingBid: 599.9, underlyingAsk: 600.1, underlyingLast: 600, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
    rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15, ...overrides,
  }, NOW);
}
const facts = (c: NormalizedOptionContract): QFunnelCandidateFacts =>
  qFunnelFactsFromContract(c, { eventState: 'CLEAR', earningsDistanceSessions: null });
const sym = (strike: number, expiry = '261106') => `SPY${expiry}P${String(strike * 1000).padStart(8, '0')}`;
const at = (strike: number, over: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}) =>
  contract({ optionSymbol: sym(strike), occSymbol: sym(strike), strike, ...over });

test('every stage obeys INPUT = PASS + FAIL + UNKNOWN + NOT_APPLICABLE and carries exact reasons, never a generic one', () => {
  const contracts = [
    at(500), // clean
    at(495, { delta: -0.5 }), // exactly on the excluded upper delta edge
    at(490, { openInterest: 49 }), at(485, { volume: 9 }), at(480, { openInterest: null, openInterestSource: null }),
    at(475, { delta: null, gamma: null, theta: null, vega: null, rho: null, iv: null, greeksSource: null }),
    at(470, { bid: 1, ask: 2 }), // 66.7% spread
    at(465, { quoteTimestamp: '2026-10-01T14:59:00.000Z' }), // 60s old
    at(460, { expiration: '2026-10-20' }), // 19 DTE
  ];
  const receipt = buildQEntryFunnel({ policy, account: approvedAccount(), candidates: contracts.map(facts) });
  assert.deepEqual(qFunnelInvariantViolations(receipt), []);
  assert.equal(receipt.totals.INPUT_CONTRACTS, 9);
  assert.equal(receipt.totals.Q_VALID, 1);
  const byStrike = new Map(receipt.candidates.map((record) => [record.optionSymbol, record]));
  const reason = (strike: number) => byStrike.get(sym(strike))?.terminalReasons.join('|');
  assert.equal(byStrike.get(sym(500))?.terminalStage, 'COMPLETED');
  assert.match(reason(495) ?? '', /DELTA_OUTSIDE_ALL_BANDS/);
  assert.match(reason(490) ?? '', /OPEN_INTEREST_BELOW_FLOOR/);
  assert.match(reason(485) ?? '', /VOLUME_BELOW_FLOOR/);
  assert.match(reason(480) ?? '', /OPEN_INTEREST_UNKNOWN/);
  assert.equal(byStrike.get(sym(480))?.terminalVerdict, 'UNKNOWN', 'unknown is UNKNOWN, never FAIL-as-zero and never PASS');
  assert.match(reason(475) ?? '', /DELTA_UNKNOWN/);
  assert.match(reason(470) ?? '', /CONTRACT_NOT_EXECUTABLE/, 'executable stage precedes the spread stage (pipeline order)');
  assert.ok((byStrike.get(sym(470))?.allFindings ?? []).includes('SPREAD:SPREAD_TOO_WIDE'), 'masked spread failure is still visible independently');
  assert.match(reason(465) ?? '', /QUOTE_STALE|OPTION_QUOTE_STALE|CONTRACT_NOT_EXECUTABLE/);
  assert.match(reason(460) ?? '', /DTE_OUTSIDE_LATTICE/);
  for (const record of receipt.candidates) assert.ok(!record.terminalReasons.includes('NO_QUALIFYING_CANDIDATE'));
  assert.equal(receipt.stages.length, qFunnelStageOrder.length);
});

test('funnel is deterministic: input order, repeated runs and irrelevant optional fields do not change the receipt hash', () => {
  const contracts = [at(500), at(495), at(490, { openInterest: 10 }), at(485, { delta: -0.4 })];
  const reference = buildQEntryFunnel({ policy, account: approvedAccount(), candidates: contracts.map(facts) });
  const reversed = buildQEntryFunnel({ policy, account: approvedAccount(), candidates: [...contracts].reverse().map(facts) });
  const again = buildQEntryFunnel({ policy, account: approvedAccount(), candidates: contracts.map(facts) });
  assert.equal(reversed.contentHash, reference.contentHash);
  assert.equal(again.contentHash, reference.contentHash);
  assert.throws(() => buildQEntryFunnel({ policy, account: approvedAccount(), candidates: [...contracts, contracts[0] as NormalizedOptionContract].map(facts) }),
    /Q_FUNNEL_DUPLICATE_CANDIDATE_ID/);
  assert.equal(reference.executionAuthorized, false);
});

test('metamorphic: tightening any numeric Q hard gate can never increase the qualifying count', () => {
  const grid: NormalizedOptionContract[] = [];
  for (let index = 0; index < 60; index++) {
    grid.push(at(400 + index, {
      delta: -(0.02 + index * 0.009), openInterest: 5 + index * 3, volume: 1 + index, bid: 2, ask: 2 + 0.02 * (index % 25),
      expiration: index % 3 === 0 ? '2026-10-20' : index % 3 === 1 ? '2026-11-06' : '2026-12-20',
    }));
  }
  const qValid = (p: QEntryFunnelPolicy) =>
    buildQEntryFunnel({ policy: p, account: approvedAccount(), candidates: grid.map(facts) }).totals.Q_VALID;
  const tightenings: ((p: QEntryFunnelPolicy, step: number) => QEntryFunnelPolicy)[] = [
    (p, s) => ({ ...p, minOpenInterest: p.minOpenInterest + s * 20 }),
    (p, s) => ({ ...p, minVolume: p.minVolume + s * 5 }),
    (p, s) => ({ ...p, maxSpreadPct: Math.max(0, p.maxSpreadPct - s * 0.02) }),
    (p, s) => ({ ...p, minDte: p.minDte + s * 3 }),
    (p, s) => ({ ...p, maxDte: Math.max(p.minDte, p.maxDte - s * 4) }),
    (p, s) => ({ ...p, deltaBands: p.deltaBands.map(([low, high]) => [low, Math.max(low + 1e-6, high - s * 0.05)] as const) }),
    (p, s) => ({ ...p, earningsExclusionDays: p.earningsExclusionDays + s }),
  ];
  for (const [index, tighten] of tightenings.entries()) {
    let previous = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 8; step++) {
      const count = qValid(tighten(policy, step));
      assert.ok(count <= previous, `tightening #${index} step ${step} raised the qualifying count ${previous} -> ${count}`);
      previous = count;
    }
  }
  assert.ok(qValid(policy) > 0 && qValid(policy) < grid.length, 'the grid must actually exercise the gates');
});

test('metamorphic: an event-window earnings distance can only remove candidates (exact boundary at earningsExclusionDays)', () => {
  const base = facts(at(500));
  const run = (distance: number | null) => buildQEntryFunnel({ policy, account: approvedAccount(),
    candidates: [{ ...base, earningsDistanceSessions: distance }] }).totals.Q_VALID;
  const exclusion = paperBootstrapRuntimePolicy.conventional.earningsExclusionDays;
  assert.equal(run(exclusion), 0, 'distance equal to the exclusion window is blocked (<=)');
  assert.equal(run(exclusion + 1), 1);
  assert.equal(run(0), 0);
  assert.equal(run(null), 1, 'unknown/absent earnings distance does not by itself block here; the governed event policy owns coverage');
});

test('research-only fields cannot alter funnel eligibility: duplicated or extreme optional evidence changes neither counts nor hash', () => {
  const clean = at(500);
  const noisy = contract({ optionSymbol: clean.optionSymbol, occSymbol: clean.occSymbol, strike: 500,
    iv: 5, gamma: 99, theta: -99, vega: 99, rho: 99, lastTradePrice: 9999 });
  const a = buildQEntryFunnel({ policy, account: approvedAccount(), candidates: [facts(clean)] });
  const b = buildQEntryFunnel({ policy, account: approvedAccount(), candidates: [facts(noisy)] });
  assert.equal(a.totals.Q_VALID, b.totals.Q_VALID);
  assert.equal(a.contentHash, b.contentHash);
});

test('duplicating an identical losing contract does not change the canonical winner, and Q reorder never changes it', () => {
  const winner = at(500, { bid: 3, ask: 3.1 });
  const loser = at(495, { bid: 1, ask: 1.05 });
  const routing = (() => {
    const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
    return parseStrategyRoutingResponse({
      contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
      results: families.map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q',
        eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
        reasons: [{ code: 'ROUTE', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })),
    });
  })();
  const decide = (contracts: readonly NormalizedOptionContract[]) => {
    const frontier = buildCanonicalStrategyFrontier({
      snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: 9,
      aegisNewRiskState: 'ALLOW_FULL', buyingPower: 10_000_000, brokerAllowedQty: 9,
      sizingPolicy: { riskBudgetQtyCap: 9, collateralQtyCap: 9, concentrationQtyCap: 9, assignmentCapacityQtyCap: 9,
        tailRiskQtyCap: 9, correlationQtyCap: 9, liquidityQtyCap: 9, reducedStateMultiplier: 0.5 },
      eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
      optionomicsContext: { state: 'UNKNOWN' }, contracts, routing,
    } as never);
    return { selected: frontier.selectedCandidateId, quantity: frontier.selectedQuantity };
  };
  const reference = decide([winner, loser]);
  assert.ok(reference.selected !== null);
  assert.deepEqual(decide([loser, winner]), reference);
  assert.deepEqual(decide([loser, loser, winner, loser]), reference);
  const funnelA = buildQEntryFunnel({ policy, account: approvedAccount(), candidates: [winner, loser].map(facts) });
  const funnelB = buildQEntryFunnel({ policy, account: approvedAccount(), candidates: [loser, winner].map(facts) });
  assert.equal(funnelA.contentHash, funnelB.contentHash);
});

test('capital and AEGIS stages attribute inactivity to CAPITAL even when every liquidity gate passes (SPY-like oversized collateral)', () => {
  const contracts = [at(600), at(590), at(580)]; // 58k-60k collateral each
  const account = approvedAccount({ equity: 99_999.96, buyingPower: 99_999.96 });
  const withModel = contracts.map((c) => {
    const collateral = c.strike * c.multiplier;
    const aegisState = modelAegisConcentrationState({ collateral, equity: account.equity, policy });
    const sizing = modelQFinalQuantity({ collateral, buyingPower: account.buyingPower, brokerAllowedQty: 1, aegisState, policy });
    return { ...facts(c), aegisState, finalQuantity: sizing.quantity, finalQuantityBinding: sizing.bindingConstraint,
      finalist: true, entryBasis: 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED' as const };
  });
  const receipt = buildQEntryFunnel({ policy, account, candidates: withModel });
  assert.equal(receipt.totals.Q_VALID, 3);
  assert.equal(receipt.totals.FINAL_QTY_POSITIVE, 0);
  assert.equal(receipt.dominantBlocker, 'AEGIS');
  const stage = receipt.stages.find((item) => item.stageId === 'AEGIS');
  assert.equal(stage?.FAIL_COUNT, 3);
  assert.deepEqual(Object.keys(stage?.reasonCounts ?? {}), ['AEGIS_HARD_VETO']);

  const poor = buildQEntryFunnel({ policy, account: approvedAccount({ equity: 99_999.96, buyingPower: 30_000 }), candidates: contracts.map(facts) });
  assert.equal(poor.dominantBlocker, 'CAPITAL');
  assert.equal(poor.stages.find((item) => item.stageId === 'CAPITAL_FIT')?.reasonCounts.BUYING_POWER_BELOW_ONE_CONTRACT_COLLATERAL, 3);

  const unapproved = buildQEntryFunnel({ policy, account: approvedAccount({
    instrumentApproval: { state: 'NOT_APPROVED', reason: 'OPTIONS_LEVEL_BELOW_REQUIRED' } }), candidates: contracts.map(facts) });
  assert.equal(unapproved.dominantBlocker, 'INSTRUMENT_APPROVAL');
  assert.equal(unapproved.stages[1]?.reasonCounts.OPTIONS_LEVEL_BELOW_REQUIRED, 3);
});

test('unknown account capital is UNKNOWN (never zero-filled) and zero buying power is a valid FAIL, never floored to one contract', () => {
  const candidate = facts(at(500));
  const unknown = buildQEntryFunnel({ policy, account: approvedAccount({ buyingPower: null }), candidates: [candidate] });
  assert.equal(unknown.stages.find((s) => s.stageId === 'CAPITAL_FIT')?.UNKNOWN_COUNT, 1);
  const zero = buildQEntryFunnel({ policy, account: approvedAccount({ buyingPower: 0 }), candidates: [candidate] });
  assert.equal(zero.stages.find((s) => s.stageId === 'CAPITAL_FIT')?.FAIL_COUNT, 1);
  assert.equal(modelQFinalQuantity({ collateral: 50_000, buyingPower: 49_999.99, brokerAllowedQty: 5, aegisState: 'ALLOW_FULL', policy }).quantity, 0);
  assert.equal(modelQFinalQuantity({ collateral: 50_000, buyingPower: 50_000, brokerAllowedQty: 5, aegisState: 'ALLOW_FULL', policy }).quantity, 1);
});

test('modeled final quantity matches the real canonical sizing waterfall across a grid of capital and AEGIS states', () => {
  const routing = parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
    results: (['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as const).map((strategyFamily) => ({
      strategyFamily, eligible: strategyFamily === 'THETA_Q',
      eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: 'ROUTE', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })),
  });
  const caps = policy.quantityCaps;
  for (const strike of [50, 150, 400]) for (const buyingPower of [0, 4_999, 5_000, 12_000, 45_000, 160_000, 900_000])
    for (const aegisState of ['ALLOW_FULL', 'ALLOW_REDUCED', 'HARD_VETO', 'HOLD_ONLY', null] as const)
      for (const brokerAllowedQty of [0, 1, 7]) {
        const c = at(strike);
        const frontier = buildCanonicalStrategyFrontier({
          snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: null,
          aegisNewRiskState: aegisState, buyingPower, brokerAllowedQty,
          sizingPolicy: { riskBudgetQtyCap: caps.RISK_BUDGET, collateralQtyCap: caps.COLLATERAL_CAP,
            concentrationQtyCap: caps.CONCENTRATION_CAP, assignmentCapacityQtyCap: caps.ASSIGNMENT_CAPACITY_CAP,
            tailRiskQtyCap: caps.TAIL_RISK_CAP, correlationQtyCap: caps.CORRELATION_CAP, liquidityQtyCap: caps.LIQUIDITY_CAP,
            reducedStateMultiplier: policy.reducedStateMultiplier },
          eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
          optionomicsContext: { state: 'UNKNOWN' }, contracts: [c], routing,
        } as never);
        const real = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0]?.sizing.quantity;
        const modeled = modelQFinalQuantity({ collateral: strike * 100, buyingPower, brokerAllowedQty, aegisState, policy }).quantity;
        assert.equal(modeled, real, `strike=${strike} bp=${buyingPower} aegis=${String(aegisState)} broker=${brokerAllowedQty}`);
      }
});

test('AEGIS concentration model: soft cap reduces, hard cap (x1.5) vetoes, boundaries are exact', () => {
  const equity = 100_000;
  const soft = paperBootstrapRuntimePolicy.aegis.maximumTickerConcentrationPct * equity; // 15,000
  const hard = soft * paperBootstrapRuntimePolicy.aegis.hardCapMultiplier;
  const state = (collateral: number) => modelAegisConcentrationState({ collateral, equity, policy });
  assert.equal(state(soft - 0.01), 'ALLOW_FULL');
  assert.equal(state(soft), 'ALLOW_REDUCED');
  assert.equal(state(hard - 0.01), 'ALLOW_REDUCED');
  assert.equal(state(hard), 'HARD_VETO');
  assert.equal(modelAegisConcentrationState({ collateral: 1, equity: null, policy }), null);
});

// ---- finalist shortlist blindness (THETA-Q-FINALIST-BLIND-TO-DETERMINISTIC-GATES) --------------

const finalistPolicy = (maxFinalists: number): FinalistQuoteRefreshPolicy => ({
  policyVersion: 'finalist-test', effectiveAt: '2026-09-01T00:00:00.000Z', maxFinalists, maxAgeSeconds: 30 });
const lattice = { minDte: 25, maxDte: 60, deltaBands: [[0, 0.25], [0.25, 0.5]],
  minOpenInterest: 50, minVolume: 10, maxSpreadPct: 0.15 };

test('finalist shortlist no longer lets delta-central contracts that fail the frozen lattice gates starve gate-passing contracts', () => {
  // Three delta-centred (|delta| ~0.125 / 0.375 band centres) but illiquid contracts, and
  // three off-centre contracts that pass every gate. Bound of 3 finalists.
  const illiquid = [at(520, { delta: -0.125, volume: 2 }), at(521, { delta: -0.125, openInterest: 3 }),
    at(522, { delta: -0.375, volume: 0 })];
  const liquid = [at(500, { delta: -0.18 }), at(501, { delta: -0.3 }), at(502, { delta: -0.45 })];
  const selected = selectFinalistContractsForRefresh({
    contracts: [...illiquid, ...liquid], latticeConfig: lattice, policy: finalistPolicy(3), asOf: NOW,
  }).map((c) => c.optionSymbol).sort();
  assert.deepEqual(selected, liquid.map((c) => c.optionSymbol).sort());
});

test('finalist shortlist still falls back to illiquid contracts when too few pass (nothing is excluded, only ranked later)', () => {
  const liquid = [at(500, { delta: -0.18 })];
  const illiquid = [at(520, { delta: -0.125, volume: 2 }), at(521, { delta: -0.125, openInterest: 3 })];
  const selected = selectFinalistContractsForRefresh({
    contracts: [...illiquid, ...liquid], latticeConfig: lattice, policy: finalistPolicy(3), asOf: NOW,
  }).map((c) => c.optionSymbol);
  assert.equal(selected[0], liquid[0]?.optionSymbol);
  assert.equal(selected.length, 3);
});

test('finalist shortlist is order-independent and a lattice without liquidity keys keeps the prior ordering', () => {
  const contracts = [at(500, { delta: -0.2 }), at(501, { delta: -0.1, volume: 1 }), at(502, { delta: -0.3 })];
  const forward = selectFinalistContractsForRefresh({ contracts, latticeConfig: lattice, policy: finalistPolicy(2), asOf: NOW });
  const backward = selectFinalistContractsForRefresh({ contracts: [...contracts].reverse(), latticeConfig: lattice, policy: finalistPolicy(2), asOf: NOW });
  assert.deepEqual(forward.map((c) => c.optionSymbol), backward.map((c) => c.optionSymbol));
  const legacy = selectFinalistContractsForRefresh({ contracts, latticeConfig: { minDte: 25, maxDte: 60, deltaBands: [[0.2, 0.3]] },
    policy: finalistPolicy(2), asOf: NOW });
  // [0.2, 0.3] centre 0.25: 502 (0.30) and 500 (0.20) are equidistant, 501 (0.10) is farthest.
  assert.ok(!legacy.map((c) => c.optionSymbol).includes(sym(501)));
  assert.equal(legacy.length, 2);
});

// ---- spread rounding boundary --------------------------------------------------------------

test('a quote with spread exactly 15.000% of mid is never rejected by binary floating point rounding (all penny quotes)', () => {
  let exact = 0;
  for (let bidCents = 1; bidCents <= 2000; bidCents++) {
    for (let askCents = bidCents; askCents <= bidCents * 2; askCents++) {
      if (200 * (askCents - bidCents) !== 15 * (askCents + bidCents)) continue;
      exact++;
      const c = contract({ bid: bidCents / 100, ask: askCents / 100 });
      assert.equal(c.spreadPct, 0.15, `bid ${bidCents / 100} ask ${askCents / 100} gave ${c.spreadPct}`);
      assert.equal(c.executable, true, `bid ${bidCents / 100} ask ${askCents / 100} wrongly non-executable: ${c.nonExecutableReason}`);
      assert.equal(qGates.spread(c.spreadPct, policy).verdict, 'PASS');
    }
  }
  assert.ok(exact >= 50, 'the scan must find real exact-15% quotes');
});

test('spread boundary is exact in fraction units: just above 15% fails, and a percent-number (15) is never mistaken for a fraction', () => {
  const over = contract({ bid: 1, ask: 1.1631 }); // 15.0004% of mid
  assert.equal(over.executable, false);
  assert.match(over.nonExecutableReason ?? '', /spread too wide/);
  assert.equal(qGates.spread(0.15, policy).verdict, 'PASS');
  assert.equal(qGates.spread(0.1500001, policy).verdict, 'FAIL');
  assert.equal(qGates.spread(15, policy).verdict, 'FAIL', 'a percent-scaled 15 must fail the fraction gate');
});
