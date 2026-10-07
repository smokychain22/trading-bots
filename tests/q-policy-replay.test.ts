import assert from 'node:assert/strict';
import test from 'node:test';
import { blackScholesPut, impliedPutVolatility } from '../src/research/q-policy-replay/black-scholes.js';
import {
  buildDecisionCandidates, runSequentialPolicy, selectCurrentQ, selectEconomicQ, simulateExit, splitAdjustedCloses,
  type ContractHistory, type DecisionPoint, type ReplayAssumptions, type ReplayCandidate, type UnderlyingHistory,
} from '../src/research/q-policy-replay/replay-engine.js';
import { bucketKeys, chooseProfiles, computePolicyMetrics, inSampleEpisodes, oosEpisodes, realizedVolatilityAt } from '../src/research/q-policy-replay/replay-metrics.js';

// Synthetic fixtures only (no market data in git).
const A: ReplayAssumptions = {
  riskFreeRate: 0.045, halfSpread: (mid) => Math.max(0.01, 0.03 * mid), halfSpreadModelId: 'TEST', feePerContractSide: 0.05,
  multiplier: 100, accountEquityUsd: null, hardTickerCapPct: 0.225,
  lattice: { minDte: 25, maxDte: 60, deltaBands: [[0, 0.25], [0.25, 0.5]], minVolume: 10, maxSpreadPct: 0.15 },
  stressGapPct: 0.05, pricingMode: 'CLOSE',
};
const dates = (start: string, n: number): string[] => {
  const out: string[] = []; let t = Date.parse(`${start}T00:00:00Z`);
  while (out.length < n) { const d = new Date(t); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10)); t += 86_400_000; }
  return out;
};
const history = (closes: number[]): UnderlyingHistory => ({ symbol: 'XYZ', dates: dates('2025-01-06', closes.length), closes });
const contract = (symbol: string, strike: number, expiration: string, bars: Record<string, number>): ContractHistory =>
  ({ symbol, strike, expiration, bars: new Map(Object.entries(bars).map(([d, c]) => [d, { close: c, volume: 100, high: c * 1.2, low: c * 0.8 }])) });

test('Black-Scholes: IV inversion round-trips and Greeks have the right signs', () => {
  const g = blackScholesPut(100, 95, 40 / 365, 0.3, 0.045);
  const iv = impliedPutVolatility(g.price, 100, 95, 40 / 365, 0.045);
  assert.ok(iv !== null && Math.abs(iv - 0.3) < 1e-4);
  assert.ok(g.delta < 0 && g.delta > -0.5 && g.gamma > 0 && g.thetaPerDay < 0 && g.vega > 0);
  assert.equal(impliedPutVolatility(0.5, 100, 110, 40 / 365, 0.045), null); // below intrinsic: never coerced
});

test('split adjustment rescales history before a 2:1 split only', () => {
  assert.deepEqual(splitAdjustedCloses([90, 92, 46, 47]), [45, 46, 46, 47]);
});

// 40 trading days; expiry on the 30th trading day.
const closesUp = Array.from({ length: 40 }, (_, i) => 100 + i * 0.1);
const hUp = history(closesUp);
const expiry = hUp.dates[29] as string;
const optionBars = (h: UnderlyingHistory, start: number, end: number, price: (i: number) => number) =>
  Object.fromEntries(h.dates.slice(start, end).map((d, k) => [d, price(start + k)]));

function candidateFor(h: UnderlyingHistory, c: ContractHistory, index: number): ReplayCandidate {
  const [cand] = buildDecisionCandidates({ underlying: 'XYZ', date: h.dates[index] as string, spot: h.closes[index] as number, contracts: [c],
    assumptions: { ...A, lattice: { ...A.lattice, minDte: 1 } } });
  return cand as ReplayCandidate;
}

