import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonicalThetaStrategyRegistry } from '../src/theta/strategy-package.js';
import { strategyRouterContractVersion } from '../src/theta/strategy-router-contract.js';
import type { ShadowStrategyOrchestratorInput } from '../src/research/shadow-strategy-orchestrator.js';
import { evaluateDotShadowProposal, persistDotShadowProposal, persistDotExitComparison } from '../src/lab/proposal-consumer.js';
import { DotLabStore } from '../src/lab/store.js';

const at = '2026-10-08T15:00:00.000Z';
const required = <T>(value: T | null | undefined): T => { assert.ok(value !== null && value !== undefined); return value; };
function proposal(branch = 'THETA_HOLD_STRIKE') {
  const baseline = required([...canonicalThetaStrategyRegistry.values()].find(item => item.branch === branch));
  const { configurationHash, ...strategy } = baseline;
  return { proposalId: randomUUID(), baselineHash: configurationHash, parentProposalHash: null,
    strategy: { ...strategy, strategyVersion: 'dot-challenger-v1', status: 'RESEARCH_ONLY' },
    hypothesis: 'Synthetic bounded DTE and qualified IV research comparison.', researchRules: [] as unknown[],
    profitTakingChallengers: ['FIXED_10'], plannedHoldingDays: 3, experimentId: 'synthetic-challenger' };
}
function input(): ShadowStrategyOrchestratorInput {
  return { underlying: 'XLE', decisionTimestamp: at, sourceEvidenceIds: ['iv-evidence'],
    ownershipState: 'ELIGIBLE', eventState: 'CLEAR',
    routing: { contractVersion: strategyRouterContractVersion, snapshotId: 'snapshot-1', timestamp: at, policyVersion: 'synthetic',
      results: ['THETA_H', 'THETA_D'].map(family => ({ strategyFamily: family as 'THETA_H' | 'THETA_D',
        eligible: true, eligibilityState: 'ELIGIBLE_PRIMARY', reasons: [], policyVersion: 'synthetic' })) },
    holdStrikeChain: { maxQuoteAgeMs: 60000, contracts: [2, 3].map(dte => ({ contractId: `synthetic-${dte}`,
      dte, expiration: dte === 2 ? '2026-10-10' : '2026-10-11', strike: 57, bid: 1, ask: 1.1,
      quoteTimestamp: at, delta: -0.2, multiplier: 100 })) },
    definedRiskChain: { dte: 20, expiration: '2026-10-28', quantity: 1, minWidth: 1, maxWidth: 5,
      maxQuoteAgeMs: 60000, maxSyncAgeMs: 1000, requireSynchronizedFreshQuotes: true,
      shortLegCandidates: [{ contractId: 'synthetic-short', strike: 57, quote: { bid: 1, ask: 1.1, quoteTimestamp: at, multiplier: 100 } }],
      longLegCandidates: [{ contractId: 'synthetic-long', strike: 55, quote: { bid: 0.3, ask: 0.4, quoteTimestamp: at, multiplier: 100 } }] } };
}
const feature = { feature: 'IV', value: 0.3, evidenceId: 'iv-evidence', snapshotId: 'snapshot-1',
  observedAt: at, availableAt: at, validUntil: '2026-10-08T15:01:00.000Z', qualification: 'QUALIFIED' };
