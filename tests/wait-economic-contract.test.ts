import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCrossStrategy, validateDeterministicEconomicsForAction, unknownDatum, ENTRY_CORE_RISK_V1, type ComparisonContext } from '../src/research/cross-strategy-common-horizon-contract.js';
import {
  emptyWaitRegretMetrics, validateWaitEconomicEvidence, waitAsComparisonCandidate,
  type WaitEconomicEvidence,
} from '../src/research/wait-economic-contract.js';

const CONTEXT: ComparisonContext = {
  decisionTimestamp: '2026-09-22T14:00:00Z', comparisonHorizonStart: '2026-09-22T14:00:00Z',
  comparisonHorizonEnd: '2026-12-21T14:00:00Z', horizonDefinitionVersion: 'theta-r8-horizon-v1',
  basis: 'PER_POSITION', currency: 'USD',
};

function evidence(overrides: Partial<WaitEconomicEvidence> = {}): WaitEconomicEvidence {
  return {
    decisionId: 'd1', asOf: '2026-09-22T14:00:00Z', capitalReferenceCandidateId: 'THETA_CONVENTIONAL:AAPL-put',
    cashPreservedAgainstReference: 19000, capitalDaysAvoidedAgainstReference: 570000, eventRiskAvoided: true,
    assignmentBurdenAvoided: null, foregonePremium: 200, bestRejectedCandidateId: 'THETA_CONVENTIONAL:AAPL-put',
    secondBestCandidateId: null, futureRealizedCounterfactual: null,
    futureRealizedCounterfactualProvenance: 'NOT_IDENTIFIABLE', ...overrides,
  };
}