test('expiry settlement: OTM keeps the credit; ITM is assignment marked at the expiry close', () => {
  const otm = contract('XYZ_P95', 95, expiry, optionBars(hUp, 0, 29, () => 1.0));
  const cand = candidateFor(hUp, otm, 0);
  const r = simulateExit({ underlying: hUp, contract: otm, candidate: cand, entryDate: hUp.dates[0] as string, policy: { id: 'HOLD' }, assumptions: A, regime: 'X' });
  assert.equal(r.state, 'CLOSED');
  if (r.state === 'CLOSED') { assert.equal(r.episode.exitReason, 'EXPIRED_OTM'); assert.ok(Math.abs(r.episode.pnl - ((1 - 0.03) * 100 - 0.05)) < 1e-9); }
  const closesDown = Array.from({ length: 40 }, (_, i) => 100 - i * 0.5);
  const hDown = history(closesDown);
  const itm = contract('XYZ_P95', 95, hDown.dates[29] as string, optionBars(hDown, 0, 29, (i) => Math.max(1, 95 - (100 - i * 0.5) + 0.5)));
  const c2 = candidateFor(hDown, itm, 0);
  const r2 = simulateExit({ underlying: hDown, contract: itm, candidate: c2, entryDate: hDown.dates[0] as string, policy: { id: 'HOLD' }, assumptions: A, regime: 'X' });
  assert.equal(r2.state === 'CLOSED' && r2.episode.exitReason, 'ASSIGNED_AT_EXPIRY');
  assert.equal(r2.state === 'CLOSED' && r2.episode.assigned, true);
  // spot at expiry = 100 - 29*0.5 = 85.5 -> intrinsic 9.5
  if (r2.state === 'CLOSED') assert.ok(Math.abs(r2.episode.pnl - ((c2.creditPerShare - 9.5) * 100 - 0.05)) < 1e-6);
});

test('exit policies trigger on synthetic paths: profit capture, premium multiple, DTE exit, below breakeven', () => {
  const decaying = contract('XYZ_P95', 95, expiry, optionBars(hUp, 0, 29, (i) => Math.max(0.05, 1 - i * 0.05)));
  const cand = candidateFor(hUp, decaying, 0);
  const run = (policy: Parameters<typeof simulateExit>[0]['policy']) => simulateExit({ underlying: hUp, contract: decaying, candidate: cand,
    entryDate: hUp.dates[0] as string, policy, assumptions: A, regime: 'X' });
  const fixed50 = run({ id: 'F50', profitCapture: 0.5 });
  assert.equal(fixed50.state === 'CLOSED' && fixed50.episode.exitReason, 'PROFIT_CAPTURE');
  assert.ok(fixed50.state === 'CLOSED' && fixed50.episode.pnl > 0);
  const dte = run({ id: 'DTE', dteExit: 21 });
  assert.equal(dte.state === 'CLOSED' && dte.episode.exitReason, 'DTE_EXIT');
  const rising = contract('XYZ_P95', 95, expiry, optionBars(hUp, 0, 29, (i) => 1 + i * 0.3));
  const c2 = candidateFor(hUp, rising, 0);
  const risk = simulateExit({ underlying: hUp, contract: rising, candidate: c2, entryDate: hUp.dates[0] as string, policy: { id: 'R2', premiumMultiple: 2 }, assumptions: A, regime: 'X' });
  assert.equal(risk.state === 'CLOSED' && risk.episode.exitReason, 'PREMIUM_MULTIPLE');
  assert.ok(risk.state === 'CLOSED' && risk.episode.pnl < 0);
  const hFall = history(Array.from({ length: 40 }, (_, i) => 100 - i * 0.4));
  const be = contract('XYZ_P97', 97, hFall.dates[29] as string, optionBars(hFall, 0, 29, () => 1));
  const c3 = candidateFor(hFall, be, 0);
  const below = simulateExit({ underlying: hFall, contract: be, candidate: c3, entryDate: hFall.dates[0] as string, policy: { id: 'BE', belowBreakeven: true }, assumptions: A, regime: 'X' });
  assert.equal(below.state === 'CLOSED' && below.episode.exitReason, 'BELOW_BREAKEVEN');
});

test('adverse-extreme pricing sells at the low and buys back at the high', () => {
  const c = contract('XYZ_P95', 95, expiry, optionBars(hUp, 0, 29, () => 1.0));
  const [base] = buildDecisionCandidates({ underlying: 'XYZ', date: hUp.dates[0] as string, spot: 100, contracts: [c], assumptions: A });
  const [stress] = buildDecisionCandidates({ underlying: 'XYZ', date: hUp.dates[0] as string, spot: 100, contracts: [c], assumptions: { ...A, pricingMode: 'ADVERSE_EXTREME' } });
  assert.ok((stress as ReplayCandidate).creditPerShare < (base as ReplayCandidate).creditPerShare);
});

test('censoring: an episode whose expiry is after the data end is never counted (no phantom win)', () => {
  const short = history(closesUp.slice(0, 10));
  const c = contract('XYZ_P95', 95, expiry, optionBars(short, 0, 10, () => 1.0));
  const decisions: DecisionPoint[] = [{ date: short.dates[0] as string, spot: 100, regime: 'X',
    candidates: [candidateFor(short, c, 0)] }];
  const r = runSequentialPolicy({ underlying: short, decisions, contractsBySymbol: new Map([[c.symbol, c]]), select: (cands) => cands[0] ?? null,
    exit: { id: 'HOLD' }, assumptions: A });
  assert.equal(r.censored, 1);
  assert.equal(r.episodes.length, 0);
  assert.equal(computePolicyMetrics(r.episodes).n, 0);
});

