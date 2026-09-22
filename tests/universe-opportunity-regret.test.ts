import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySymbolObservation, classifyObservationPolicyAdequacy, classifyOutsideCapOpportunity,
  validateOpportunityRegretRecord, rankBaselineDollarVolume, rankLiquidityThenOptionabilityLexicographic,
  rankStructuralOptionEconomicsPareto, rankOwnershipEligiblePareto,
  type UniverseOpportunityRegretRecord, type UnderlyingRankingFeatures,
} from '../src/research/universe-opportunity-regret.js';

// --- B5/B6: observation status + policy adequacy -------------------------

test('classifySymbolObservation: NOT_OPTION_CHECKED when optionability was never checked at all', () => {
  assert.equal(classifySymbolObservation({ optionabilityChecked: false, quoteEvidenceAvailable: false, structuralCandidateAvailable: false }), 'NOT_OPTION_CHECKED');
});

test('classifySymbolObservation: FULLY_OBSERVED_SYMBOL only when checked AND quote AND structural candidate evidence all exist', () => {
  assert.equal(classifySymbolObservation({ optionabilityChecked: true, quoteEvidenceAvailable: true, structuralCandidateAvailable: true }), 'FULLY_OBSERVED_SYMBOL');
});

test('ADVERSARIAL: a symbol that was optionability-checked but has no valid quote evidence is PARTIALLY_OBSERVED_SYMBOL, never silently treated as fully observed', () => {
  assert.equal(classifySymbolObservation({ optionabilityChecked: true, quoteEvidenceAvailable: false, structuralCandidateAvailable: false }), 'PARTIALLY_OBSERVED_SYMBOL');
});

test('classifyObservationPolicyAdequacy: OBSERVATION_POLICY_TOO_NARROW when the observed fraction is below the caller-supplied minimum', () => {
  const result = classifyObservationPolicyAdequacy({ outsideCapSymbolsTotal: 100, outsideCapSymbolsOptionabilityChecked: 5, minimumObservedFraction: 0.5 });
  assert.equal(result, 'OBSERVATION_POLICY_TOO_NARROW');
});

test('classifyObservationPolicyAdequacy: INSUFFICIENT_EVIDENCE_TO_JUDGE when there are zero outside-cap symbols to measure against', () => {
  assert.equal(classifyObservationPolicyAdequacy({ outsideCapSymbolsTotal: 0, outsideCapSymbolsOptionabilityChecked: 0, minimumObservedFraction: 0.5 }), 'INSUFFICIENT_EVIDENCE_TO_JUDGE');
});

// --- B3: opportunity-miss honesty -----------------------------------------

test('classifyOutsideCapOpportunity: EVIDENCE_INCOMPLETE when the symbol was not fully observed, regardless of any other field', () => {
  const result = classifyOutsideCapOpportunity({
    observationStatus: 'PARTIALLY_OBSERVED_SYMBOL', structuralCandidateAvailable: true,
    eventEligible: true, aegisEligible: true, paperAuthorizedBranch: false,
  });
  assert.equal(result, 'EVIDENCE_INCOMPLETE');
});

test('ADVERSARIAL: an outside-cap candidate that is event-blocked is EVENT_BLOCKED, never STRUCTURALLY_INTERESTING merely because the structural economics look good', () => {
  const result = classifyOutsideCapOpportunity({
    observationStatus: 'FULLY_OBSERVED_SYMBOL', structuralCandidateAvailable: true,
    eventEligible: false, aegisEligible: true, paperAuthorizedBranch: false,
  });
  assert.equal(result, 'EVENT_BLOCKED');
});

test('ADVERSARIAL: an outside-cap candidate with an UNKNOWN AEGIS state is EVIDENCE_INCOMPLETE, never assumed eligible', () => {
  const result = classifyOutsideCapOpportunity({
    observationStatus: 'FULLY_OBSERVED_SYMBOL', structuralCandidateAvailable: true,
    eventEligible: true, aegisEligible: null, paperAuthorizedBranch: false,
  });
  assert.equal(result, 'EVIDENCE_INCOMPLETE');
});

test('classifyOutsideCapOpportunity: STRUCTURALLY_INTERESTING (not PAPER_AUTHORIZABLE) when every gate passes but the branch has no real Paper authority', () => {
  const result = classifyOutsideCapOpportunity({
    observationStatus: 'FULLY_OBSERVED_SYMBOL', structuralCandidateAvailable: true,
    eventEligible: true, aegisEligible: true, paperAuthorizedBranch: false,
  });
  assert.equal(result, 'STRUCTURALLY_INTERESTING');
});

