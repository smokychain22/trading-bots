import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bestCoveredCallCandidate, evaluateCoveredCallCandidates, nondominatedCoveredCallCandidates, selectableCoveredCallCandidates,
  type CoveredCallCandidate, type CoveredCallUtilityWeights,
} from '../src/theta/covered-call-lattice.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import { evaluatePaperBootstrapManagementPolicy, type RollCandidate } from '../src/theta/paper-bootstrap-management-policy.js';
import { computeEffectiveStockBasis, computeWholeChainPnl, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';

// PHASE 2: recovery decision on forward economics and covered-call economics. Offline, deterministic.

const close = (actual: number | null, expected: number, message?: string): void => {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-6, `${message ?? ''} expected ${expected} got ${actual}`);
};

const recoveryState = (overrides: Record<string, unknown> = {}, observedAt = '2026-09-12T14:00:00.000Z') => assembleManagementInput({
  chain_id: 'chain', lifecycle_state: 'RECOVERY_WAIT', underlying_id: 'underlying', underlying: 'AAPL',
  option_leg_id: 'leg', option_contract_id: 'contract', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: '2026-10-16', multiplier: '100', bid: '1', ask: '1.1', quote_as_of: observedAt,
  feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0', open_stock_shares: '100',
  stock_basis_per_share: '195', realized_stock_pnl: '0', dividends: '0', fees: '0',
  buying_power: '50000', options_buying_power: '40000', account_as_of: observedAt, fusion_snapshot_id: 'fusion',
  reconciliation_quality: 'GOOD', broker_option_symbol: null, broker_option_quantity: null, broker_option_side: null,
  broker_option_asset_class: null, broker_option_observed_at: null, ledger_option_contract_quantity: '0',
  snapshot_json: { underlyingState: { last: 190 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
  broker_position: { currentPrice: 190 }, ...overrides,
}, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt });

const call = (overrides: Partial<RollCandidate> = {}): RollCandidate => ({
  optionContractId: 'cc-target', symbol: 'AAPL261120C00200000', optionType: 'CALL', strike: 200,
  expiration: '2026-11-20', multiplier: 100, quantity: 1, bid: 1, ask: 1.2, ...overrides,
});

const history = (netPutPremium: number, assignmentStrike = 195): WholeChainComponents => ({
  cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: netPutPremium, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0,
  assignmentStrike, stockSharesAssigned: 100, dividends: 0, coveredCallPremium: null, coveredCallCloseCosts: null,
  stockSaleOrCallAwayProceeds: null, fees: 0, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: 0,
  currentStockMarkPerShare: 190, openStockShares: 100,
});

const zeroWeights = (reason: string): CoveredCallUtilityWeights => ({
  upsideSacrificePerDollarWeight: 0, spreadPerDollarWeight: 0, eventRiskPenalty: 0, dividendExDateRiskPenalty: 0, belowBasisPenalty: 0,
  provenance: { policyVersion: 'phase2-test', configurationId: reason, effectiveVersion: 'phase2-test', sourceReason: reason },
});

const actionUtilities = (evidence: ReturnType<typeof evaluatePaperBootstrapManagementPolicy>) =>
  (evidence?.actionValues ?? []).map(value => [value.action, value.utility] as const);

test('recovery is not "wait until breakeven": at, above, near and far below basis the decision follows forward economics, not distance to basis', () => {
  const marks = [260, 195, 194, 150, 60];
  for (const mark of marks) {
    const overrides = { broker_position: { currentPrice: mark }, snapshot_json: { underlyingState: { last: mark }, marketSession: { isOpen: false },
      riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } } };
    // Neutral forward economics: nothing to do other than the passive default, regardless of distance to basis.
    const passive = evaluatePaperBootstrapManagementPolicy(recoveryState(overrides));
    assert.equal(passive?.selectedAction, 'RECOVERY_WAIT', `mark ${mark}`);
    // A real, known forward cost of waiting (capital opportunity cost) sells the stock at EVERY mark, below basis included.
    const costly = evaluatePaperBootstrapManagementPolicy({ ...recoveryState(overrides), assignedAtObservedAt: '2026-08-13T14:00:00.000Z',
      annualOpportunityCostRate: 0.05, sellStockOpportunityCostUtilityWeight: 0.02, recoveryForwardHorizonDays: 30 });
    assert.equal(costly?.selectedAction, 'SELL_STOCK', `mark ${mark} must not wait for breakeven when waiting has a known forward cost`);
  }
});

