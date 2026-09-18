import assert from 'node:assert/strict';
import test from 'node:test';
import { computeWholeChainPnl, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';
import {
  BOOTSTRAP_NEUTRAL_CC_WEIGHT_PROVENANCE, nondominatedCoveredCallCandidates,
  evaluateCoveredCallCandidates, type CoveredCallCandidate,
} from '../src/theta/covered-call-lattice.js';
import { evaluatePaperBootstrapManagementPolicy } from '../src/theta/paper-bootstrap-management-policy.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';

/**
 * Property/invariant checks for the management-economics layer. These use
 * plain deterministic random sampling via node:test rather than pulling in
 * fast-check -- the invariants below are simple enough (a handful of
 * numeric/structural properties over randomly generated fixtures) that a
 * dedicated property-testing framework is not justified for this pass; the
 * existing node:test stack is sufficient.
 */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260918);

test('PROPERTY: an UNKNOWN (null) WholeChainComponents leg never silently becomes zero -- wholeChainPnl is null whenever any leg is null', () => {
  for (let trial = 0; trial < 200; trial += 1) {
    const nullFees = rand() < 0.3;
    const components: WholeChainComponents = {
      cashflowBasis:'ACTUAL_FILL_CASHFLOW',initialPutPremium:rand()*1000,putCloseCosts:rand()*50,rollCredits:rand()*100,rollCloseCosts:rand()*100,
      assignmentStrike: 100 + rand() * 100, stockSharesAssigned: 100, dividends: rand() * 10,
      coveredCallPremium: 0, coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: null,
      fees:nullFees?null:rand()*10,executionCostNotEmbeddedInCashflows:rand()*5,tcaExecutionShortfall:rand()*5,
      currentStockMarkPerShare: 100 + rand() * 100, openStockShares: 100,
    };
    const result = computeWholeChainPnl(components);
    if (nullFees) assert.equal(result.wholeChainPnl, null);
    else assert.notEqual(result.wholeChainPnl, null);
  }
});

test('PROPERTY: computeWholeChainPnl equals the exact sum of its own reported known legs, for randomly generated complete inputs', () => {
  for (let trial = 0; trial < 200; trial += 1) {
    const components: WholeChainComponents = {
      cashflowBasis:'ACTUAL_FILL_CASHFLOW',initialPutPremium:rand()*1000-500,putCloseCosts:rand()*100,rollCredits:rand()*200,rollCloseCosts:rand()*200,
      assignmentStrike: 50 + rand() * 200, stockSharesAssigned: 100, dividends: rand() * 20,
      coveredCallPremium: rand() * 200, coveredCallCloseCosts: rand() * 50,
      stockSaleOrCallAwayProceeds:50+rand()*200,fees:rand()*10,executionCostNotEmbeddedInCashflows:rand()*5,tcaExecutionShortfall:rand()*5,
      currentStockMarkPerShare: null, openStockShares: 0,
    };
    const result = computeWholeChainPnl(components);
    const sum = result.legLevelPnl.reduce((total, leg) => total + (leg.amount ?? 0), 0);
    assert.ok(Math.abs((result.wholeChainPnl as number) - sum) < 1e-9);
  }
});

test('PROPERTY: gross call-away/sale proceeds never equal reported stock-leg P&L unless the acquisition cost happens to be exactly zero', () => {
  for (let trial = 0; trial < 200; trial += 1) {
    const proceeds = 100 + rand() * 500;
    const assignmentStrike = 1 + rand() * 300; // never exactly 0
    const components: WholeChainComponents = {
      cashflowBasis:'ACTUAL_FILL_CASHFLOW',initialPutPremium:0,putCloseCosts:0,rollCredits:0,rollCloseCosts:0,assignmentStrike,stockSharesAssigned:100,
      dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: proceeds,
      fees:0,executionCostNotEmbeddedInCashflows:0,tcaExecutionShortfall:0,currentStockMarkPerShare:null,openStockShares:0,
    };
    const result = computeWholeChainPnl(components);
    const stockLeg = result.legLevelPnl.find((leg) => leg.label === 'STOCK_PNL_AT_SALE_OR_CALL_AWAY');
    assert.notEqual(stockLeg?.amount, proceeds);
  }
});