test('Dot narrowed H lattice actually changes existing generator results without modifying canonical registry', () => {
  const raw = proposal(), before = raw.baselineHash;
  raw.strategy.lattice = { ...raw.strategy.lattice, dteMin: 3 };
  const result = evaluateDotShadowProposal(raw, input(), []);
  assert.equal(result.state, 'EVALUATED_RESEARCH_ONLY');
  assert.equal(result.result?.acceptedCandidates.length, 1);
  assert.equal(result.result?.rejectedCandidates.length, 1);
  assert.equal(result.brokerAuthority, false);
  assert.ok([...canonicalThetaStrategyRegistry.values()].some(item => item.configurationHash === before && item.lattice.dteMin === 2));
});
test('Dot D proposal reuses fresh synchronized spread economics', () => {
  const result = evaluateDotShadowProposal(proposal('THETA_DEFINED_RISK'), input(), []);
  assert.equal(result.result?.acceptedCandidates.length, 1);
  const stale = input(); const chain = required(stale.definedRiskChain);
  stale.definedRiskChain = { ...chain, maxQuoteAgeMs: 1,
    shortLegCandidates: [{ ...required(chain.shortLegCandidates[0]), quote: { bid: 1, ask: 1.1, multiplier: 100,
      quoteTimestamp: '2026-10-08T14:59:00.000Z' } }] };
  assert.equal(evaluateDotShadowProposal(proposal('THETA_DEFINED_RISK'), stale, []).result?.acceptedCandidates.length, 0);
});
test('rules distinguish a qualified pass, rejection, missing, stale, future and wrong snapshot evidence', () => {
  const raw = proposal(); raw.researchRules = [{ feature: 'IV', operator: 'GTE', lower: 0.25, upper: null, role: 'RESEARCH_ONLY' }];
  assert.equal(evaluateDotShadowProposal(raw, input(), [feature]).state, 'EVALUATED_RESEARCH_ONLY');
  for (const evidence of [[], [{ ...feature, value: 0.1 }], [{ ...feature, value: null }],
    [{ ...feature, validUntil: at }], [{ ...feature, availableAt: '2026-10-08T15:00:01.000Z' }],
    [{ ...feature, snapshotId: 'other' }], [{ ...feature, evidenceId: 'unbound' }]]) {
    const result = evaluateDotShadowProposal(raw, input(), evidence);
    assert.equal(result.state, 'BLOCKED'); assert.equal(result.result, null);
  }
  assert.throws(() => evaluateDotShadowProposal(raw, input(), [feature, feature]), /DUPLICATE/);
});
test('unsupported model, delta or lattice expansion is explicit, Q/A/C never get invented candidates', () => {
  for (const branch of ['THETA_CONVENTIONAL', 'THETA_RECOVERY', 'THETA_CC']) {
    assert.ok(evaluateDotShadowProposal(proposal(branch), input(), []).blockers.includes('CANONICAL_Q_OR_INVENTORY_MANAGEMENT_CONSUMER_REQUIRED'));
  }
  for (const change of [{ entryModelVersion: 'unimplemented' }, { lattice: { ...proposal().strategy.lattice, dteMax: 6 } },
    { lattice: { ...proposal().strategy.lattice, deltaResearchBuckets: [0.2] } }]) {
    const raw = proposal(); Object.assign(raw.strategy, change);
    assert.equal(evaluateDotShadowProposal(raw, input(), []).result, null);
  }
});
test('shadow result and immutable proposal persist idempotently in isolated account state', () => {
  const store = new DotLabStore(':memory:', { version: 'dot-strategy-lab-v1', providerAccountId: randomUUID(),
    executionAccountId: randomUUID(), workspaceId: randomUUID(), accountNumber: 'SYNTHETIC', confirmedAt: at,
    environment: 'PAPER', brokerExecutionEnabled: false, workerEnabled: false });
  try {
    const raw = proposal();
    const first = persistDotShadowProposal(store, raw, input(), []);
    assert.equal(persistDotShadowProposal(store, raw, input(), []).receiptHash, first.receiptHash);
    assert.equal(store.list('EXPERIMENT').length, 1);
    assert.deepEqual(first.unconsumedExperimentFields, ['plannedHoldingDays', 'profitTakingChallengers']);
  } finally { store.close(); }
});

test('Dot holding horizon and exits run existing full-policy replay without claiming actual fills or profit', () => {
  const store = new DotLabStore(':memory:', { version: 'dot-strategy-lab-v1', providerAccountId: randomUUID(),
    executionAccountId: randomUUID(), workspaceId: randomUUID(), accountNumber: 'SYNTHETIC', confirmedAt: at,
    environment: 'PAPER', brokerExecutionEnabled: false, workerEnabled: false });
  try {
    const raw = proposal(); raw.plannedHoldingDays = 1;
    const receipt = persistDotExitComparison(store, raw, { version: 'theta-profit-taking-replay-input-v1',
      sourceSha: 'a'.repeat(40), sourceManifestHash: 'b'.repeat(64), episodeId: 'synthetic', chainId: 'synthetic',
      evidenceClass: 'DETERMINISTIC_TEST', entryAt: '2026-10-07T15:00:00.000Z', entryCreditDollars: 100, entryFeesDollars: 1,
      policy: { version: 'synthetic', maxHoldingMinutes: 999999, exitDte: 1, maxTailLossDollars: 100 },
      observations: [{ evidenceId: 'synthetic-close', decisionAt: at, dte: 2, closeAskDollars: 90, closeFeesDollars: 1,
        adverseSlippageDollars: 1, quoteAt: at, quoteReceivedAt: at, quoteValidThrough: '2026-10-08T15:01:00.000Z',
        quoteAuthority: 'ALPACA_EXECUTABLE_MARKET', hardRiskExitRequired: null, eventExitRequired: null,
        riskAvailableAt: null, eventAvailableAt: null, eventValidThrough: null, forecast: null }] });
    assert.equal(receipt.fullPolicyTrialCount, 17);
    assert.equal(receipt.comparison.policies.find(item => item.policy === 'TIME_EXIT')?.terminal, 'ESTIMATED_EXIT');
    assert.equal(receipt.comparison.policies.find(item => item.policy === 'TIME_EXIT')?.estimatedAfterCostPnlDollars, 7);
    assert.equal(receipt.actualFill, false); assert.equal(receipt.truthClass, 'MODELED_RESEARCH');
    assert.equal(receipt.profitability, 'EMPIRICALLY_UNPROVEN');
  } finally { store.close(); }
});