test('sunk cost is not the objective: identical forward economics with different historical option P&L produce identical action values', () => {
  const overrides = { broker_position: { currentPrice: 150 }, snapshot_json: { underlyingState: { last: 150 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'HARD_VETO' }, eventState: { state: 'CLEAR' } } };
  const scenarios = [
    { label: 'big historical gain', basis: '120', components: history(7000, 195) },
    { label: 'flat history', basis: '195', components: history(0, 195) },
    { label: 'big historical option loss', basis: '260', components: history(-6500, 195) },
  ];
  // Forward levers that do NOT size capital by cost basis: the thesis lever (and the neutral default).
  for (const policyFields of [{}, { thesisFailureUtilityBias: 1 }]) {
    const results = scenarios.map(item => {
      const input = { ...recoveryState({ ...overrides, stock_basis_per_share: item.basis }), ...policyFields, wholeChainComponents: item.components };
      return { label: item.label, evidence: evaluatePaperBootstrapManagementPolicy(input) };
    });
    const first = results[0];
    assert.ok(first);
    for (const result of results) {
      assert.equal(result.evidence?.selectedAction, first.evidence?.selectedAction, result.label);
      assert.deepEqual(actionUtilities(result.evidence), actionUtilities(first.evidence), `${result.label}: utilities must not move with historical P&L`);
    }
  }
  // ...while the REPORTED accounting still differs: history is visible, it just is not a decision input.
  const bases = scenarios.map(item => computeEffectiveStockBasis(item.components).effectiveStockBasisPerShare as number);
  const [b0, b1, b2] = bases;
  assert.ok(b0 !== undefined && b1 !== undefined && b2 !== undefined);
  assert.ok(b0 < b1 && b1 < b2);
});

test('P2-CHAIN-02 FIXED: the capital opportunity cost of waiting is sized on the CURRENT MARK x shares, so identical forward economics with different historical loss give identical SELL_STOCK / RECOVERY_WAIT utility', () => {
  const overrides = { broker_position: { currentPrice: 150 }, snapshot_json: { underlyingState: { last: 150 }, marketSession: { isOpen: false },
    riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } } };
  const policyFields = { assignedAtObservedAt: '2026-09-01T14:00:00.000Z', annualOpportunityCostRate: 0.05,
    sellStockOpportunityCostUtilityWeight: 0.02, recoveryForwardHorizonDays: 30 };
  const utilityFor = (netPutPremium: number) => evaluatePaperBootstrapManagementPolicy({ ...recoveryState(overrides), ...policyFields,
    wholeChainComponents: history(netPutPremium, 195) })?.actionValues.find(value => value.action === 'SELL_STOCK')?.utility as number;
  const gain = utilityFor(7000), flat = utilityFor(0), loss = utilityFor(-6500);
  // Forward liquidation value (150 * 100) is identical in all three, and so is the utility. It previously scaled with the
  // effective basis (125 / 195 / 260), i.e. the SELL_STOCK incentive grew with the size of the historical loss.
  // No file in the repo (docs, code comments, CLAUDE.md, TEAM_CHARTER) is an owner directive requiring cost-basis sizing: the
  // 'standing directive' quoted in recovery-state.ts says only that THETA may evaluate this when canonical basis is UNKNOWN,
  // which the mark-based figure satisfies better (it needs no basis at all).
  close(gain, flat);
  close(loss, flat);
  // expected magnitude: weight 0.02 x (150 x 100 x 5% x 30 / 365)
  close(flat, 0.02 * 150 * 100 * 0.05 * 30 / 365);
  const waitFor = (netPutPremium: number) => evaluatePaperBootstrapManagementPolicy({ ...recoveryState(overrides), ...policyFields,
    wholeChainComponents: history(netPutPremium, 195) })?.actionValues.find(value => value.action === 'RECOVERY_WAIT')?.utility as number;
  close(waitFor(7000), waitFor(-6500));
  // the recorded basis column (what the lot was bought at) is equally irrelevant
  const byLotBasis = (basis: string) => evaluatePaperBootstrapManagementPolicy({ ...recoveryState({ ...overrides, stock_basis_per_share: basis }),
    ...policyFields })?.actionValues.find(value => value.action === 'SELL_STOCK')?.utility as number;
  close(byLotBasis('120'), byLotBasis('260'));
  // a lower mark (a real change in liquidation value) DOES move it - the cost is forward, not constant
  const lowerMark = evaluatePaperBootstrapManagementPolicy({ ...recoveryState({ broker_position: { currentPrice: 100 } }), ...policyFields,
    wholeChainComponents: history(0, 195) })?.actionValues.find(value => value.action === 'SELL_STOCK')?.utility as number;
  assert.ok(lowerMark < flat);
});