test('validateWaitEconomicEvidence rejects a NOT_IDENTIFIABLE provenance carrying a non-null counterfactual value', () => {
  const result = validateWaitEconomicEvidence(evidence({ futureRealizedCounterfactualProvenance: 'NOT_IDENTIFIABLE', futureRealizedCounterfactual: 50 }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'NOT_IDENTIFIABLE_PROVENANCE_MUST_NEVER_CARRY_A_NON_NULL_COUNTERFACTUAL_VALUE');
});

test('validateWaitEconomicEvidence rejects an ESTIMABLE provenance with no counterfactual value at all', () => {
  const result = validateWaitEconomicEvidence(evidence({ futureRealizedCounterfactualProvenance: 'ESTIMABLE', futureRealizedCounterfactual: null }));
  assert.equal(result.valid, false);
});

test('validateWaitEconomicEvidence accepts NOT_IDENTIFIABLE with null, and OBSERVED/ESTIMABLE with a real value', () => {
  assert.equal(validateWaitEconomicEvidence(evidence()).valid, true);
  assert.equal(validateWaitEconomicEvidence(evidence({ futureRealizedCounterfactualProvenance: 'ESTIMABLE', futureRealizedCounterfactual: 75 })).valid, true);
});

test('REPAIR: validateWaitEconomicEvidence rejects capital-reference VALUES appearing with NO named reference candidate -- prevents an implicit, unattributed sum', () => {
  const result = validateWaitEconomicEvidence(evidence({
    capitalReferenceCandidateId: null, cashPreservedAgainstReference: 19000, capitalDaysAvoidedAgainstReference: 570000,
  }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'CAPITAL_REFERENCE_VALUES_REQUIRE_A_NAMED_REFERENCE_CANDIDATE');
});

test('REPAIR: validateWaitEconomicEvidence rejects capitalDaysAvoidedAgainstReference populated with no cashPreservedAgainstReference', () => {
  const result = validateWaitEconomicEvidence(evidence({ cashPreservedAgainstReference: null, capitalDaysAvoidedAgainstReference: 570000 }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'CAPITAL_DAYS_AVOIDED_REQUIRES_A_KNOWN_CASH_PRESERVED_VALUE');
});

test('validateWaitEconomicEvidence accepts a fully null capital-reference chain (no reference candidate this cycle)', () => {
  const result = validateWaitEconomicEvidence(evidence({
    capitalReferenceCandidateId: null, cashPreservedAgainstReference: null, capitalDaysAvoidedAgainstReference: null,
  }));
  assert.equal(result.valid, true);
});

test('emptyWaitRegretMetrics starts every future metric null and sampleSize zero -- never a synthetic populated number', () => {
  const metrics = emptyWaitRegretMetrics('2026-01-01', '2026-12-31');
  assert.equal(metrics.sampleSize, 0);
  assert.equal(metrics.opportunityConversionRate, null);
  assert.equal(metrics.waitRegret, null);
});

test('waitAsComparisonCandidate reports zero (real, known) capital commitment and NO_STRUCTURE, never null capital or a misleading structureClass', () => {
  const candidate = waitAsComparisonCandidate(evidence(), CONTEXT);
  assert.equal(candidate.deterministic.action, 'WAIT');
  assert.equal(candidate.deterministic.structureClass, 'NO_STRUCTURE');
  assert.equal(candidate.deterministic.collateral, 0);
  assert.equal(candidate.deterministic.capitalRequirement, 0);
  assert.equal(candidate.empirical.expectedAfterCostWholeChainPnl, null);
});

test('waitAsComparisonCandidate never carries a futureRealizedCounterfactual across into empirical economics', () => {
  const withEstimate = evidence({ futureRealizedCounterfactualProvenance: 'ESTIMABLE', futureRealizedCounterfactual: 300 });
  const candidate = waitAsComparisonCandidate(withEstimate, CONTEXT);
  assert.equal(candidate.empirical.expectedAfterCostWholeChainPnl, null);
});

test('REPAIR: WAIT is now actually reachable in compareCrossStrategy -- validateDeterministicEconomicsForAction never requires DTE for WAIT', () => {
  const waitCandidate = waitAsComparisonCandidate(evidence(), CONTEXT);
  assert.equal(validateDeterministicEconomicsForAction('WAIT', waitCandidate.deterministic), true);
});

test('REPAIR: CSP + Defined Risk + WAIT can be structurally compared together without WAIT being invalid merely because it has no option expiration', () => {
  const csp = {
    candidateId: 'THETA_CONVENTIONAL:AAPL-put', context: CONTEXT, quantity: 1,
    deterministic: {
      action: 'OPEN_CSP', strategy: 'THETA_CONVENTIONAL', underlying: 'AAPL',
      structureClass: 'CASH_SECURED_SINGLE_LEG' as const, contractIdentities: ['AAPL-put'], dte: 30,
      strikes: [190], executableOpenCreditDebit: 2.0, multiplier: 100, collateral: 19000,
      buyingPowerImpact: 19000, maxLoss: 18800, breakEven: 188, downsideCushion: 0.05, width: null,
      bidAskSpread: 0.05, estimatedEntryExecutionCost: 5, capitalRequirement: 19000,
    },
    empirical: {
      expectedAfterCostWholeChainPnl: null, probabilityProfitable: null,
      probabilityAssignment: unknownDatum('NOT_YET_MODELED'), expectedAssignmentBurden: unknownDatum('NOT_YET_MODELED'),
      expectedRecoveryDuration: unknownDatum('NOT_YET_MODELED'), expectedCapitalDays: null,
      expectedShortfall: null, cvar: null, maxDrawdown: null, concentrationImpact: null,
      expectedTca: null, calibratedUncertainty: null,
    },
  };
  const definedRisk = {
    ...csp, candidateId: 'THETA_DEFINED_RISK:AAPL-spread',
    deterministic: { ...csp.deterministic, action: 'OPEN_DEFINED_RISK', strategy: 'THETA_DEFINED_RISK', structureClass: 'STRUCTURALLY_DEFINED_RISK_SPREAD' as const, width: 5, maxLoss: 380, collateral: 500, capitalRequirement: 500 },
  };
  const wait = waitAsComparisonCandidate(evidence(), CONTEXT);
  const result = compareCrossStrategy([csp, definedRisk, wait], ENTRY_CORE_RISK_V1);
  // Not NOT_COMPARABLE -- structural validation passes for all three, including WAIT.
  assert.notEqual(result.state, 'NOT_COMPARABLE');
  assert.deepEqual(result.candidateIds.sort(), ['THETA_CONVENTIONAL:AAPL-put', 'THETA_DEFINED_RISK:AAPL-spread', 'WAIT:d1'].sort());
});