test('PROPERTY: nondominatedCoveredCallCandidates never removes a candidate on a dimension neither candidate in a pair actually knows', () => {
  const candidate = (overrides: Partial<CoveredCallCandidate> = {}): CoveredCallCandidate => ({
    symbol: 'X', optionContractId: `c-${rand()}`, strike: 200, expiration: '2026-10-16', delta: null,
    bid: 1, ask: 1.1, multiplier: 100, quantity: 1, openInterest: null, volume: null,
    dividendExDateRisk: 'UNKNOWN', eventRisk: 'UNKNOWN', ...overrides,
  });
  for (let trial = 0; trial < 50; trial += 1) {
    const bidA = rand() * 5, bidB = rand() * 5;
    const assessments = evaluateCoveredCallCandidates(null, null, 100,
      { cashflowBasis:'ACTUAL_FILL_CASHFLOW',initialPutPremium:null,putCloseCosts:null,rollCredits:null,rollCloseCosts:null,assignmentStrike:null,stockSharesAssigned:100,
        dividends:0,fees:0,executionCostNotEmbeddedInCashflows:0,tcaExecutionShortfall:0 },
      [candidate({ optionContractId: 'a', bid: bidA, ask: bidA + 0.1 }), candidate({ optionContractId: 'b', bid: bidB, ask: bidB + 0.1 })],
      { upsideSacrificePerDollarWeight: 0, spreadPerDollarWeight: 0, eventRiskPenalty: 0, dividendExDateRiskPenalty: 0,
        belowBasisPenalty: 0, provenance: BOOTSTRAP_NEUTRAL_CC_WEIGHT_PROVENANCE });
    // Both candidates have UNKNOWN event/dividend risk and identical spread
    // -- the only known-differing dimension is premium. Neither dominates
    // on a dimension they both lack (event/dividend risk), so the
    // nondominated set must retain the strictly-better-on-premium winner
    // (which always survives) and never spuriously remove based on an
    // unknown dimension alone.
    const nondominated = nondominatedCoveredCallCandidates(assessments);
    const winner = bidA >= bidB ? 'a' : 'b';
    assert.ok(nondominated.some((assessment) => assessment.candidate.optionContractId === winner));
  }
});

test('PROPERTY: the management evaluator never creates a broker intent -- ManagementPolicyEvidence carries no order/fill fields, only ordinal utility and reason codes', () => {
  const baseRow = {
    chain_id: 'chain', lifecycle_state: 'RECOVERY_WAIT', underlying_id: 'u', underlying: 'AAPL',
    option_leg_id: null, option_contract_id: null, quantity: '0', entry_credit_debit: null,
    contract_symbol: null, option_type: null, strike: null, expiration_date: null, multiplier: null,
    bid: null, ask: null, quote_as_of: null, feed: null, quote_quality: null, realized_option_pnl: '0',
    open_stock_shares: '100', stock_basis_per_share: '195', realized_stock_pnl: '0', dividends: '0', fees: '0',
    buying_power: '50000', options_buying_power: '40000', account_as_of: '2026-09-12T14:00:00.000Z',
    fusion_snapshot_id: 'fusion',
    snapshot_json: { underlyingState: { last: 190 }, marketSession: { isOpen: false },
      riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
    broker_position: { currentPrice: 190 },
  };
  const state = assembleManagementInput(baseRow, {
    managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: '2026-09-12T14:00:00.000Z',
  });
  const evidence = evaluatePaperBootstrapManagementPolicy(state);
  assert.ok(evidence !== null);
  const keys = new Set(Object.keys(evidence as object));
  for (const forbidden of ['orderId', 'brokerOrderId', 'fillId', 'quantitySubmitted', 'side', 'timeInForce']) {
    assert.ok(!keys.has(forbidden), `ManagementPolicyEvidence must never carry a broker-order-shaped field: ${forbidden}`);
  }
});