test('weak, poor-liquidity and event-exposed calls lose to waiting; a strong clean call wins; the same call under unknown event risk is not treated as safe', () => {
  const weights: CoveredCallUtilityWeights = { upsideSacrificePerDollarWeight: 0, spreadPerDollarWeight: 5, eventRiskPenalty: 500,
    dividendExDateRiskPenalty: 200, belowBasisPenalty: 0, provenance: zeroWeights('phase2').provenance };
  const base = { ...recoveryState(), sellCcPremiumUtilityWeight: 0.01, ccUtilityWeights: weights };
  const decide = (candidate: RollCandidate) => evaluatePaperBootstrapManagementPolicy({ ...base, ccCandidates: [candidate] });
  assert.equal(decide(call({ bid: 1.5, ask: 1.6, eventRisk: 'ABSENT_VERIFIED', dividendExDateRisk: 'ABSENT_VERIFIED' }))?.selectedAction, 'SELL_CC', 'strong clean call');
  assert.equal(decide(call({ bid: 1.5, ask: 1.6, eventRisk: 'PRESENT' }))?.selectedAction, 'RECOVERY_WAIT', 'event approaching');
  assert.equal(decide(call({ bid: 1.5, ask: 1.6, eventRisk: 'ABSENT_VERIFIED', dividendExDateRisk: 'PRESENT' }))?.selectedAction, 'RECOVERY_WAIT', 'ex-dividend approaching');
  assert.equal(decide(call({ bid: 0.05, ask: 3.2, eventRisk: 'ABSENT_VERIFIED', dividendExDateRisk: 'ABSENT_VERIFIED' }))?.selectedAction, 'RECOVERY_WAIT', 'poor liquidity (wide spread)');
  assert.equal(decide(call({ bid: 0, ask: 0.05 }))?.selectedAction, 'RECOVERY_WAIT', 'worthless premium does not beat waiting');
  // unknown event risk: no fabricated penalty, but explicitly named as uncertain, never as ABSENT_VERIFIED
  const unknown = decide(call({ bid: 1.5, ask: 1.6, eventRisk: 'UNKNOWN', dividendExDateRisk: 'UNKNOWN' }));
  const reasons = unknown?.actionValues.find(value => value.action === 'SELL_CC')?.reasons ?? [];
  assert.ok(reasons.includes('EVENT_RISK_UNKNOWN_NOT_TREATED_AS_SAFE'));
  assert.ok(!reasons.includes('EVENT_RISK_ABSENT_VERIFIED'));
});