test('classifyOutsideCapOpportunity: PAPER_AUTHORIZABLE only when the real registry flag says so', () => {
  const result = classifyOutsideCapOpportunity({
    observationStatus: 'FULLY_OBSERVED_SYMBOL', structuralCandidateAvailable: true,
    eventEligible: true, aegisEligible: true, paperAuthorizedBranch: true,
  });
  assert.equal(result, 'PAPER_AUTHORIZABLE');
});

// --- B7: opportunity-regret record validation ------------------------------

function record(overrides: Partial<UniverseOpportunityRegretRecord> = {}): UniverseOpportunityRegretRecord {
  return {
    decisionId: 'd1', decisionTimestamp: '2026-09-22T14:00:00Z', symbol: 'XYZ', rankUnderDollarVolume: 50,
    insideProductionCap: false, observationStatus: 'FULLY_OBSERVED_SYMBOL', optionable: true,
    quoteEvidenceAvailable: true, structuralCandidateAvailable: true, bestCandidateId: 'c1',
    eventState: 'CLEAR', ownershipState: 'ELIGIBLE', aegisState: 'CLEAR', selectedByProduction: false,
    selectedByChallenger: {}, outsideCapOpportunityStatus: 'STRUCTURALLY_INTERESTING',
    futureOutcomeStatus: 'NOT_IDENTIFIABLE', ...overrides,
  };
}

test('ADVERSARIAL: a never-traded candidate is REJECTED if labeled OBSERVED_REAL_CHAIN -- must never claim an observed winner that was never actually selected', () => {
  const result = validateOpportunityRegretRecord(record({ selectedByProduction: false, futureOutcomeStatus: 'OBSERVED_REAL_CHAIN' }));
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'NEVER_TRADED_CANDIDATE_CANNOT_BE_LABELED_OBSERVED_REAL_CHAIN');
});

test('validateOpportunityRegretRecord accepts OBSERVED_REAL_CHAIN when the candidate really was selected by Production', () => {
  assert.equal(validateOpportunityRegretRecord(record({ selectedByProduction: true, futureOutcomeStatus: 'OBSERVED_REAL_CHAIN' })).valid, true);
});

test('validateOpportunityRegretRecord rejects an inside-cap record carrying a real outsideCapOpportunityStatus, and an outside-cap record carrying NOT_APPLICABLE_INSIDE_CAP', () => {
  assert.equal(validateOpportunityRegretRecord(record({ insideProductionCap: true, outsideCapOpportunityStatus: 'STRUCTURALLY_INTERESTING' })).valid, false);
  assert.equal(validateOpportunityRegretRecord(record({ insideProductionCap: false, outsideCapOpportunityStatus: 'NOT_APPLICABLE_INSIDE_CAP' })).valid, false);
  assert.equal(validateOpportunityRegretRecord(record({ insideProductionCap: true, outsideCapOpportunityStatus: 'NOT_APPLICABLE_INSIDE_CAP' })).valid, true);
});

// --- B4/B9: underlying-ranking challengers ---------------------------------

function features(overrides: Partial<UnderlyingRankingFeatures> = {}): UnderlyingRankingFeatures {
  return {
    symbol: 'AAA', avgDollarVolume: 1_000_000, observationStatus: 'FULLY_OBSERVED_SYMBOL', optionContractCount: 40,
    medianRelativeSpread: 0.02, executablePremiumOverCollateral: 0.03, downsideCushion: 0.05,
    ownershipEligible: true, eventEvidenceComplete: true, ...overrides,
  };
}

test('rankBaselineDollarVolume ranks purely by avgDollarVolume desc, excluding (never zero-filling) symbols with unknown dollar volume', () => {
  const result = rankBaselineDollarVolume([
    features({ symbol: 'LOW', avgDollarVolume: 100 }), features({ symbol: 'HIGH', avgDollarVolume: 900 }),
    features({ symbol: 'UNKNOWN', avgDollarVolume: null }),
  ]);
  assert.deepEqual(result.rankedOrNonDominated, ['HIGH', 'LOW']);
  assert.ok(result.excludedSymbols.some((e) => e.symbol === 'UNKNOWN'));
});

