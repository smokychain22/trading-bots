import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cashSecuredPutMaxLossAtZero, capitalBurdenView, compareCrossStrategy, executionBurdenView, riskBurdenView,
  sameComparisonContext, uncertaintyView, validateDeterministicEconomicsForAction,
  type CandidateComparisonInput, type ComparisonContext, type DeterministicEntryEconomics, type EmpiricalForwardEconomics,
} from '../src/research/cross-strategy-common-horizon-contract.js';

const CONTEXT: ComparisonContext = {
  decisionTimestamp: '2026-09-22T14:00:00Z', comparisonHorizonStart: '2026-09-22T14:00:00Z',
  comparisonHorizonEnd: '2026-12-21T14:00:00Z', horizonDefinitionVersion: 'theta-r8-horizon-v1',
  basis: 'PER_POSITION', currency: 'USD',
};

const NULL_EMPIRICAL: EmpiricalForwardEconomics = {
  expectedAfterCostWholeChainPnl: null, probabilityProfitable: null, probabilityAssignment: null,
  expectedAssignmentBurden: null, expectedRecoveryDuration: null, expectedCapitalDays: null,
  expectedShortfall: null, cvar: null, maxDrawdown: null, concentrationImpact: null,
  expectedTca: null, calibratedUncertainty: null,
};

function csp(overrides: Partial<DeterministicEntryEconomics> = {}, empirical: Partial<EmpiricalForwardEconomics> = {}, context: ComparisonContext = CONTEXT): CandidateComparisonInput {
  return {
    candidateId: 'THETA_CONVENTIONAL:AAPL-put', context, quantity: 1,
    deterministic: {
      action: 'OPEN_CSP', strategy: 'THETA_CONVENTIONAL', underlying: 'AAPL',
      structureClass: 'CASH_SECURED_SINGLE_LEG', contractIdentities: ['AAPL-put'],
      dte: 30, strikes: [190], executableOpenCreditDebit: 2.0, multiplier: 100, collateral: 19000,
      buyingPowerImpact: 19000, maxLoss: null, breakEven: 188, downsideCushion: 0.05, width: null,
      bidAskSpread: 0.05, estimatedEntryExecutionCost: 5, capitalRequirement: 19000, ...overrides,
    },
    empirical: { ...NULL_EMPIRICAL, ...empirical },
  };
}

function definedRisk(overrides: Partial<DeterministicEntryEconomics> = {}, empirical: Partial<EmpiricalForwardEconomics> = {}, context: ComparisonContext = CONTEXT): CandidateComparisonInput {
  return {
    candidateId: 'THETA_DEFINED_RISK:AAPL-spread', context, quantity: 1,
    deterministic: {
      action: 'OPEN_DEFINED_RISK', strategy: 'THETA_DEFINED_RISK', underlying: 'AAPL',
      structureClass: 'STRUCTURALLY_DEFINED_RISK_SPREAD', contractIdentities: ['AAPL-short-put', 'AAPL-long-put'],
      dte: 30, strikes: [190, 185], executableOpenCreditDebit: 1.2, multiplier: 100, collateral: 500,
      buyingPowerImpact: 500, maxLoss: 380, breakEven: 188.8, downsideCushion: 0.05, width: 5,
      bidAskSpread: 0.10, estimatedEntryExecutionCost: 8, capitalRequirement: 500, ...overrides,
    },
    empirical: { ...NULL_EMPIRICAL, ...empirical },
  };
}

const fullRisk = (pnl: number, es: number, capitalDays: number, uncertainty: number): Partial<EmpiricalForwardEconomics> => ({
  expectedAfterCostWholeChainPnl: pnl, expectedShortfall: es, expectedCapitalDays: capitalDays, calibratedUncertainty: uncertainty,
});

test('cashSecuredPutMaxLossAtZero computes a real finite figure for a CSP -- severe but finite, never null when inputs are known', () => {
  const maxLoss = cashSecuredPutMaxLossAtZero(190, 2.0, 100, 1);
  assert.equal(maxLoss, (190 - 2.0) * 100 * 1);
});

test('cashSecuredPutMaxLossAtZero returns null (never a fabricated figure) when any input is missing', () => {
  assert.equal(cashSecuredPutMaxLossAtZero(null, 2.0, 100, 1), null);
  assert.equal(cashSecuredPutMaxLossAtZero(190, null, 100, 1), null);
});

test('validateDeterministicEconomicsForAction does NOT require dte/strikes for WAIT, only real known zero capital commitment', () => {
  const waitDeterministic: DeterministicEntryEconomics = {
    action: 'WAIT', strategy: 'WAIT', underlying: '', structureClass: 'MARGIN_UNDEFINED_OR_UNBOUNDED_STRUCTURE',
    contractIdentities: [], dte: null, strikes: [], executableOpenCreditDebit: 0, multiplier: null,
    collateral: 0, buyingPowerImpact: 0, maxLoss: null, breakEven: null, downsideCushion: null,
    width: null, bidAskSpread: null, estimatedEntryExecutionCost: 0, capitalRequirement: 0,
  };
  assert.equal(validateDeterministicEconomicsForAction('WAIT', waitDeterministic), true);
});

