import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContractPathObservationReceipt, type ContractPathLegIdentity, type ContractPathQuoteObservation } from '../src/research/contract-path-observation-runtime.js';
import { adaptCommand5aObservation, projectToRawObservationBundleRow, hashAdaptedRow } from '../src/research/command5a-canonical-adapter.js';
import { runRealDataArrivalPipelineFromCommand5A } from '../src/research/real-data-arrival-harness.js';

const SOURCE_SHA = 'a'.repeat(40);
const WORKER_SHA = 'b'.repeat(40);
const SUBJECT_ID = 'c'.repeat(64);
const TARGET_AT = '2026-09-21T15:00:00Z';
const OBSERVED_AT = '2026-09-21T15:00:05Z';

function quote(overrides: Partial<ContractPathQuoteObservation> & { optionSymbol: string }): ContractPathQuoteObservation {
  return {
    bid: 2.0, ask: 2.10, providerTimestamp: '2026-09-21T15:00:00Z', receivedAt: OBSERVED_AT,
    impliedVolatility: 0.28, delta: -0.2, gamma: 0.01, theta: -0.05, vega: 0.1,
    provider: 'ALPACA', feed: 'OPRA', quality: 'GOOD', reasonCodes: [],
    ...overrides,
  };
}

const underlying = {
  symbol: 'SPY', price: 590.12, providerTimestamp: '2026-09-21T15:00:00Z', receivedAt: OBSERVED_AT,
  provider: 'ALPACA' as const, purpose: 'RESEARCH_REFERENCE_ONLY' as const,
};

test('CORE CLAIM: a real Q (single-leg) Command 5A observation adapts into research evidence with a real mark, traceable to the source', () => {
  const leg: ContractPathLegIdentity = { optionSymbol: 'SPY251017P00590000', side: 'SHORT', optionType: 'PUT', expiration: '2026-10-17', strike: 590, multiplier: 100 };
  const receipt = buildContractPathObservationReceipt({
    observationJobId: 'job-q-1', subjectId: SUBJECT_ID, checkpoint: '1H', targetAt: TARGET_AT, actualObservedAt: OBSERVED_AT,
    expectedLegs: [leg], quotes: [quote({ optionSymbol: leg.optionSymbol })], underlying, sourceSha: SOURCE_SHA, workerSha: WORKER_SHA,
  });
  const adapted = adaptCommand5aObservation({
    receipt, legIdentities: [{ optionSymbol: leg.optionSymbol, side: 'SHORT' }],
    subject: { subjectId: SUBJECT_ID, wasSelected: true, wasShadowOnly: true },
  });
  assert.equal(adapted.checkpoint, '1H');
  assert.equal(adapted.mark.packageMark, 2.05);
  assert.equal(adapted.completeness.outcome, 'ACCEPTED');
  assert.equal(adapted.sourceObservation, receipt); // verbatim, never rebuilt
  assert.equal(adapted.sourceSha, SOURCE_SHA);
  assert.ok(hashAdaptedRow(adapted).length === 64);

  const projected = projectToRawObservationBundleRow(adapted);
  assert.equal(projected.checkpoint, '1H');
  assert.equal(projected.marketMarkPrice, 2.05);
  assert.equal(projected.provenance, 'REAL_SCHEDULED_OBSERVATION');
});

