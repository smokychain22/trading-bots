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
