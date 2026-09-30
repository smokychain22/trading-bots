import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfitTakingComparisonRow, canonicalV7ProfitTakingPolicies, type ProfitTakingDecisionState } from '../src/research/profit-taking-experiment.js';
import { runProfitTakingChallengerComparison } from '../src/research/profit-taking-challenger-runner.js';

function state(episodeId: string): ProfitTakingDecisionState {
  return {
    episodeId, chainId: `chain-${episodeId}`, decisionId: `decision-${episodeId}`, decisionAt: '2026-09-20T14:00:00Z',
    openCredit: 100, closeDebit: 40, remainingExecutablePremium: 40, dte: 20, signedDelta: -0.2, absoluteDelta: 0.2,
    atmIv: 0.3, rv20: 0.25, vrp20: 0.05, eventEvidenceState: 'CLEAR', executionEvidenceState: 'EXECUTABLE',
    assignmentBurden: null, capitalDaysConsumed: 15, rollAlternativeAvailable: true, redeploymentAlternativeAvailable: false,
    portfolioConstraints: [], uncertaintyState: 'KNOWN',
  };
}

function rowFor(episodeId: string, challengerPolicy: (typeof canonicalV7ProfitTakingPolicies)[number], incrementalPnl: number) {
  return buildProfitTakingComparisonRow({
    state: state(episodeId), actualPolicy: 'FIXED_50', challengerPolicy,
    actualAction: 'CLOSE', challengerAction: 'CLOSE', actualOutcomeRef: `outcome-${episodeId}`,
    counterfactualOutcomeState: 'OBSERVED_PARALLEL', incrementalWholeChainNetPnl: incrementalPnl,
    incrementalCapitalDays: 2, incrementalDownside: 0, incrementalExecutionCost: 1, labelAvailableAt: '2026-09-21T00:00:00Z',
  });
}

test('CORE CLAIM: every policy is compared over the exact same episode set -- no cross-policy denominator drift', () => {
  const rows = canonicalV7ProfitTakingPolicies.flatMap((policy) => [rowFor('e1', policy, 10), rowFor('e2', policy, 20)]);
  const result = runProfitTakingChallengerComparison(rows);
  assert.equal(result.commonEpisodeCount, 2);
  for (const policy of result.perPolicy) assert.equal(policy.episodeCount, 2);
});

test('an episode missing for even one policy is excluded from every policy aggregate', () => {
  const rows = canonicalV7ProfitTakingPolicies.flatMap((policy) => [rowFor('e1', policy, 10)]);
  // Remove episode e1's row for exactly one policy -- simulate incomplete data.
  const incomplete = rows.filter((r) => !(r.challengerPolicy === 'FIXED_90' && r.state.episodeId === 'e1'));
  const withPartialSecondEpisode = [...incomplete, ...canonicalV7ProfitTakingPolicies.filter((p) => p !== 'FIXED_90').map((p) => rowFor('e2', p, 5))];
  const result = runProfitTakingChallengerComparison(withPartialSecondEpisode);
  assert.ok(result.excludedEpisodeIds.length >= 1);
});

test('all 17 canonical policies are represented in every run result, even with zero data', () => {
  const result = runProfitTakingChallengerComparison([]);
  assert.equal(result.perPolicy.length, 17);
  assert.equal(result.numberOfTrials, 17);
});

test('missing or unidentified labels cannot create policy-specific denominators', () => {
  const rows = canonicalV7ProfitTakingPolicies.flatMap((policy) => [rowFor('e1', policy, 10), rowFor('e2', policy, 20)]);
  const incomplete = rows.map((r) => r.state.episodeId === 'e1' && r.challengerPolicy === 'FIXED_05' ? { ...r, incrementalWholeChainNetPnl: null } : r);
  const result = runProfitTakingChallengerComparison(incomplete);
  assert.deepEqual(result.metricCohorts.incrementalWholeChainNetPnl, ['e2']);
  assert.deepEqual(result.metricCohorts.incrementalCapitalDays, ['e1', 'e2']);
  assert.ok(result.perPolicy.every((p) => p.episodeCount === 1 && p.averageIncrementalWholeChainNetPnl === 20));
  assert.deepEqual(result, runProfitTakingChallengerComparison([...incomplete].reverse()));
});

test('duplicate labels and mixed observed/modeled cohorts fail rather than overwrite or pool evidence', () => {
  const rows = canonicalV7ProfitTakingPolicies.map((p) => rowFor('e1', p, 10));
  const first = rows[0];
  assert.ok(first);
  assert.throws(() => runProfitTakingChallengerComparison([...rows, first]), /DUPLICATE/);
  assert.throws(() => runProfitTakingChallengerComparison(rows.map((r, i) => i === 0 ? { ...r, counterfactualOutcomeState: 'ESTIMABLE' } : r)), /MIXED_TRUTH/);
  assert.throws(() => runProfitTakingChallengerComparison([{ ...first, incrementalWholeChainNetPnl: NaN }]), /NONFINITE/);
});
