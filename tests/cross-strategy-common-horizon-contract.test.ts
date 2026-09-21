import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cashSecuredPutMaxLossAtZero, capitalBurdenView, compareCrossStrategy, executionBurdenView, riskBurdenView,
  sameComparisonContext, uncertaintyView, validateDeterministicEconomicsForAction, validateComparisonProfile,
  canonicalTailRiskMetric, ENTRY_CORE_RISK_V1, ENTRY_WHOLE_CHAIN_V1,
  type CandidateComparisonInput, type ComparisonContext, type DeterministicEntryEconomics, type EmpiricalForwardEconomics,
  type ComparisonProfile,
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

const wholeChainFull = (pnl: number, es: number, capitalDays: number, uncertainty: number, assignmentProb: number, assignmentBurden: number, recoveryDuration: number, tca: number): Partial<EmpiricalForwardEconomics> => ({
  ...fullRisk(pnl, es, capitalDays, uncertainty),
  probabilityAssignment: assignmentProb, expectedAssignmentBurden: assignmentBurden,
  expectedRecoveryDuration: recoveryDuration, expectedTca: tca,
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

test('GOVERNANCE: canonicalTailRiskMetric names expectedShortfall, and cvar is never coalesced into it anywhere in this module', () => {
  assert.equal(canonicalTailRiskMetric, 'EXPECTED_SHORTFALL');
  // A candidate with ONLY cvar populated (no expectedShortfall) must NOT be treated as risk-adjusted-complete --
  // proves the module never does `expectedShortfall ?? cvar`.
  const cvarOnly = csp({}, { expectedAfterCostWholeChainPnl: 100, cvar: -50, expectedCapitalDays: 30, calibratedUncertainty: 10 });
  const other = definedRisk({}, fullRisk(90, -80, 30, 10));
  const result = compareCrossStrategy([cvarOnly, other], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'PROFILE_NOT_READY');
  assert.ok(result.missingRequiredDimensions.includes('expectedShortfall'));
});

test('GOVERNANCE: validateComparisonProfile rejects a profile whose paretoDimensions is not a subset of requiredDimensions', () => {
  assert.equal(validateComparisonProfile(ENTRY_CORE_RISK_V1), true);
  assert.equal(validateComparisonProfile(ENTRY_WHOLE_CHAIN_V1), true);
  const invalid: ComparisonProfile = {
    profileVersion: 'bad', requiredDimensions: ['expectedAfterCostWholeChainPnl'],
    optionalDimensions: [], paretoDimensions: ['expectedShortfall'],
  };
  assert.equal(validateComparisonProfile(invalid), false);
});

test('GOVERNANCE: compareCrossStrategy throws on an invalid profile rather than silently comparing under it', () => {
  const invalid: ComparisonProfile = {
    profileVersion: 'bad', requiredDimensions: ['expectedAfterCostWholeChainPnl'],
    optionalDimensions: [], paretoDimensions: ['expectedShortfall'],
  };
  assert.throws(() => compareCrossStrategy([csp(), definedRisk()], invalid), /COMPARISON_PROFILE_INVALID_PARETO_DIMENSIONS_NOT_SUBSET_OF_REQUIRED/);
});

test('compareCrossStrategy reports NOT_COMPARABLE for zero candidates', () => {
  const result = compareCrossStrategy([], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'NOT_COMPARABLE');
  assert.equal(result.reason, 'NO_CANDIDATES');
});

test('REPAIR: compareCrossStrategy reports NOT_COMPARABLE when candidates have mismatched comparison contexts (horizon/basis/currency)', () => {
  const differentBasis: ComparisonContext = { ...CONTEXT, basis: 'PER_CONTRACT' };
  const result = compareCrossStrategy([csp(), definedRisk({}, {}, differentBasis)], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'NOT_COMPARABLE');
  assert.equal(result.reason, 'COMPARISON_CONTEXT_MISMATCH');
});

test('compareCrossStrategy reports NOT_COMPARABLE when deterministic economics are incomplete for any candidate', () => {
  const incomplete = csp({ collateral: null });
  const result = compareCrossStrategy([incomplete, definedRisk()], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'NOT_COMPARABLE');
  assert.equal(result.reason, 'DETERMINISTIC_ECONOMICS_INCOMPLETE');
});

test('compareCrossStrategy reports STRUCTURAL_ONLY for a single candidate -- nothing to compare against', () => {
  const result = compareCrossStrategy([csp()], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'STRUCTURAL_ONLY');
});

test('compareCrossStrategy reports STRUCTURAL_ONLY when neither candidate has ANY empirical evidence at all', () => {
  const result = compareCrossStrategy([csp(), definedRisk()], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'STRUCTURAL_ONLY');
  assert.equal(result.reason, 'NO_EMPIRICAL_EVIDENCE_FOR_ANY_CANDIDATE');
  assert.equal(result.highestExpectedPnlCandidateId, null);
});

test('REPAIR: an EV-only candidate is EV_COMPARABLE_ONLY, and highestExpectedPnlCandidateId is populated but explicitly NOT a final winner claim', () => {
  const result = compareCrossStrategy([csp({}, { expectedAfterCostWholeChainPnl: 150 }), definedRisk()], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'EV_COMPARABLE_ONLY');
  assert.equal(result.highestExpectedPnlCandidateId, 'THETA_CONVENTIONAL:AAPL-put');
  assert.deepEqual(result.nonDominatedCandidateIds, []); // no risk-adjusted claim made at this state
});

test('REPAIR: EV known for all but risk fields incomplete is PROFILE_NOT_READY, never claimed fully comparable', () => {
  const result = compareCrossStrategy([
    csp({}, { expectedAfterCostWholeChainPnl: 150, expectedShortfall: -200 }), // has ES but not capitalDays/uncertainty
    definedRisk({}, { expectedAfterCostWholeChainPnl: 90 }),
  ], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'PROFILE_NOT_READY');
  assert.equal(result.profileReadiness, 'PROFILE_NOT_READY');
  assert.ok(result.missingRequiredDimensions.includes('expectedCapitalDays'));
  assert.deepEqual(result.nonDominatedCandidateIds, []);
});

test('REPAIR: full risk-adjusted economics for all candidates reaches FULL_RESEARCH_COMPARABLE under ENTRY_CORE_RISK_V1 and exposes a Pareto set, never a single manufactured winner', () => {
  const better = csp({}, fullRisk(150, -50, 30, 10));
  const worse = definedRisk({}, fullRisk(90, -80, 30, 10)); // dominated on every dimension
  const result = compareCrossStrategy([worse, better], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'FULL_RESEARCH_COMPARABLE');
  assert.equal(result.profileReadiness, 'PROFILE_COMPARABLE');
  assert.equal(result.highestExpectedPnlCandidateId, 'THETA_CONVENTIONAL:AAPL-put');
  assert.deepEqual(result.nonDominatedCandidateIds, ['THETA_CONVENTIONAL:AAPL-put']);
});

test('FULL_RESEARCH_COMPARABLE with a genuine Pareto trade-off reports BOTH candidates as non-dominated -- never collapsed to one', () => {
  const higherEvMoreRisk = csp({}, fullRisk(150, -200, 30, 10)); // best EV, worst ES
  const lowerEvSaferTail = definedRisk({}, fullRisk(90, -30, 30, 10)); // worse EV, best ES
  const result = compareCrossStrategy([higherEvMoreRisk, lowerEvSaferTail], ENTRY_CORE_RISK_V1);
  assert.equal(result.state, 'FULL_RESEARCH_COMPARABLE');
  assert.deepEqual([...result.nonDominatedCandidateIds].sort(), ['THETA_CONVENTIONAL:AAPL-put', 'THETA_DEFINED_RISK:AAPL-spread']);
});

test('GOVERNANCE: the same candidates that are FULL_RESEARCH_COMPARABLE under ENTRY_CORE_RISK_V1 are only PROFILE_NOT_READY under ENTRY_WHOLE_CHAIN_V1 (missing assignment/recovery/TCA evidence)', () => {
  const a = csp({}, fullRisk(150, -50, 30, 10));
  const b = definedRisk({}, fullRisk(90, -80, 30, 10));
  const core = compareCrossStrategy([a, b], ENTRY_CORE_RISK_V1);
  const wholeChain = compareCrossStrategy([a, b], ENTRY_WHOLE_CHAIN_V1);
  assert.equal(core.state, 'FULL_RESEARCH_COMPARABLE');
  assert.equal(wholeChain.state, 'PROFILE_NOT_READY');
  assert.ok(wholeChain.missingRequiredDimensions.includes('probabilityAssignment'));
  assert.ok(wholeChain.missingRequiredDimensions.includes('expectedTca'));
});

test('GOVERNANCE: ENTRY_WHOLE_CHAIN_V1 reaches FULL_RESEARCH_COMPARABLE once assignment/recovery/TCA evidence is known, and never claims a Pareto direction for probabilityAssignment itself', () => {
  const a = csp({}, wholeChainFull(150, -50, 30, 10, 0.3, 500, 10, 5));
  const b = definedRisk({}, wholeChainFull(90, -80, 30, 10, 0.05, 100, 3, 8));
  const result = compareCrossStrategy([a, b], ENTRY_WHOLE_CHAIN_V1);
  assert.equal(result.state, 'FULL_RESEARCH_COMPARABLE');
  assert.equal(result.profileVersion, ENTRY_WHOLE_CHAIN_V1.profileVersion);
  // paretoDimensions never includes probabilityAssignment/expectedAssignmentBurden/expectedRecoveryDuration
  assert.ok(!ENTRY_WHOLE_CHAIN_V1.paretoDimensions.includes('probabilityAssignment'));
  assert.ok(!ENTRY_WHOLE_CHAIN_V1.paretoDimensions.includes('expectedAssignmentBurden'));
  assert.ok(!ENTRY_WHOLE_CHAIN_V1.paretoDimensions.includes('expectedRecoveryDuration'));
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
