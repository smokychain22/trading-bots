import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStrategyChoiceOutcomeRows } from '../src/research/strategy-choice-outcome-builder.js';

test('CORE CLAIM: an unselected strategy outcome is never factual -- only the chosen strategy can resolve', () => {
  const rows = buildStrategyChoiceOutcomeRows({
    comparisonPointId: 'cp1',
    alternatives: [
      { strategyFamily: 'THETA_CONVENTIONAL', wasChosen: true, preDecisionStateHash: 'h1' },
      { strategyFamily: 'THETA_HOLD_STRIKE', wasChosen: false, preDecisionStateHash: 'h2' },
      { strategyFamily: 'THETA_DEFINED_RISK', wasChosen: false, preDecisionStateHash: 'h3' },
    ],
    chosenStrategyResolvedOutcome: 123,
  });
  const chosen = rows.find((r) => r.strategyFamily === 'THETA_CONVENTIONAL') as (typeof rows)[number];
  const unchosenH = rows.find((r) => r.strategyFamily === 'THETA_HOLD_STRIKE') as (typeof rows)[number];
  const unchosenD = rows.find((r) => r.strategyFamily === 'THETA_DEFINED_RISK') as (typeof rows)[number];
  assert.equal(chosen.identifiabilityStatus, 'FACTUAL_OBSERVED');
  assert.equal(chosen.commonHorizonOutcome, 123);
  assert.equal(unchosenH.identifiabilityStatus, 'NOT_IDENTIFIABLE');
  assert.equal(unchosenH.commonHorizonOutcome, null);
  assert.equal(unchosenD.commonHorizonOutcome, null);
});

test('ADVERSARIAL: exactly one chosen alternative is required', () => {
  assert.throws(() => buildStrategyChoiceOutcomeRows({
    comparisonPointId: 'cp2',
    alternatives: [
      { strategyFamily: 'THETA_CONVENTIONAL', wasChosen: true, preDecisionStateHash: 'h1' },
      { strategyFamily: 'THETA_HOLD_STRIKE', wasChosen: true, preDecisionStateHash: 'h2' },
    ],
    chosenStrategyResolvedOutcome: null,
  }), /STRATEGY_CHOICE_REQUIRES_EXACTLY_ONE_CHOSEN_ALTERNATIVE/);
});