test('sequential policy never overlaps positions on one underlying', () => {
  const c = contract('XYZ_P95', 95, expiry, optionBars(hUp, 0, 29, () => 1.0));
  const decisions: DecisionPoint[] = [0, 5, 10, 31].map((i) => ({ date: hUp.dates[i] as string, spot: hUp.closes[i] as number, regime: 'X',
    candidates: i < 29 ? [candidateFor(hUp, c, i)] : [] }));
  const r = runSequentialPolicy({ underlying: hUp, decisions, contractsBySymbol: new Map([[c.symbol, c]]), select: (cands) => cands[0] ?? null,
    exit: { id: 'HOLD' }, assumptions: A });
  assert.equal(r.episodes.length, 1); // decisions on days 5 and 10 are skipped while the day-0 position is open
  assert.equal(r.waits, 1); // day 31 had no candidate
});

test('CURRENT_Q emulation ends in OCC lexical order among the Pareto front; economic selection does not', () => {
  const h = history(Array.from({ length: 40 }, () => 100));
  const exp = h.dates[35] as string;
  const mk = (sym: string, k: number, px: number) => contract(sym, k, exp, optionBars(h, 0, 30, () => px));
  const cands = buildDecisionCandidates({ underlying: 'XYZ', date: h.dates[0] as string, spot: 100,
    contracts: [mk('XYZ_A_P90', 90, 0.35), mk('XYZ_B_P96', 96, 1.6)], assumptions: { ...A, lattice: { ...A.lattice, minDte: 1 } } });
  assert.equal(selectCurrentQ(cands, { ...A, lattice: { ...A.lattice, minDte: 1 } })?.symbol, 'XYZ_A_P90');
  const econ = selectEconomicQ(cands, null);
  assert.ok(econ !== null);
  const capped = selectEconomicQ(cands, { id: 't', minCushionSigmas: null, maxAbsDelta: 0.01, minRewardToStress: null });
  assert.equal(capped, null); // profile floors can produce WAIT
});

test('profile selection reads only in-sample evidence; OOS outcomes cannot influence it', () => {
  const ep = (entry: string, exit: string, pnl: number) => ({ underlying: 'XYZ', symbol: `S${entry}${exit}${pnl}`, entryDate: entry, exitDate: exit,
    exitReason: 'EXPIRED_OTM' as const, pnl, capital: 1000, holdDays: 10, capitalDays: 10_000, roc: pnl / 1000, assigned: false,
    modelPricedExit: false, modeledSlippage: 0, maeUsd: Math.min(0, pnl), features: { absDelta: 0.2, iv: 0.3, dte: 40, cushionSigmas: 1, regime: 'X' } });
  const plan = { trainEnd: '2025-02-28', validationEnd: '2025-08-31' };
  const eps = [ep('2025-01-01', '2025-02-01', 10), ep('2025-08-20', '2025-09-15', -500), ep('2025-10-01', '2025-11-01', 999)];
  assert.deepEqual(inSampleEpisodes(eps, plan).map((e) => e.pnl), [10]); // exit after validation end is excluded too
  assert.deepEqual(oosEpisodes(eps, plan).map((e) => e.pnl), [999]);
  const good = Array.from({ length: 25 }, (_, i) => ep(`2024-0${1 + (i % 9)}-1${i % 9}`, `2024-0${1 + (i % 9)}-2${i % 9}`, 5 + i));
  const choices = chooseProfiles([{ policyId: 'P1', inSample: computePolicyMetrics(good) }]);
  assert.ok(choices.every((c) => c.policyId === 'P1'));
  assert.ok(chooseProfiles([{ policyId: 'P1', inSample: computePolicyMetrics(good.slice(0, 5)) }]).every((c) => c.policyId === null));
});

test('profit capture never fires on a model-priced (no-trade) day: theta at constant IV cannot fake a capture', () => {
  // Bars only on the entry day: every later day is model-priced; FIXED_25 must not close before expiry.
  const c = contract('XYZ_P95', 95, expiry, optionBars(hUp, 0, 1, () => 1.0));
  const cand = candidateFor(hUp, c, 0);
  const r = simulateExit({ underlying: hUp, contract: c, candidate: cand, entryDate: hUp.dates[0] as string, policy: { id: 'F25', profitCapture: 0.25 }, assumptions: A, regime: 'X' });
  assert.equal(r.state === 'CLOSED' && r.episode.exitReason, 'EXPIRED_OTM');
  // A risk/time exit may still use a model price, and is labelled.
  const t = simulateExit({ underlying: hUp, contract: c, candidate: cand, entryDate: hUp.dates[0] as string, policy: { id: 'DTE', dteExit: 21 }, assumptions: A, regime: 'X' });
  assert.equal(t.state === 'CLOSED' && t.episode.modelPricedExit, true);
});

