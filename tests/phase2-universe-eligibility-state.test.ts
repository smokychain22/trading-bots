import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  approvalAuthorityFromClassification, classifyInstrumentEligibility, emptyInstrumentPromotionContract,
  instrumentEligibilityStates, instrumentPromotionContractFields, type InstrumentEligibilityInput,
  type InstrumentPromotionField, type PromotionSlot,
} from '../src/theta/instrument-eligibility-state.js';
import { classifyPaperInstrument, paperInstrumentClassificationManifest } from '../src/theta/paper-entry-safety-policy.js';

const known = <T>(value: T, evidenceRef = 'test:evidence'): PromotionSlot<T> => ({ state: 'KNOWN', value, evidenceRef });
const completePromotion = (): NonNullable<InstrumentEligibilityInput['promotion']> => {
  const slots: Record<string, PromotionSlot> = {};
  for (const field of instrumentPromotionContractFields) if (field !== 'capitalFit') slots[field] = known(field === 'leveragedInverse' ? false : `v:${field}`);
  return slots as NonNullable<InstrumentEligibilityInput['promotion']>;
};
const approved = { paperBootstrapApproved: true, authorityRef: 'official-issuer:test:abc' };
const richCapital = { availableCapitalUsd: 100_000, collateralPerContractUsd: 19_000 };

test('promotion contract lists every required field and starts fully typed-unknown, with relative strength owner-policy-required', () => {
  const expected = ['identity', 'assetClass', 'exchange', 'optionability', 'standardDeliverable', 'issuerProductAuthority',
    'fundOrCompanyClassification', 'leveragedInverse', 'earningsApplicability', 'corporateActionHandling',
    'relativeStrengthAvailability', 'stockLiquidity', 'optionLiquidity', 'spreadQuality', 'assignmentSuitability',
    'recoverySuitability', 'capitalFit', 'eventCoverage', 'policyVersion'];
  assert.deepEqual([...instrumentPromotionContractFields], expected);
  const empty = emptyInstrumentPromotionContract();
  for (const field of expected) {
    const slot = empty[field as InstrumentPromotionField];
    assert.notEqual(slot.state, 'KNOWN', field);
    assert.equal(slot.value, null, field);
  }
  assert.equal(empty.relativeStrengthAvailability.state, 'OWNER_POLICY_REQUIRED');
  assert.equal(empty.policyVersion.state, 'REQUIRED_NOT_PROVIDED');
  assert.equal(empty.identity.state, 'UNKNOWN');
});

test('the five states are exactly the specified set', () => {
  assert.deepEqual([...instrumentEligibilityStates].sort(), ['APPROVED_CAPITAL_FIT', 'APPROVED_DATA_INCOMPLETE',
    'APPROVED_NOT_CAPITAL_FIT', 'DISCOVERED_NOT_APPROVED', 'RESEARCH_ONLY']);
});

test('discovery, liquidity, optionability and capital fit never imply Paper approval', () => {
  const r = classifyInstrumentEligibility({ symbol: 'xyz', discovered: true, approval: null, capital: richCapital, promotion: completePromotion() });
  assert.equal(r.state, 'DISCOVERED_NOT_APPROVED');
  assert.equal(r.approvedForPaperBootstrap, false);
  assert.equal(r.executionAuthorized, false);
  assert.equal(r.symbol, 'XYZ');
  assert.deepEqual(r.blockers, ['NOT_OWNER_APPROVED']);
  for (const approval of [{ paperBootstrapApproved: false, authorityRef: 'x' }, { paperBootstrapApproved: true, authorityRef: null },
    { paperBootstrapApproved: true, authorityRef: '  ' }]) {
    assert.equal(classifyInstrumentEligibility({ symbol: 'XYZ', discovered: true, approval, capital: richCapital }).state,
      'DISCOVERED_NOT_APPROVED');
  }
});

test('approved + complete + capital fits is the only way to APPROVED_CAPITAL_FIT, and it still authorizes no execution', () => {
  const r = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved, capital: richCapital,
    promotion: completePromotion() });
  assert.equal(r.state, 'APPROVED_CAPITAL_FIT');
  assert.equal(r.capacityContracts, 5);
  assert.equal(r.approvedForPaperBootstrap, true);
  assert.equal(r.executionAuthorized, false);
  assert.deepEqual(r.incompleteSlots, []);
});

test('approved instrument that cannot afford one contract is APPROVED_NOT_CAPITAL_FIT, distinct from discovery and from missing data', () => {
  const r = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved,
    capital: { availableCapitalUsd: 18_999.99, collateralPerContractUsd: 19_000 }, promotion: completePromotion() });
  assert.equal(r.state, 'APPROVED_NOT_CAPITAL_FIT');
  assert.equal(r.capacityContracts, 0);
  assert.equal(r.approvedForPaperBootstrap, true, 'approval is retained; only capital blocks');
  const exact = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved,
    capital: { availableCapitalUsd: 19_000, collateralPerContractUsd: 19_000 }, promotion: completePromotion() });
  assert.equal(exact.state, 'APPROVED_CAPITAL_FIT');
  assert.equal(exact.capacityContracts, 1);
});