test('validateDeterministicEconomicsForAction requires width for OPEN_DEFINED_RISK but not for OPEN_CSP', () => {
  const noWidth = definedRisk({ width: null }).deterministic;
  assert.equal(validateDeterministicEconomicsForAction('OPEN_DEFINED_RISK', noWidth), false);
  const cspNoWidth = csp({ width: null }).deterministic;
  assert.equal(validateDeterministicEconomicsForAction('OPEN_CSP', cspNoWidth), true);
});

test('sameComparisonContext requires every field to match, including horizonDefinitionVersion', () => {
  const differentVersion: ComparisonContext = { ...CONTEXT, horizonDefinitionVersion: 'v2' };
  assert.equal(sameComparisonContext(CONTEXT, CONTEXT), true);
  assert.equal(sameComparisonContext(CONTEXT, differentVersion), false);
});

test('compareCrossStrategy reports NOT_COMPARABLE for zero candidates', () => {
  const result = compareCrossStrategy([]);
  assert.equal(result.state, 'NOT_COMPARABLE');
  assert.equal(result.reason, 'NO_CANDIDATES');
});

test('REPAIR: compareCrossStrategy reports NOT_COMPARABLE when candidates have mismatched comparison contexts (horizon/basis/currency)', () => {
  const differentBasis: ComparisonContext = { ...CONTEXT, basis: 'PER_CONTRACT' };
  const result = compareCrossStrategy([csp(), definedRisk({}, {}, differentBasis)]);
  assert.equal(result.state, 'NOT_COMPARABLE');
  assert.equal(result.reason, 'COMPARISON_CONTEXT_MISMATCH');
});

test('compareCrossStrategy reports NOT_COMPARABLE when deterministic economics are incomplete for any candidate', () => {
  const incomplete = csp({ collateral: null });
  const result = compareCrossStrategy([incomplete, definedRisk()]);
  assert.equal(result.state, 'NOT_COMPARABLE');
  assert.equal(result.reason, 'DETERMINISTIC_ECONOMICS_INCOMPLETE');
});

test('compareCrossStrategy reports STRUCTURAL_ONLY for a single candidate -- nothing to compare against', () => {
  const result = compareCrossStrategy([csp()]);
  assert.equal(result.state, 'STRUCTURAL_ONLY');
});

test('compareCrossStrategy reports STRUCTURAL_ONLY when neither candidate has ANY empirical evidence at all', () => {
  const result = compareCrossStrategy([csp(), definedRisk()]);
  assert.equal(result.state, 'STRUCTURAL_ONLY');
  assert.equal(result.reason, 'NO_EMPIRICAL_EVIDENCE_FOR_ANY_CANDIDATE');
  assert.equal(result.highestExpectedPnlCandidateId, null);
});

test('REPAIR: an EV-only candidate is EV_COMPARABLE_ONLY, and highestExpectedPnlCandidateId is populated but explicitly NOT a final winner claim', () => {
  const result = compareCrossStrategy([csp({}, { expectedAfterCostWholeChainPnl: 150 }), definedRisk()]);
  assert.equal(result.state, 'EV_COMPARABLE_ONLY');
  assert.equal(result.highestExpectedPnlCandidateId, 'THETA_CONVENTIONAL:AAPL-put');
  assert.deepEqual(result.nonDominatedCandidateIds, []); // no risk-adjusted claim made at this state
});

test('REPAIR: EV known for all but risk fields incomplete is RISK_ADJUSTED_NOT_READY, never claimed fully comparable', () => {
  const result = compareCrossStrategy([
    csp({}, { expectedAfterCostWholeChainPnl: 150, expectedShortfall: -200 }), // has ES but not capitalDays/uncertainty
    definedRisk({}, { expectedAfterCostWholeChainPnl: 90 }),
  ]);
  assert.equal(result.state, 'RISK_ADJUSTED_NOT_READY');
  assert.ok(result.missingComparisonDimensions.includes('expectedCapitalDays'));
  assert.deepEqual(result.nonDominatedCandidateIds, []);
});

test('REPAIR: full risk-adjusted economics for all candidates reaches FULL_RESEARCH_COMPARABLE and exposes a Pareto set, never a single manufactured winner', () => {
  const better = csp({}, fullRisk(150, -50, 30, 10));
  const worse = definedRisk({}, fullRisk(90, -80, 30, 10)); // dominated on every dimension
  const result = compareCrossStrategy([worse, better]);
  assert.equal(result.state, 'FULL_RESEARCH_COMPARABLE');
  assert.equal(result.highestExpectedPnlCandidateId, 'THETA_CONVENTIONAL:AAPL-put');
  assert.deepEqual(result.nonDominatedCandidateIds, ['THETA_CONVENTIONAL:AAPL-put']);
});

test('FULL_RESEARCH_COMPARABLE with a genuine Pareto trade-off reports BOTH candidates as non-dominated -- never collapsed to one', () => {
  const higherEvMoreRisk = csp({}, fullRisk(150, -200, 30, 10)); // best EV, worst ES
  const lowerEvSaferTail = definedRisk({}, fullRisk(90, -30, 30, 10)); // worse EV, best ES
  const result = compareCrossStrategy([higherEvMoreRisk, lowerEvSaferTail]);
  assert.equal(result.state, 'FULL_RESEARCH_COMPARABLE');
  assert.deepEqual([...result.nonDominatedCandidateIds].sort(), ['THETA_CONVENTIONAL:AAPL-put', 'THETA_DEFINED_RISK:AAPL-spread']);
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