test('high IV pays a larger bid than low IV and ranks above it when nothing else differs; a missing quote is never a zero premium', () => {
  const held = 100;
  const make = (id: string, strike: number, bid: number | null, ask: number | null): CoveredCallCandidate => ({
    symbol: id, optionContractId: id, strike, expiration: '2026-11-20', delta: null, bid, ask, multiplier: 100, quantity: 1,
    openInterest: null, volume: null, dividendExDateRisk: 'ABSENT_VERIFIED', eventRisk: 'ABSENT_VERIFIED',
  });
  const chain = { ...history(0, 195), coveredCallPremium: 0, coveredCallCloseCosts: 0 };
  const base: Omit<typeof chain, 'currentStockMarkPerShare' | 'openStockShares'> & Partial<typeof chain> = { ...chain };
  delete base.currentStockMarkPerShare;
  delete base.openStockShares;
  const assessments = evaluateCoveredCallCandidates(195, 196, held, base, [
    make('low-iv', 205, 0.5, 0.75), make('high-iv', 205, 2, 2.25), make('no-quote', 205, null, null),
  ], zeroWeights('phase2-iv'));
  const byId = new Map(assessments.map(item => [item.candidate.optionContractId, item]));
  close(byId.get('high-iv')?.premiumIncomeDollars ?? null, 200);
  close(byId.get('low-iv')?.premiumIncomeDollars ?? null, 50);
  assert.equal(byId.get('no-quote')?.premiumIncomeDollars, null);
  assert.equal(byId.get('no-quote')?.utility.utility, null);
  assert.equal(byId.get('no-quote')?.wholeChainPnlIfCalledAway, null);
  assert.equal(bestCoveredCallCandidate(assessments)?.candidate.optionContractId, 'high-iv');
  assert.equal(selectableCoveredCallCandidates(assessments).some(item => item.candidate.optionContractId === 'no-quote'), false);
  assert.equal(nondominatedCoveredCallCandidates(selectableCoveredCallCandidates(assessments)).length, 1);
});

test('covered-call economics: call-away P&L carries prior CSP/roll losses, so a strike above the assignment strike but below effective basis is a loss', () => {
  // assigned at 100; the chain lost 700 net on options before assignment => effective basis 107.
  const chain = { cashflowBasis: 'ACTUAL_FILL_CASHFLOW' as const, initialPutPremium: 200, putCloseCosts: 0, rollCredits: 300, rollCloseCosts: 1200,
    assignmentStrike: 100, stockSharesAssigned: 100, dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
    stockSaleOrCallAwayProceeds: null, fees: 0, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: 0 };
  close(computeEffectiveStockBasis({ ...chain, currentStockMarkPerShare: 100, openStockShares: 100 }).effectiveStockBasisPerShare, 107);
  const candidate = (id: string, strike: number): CoveredCallCandidate => ({ symbol: id, optionContractId: id, strike, expiration: '2026-11-20',
    delta: null, bid: 1, ask: 1.1, multiplier: 100, quantity: 1, openInterest: null, volume: null,
    dividendExDateRisk: 'ABSENT_VERIFIED', eventRisk: 'ABSENT_VERIFIED' });
  const assessments = evaluateCoveredCallCandidates(107, 104, 100, chain, [candidate('below', 105), candidate('at', 107), candidate('above', 112)],
    zeroWeights('phase2-cc'));
  const byId = new Map(assessments.map(item => [item.candidate.optionContractId, item]));
  assert.equal(byId.get('below')?.belowBasis, true);
  assert.equal(byId.get('at')?.belowBasis, false);
  assert.equal(byId.get('above')?.belowBasis, false);
  // called away at 105: stock +500 over the assignment strike, premium +100, option history -700 => -100 despite "profit on the stock"
  close(byId.get('below')?.wholeChainPnlIfCalledAway ?? null, -100);
  // at effective basis: premium only (stock + history net to zero): +100
  close(byId.get('at')?.wholeChainPnlIfCalledAway ?? null, 100);
  close(byId.get('above')?.wholeChainPnlIfCalledAway ?? null, 600);
  // default policy refuses below-basis selection; evaluation still lists it with the reason
  assert.ok(byId.get('below')?.reasons.includes('BELOW_BASIS_CC_REJECTED_BY_BOOTSTRAP_POLICY'));
  assert.ok(!selectableCoveredCallCandidates(assessments).some(item => item.candidate.optionContractId === 'below'));
});