test('a known capital shortfall is reported even when other data is also missing (more data cannot repair it)', () => {
  const r = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved,
    capital: { availableCapitalUsd: 100, collateralPerContractUsd: 19_000 } });
  assert.equal(r.state, 'APPROVED_NOT_CAPITAL_FIT');
  assert.ok(r.incompleteSlots.includes('identity'));
});

test('unknown capital is data-incomplete, never capital-fit and never coerced to zero capacity', () => {
  for (const capital of [{ availableCapitalUsd: null, collateralPerContractUsd: 19_000 },
    { availableCapitalUsd: 100_000, collateralPerContractUsd: null }, { availableCapitalUsd: Number.NaN, collateralPerContractUsd: 19_000 },
    { availableCapitalUsd: -5, collateralPerContractUsd: 19_000 }, { availableCapitalUsd: 100_000, collateralPerContractUsd: 0 },
    { availableCapitalUsd: 100_000, collateralPerContractUsd: -1 }]) {
    const r = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved, capital, promotion: completePromotion() });
    assert.equal(r.state, 'APPROVED_DATA_INCOMPLETE', JSON.stringify(capital));
    assert.equal(r.capacityContracts, null);
    assert.ok(r.incompleteSlots.includes('capitalFit'));
  }
});

test('every single missing or malformed promotion slot makes an approved instrument data-incomplete', () => {
  for (const field of instrumentPromotionContractFields) {
    if (field === 'capitalFit') continue;
    const variants: PromotionSlot[] = [
      { state: 'UNKNOWN', value: null, evidenceRef: null },
      { state: 'KNOWN', value: null, evidenceRef: 'e' },
      { state: 'KNOWN', value: 'v', evidenceRef: null },
      { state: 'KNOWN', value: 'v', evidenceRef: '   ' },
      { state: 'REQUIRED_NOT_PROVIDED', value: 'v', evidenceRef: 'e' },
      { state: 'OWNER_POLICY_REQUIRED', value: 'v', evidenceRef: 'e' },
    ];
    for (const slot of variants) {
      const r = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved, capital: richCapital,
        promotion: { ...completePromotion(), [field]: slot } });
      assert.equal(r.state, 'APPROVED_DATA_INCOMPLETE', `${field} ${JSON.stringify(slot)}`);
      assert.deepEqual(r.incompleteSlots, [field]);
    }
  }
});

test('omitting the promotion block entirely leaves every non-derived slot incomplete, with relative strength owner-policy-required', () => {
  const r = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved, capital: richCapital });
  assert.equal(r.state, 'APPROVED_DATA_INCOMPLETE');
  assert.equal(r.incompleteSlots.length, instrumentPromotionContractFields.length - 1);
  assert.equal(r.slots.relativeStrengthAvailability.state, 'OWNER_POLICY_REQUIRED');
  assert.equal(r.slots.capitalFit.state, 'KNOWN', 'capital fit is derived mechanically from supplied capital');
});

test('relative strength is never invented: a bare availability claim without a policy reference stays OWNER_POLICY_REQUIRED', () => {
  const claimed = { ...completePromotion(), relativeStrengthAvailability: { state: 'KNOWN', value: true, evidenceRef: null } as PromotionSlot };
  const r = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved, capital: richCapital, promotion: claimed });
  assert.equal(r.state, 'APPROVED_DATA_INCOMPLETE');
  assert.equal(r.slots.relativeStrengthAvailability.state, 'OWNER_POLICY_REQUIRED');
  assert.equal(r.slots.relativeStrengthAvailability.value, null);
  assert.deepEqual(r.incompleteSlots, ['relativeStrengthAvailability']);
});

test('the capitalFit slot cannot be supplied by the caller (it is derived, so a caller cannot claim a fit)', () => {
  const forged = { ...completePromotion(), capitalFit: known({ fits: true, capacityContracts: 99 }) };
  const r = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved,
    capital: { availableCapitalUsd: 1, collateralPerContractUsd: 19_000 }, promotion: forged as never });
  assert.equal(r.state, 'APPROVED_NOT_CAPITAL_FIT');
  assert.equal(r.capacityContracts, 0);
});