test('ADVERSARIAL: high dollar volume but NOT_OPTION_CHECKED is excluded from rankLiquidityThenOptionabilityLexicographic, never ranked on a feature it was never actually observed to have', () => {
  const result = rankLiquidityThenOptionabilityLexicographic([
    features({ symbol: 'BIGVOL_UNCHECKED', avgDollarVolume: 5_000_000, observationStatus: 'NOT_OPTION_CHECKED', optionContractCount: null }),
    features({ symbol: 'SMALLVOL_CHECKED', avgDollarVolume: 200_000, observationStatus: 'FULLY_OBSERVED_SYMBOL', optionContractCount: 60 }),
  ]);
  assert.deepEqual(result.rankedOrNonDominated, ['SMALLVOL_CHECKED']);
  assert.ok(result.excludedSymbols.some((e) => e.symbol === 'BIGVOL_UNCHECKED' && e.reason.startsWith('NOT_FULLY_OBSERVED')));
});

test('ADVERSARIAL: lower dollar volume with excellent option liquidity still ranks via its own dollar-volume-first key -- rankLiquidityThenOptionabilityLexicographic never silently reorders by the secondary key alone', () => {
  const result = rankLiquidityThenOptionabilityLexicographic([
    features({ symbol: 'LOWVOL_GREAT_LIQUIDITY', avgDollarVolume: 200_000, optionContractCount: 500 }),
    features({ symbol: 'HIGHVOL_THIN_OPTIONS', avgDollarVolume: 5_000_000, optionContractCount: 5 }),
  ]);
  assert.deepEqual(result.rankedOrNonDominated, ['HIGHVOL_THIN_OPTIONS', 'LOWVOL_GREAT_LIQUIDITY']); // dollar volume is still the PRIMARY key
});

test('ADVERSARIAL: an outside-cap candidate with a STALE quote is excluded from rankStructuralOptionEconomicsPareto via missing/PARTIALLY_OBSERVED status, never included with a fabricated economics figure', () => {
  const result = rankStructuralOptionEconomicsPareto([
    features({ symbol: 'STALE', observationStatus: 'PARTIALLY_OBSERVED_SYMBOL', executablePremiumOverCollateral: null }),
    features({ symbol: 'FRESH', observationStatus: 'FULLY_OBSERVED_SYMBOL' }),
  ]);
  assert.deepEqual(result.rankedOrNonDominated, ['FRESH']);
  assert.ok(result.excludedSymbols.some((e) => e.symbol === 'STALE'));
});

test('rankStructuralOptionEconomicsPareto returns a real, unweighted, UNORDERED non-dominated set -- never collapses a genuine trade-off to one winner', () => {
  const result = rankStructuralOptionEconomicsPareto([
    features({ symbol: 'HIGH_PREMIUM_WIDE_SPREAD', executablePremiumOverCollateral: 0.08, medianRelativeSpread: 0.10, downsideCushion: 0.04 }),
    features({ symbol: 'LOW_PREMIUM_TIGHT_SPREAD', executablePremiumOverCollateral: 0.02, medianRelativeSpread: 0.01, downsideCushion: 0.06 }),
  ]);
  assert.deepEqual([...result.rankedOrNonDominated].sort(), ['HIGH_PREMIUM_WIDE_SPREAD', 'LOW_PREMIUM_TIGHT_SPREAD']);
});

test('ADVERSARIAL: rankOwnershipEligiblePareto excludes an ownership-UNKNOWN symbol, never defaulting it to eligible', () => {
  const result = rankOwnershipEligiblePareto([
    features({ symbol: 'UNKNOWN_OWNERSHIP', ownershipEligible: null }),
    features({ symbol: 'ELIGIBLE', ownershipEligible: true }),
  ]);
  assert.deepEqual(result.rankedOrNonDominated, ['ELIGIBLE']);
  assert.ok(result.excludedSymbols.some((e) => e.symbol === 'UNKNOWN_OWNERSHIP' && e.reason === 'OWNERSHIP_ELIGIBILITY_UNKNOWN'));
});

test('ADVERSARIAL: a candidate that "appears best" only because every other symbol was never queried is still excluded/flagged, never silently declared the winner by default', () => {
  const result = rankStructuralOptionEconomicsPareto([
    features({ symbol: 'ONLY_QUERIED', executablePremiumOverCollateral: 0.001 }), // objectively mediocre economics
    features({ symbol: 'NEVER_QUERIED_1', observationStatus: 'NOT_OPTION_CHECKED', executablePremiumOverCollateral: null }),
    features({ symbol: 'NEVER_QUERIED_2', observationStatus: 'NOT_OPTION_CHECKED', executablePremiumOverCollateral: null }),
  ]);
  // ONLY_QUERIED is technically non-dominated (it's the only ranked candidate), but the result must show two exclusions, not a clean "1 winner" result.
  assert.deepEqual(result.rankedOrNonDominated, ['ONLY_QUERIED']);
  assert.equal(result.excludedSymbols.length, 2);
});