test('the stress gate rejects a policy whose in-sample edge disappears under execution stress', () => {
  const ep = (i: number, pnl: number) => ({ underlying: 'XYZ', symbol: `S${i}`, entryDate: `2024-0${1 + (i % 9)}-0${1 + (i % 9)}`,
    exitDate: `2024-0${1 + (i % 9)}-1${i % 9}`, exitReason: 'EXPIRED_OTM' as const, pnl, capital: 1000, holdDays: 10, capitalDays: 10_000,
    roc: pnl / 1000, assigned: false, modelPricedExit: false, modeledSlippage: 0, maeUsd: Math.min(0, pnl),
    features: { absDelta: 0.2, iv: 0.3, dte: 40, cushionSigmas: 1, regime: 'X' } });
  const base = computePolicyMetrics(Array.from({ length: 25 }, (_, i) => ep(i, 10)));
  const stressedNegative = computePolicyMetrics(Array.from({ length: 25 }, (_, i) => ep(i, i % 2 === 0 ? -30 : 10)));
  assert.ok(chooseProfiles([{ policyId: 'FRAGILE', inSample: base, inSampleStress: [stressedNegative] }]).every((c) => c.policyId === null));
  assert.ok(chooseProfiles([{ policyId: 'ROBUST', inSample: base, inSampleStress: [base] }]).every((c) => c.policyId === 'ROBUST'));
});

test('path risk: a no-stop position that recovers records its maximum adverse excursion, and selection sees it', () => {
  // Price spikes (loss) then decays (recovery): realized P&L is positive, MAE is negative.
  const c = contract('XYZ_P95', 95, expiry, optionBars(hUp, 0, 29, (i) => i < 5 ? 1 + i * 0.6 : Math.max(0.05, 3 - (i - 5) * 0.2)));
  const cand = candidateFor(hUp, c, 0);
  const r = simulateExit({ underlying: hUp, contract: c, candidate: cand, entryDate: hUp.dates[0] as string, policy: { id: 'HOLD' }, assumptions: A, regime: 'X' });
  assert.ok(r.state === 'CLOSED' && r.episode.pnl > 0 && r.episode.maeUsd < -150);
  const m = computePolicyMetrics(r.state === 'CLOSED' ? [r.episode] : []);
  assert.ok(m.expectedShortfall5Roc !== null && m.expectedShortfall5Roc > 0);
  assert.ok(m.expectedShortfall5MaeRoc !== null && m.expectedShortfall5MaeRoc < 0);
});

test('reporting reconciles gross P&L to net P&L and exposes PIT IV/RV plus sector buckets', () => {
  const h = { ...history(Array.from({ length: 50 }, (_, index) => 100 + index * 0.2 + (index % 2 === 0 ? 1 : -1))),
    sector: 'TEST_SECTOR' };
  const rv = realizedVolatilityAt(h, h.closes.length - 1);
  assert.ok(rv !== null && rv > 0);
  const c = contract('XYZ_P95', 95, h.dates[29] as string, optionBars(h, 0, 29, (index) => Math.max(0.2, 2 - index * 0.04)));
  const candidate = buildDecisionCandidates({ underlying: 'XYZ', date: h.dates[0] as string, spot: 100, contracts: [c], assumptions: A,
    realizedVolatility: 0.2 })[0] as ReplayCandidate;
  assert.equal(candidate.ivToRvRatio, candidate.iv === null ? null : candidate.iv / 0.2);
  const result = simulateExit({ underlying: h, contract: c, candidate, entryDate: h.dates[0] as string,
    policy: { id: 'HOLD' }, assumptions: A, regime: 'TEST' });
  assert.equal(result.state, 'CLOSED');
  if (result.state !== 'CLOSED') return;
  assert.ok(Math.abs(result.episode.grossPnl - result.episode.modeledCosts - result.episode.pnl) < 1e-9);
  assert.equal(bucketKeys.sector(result.episode), 'TEST_SECTOR');
  assert.notEqual(bucketKeys.ivRv(result.episode), 'UNKNOWN');
  const metrics = computePolicyMetrics([result.episode]);
  assert.ok(Math.abs(metrics.grossPnl - metrics.modeledCosts - metrics.totalPnl) < 1e-9);
});