test('RESEARCH_ONLY dominates: an unapproved research row stays research, and an approved one flagged research is held research with a conflict flag', () => {
  const unapproved = classifyInstrumentEligibility({ symbol: 'LOWPX', discovered: true, researchOnly: true, approval: null,
    capital: richCapital, promotion: completePromotion() });
  assert.equal(unapproved.state, 'RESEARCH_ONLY');
  assert.equal(unapproved.approvedForPaperBootstrap, false);
  const conflict = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, researchOnly: true, approval: approved,
    capital: richCapital, promotion: completePromotion() });
  assert.equal(conflict.state, 'RESEARCH_ONLY');
  assert.equal(conflict.approvedForPaperBootstrap, false);
  assert.ok(conflict.reviewFlags.includes('RESEARCH_ONLY_LABEL_CONFLICTS_WITH_APPROVAL'));
});

test('leveraged or inverse instruments are flagged for owner review, not silently accepted or rejected', () => {
  const r = classifyInstrumentEligibility({ symbol: 'SPY', discovered: true, approval: approved, capital: richCapital,
    promotion: { ...completePromotion(), leveragedInverse: known(true) } });
  assert.ok(r.reviewFlags.includes('LEVERAGED_OR_INVERSE_REQUIRES_OWNER_REVIEW'));
});

test('the real approval manifest, not discovery, is the only approval source for the bounded SPY/TLT/XLE cohort', () => {
  const earnings = (state: string) => ({ state, evidenceId: null, thetaObservedAt: null }) as never;
  const asOf = '2026-10-05T00:00:00.000Z';
  const spy = classifyPaperInstrument({ symbol: 'SPY', decisionAsOf: asOf, earnings: earnings('UNKNOWN') });
  assert.equal(approvalAuthorityFromClassification(spy).paperBootstrapApproved, true);
  assert.deepEqual(paperInstrumentClassificationManifest.entries.map((entry) => entry.symbol), ['SPY', 'TLT', 'XLE']);
  for (const symbol of ['TLT', 'XLE'] as const) {
    const evidence = classifyPaperInstrument({ symbol, decisionAsOf: asOf, earnings: earnings('UNKNOWN') });
    assert.equal(evidence.state, 'NON_COMPANY_FUND', symbol);
    assert.equal(approvalAuthorityFromClassification(evidence).paperBootstrapApproved, true, symbol);
  }
  for (const [symbol, earn] of [['QQQ', 'UNKNOWN'], ['AAPL', 'KNOWN_POSITIVE_DISTANCE']] as const) {
    const evidence = classifyPaperInstrument({ symbol, decisionAsOf: asOf, earnings: earnings(earn) });
    const authority = approvalAuthorityFromClassification(evidence);
    assert.equal(authority.paperBootstrapApproved, false, symbol);
    const r = classifyInstrumentEligibility({ symbol, discovered: true, approval: authority, capital: richCapital, promotion: completePromotion() });
    assert.equal(r.state, 'DISCOVERED_NOT_APPROVED', symbol);
  }
  // A conflicting manifest/earnings classification is never an approval.
  const conflict = classifyPaperInstrument({ symbol: 'SPY', decisionAsOf: asOf, earnings: earnings('KNOWN_POSITIVE_DISTANCE') });
  assert.equal(conflict.state, 'CONFLICT');
  assert.equal(approvalAuthorityFromClassification(conflict).paperBootstrapApproved, false);
  // Manifest not yet effective at decision time is not an approval either.
  const early = classifyPaperInstrument({ symbol: 'SPY', decisionAsOf: '2026-01-01T00:00:00.000Z', earnings: earnings('UNKNOWN') });
  assert.equal(approvalAuthorityFromClassification(early).paperBootstrapApproved, false);
});

test('Optionomics-only company evidence proves company applicability only and is not an approval', () => {
  const evidence = classifyPaperInstrument({ symbol: 'MSFT', decisionAsOf: '2026-10-02T00:00:00.000Z',
    earnings: { state: 'KNOWN_POSITIVE_DISTANCE', evidenceId: 'e1', thetaObservedAt: '2026-10-01T00:00:00.000Z' } as never });
  assert.equal(evidence.state, 'OPERATING_COMPANY');
  assert.equal(approvalAuthorityFromClassification(evidence).paperBootstrapApproved, false);
});

test('universe discovery and universe policy source never reference the approval manifest or set an approval flag', () => {
  for (const path of ['src/theta/universe-discovery.ts', 'src/theta/universe-policy.ts']) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /paperInstrumentClassificationManifest|paperBootstrapApproved|classifyPaperInstrument/, path);
  }
});

test('the classifier module never defines a relative-strength formula', () => {
  const source = readFileSync('src/theta/instrument-eligibility-state.ts', 'utf8');
  assert.doesNotMatch(source, /benchmark|zscore|percentile|window\s*[:=]/i);
  assert.match(source, /OWNER_POLICY_REQUIRED/);
});