test('CORE CLAIM: a real D (two-leg) observation preserves package economics through the adapter, never leg-averaged', () => {
  const shortLeg: ContractPathLegIdentity = { optionSymbol: 'SPY251017P00590000', side: 'SHORT', optionType: 'PUT', expiration: '2026-10-17', strike: 590, multiplier: 100 };
  const longLeg: ContractPathLegIdentity = { optionSymbol: 'SPY251017P00580000', side: 'LONG', optionType: 'PUT', expiration: '2026-10-17', strike: 580, multiplier: 100 };
  const receipt = buildContractPathObservationReceipt({
    observationJobId: 'job-d-1', subjectId: SUBJECT_ID, checkpoint: 'EOD', targetAt: TARGET_AT, actualObservedAt: OBSERVED_AT,
    expectedLegs: [shortLeg, longLeg],
    quotes: [
      quote({ optionSymbol: shortLeg.optionSymbol, bid: 3.0, ask: 3.10, impliedVolatility: 0.30 }),
      quote({ optionSymbol: longLeg.optionSymbol, bid: 1.0, ask: 1.05, impliedVolatility: 0.32 }),
    ],
    underlying, sourceSha: SOURCE_SHA, workerSha: WORKER_SHA,
  });
  const adapted = adaptCommand5aObservation({
    receipt, legIdentities: [{ optionSymbol: shortLeg.optionSymbol, side: 'SHORT' }, { optionSymbol: longLeg.optionSymbol, side: 'LONG' }],
    subject: { subjectId: SUBJECT_ID, wasSelected: false, wasShadowOnly: true },
  });
  assert.equal(adapted.mark.markType, 'DEFINED_RISK_PACKAGE_MID');
  assert.equal(adapted.mark.shortLegImpliedVolatility, 0.30);
  assert.equal(adapted.mark.longLegImpliedVolatility, 0.32);
  assert.equal(adapted.wasSelected, false);
});

test('ADVERSARIAL: an economically-incomplete adapted row (real producer/provider gap) is rejected by projectToRawObservationBundleRow, never silently passed through as null', () => {
  const leg: ContractPathLegIdentity = { optionSymbol: 'A', side: 'SHORT', optionType: 'PUT', expiration: '2026-10-17', strike: 590, multiplier: 100 };
  const receipt = buildContractPathObservationReceipt({
    observationJobId: 'job-q-2', subjectId: SUBJECT_ID, checkpoint: '15M', targetAt: TARGET_AT, actualObservedAt: OBSERVED_AT,
    expectedLegs: [leg], quotes: [quote({ optionSymbol: 'A', bid: null, ask: null })],
    underlying: { ...underlying, price: null }, sourceSha: SOURCE_SHA, workerSha: WORKER_SHA,
  });
  const adapted = adaptCommand5aObservation({
    receipt, legIdentities: [{ optionSymbol: 'A', side: 'SHORT' }],
    subject: { subjectId: SUBJECT_ID, wasSelected: true, wasShadowOnly: true },
  });
  assert.equal(adapted.completeness.outcome, 'DATASET_INCOMPLETE');
  assert.throws(() => projectToRawObservationBundleRow(adapted), /COMMAND5A_ADAPTER_DATASET_INCOMPLETE/);
});

test('CORE CLAIM (gap 5/12): the real-data-arrival harness consumes a real Command 5A receipt through the SAME canonical adapter end to end', () => {
  const leg: ContractPathLegIdentity = { optionSymbol: 'A', side: 'SHORT', optionType: 'PUT', expiration: '2026-10-17', strike: 590, multiplier: 100 };
  const receipt = buildContractPathObservationReceipt({
    observationJobId: 'job-q-3', subjectId: SUBJECT_ID, checkpoint: '1H', targetAt: TARGET_AT, actualObservedAt: OBSERVED_AT,
    expectedLegs: [leg], quotes: [quote({ optionSymbol: 'A' })], underlying, sourceSha: SOURCE_SHA, workerSha: WORKER_SHA,
  });
  const result = runRealDataArrivalPipelineFromCommand5A({
    bundleId: 'bundle-1', decisionAt: TARGET_AT, subject: { subjectId: SUBJECT_ID, wasSelected: true, wasShadowOnly: true },
    observations: [{ receipt, legIdentities: [{ optionSymbol: 'A', side: 'SHORT' }] }],
  });
  assert.equal(result.schemaValid, true);
  assert.equal(result.pitValid, true);
  assert.ok(result.dataset !== null);
  assert.equal(result.dataset?.path[0]?.marketMarkPath, 2.05);
});
