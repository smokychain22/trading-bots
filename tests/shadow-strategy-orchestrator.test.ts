import assert from 'node:assert/strict';
import test from 'node:test';
import {
  orchestrateShadowStrategies, type ShadowStrategyOrchestratorInput, type HoldStrikeChainInput,
  type DefinedRiskChainInputForOrchestrator,
} from '../src/research/shadow-strategy-orchestrator.js';
import { strategyRouterContractVersion, type StrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import type { HoldStrikeChainContractQuote } from '../src/research/hold-strike-shadow-candidate-generator.js';
import type { DefinedRiskLegContract } from '../src/research/defined-risk-shadow-candidate-generator.js';

const DECISION_TS = '2026-09-22T14:00:00Z';

function routing(eligibleFamilies: readonly StrategyFamily[]): StrategyRoutingResponse {
  const allFamilies: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return {
    contractVersion: strategyRouterContractVersion, snapshotId: 'snap-1', timestamp: DECISION_TS,
    policyVersion: 'test-policy-v1',
    results: allFamilies.map((strategyFamily) => ({
      strategyFamily,
      eligible: eligibleFamilies.includes(strategyFamily),
      eligibilityState: eligibleFamilies.includes(strategyFamily) ? 'ELIGIBLE_PRIMARY' as const : 'INELIGIBLE_STATE' as const,
      reasons: [{ code: 'TEST_REASON', polarity: eligibleFamilies.includes(strategyFamily) ? 1 as const : -1 as const, detail: 'test fixture' }],
      policyVersion: 'test-policy-v1',
    })),
  };
}

function holdStrikeContract(overrides: Partial<HoldStrikeChainContractQuote> = {}): HoldStrikeChainContractQuote {
  return {
    contractId: 'AAPL-c1', strike: 190, dte: 3, expiration: '2026-09-25',
    bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T13:59:30Z', delta: -0.22, multiplier: 100, ...overrides,
  };
}

function definedRiskLeg(overrides: Partial<DefinedRiskLegContract> = {}): DefinedRiskLegContract {
  return {
    contractId: 'AAPL-short', strike: 190,
    quote: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 },
    ...overrides,
  };
}

function baseInput(overrides: Partial<ShadowStrategyOrchestratorInput> = {}): ShadowStrategyOrchestratorInput {
  return {
    underlying: 'AAPL', decisionTimestamp: DECISION_TS, routing: routing([]),
    ownershipState: 'ELIGIBLE', eventState: 'CLEAR', holdStrikeChain: null, definedRiskChain: null,
    sourceEvidenceIds: ['ev-1'], ...overrides,
  };
}

test('every real strategy family gets exactly one branch result -- a router result is never silently dropped', () => {
  const result = orchestrateShadowStrategies(baseInput({ routing: routing(['THETA_Q']) }));
  assert.equal(result.branchResults.length, 6);
  const families = result.branchResults.map((b) => b.family).sort();
  assert.deepEqual(families, ['THETA_A', 'THETA_C', 'THETA_D', 'THETA_H', 'THETA_Q', 'THETA_R']);
});

test('THETA_Q is reference-only -- this module never generates or re-decides Q candidates', () => {
  const result = orchestrateShadowStrategies(baseInput({ routing: routing(['THETA_Q']) }));
  const q = result.branchResults.find((b) => b.family === 'THETA_Q');
  assert.equal(q?.branchState, 'PRODUCTION_CANONICAL_REFERENCE_ONLY');
  assert.equal(q?.holdStrikeResult, null);
  assert.equal(q?.definedRiskResult, null);
});

test('THETA_H eligible with a real chain generates real Hold-Strike shadow candidates', () => {
  const chain: HoldStrikeChainInput = { contracts: [holdStrikeContract()], maxQuoteAgeMs: 60000 };
  const result = orchestrateShadowStrategies(baseInput({ routing: routing(['THETA_H']), holdStrikeChain: chain }));
  const h = result.branchResults.find((b) => b.family === 'THETA_H');
  assert.equal(h?.branchState, 'SHADOW_CANDIDATES_GENERATED');
  assert.equal(h?.holdStrikeResult?.acceptedCandidates.length, 1);
  assert.equal(h?.brokerAuthority, false);
});

test('THETA_D eligible with a real chain generates real spread-pair shadow candidates', () => {
  const chain: DefinedRiskChainInputForOrchestrator = {
    expiration: '2026-10-17', dte: 25,
    shortLegCandidates: [definedRiskLeg({ contractId: 'short-190', strike: 190 })],
    longLegCandidates: [definedRiskLeg({
      contractId: 'long-185', strike: 185,
      quote: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 },
    })],
    quantity: 1, maxSyncAgeMs: 1000, maxQuoteAgeMs: 60000, minWidth: 1, maxWidth: 20,
    requireSynchronizedFreshQuotes: false,
  };
  const result = orchestrateShadowStrategies(baseInput({ routing: routing(['THETA_D']), definedRiskChain: chain }));
  const d = result.branchResults.find((b) => b.family === 'THETA_D');
  assert.equal(d?.branchState, 'SHADOW_CANDIDATES_GENERATED');
  assert.equal(d?.definedRiskResult?.acceptedCandidates.length, 1);
  assert.equal(d?.brokerAuthority, false);
});