test('covered-call identity: called-away minus not-called P&L equals (strike - mark) * covered shares, and uncovered shares keep their mark', () => {
  const base = { cashflowBasis: 'ACTUAL_FILL_CASHFLOW' as const, initialPutPremium: 330, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0,
    assignmentStrike: 80, stockSharesAssigned: 300, dividends: 0, coveredCallPremium: 45, coveredCallCloseCosts: 120,
    stockSaleOrCallAwayProceeds: null, fees: 4, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: 0 };
  for (const strike of [70, 80, 82.5, 90, 140]) {
    for (const mark of [60, 79.99, 80, 95]) {
      for (const contracts of [1, 2, 3]) {
        const candidate: CoveredCallCandidate = { symbol: 'c', optionContractId: 'c', strike, expiration: '2026-11-20', delta: null, bid: 0.8,
          ask: 0.9, multiplier: 100, quantity: contracts, openInterest: null, volume: null, dividendExDateRisk: 'ABSENT_VERIFIED', eventRisk: 'ABSENT_VERIFIED' };
        const [assessment] = evaluateCoveredCallCandidates(75, mark, 300, base, [candidate], zeroWeights('identity'));
        const covered = contracts * 100;
        const called = assessment?.wholeChainPnlIfCalledAway ?? null;
        const notCalled = assessment?.wholeChainPnlIfNotCalled ?? null;
        assert.ok(called !== null && notCalled !== null);
        close(called - notCalled, (strike - mark) * covered, `strike=${strike} mark=${mark} contracts=${contracts}`);
        // not called: prior CC loss (45-120), new premium, fees, and stock MTM on ALL shares
        close(notCalled, 330 + 45 + 0.8 * covered - 120 - 4 + (mark - 80) * 300);
      }
    }
  }
});

test('no covered call may violate coverage: more contracts than 100-share lots held is unrankable, not a smaller covered call', () => {
  const chain = { cashflowBasis: 'ACTUAL_FILL_CASHFLOW' as const, initialPutPremium: 100, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0,
    assignmentStrike: 50, stockSharesAssigned: 150, dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
    stockSaleOrCallAwayProceeds: null, fees: 0, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: 0 };
  const build = (quantity: number, multiplier = 100): CoveredCallCandidate => ({ symbol: 'c', optionContractId: `c${quantity}`, strike: 55,
    expiration: '2026-11-20', delta: null, bid: 1, ask: 1.1, multiplier, quantity, openInterest: null, volume: null,
    dividendExDateRisk: 'ABSENT_VERIFIED', eventRisk: 'ABSENT_VERIFIED' });
  const assessments = evaluateCoveredCallCandidates(49, 50, 150, chain, [build(1), build(2), build(0), build(1.5), build(1, 0)], zeroWeights('coverage'));
  assert.notEqual(assessments[0]?.utility.utility, null);
  for (const invalid of assessments.slice(1)) {
    assert.ok(invalid.reasons.includes('CC_CONTRACT_OR_SHARE_COVERAGE_INVALID'), invalid.candidate.optionContractId);
    assert.equal(invalid.premiumIncomeDollars, null);
    assert.equal(invalid.utility.utility, null);
    assert.equal(invalid.wholeChainPnlIfCalledAway, null);
  }
  assert.equal(bestCoveredCallCandidate(assessments)?.candidate.optionContractId, 'c1');
});

