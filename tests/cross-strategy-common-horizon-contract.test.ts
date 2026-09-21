import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capitalBurdenView, compareCrossStrategy, executionBurdenView, riskBurdenView, uncertaintyView,
  type CandidateComparisonInput, type DeterministicEntryEconomics, type EmpiricalForwardEconomics,
} from '../src/research/cross-strategy-common-horizon-contract.js';

const NULL_EMPIRICAL: EmpiricalForwardEconomics = {
  expectedAfterCostWholeChainPnl: null, probabilityProfitable: null, probabilityAssignment: null,
  expectedAssignmentBurden: null, expectedRecoveryDuration: null, expectedCapitalDays: null,
  expectedShortfall: null, cvar: null, expectedTca: null, calibratedUncertainty: null,
};

function csp(overrides: Partial<DeterministicEntryEconomics> = {}, empirical: Partial<EmpiricalForwardEconomics> = {}): CandidateComparisonInput {
  return {
    candidateId: 'THETA_CONVENTIONAL:AAPL-put',
    deterministic: {
      action: 'OPEN_CSP', strategy: 'THETA_CONVENTIONAL', underlying: 'AAPL', contractIdentities: ['AAPL-put'],
      dte: 30, strikes: [190], executableOpenCreditDebit: 2.0, multiplier: 100, collateral: 19000,
      buyingPowerImpact: 19000, maxLoss: null, breakEven: 188, downsideCushion: 0.05, width: null,
      bidAskSpread: 0.05, estimatedEntryExecutionCost: 5, capitalRequirement: 19000, ...overrides,
    },
    empirical: { ...NULL_EMPIRICAL, ...empirical },
  };
}

function definedRisk(overrides: Partial<DeterministicEntryEconomics> = {}, empirical: Partial<EmpiricalForwardEconomics> = {}): CandidateComparisonInput {
  return {
    candidateId: 'THETA_DEFINED_RISK:AAPL-spread',
    deterministic: {
      action: 'OPEN_DEFINED_RISK', strategy: 'THETA_DEFINED_RISK', underlying: 'AAPL',
      contractIdentities: ['AAPL-short-put', 'AAPL-long-put'], dte: 30, strikes: [190, 185],
      executableOpenCreditDebit: 1.2, multiplier: 100, collateral: 500, buyingPowerImpact: 500,
      maxLoss: 380, breakEven: 188.8, downsideCushion: 0.05, width: 5, bidAskSpread: 0.10,
      estimatedEntryExecutionCost: 8, capitalRequirement: 500, ...overrides,
    },
    empirical: { ...NULL_EMPIRICAL, ...empirical },
  };
}

test('compareCrossStrategy reports CROSS_STRATEGY_NOT_COMPARABLE for zero candidates', () => {
  const result = compareCrossStrategy([]);
  assert.equal(result.state, 'CROSS_STRATEGY_NOT_COMPARABLE');
  assert.equal(result.reason, 'NO_CANDIDATES');
  assert.equal(result.winner, null);
});

test('compareCrossStrategy reports CROSS_STRATEGY_NOT_COMPARABLE when deterministic economics are incomplete for any candidate', () => {
  const incomplete = csp({ collateral: null });
  const result = compareCrossStrategy([incomplete, definedRisk()]);
  assert.equal(result.state, 'CROSS_STRATEGY_NOT_COMPARABLE');
  assert.equal(result.reason, 'DETERMINISTIC_ECONOMICS_INCOMPLETE');
  assert.equal(result.winner, null);
});

test('compareCrossStrategy reports STRUCTURALLY_COMPARABLE_ONLY for a single candidate -- nothing to compare against', () => {
  const result = compareCrossStrategy([csp()]);
  assert.equal(result.state, 'STRUCTURALLY_COMPARABLE_ONLY');
  assert.equal(result.winner, null);
});

test('REPAIR-BY-DESIGN: CSP vs Defined-Risk with missing empirical values never manufactures a winner -- the exact defect this contract exists to prevent', () => {
  const result = compareCrossStrategy([csp(), definedRisk()]);
  assert.equal(result.state, 'EMPIRICAL_ECONOMICS_UNKNOWN');
  assert.equal(result.reason, 'MISSING_EMPIRICAL_ECONOMICS');
  assert.equal(result.winner, null);
  // Critically: candidateIds are still reported for transparency, but NEVER
  // used to derive winner -- confirm branch-name alphabetical order
  // ("THETA_CONVENTIONAL" < "THETA_DEFINED_RISK") does not leak into winner.
  assert.deepEqual([...result.candidateIds].sort(), ['THETA_CONVENTIONAL:AAPL-put', 'THETA_DEFINED_RISK:AAPL-spread']);
});

test('compareCrossStrategy reports EMPIRICAL_ECONOMICS_UNKNOWN even when only ONE candidate has real empirical data -- comparing known vs unknown is not fair', () => {
  const withEv = csp({}, { expectedAfterCostWholeChainPnl: 150 });
  const withoutEv = definedRisk();
  const result = compareCrossStrategy([withEv, withoutEv]);
  assert.equal(result.state, 'EMPIRICAL_ECONOMICS_UNKNOWN');
  assert.equal(result.winner, null);
});

test('compareCrossStrategy picks a real economic winner ONLY when every candidate has complete empirical economics', () => {
  const better = csp({}, { expectedAfterCostWholeChainPnl: 150 });
  const worse = definedRisk({}, { expectedAfterCostWholeChainPnl: 90 });
  const result = compareCrossStrategy([worse, better]); // deliberately reversed input order
  assert.equal(result.state, 'COMPARABLE');
  assert.equal(result.winner, 'THETA_CONVENTIONAL:AAPL-put');
  assert.equal(result.reason, 'HIGHEST_EXPECTED_AFTER_COST_WHOLE_CHAIN_PNL');
});

test('REPAIR-BY-DESIGN: a true numeric tie on expectedAfterCostWholeChainPnl is CROSS_STRATEGY_NOT_COMPARABLE, never resolved by input/array order', () => {
  const a = csp({}, { expectedAfterCostWholeChainPnl: 100 });
  const b = definedRisk({}, { expectedAfterCostWholeChainPnl: 100 });
  const forward = compareCrossStrategy([a, b]);
  const reversed = compareCrossStrategy([b, a]);
  assert.equal(forward.state, 'CROSS_STRATEGY_NOT_COMPARABLE');
  assert.equal(forward.reason, 'TIED_EMPIRICAL_ECONOMICS');
  assert.equal(reversed.state, 'CROSS_STRATEGY_NOT_COMPARABLE');
  assert.equal(forward.winner, reversed.winner); // both null -- order-independent
});

test('riskBurdenView/capitalBurdenView/executionBurdenView/uncertaintyView project the SAME underlying fields, never a duplicated independent value', () => {
  const candidate = definedRisk({ maxLoss: 380, downsideCushion: 0.07 }, { probabilityAssignment: 0.2, expectedShortfall: -300 });
  const risk = riskBurdenView(candidate);
  const capital = capitalBurdenView(candidate);
  const execution = executionBurdenView(candidate);
  const uncertainty = uncertaintyView(candidate);
  assert.equal(risk.maxLoss, candidate.deterministic.maxLoss);
  assert.equal(risk.probabilityAssignment, candidate.empirical.probabilityAssignment);
  assert.equal(capital.collateral, candidate.deterministic.collateral);
  assert.equal(execution.bidAskSpread, candidate.deterministic.bidAskSpread);
  assert.equal(uncertainty.calibratedUncertainty, candidate.empirical.calibratedUncertainty);
});