test('ADVERSARIAL: H/D branch results never carry a shape that could be mistaken for broker intent', () => {
  const chain: HoldStrikeChainInput = { contracts: [holdStrikeContract()], maxQuoteAgeMs: 60000 };
  const result = orchestrateShadowStrategies(baseInput({ routing: routing(['THETA_H']), holdStrikeChain: chain }));
  assert.equal(result.brokerAuthority, false);
  for (const branch of result.branchResults) {
    assert.equal(branch.brokerAuthority, false);
    assert.ok(!('orderId' in branch));
    assert.ok(!('submittedAt' in branch));
  }
});

test('an ineligible branch is explicit INELIGIBLE_THIS_CYCLE, distinct from NOT_APPLICABLE or a silent gap', () => {
  const result = orchestrateShadowStrategies(baseInput({ routing: routing(['THETA_Q']) }));
  const h = result.branchResults.find((b) => b.family === 'THETA_H');
  const d = result.branchResults.find((b) => b.family === 'THETA_D');
  assert.equal(h?.branchState, 'INELIGIBLE_THIS_CYCLE');
  assert.equal(d?.branchState, 'INELIGIBLE_THIS_CYCLE');
  assert.equal(h?.eligibleThisCycle, false);
});

test('REPAIR: THETA_H eligible but no chain supplied is MISSING_CHAIN_INPUT, never silently coerced to ineligible or NOT_APPLICABLE', () => {
  const result = orchestrateShadowStrategies(baseInput({ routing: routing(['THETA_H']), holdStrikeChain: null }));
  const h = result.branchResults.find((b) => b.family === 'THETA_H');
  assert.equal(h?.branchState, 'MISSING_CHAIN_INPUT');
  assert.equal(h?.eligibleThisCycle, true);
});

test('REPAIR: THETA_D eligible but no chain supplied is MISSING_CHAIN_INPUT, never silently coerced', () => {
  const result = orchestrateShadowStrategies(baseInput({ routing: routing(['THETA_D']), definedRiskChain: null }));
  const d = result.branchResults.find((b) => b.family === 'THETA_D');
  assert.equal(d?.branchState, 'MISSING_CHAIN_INPUT');
  assert.equal(d?.eligibleThisCycle, true);
});

test('THETA_A/THETA_C/THETA_R are recorded as lifecycle handoff references, never given invented candidates', () => {
  const result = orchestrateShadowStrategies(baseInput({ routing: routing(['THETA_A', 'THETA_C', 'THETA_R']) }));
  for (const family of ['THETA_A', 'THETA_C', 'THETA_R'] as const) {
    const branch = result.branchResults.find((b) => b.family === family);
    assert.equal(branch?.branchState, 'LIFECYCLE_HANDOFF_REFERENCE_ONLY');
    assert.equal(branch?.holdStrikeResult, null);
    assert.equal(branch?.definedRiskResult, null);
    assert.equal(branch?.eligibleThisCycle, true);
  }
});

test('multiple simultaneously eligible families (Q + H + D) each get their own independent real result', () => {
  const holdChain: HoldStrikeChainInput = { contracts: [holdStrikeContract()], maxQuoteAgeMs: 60000 };
  const drChain: DefinedRiskChainInputForOrchestrator = {
    expiration: '2026-10-17', dte: 25,
    shortLegCandidates: [definedRiskLeg({ contractId: 'short-190', strike: 190 })],
    longLegCandidates: [definedRiskLeg({
      contractId: 'long-185', strike: 185,
      quote: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 },
    })],
    quantity: 1, maxSyncAgeMs: 1000, maxQuoteAgeMs: 60000, minWidth: 1, maxWidth: 20,
    requireSynchronizedFreshQuotes: false,
  };
  const result = orchestrateShadowStrategies(baseInput({
    routing: routing(['THETA_Q', 'THETA_H', 'THETA_D']), holdStrikeChain: holdChain, definedRiskChain: drChain,
  }));
  assert.equal(result.branchResults.find((b) => b.family === 'THETA_Q')?.branchState, 'PRODUCTION_CANONICAL_REFERENCE_ONLY');
  assert.equal(result.branchResults.find((b) => b.family === 'THETA_H')?.branchState, 'SHADOW_CANDIDATES_GENERATED');
  assert.equal(result.branchResults.find((b) => b.family === 'THETA_D')?.branchState, 'SHADOW_CANDIDATES_GENERATED');
});