test('deep OTM, near-the-money and the upside-sacrifice trade-off: a lower premium farther OTM call can outrank a rich near-the-money call once upside is priced', () => {
  const chain = { cashflowBasis: 'ACTUAL_FILL_CASHFLOW' as const, initialPutPremium: 100, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0,
    assignmentStrike: 100, stockSharesAssigned: 100, dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
    stockSaleOrCallAwayProceeds: null, fees: 0, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: 0 };
  const build = (id: string, strike: number, bid: number): CoveredCallCandidate => ({ symbol: id, optionContractId: id, strike, expiration: '2026-11-20',
    delta: null, bid, ask: bid + 0.05, multiplier: 100, quantity: 1, openInterest: null, volume: null,
    dividendExDateRisk: 'ABSENT_VERIFIED', eventRisk: 'ABSENT_VERIFIED' });
  const weights = { ...zeroWeights('upside'), upsideSacrificePerDollarWeight: 0.5 };
  const assessments = evaluateCoveredCallCandidates(99, 100, 100, chain, [build('atm', 101, 3.0), build('deep-otm', 125, 0.4)], weights, 130);
  const byId = new Map(assessments.map(item => [item.candidate.optionContractId, item]));
  close(byId.get('atm')?.upsideSacrificedDollars ?? null, 2900);
  close(byId.get('deep-otm')?.upsideSacrificedDollars ?? null, 500);
  assert.equal(bestCoveredCallCandidate(assessments, true)?.candidate.optionContractId, 'deep-otm');
  // with no reference upside price the sacrifice is UNKNOWN, never zero, and premium alone ranks
  const unpriced = evaluateCoveredCallCandidates(99, 100, 100, chain, [build('atm', 101, 3.0), build('deep-otm', 125, 0.4)], weights);
  assert.equal(unpriced[0]?.upsideSacrificedDollars, null);
  assert.equal(bestCoveredCallCandidate(unpriced, true)?.candidate.optionContractId, 'atm');
});

test('CC close, CC roll and call-away: every CC debit and credit stays in the chain and old CC losses are immutable', () => {
  const chain: WholeChainComponents = {
    cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: 250, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0,
    assignmentStrike: 60, stockSharesAssigned: 100, dividends: 0, fees: 0, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: 0,
    coveredCallPremium: 180 + 150, coveredCallCloseCosts: 420 + 30, // CC1 sold 180, rolled at a 420 debit into CC2 sold 150, CC2 closed for 30
    stockSaleOrCallAwayProceeds: 6400, currentStockMarkPerShare: null, openStockShares: 0,
  };
  // direct cash: 250 + 180 - 420 + 150 - 30 - 6000 + 6400
  close(computeWholeChainPnl(chain).wholeChainPnl, 530);
  // lowering the rolled CC loss can only improve the total by exactly that amount; it can never be netted against new premium silently
  close((computeWholeChainPnl({ ...chain, coveredCallCloseCosts: 30 }).wholeChainPnl as number) - 530, 420);
  // a call-away of shares not covered by the CC (partial) keeps the unexited shares at MTM
  const partial = computeWholeChainPnl({ ...chain, stockSharesAssigned: 200, openStockShares: 100, currentStockMarkPerShare: 55 });
  close(partial.wholeChainPnl, 250 + 180 - 420 + 150 - 30 + (6400 - 60 * 100) + (55 - 60) * 100);
});

test('OWNER_POLICY characterization: the bootstrap SELL_CC gate compares the strike to the EFFECTIVE basis, so historical option losses can change CC eligibility', () => {
  // Same strike, same quote, same mark; only the historical option P&L differs. Documented as a basis-anchored policy rule (not
  // a forward-economics rule): a sunk-cost-sensitive gate that the owner must either accept or replace with a forward test.
  const decide = (netPremium: number) => evaluatePaperBootstrapManagementPolicy({
    ...recoveryState({ stock_basis_per_share: '195' }), wholeChainComponents: history(netPremium, 195), sellCcPremiumUtilityWeight: 0.01,
    ccCandidate: call({ strike: 190, bid: 1, ask: 1.2 }),
  });
  assert.equal(decide(1000)?.selectedAction, 'SELL_CC', 'effective basis 185 < strike 190: eligible');
  assert.equal(decide(-1000)?.selectedAction, 'RECOVERY_WAIT', 'effective basis 205 > strike 190: gated (history-dependent)');
});
