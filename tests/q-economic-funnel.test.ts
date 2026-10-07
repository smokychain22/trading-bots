import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildQEconomicFunnelReceipt } from '../src/theta/q-economic-funnel.js';
import type { NormalizedOptionContract } from '../src/theta/option-contract.js';
import { paperBootstrapRuntimePolicy as P } from '../src/theta/paper-bootstrap-runtime-policy.js';

// Real decision-time chain of the first Paper fill (XLE, 2026-10-07 13:32:07Z), recovered from the THETA cycle archive:
// the 124 Q-window puts the Q branch saw, market-data fields only.
const fixture = JSON.parse(readFileSync('tests/fixtures/xle-2026-10-07-q-decision-chain.json', 'utf8')) as {
  readonly structuralFinalistSymbols: readonly string[];
  readonly qEvaluationStateCounts: Readonly<Record<string, number>>;
  readonly contracts: readonly Record<string, unknown>[];
};
const contracts = fixture.contracts.map((c) => ({ ...c, underlying: 'XLE' })) as unknown as NormalizedOptionContract[];
const lattice = { minDte: P.conventional.minimumDte, maxDte: P.conventional.maximumDte, deltaBands: P.conventional.deltaBands,
  minOpenInterest: P.conventional.minimumOpenInterest, minVolume: P.conventional.minimumVolume, maxSpreadPct: P.conventional.maximumSpreadPct };
const receipt = (topK: number) => buildQEconomicFunnelReceipt({ underlying: 'XLE', contracts, latticeConfig: lattice,
  structuralFinalistSymbols: new Set(fixture.structuralFinalistSymbols), topK, stressGapPct: P.aegis.stressGapThresholdAbsoluteReturn });

test('BC: the XLE 124-candidate funnel is counted stage by stage, with no silent 124 -> 4 collapse', () => {
  assert.equal(contracts.length, 124);
  assert.equal(Object.values(fixture.qEvaluationStateCounts).reduce((a, b) => a + b, 0), 124);
  const r = receipt(5);
  assert.deepEqual(r.stages, {
    RAW_CONTRACTS: 124, PUT_QUOTED: 93, DTE_VALID: 93, DELTA_BAND_VALID: 48, LIQUIDITY_VALID: 11, CAPITAL_VALID: 11,
    EVENT_VALID: 'NOT_EVALUATED_BEFORE_SHORTLIST', OWNERSHIP_VALID: 'NOT_EVALUATED_BEFORE_SHORTLIST', AEGIS_VALID: 'NOT_EVALUATED_BEFORE_SHORTLIST',
    ECONOMICS_EVALUATED: 11, ECONOMICS_COMPLETE: 11, STRUCTURAL_FINALISTS: 5,
  });
  // Every hard-filter survivor is economically evaluated -- not only the structural finalists.
  assert.equal(receipt(500).economicTopK.length, 11);
  assert.equal(r.authority, 'SHADOW_OBSERVATION_ONLY');
});

test('BC: the economic order is never the OCC order, and the fill (57P) is not the economic leader on the real chain', () => {
  const all = receipt(500).economicTopK;
  const ids = all.map((c) => c.candidateId);
  assert.notDeepEqual(ids, ids.toSorted());
  assert.ok(all.every((c) => c.decidedBy !== 'EXACT_ECONOMIC_TIE_CANDIDATE_ID' || c === all[all.length - 1]));
  const rankOf = (id: string) => all.find((c) => c.candidateId === id)?.economicRank;
  assert.ok((rankOf('XLE261120P00057000') as number) > (rankOf('XLE261120P00063000') as number));
  // On one expiry every survivor is Pareto-efficient: premium and cushion trade off monotonically. Choosing among them is a
  // risk preference (owner hurdle or calibrated EV), which is why ENFORCED stays locked without both.
  assert.ok(all.every((c) => c.paretoRank === 1));
  // A structural finalist that fails a hard filter is reported, not ranked.
  assert.ok(!ids.includes('XLE261106P00060000'));
  assert.ok(receipt(5).economicTopKExcludedByStructuralShortlist.length > 0);
});
