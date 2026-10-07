import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBranchEconomicShadow } from '../src/theta/branch-economic-shadow.js';
import type { CanonicalBranchFrontier } from '../src/theta/canonical-strategy-frontier.js';
import type { NormalizedOptionContract } from '../src/theta/option-contract.js';

const contract = (symbol: string, strike: number, bid: number, ask: number, delta: number, iv = 0.3): NormalizedOptionContract =>
  ({ underlying: 'XYZ', optionSymbol: symbol, optionType: 'PUT', strike, expiration: '2026-11-20', dte: 30, multiplier: 100,
    bid, ask, delta, iv, volume: 100, openInterest: 500, underlyingReferencePrice: 100 }) as unknown as NormalizedOptionContract;
const leg = (c: NormalizedOptionContract, positionIntent: 'SELL_TO_OPEN' | 'BUY_TO_OPEN') => ({ positionIntent, optionSymbol: c.optionSymbol,
  optionType: 'PUT', strike: c.strike, expiration: c.expiration, multiplier: 100, bid: c.bid, ask: c.ask });
const candidate = (branch: string, id: string, legs: unknown[]) => ({ candidateId: id, branch, underlying: 'XYZ', legs, dte: 30,
  riskFeasible: true, sizing: { quantity: 1 } });
const frontierBranch = (branch: string, bestCandidateId: string, candidates: unknown[]) =>
  ({ branch, evaluated: true, bestCandidateId, candidates }) as unknown as CanonicalBranchFrontier;

const atm = contract('XYZ_P100', 100, 3.9, 4.0, -0.5);
const s95 = contract('XYZ_P95', 95, 1.9, 2.0, -0.3);
const s90 = contract('XYZ_P90', 90, 0.8, 0.9, -0.15);
const s85 = contract('XYZ_P85', 85, 0.3, 0.35, -0.07);

test('D is priced on BOTH legs (short bid - long ask) and ranked by credit per unit of defined max loss', () => {
  const narrow = candidate('THETA_DEFINED_RISK', 'D:A_95_90', [leg(s95, 'SELL_TO_OPEN'), leg(s90, 'BUY_TO_OPEN')]);
  const wide = candidate('THETA_DEFINED_RISK', 'D:B_95_85', [leg(s95, 'SELL_TO_OPEN'), leg(s85, 'BUY_TO_OPEN')]);
  const [record] = buildBranchEconomicShadow([frontierBranch('THETA_DEFINED_RISK', 'D:A_95_90', [narrow, wide])], [atm, s95, s90, s85]);
  assert.equal(record?.economicsEvaluatedCount, 2);
  const byId = new Map(record?.top.map((row) => [row.candidateId, row]));
  // 95/90: credit 1.9 - 0.9 = 1.0 -> max profit $100, max loss $400. 95/85: credit 1.9 - 0.35 = 1.55 -> $155 / $845.
  assert.equal(byId.get('D:A_95_90')?.maxProfitUsd, 100);
  assert.equal(byId.get('D:A_95_90')?.maxLossUsd, 400);
  assert.equal(byId.get('D:B_95_85')?.maxProfitUsd, 155);
  assert.equal(byId.get('D:B_95_85')?.maxLossUsd, 845);
  assert.equal(record?.authority, 'SHADOW_OBSERVATION_ONLY');
});

test('a D candidate missing its long leg is not evaluable (no single-leg proxy)', () => {
  const broken = candidate('THETA_DEFINED_RISK', 'D:broken', [leg(s95, 'SELL_TO_OPEN')]);
  const [record] = buildBranchEconomicShadow([frontierBranch('THETA_DEFINED_RISK', 'D:broken', [broken])], [s95]);
  assert.equal(record?.economicsEvaluatedCount, 0);
  assert.equal(record?.notEvaluableCount, 1);
  assert.equal(record?.economicBestCandidateId, null);
});

test('H ranks by cushion in implied moves first and records divergence from the structural best', () => {
  const near = candidate('THETA_HOLD_STRIKE', 'H:A_P95', [leg(s95, 'SELL_TO_OPEN')]);
  const far = candidate('THETA_HOLD_STRIKE', 'H:B_P85', [leg(s85, 'SELL_TO_OPEN')]);
  const [record] = buildBranchEconomicShadow([frontierBranch('THETA_HOLD_STRIKE', 'H:A_P95', [near, far])], [atm, s95, s85]);
  assert.equal(record?.economicBestCandidateId, 'H:B_P85');
  assert.equal(record?.structuralBestCandidateId, 'H:A_P95');
  assert.equal(record?.diverges, true);
});
