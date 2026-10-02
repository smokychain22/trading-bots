import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { applyCompanyEventPaperPolicy, type CompanyEventPaperPolicyDecision } from '../src/theta/paper-entry-safety-policy.js';
import type { InstrumentClassificationEvidence } from '../src/theta/paper-entry-safety-policy.js';
import type { OptionomicsEarningsEvidence } from '../src/theta/earnings-event-evidence.js';
import type { MacroRiskEvidence } from '../src/theta/macro-event-policy.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { paperBootstrapRuntimePolicy } from '../src/theta/paper-bootstrap-runtime-policy.js';
import { qEntryFunnelPolicyFromRuntimePolicy, qGates } from '../src/theta/q-entry-funnel.js';
import { parseThetaQResponse } from '../src/theta/theta-q-contract.js';

// Phase 2 area Q: epsilon-below / exact / epsilon-above boundary tests for every
// numeric Q threshold, executed against the REAL Python lattice + baseline and
// against the TypeScript gate semantics that the funnel receipt uses, so that
// the two cannot silently diverge. Synthetic data only.

const python = [process.env.PYTHON_EXECUTABLE_FOR_TESTS, 'C:\\Users\\hp\\AppData\\Local\\Programs\\Python\\Python312\\python.exe']
  .filter((candidate): candidate is string => candidate !== undefined).find((candidate) => existsSync(candidate)) ?? 'python';
const script = path.resolve('bots/theta/quant/runtime/theta_q_contract.py');
const hasPython = spawnSync(python, ['--version']).status === 0;
const pythonTest = hasPython ? test : test.skip;
const HASH = 'a'.repeat(64);
const conv = paperBootstrapRuntimePolicy.conventional;
const policy = qEntryFunnelPolicyFromRuntimePolicy();

const lattice = {
  configVersion: 'lattice-boundary', minDte: conv.minimumDte, maxDte: conv.maximumDte,
  deltaBands: conv.deltaBands.map((band) => [...band]), minOpenInterest: conv.minimumOpenInterest, minVolume: conv.minimumVolume,
  maxSpreadPct: conv.maximumSpreadPct, earningsExclusionDays: conv.earningsExclusionDays,
};
const sizingPolicy = {
  riskLimitVersion: 'risk-boundary', maxSpreadPct: conv.maximumSpreadPct,
  maxQuoteAgeSeconds: paperBootstrapRuntimePolicy.quoteAge.candidateMaximumSeconds, minOpenInterest: conv.minimumOpenInterest,
  minVolume: conv.minimumVolume, earningsExclusionDays: conv.earningsExclusionDays, ownershipAcceptabilityFloor: 0.3,
  exceptionalUtilityThreshold: 0.9, strongUtilityThreshold: 0.7, minimumPositiveEdge: 0.05,
  riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5,
};
const cost = { commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 1.0, costModelVersion: 'cost-boundary' };
const baseCandidate = {
  candidateId: 'c1', underlyingSymbol: 'SPY', dte: 40, strike: 500, putDeltaMagnitude: 0.2, spreadPct: 0.05,
  quoteAgeSeconds: 5, openInterest: 500, volume: 100, earningsDistanceDays: null, multiplier: 100,
  entryPremiumPerShare: 2, ownershipAcceptability: 0.6, severeDrawdownProbability: 0.1, ivRank: 0.4,
  brokerAllowedQty: 3, contractIsStandard: true,
};

function runQ(candidate: Record<string, unknown>, options: { lattice?: Record<string, unknown>; sizing?: Record<string, unknown> } = {}) {
  const request = {
    contractVersion: 'theta-q-runtime-v1', operation: 'evaluateCspCandidates', fusionSnapshotHash: HASH,
    latticeConfig: { ...lattice, ...options.lattice }, sizingPolicy: { ...sizingPolicy, ...options.sizing },
    costAssumptions: cost, candidates: [{ ...baseCandidate, ...candidate }],
  };
  const run = spawnSync(python, [script], { input: JSON.stringify(request), encoding: 'utf8', timeout: 20_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const response = parseThetaQResponse(JSON.parse(run.stdout), HASH);
  const only = response.candidates[0];
  assert.ok(only);
  return { feasible: only.actionFeasible, quantity: only.quantity, codes: only.reasons.map((reason) => reason.code), only };
}

type Boundary = { name: string; field: string; below: number; exact: number; above: number; code: string;
  /** which side of `exact` is the failing side */ failing: 'below' | 'above'; };

const boundaries: Boundary[] = [
  { name: 'DTE min', field: 'dte', below: conv.minimumDte - 1, exact: conv.minimumDte, above: conv.minimumDte + 1, code: 'DTE_OUTSIDE_LATTICE', failing: 'below' },
  { name: 'DTE max', field: 'dte', below: conv.maximumDte - 1, exact: conv.maximumDte, above: conv.maximumDte + 1, code: 'DTE_OUTSIDE_LATTICE', failing: 'above' },
  { name: 'open interest', field: 'openInterest', below: conv.minimumOpenInterest - 1, exact: conv.minimumOpenInterest, above: conv.minimumOpenInterest + 1, code: 'OPEN_INTEREST_BELOW_FLOOR', failing: 'below' },
  { name: 'volume', field: 'volume', below: conv.minimumVolume - 1, exact: conv.minimumVolume, above: conv.minimumVolume + 1, code: 'VOLUME_BELOW_FLOOR', failing: 'below' },
  { name: 'spread (fraction)', field: 'spreadPct', below: conv.maximumSpreadPct - 1e-9, exact: conv.maximumSpreadPct, above: conv.maximumSpreadPct + 1e-9, code: 'SPREAD_TOO_WIDE', failing: 'above' },
  { name: 'quote age', field: 'quoteAgeSeconds', below: 30 - 0.001, exact: 30, above: 30.001, code: 'QUOTE_STALE', failing: 'above' },
  { name: 'earnings exclusion', field: 'earningsDistanceDays', below: conv.earningsExclusionDays - 1, exact: conv.earningsExclusionDays, above: conv.earningsExclusionDays + 1, code: 'EARNINGS_TOO_NEAR', failing: 'below' },
];

for (const boundary of boundaries) {
  pythonTest(`${boundary.name}: epsilon below / exact / epsilon above against the real Python Q, and TS gate parity`, () => {
    const outcome = (value: number) => runQ({ [boundary.field]: value });
    for (const [label, value] of [['below', boundary.below], ['exact', boundary.exact], ['above', boundary.above]] as const) {
      const result = outcome(value);
      // Inclusive gates: the exact boundary value PASSES, except earnings where the exact value BLOCKS (<=).
      const expectFail = boundary.field === 'earningsDistanceDays'
        ? value <= conv.earningsExclusionDays
        : boundary.failing === 'below' ? value < boundary.exact : value > boundary.exact;
      assert.equal(result.feasible, !expectFail, `${boundary.name} ${label}=${value}: ${result.codes.join(',')}`);
      assert.equal(result.codes.includes(boundary.code), expectFail, `${boundary.name} ${label}=${value} reason ${boundary.code}`);
      assert.ok(result.quantity === 0 || result.feasible);
    }
    // TypeScript funnel gate agrees with Python at all three points.
    const tsVerdict = (value: number): string => {
      switch (boundary.field) {
        case 'dte': return qGates.dte(value, policy).verdict;
        case 'openInterest': return qGates.openInterest(value, policy).verdict;
        case 'volume': return qGates.volume(value, policy).verdict;
        case 'spreadPct': return qGates.spread(value, policy).verdict;
        case 'quoteAgeSeconds': return qGates.quoteAge(value, policy).verdict;
        default: return qGates.earnings(value, policy).verdict;
      }
    };
    for (const value of [boundary.below, boundary.exact, boundary.above]) {
      assert.equal(tsVerdict(value) === 'PASS', runQ({ [boundary.field]: value }).feasible, `TS/Python divergence at ${boundary.field}=${value}`);
    }
  });
}

pythonTest('delta bands are half-open on |delta|: 0.25 belongs to the second band and 0.5 is excluded; band edges never flip', () => {
  const feasible = (magnitude: number) => runQ({ putDeltaMagnitude: magnitude }).feasible;
  assert.equal(feasible(0), true);
  assert.equal(feasible(0.25 - 1e-9), true);
  assert.equal(feasible(0.25), true);
  assert.equal(feasible(0.5 - 1e-9), true);
  assert.equal(feasible(0.5), false, 'the exclusive upper edge of the last band');
  assert.equal(feasible(0.5 + 1e-9), false);
  assert.ok(runQ({ putDeltaMagnitude: 0.5 }).codes.includes('DELTA_OUTSIDE_ALL_BANDS'));
  for (const magnitude of [0, 0.1, 0.25 - 1e-9, 0.25, 0.4, 0.5 - 1e-9, 0.5, 0.6]) {
    assert.equal(qGates.deltaBand(-magnitude, policy).verdict === 'PASS', feasible(magnitude), `signed delta ${-magnitude}`);
    // Q-DELTA-SIGN-001: a positive put delta is invalid evidence (UNKNOWN), never silently folded into its magnitude.
    if (magnitude > 0) assert.equal(qGates.deltaBand(magnitude, policy).verdict, 'UNKNOWN', `positive put delta ${magnitude}`);
  }
  assert.equal(qGates.deltaBand(null, policy).verdict, 'UNKNOWN');
});

pythonTest('UNKNOWN gate inputs are rejected as UNKNOWN (distinct reason code) and never coerced to a passing or zero value', () => {
  for (const [field, code] of [['spreadPct', 'SPREAD_UNKNOWN'], ['openInterest', 'OPEN_INTEREST_UNKNOWN'], ['volume', 'VOLUME_UNKNOWN']] as const) {
    const result = runQ({ [field]: null });
    assert.equal(result.feasible, false);
    assert.ok(result.codes.includes(code), `${field} -> ${code}, got ${result.codes.join(',')}`);
    assert.equal(result.quantity, 0);
  }
  const noAge = runQ({ quoteAgeSeconds: null });
  assert.ok(noAge.codes.includes('QUOTE_AGE_UNKNOWN'));
  assert.equal(noAge.feasible, false);
  // earnings distance UNKNOWN is a pass at THIS layer (event coverage is a separate governed policy)
  assert.equal(runQ({ earningsDistanceDays: null }).feasible, true);
});

pythonTest('ownership floor is exact: 0.3 passes, epsilon below fails with quantity zero (never floored to one)', () => {
  const at = runQ({ ownershipAcceptability: 0.3 });
  assert.equal(at.feasible, true);
  assert.ok(at.codes.includes('OWNERSHIP_ACCEPTABLE'));
  const below = runQ({ ownershipAcceptability: 0.3 - 1e-9 });
  assert.equal(below.feasible, false);
  assert.equal(below.quantity, 0);
  assert.ok(below.codes.includes('OWNERSHIP_BELOW_FLOOR'));
  assert.equal(runQ({ ownershipAcceptability: null }).feasible, false, 'unknown ownership without bootstrap eligibility is not eligible');
});

pythonTest('capital fit: broker-allowed quantity zero is a hard veto, positive is capped by the smallest cap, and collateral is strike * multiplier', () => {
  assert.ok(runQ({ brokerAllowedQty: 0 }).codes.includes('BROKER_QTY_ZERO'));
  assert.equal(runQ({ brokerAllowedQty: 0 }).quantity, 0);
  assert.equal(runQ({ brokerAllowedQty: 1 }).quantity, 1);
  assert.equal(runQ({ brokerAllowedQty: 99 }).quantity, 3, 'the collateral cap (3) binds');
  const economics = runQ({ strike: 706, multiplier: 100, entryPremiumPerShare: 3.64 }).only.economics;
  assert.ok(economics);
  assert.equal(economics.secured_collateral_per_contract, 70_600, 'strike * 100, in dollars per contract');
  assert.equal(economics.max_profit, 364, 'premium per SHARE * multiplier');
  assert.ok(Math.abs(economics.break_even_price - 702.36) < 1e-9);
  assert.ok(Math.abs(economics.credit_collateral_ratio - 364 / 70_600) < 1e-12);
  assert.equal(runQ({ multiplier: 0 }).feasible, false);
  assert.equal(runQ({ contractIsStandard: false }).feasible, false);
});

pythonTest('premium economics: there is NO minimum-premium or net-of-cost gate in Q, and minimumPositiveEdge is dead configuration (CURRENT BEHAVIOR, owner-policy gap)', () => {
  const tiny = runQ({ entryPremiumPerShare: 0.01 });
  assert.equal(tiny.feasible, true, 'a $1 credit against $1.70 of modeled opening cost is still feasible at the Q layer');
  assert.equal(tiny.only.economics?.max_profit, 1);
  assert.equal(tiny.only.economics?.ev_net, null);
  for (const edge of [0, 0.05, 1_000_000]) {
    const result = runQ({ entryPremiumPerShare: 0.01 }, { sizing: { minimumPositiveEdge: edge } });
    assert.equal(result.feasible, true, `minimumPositiveEdge=${edge} must currently have no effect`);
    assert.equal(result.quantity, tiny.quantity);
  }
});

// ---- TypeScript boundaries: quote normalization, executable flag and event policy ---------------

const NOW = '2026-10-01T15:00:00.000Z';
const normalized = (over: Partial<Parameters<typeof normalizeOptionContract>[0]>) => normalizeOptionContract({
  source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261106P00500000', occSymbol: 'SPY261106P00500000',
  optionType: 'PUT', strike: 500, expiration: '2026-11-06', asOfDate: '2026-10-01', multiplier: 100,
  underlyingBid: 599.9, underlyingAsk: 600.1, underlyingLast: 600, underlyingTimestamp: NOW,
  bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: null, lastTradeSize: null,
  quoteTimestamp: NOW, tradeTimestamp: null, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
  openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
  rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15, ...over,
}, NOW);

test('executable flag quote-age boundary is inclusive at 30s and the age is computed from the provider timestamp in seconds', () => {
  const ago = (seconds: number) => new Date(Date.parse(NOW) - seconds * 1000).toISOString();
  assert.equal(normalized({ quoteTimestamp: ago(29.999) }).executable, true);
  assert.equal(normalized({ quoteTimestamp: ago(30) }).executable, true);
  const stale = normalized({ quoteTimestamp: ago(30.001) });
  assert.equal(stale.executable, false);
  assert.match(stale.nonExecutableReason ?? '', /quote stale/);
  assert.equal(normalized({ quoteTimestamp: ago(30) }).dataAgeSeconds, 30);
  const future = normalized({ quoteTimestamp: new Date(Date.parse(NOW) + 1000).toISOString() });
  assert.equal(future.executable, false);
  assert.match(future.nonExecutableReason ?? '', /future/);
  assert.equal(normalized({ quoteTimestamp: null }).executable, false);
  assert.equal(qGates.quoteFreshness(59.999, policy).verdict, 'PASS');
  assert.equal(qGates.quoteFreshness(60, policy).verdict, 'FAIL');
});

test('DTE is whole calendar days from asOfDate (expiration day itself is not tradable), and collateral/economics units are dollars per contract', () => {
  assert.equal(normalized({ expiration: '2026-10-26' }).dte, 25);
  assert.equal(normalized({ expiration: '2026-11-30' }).dte, 60);
  const today = normalized({ expiration: '2026-10-01' });
  assert.equal(today.executable, false);
  assert.match(today.nonExecutableReason ?? '', /expires today/);
  const c = normalized({ bid: 3.64, ask: 3.76, strike: 706 });
  assert.equal(c.strike * c.multiplier, 70_600);
  assert.ok(Math.abs((c.breakEven ?? NaN) - 702.36) < 1e-9);
});

const instrumentFund: InstrumentClassificationEvidence = {
  policyVersion: 'theta-paper-instrument-classification-v1', symbol: 'AAPL', state: 'OPERATING_COMPANY',
  paperBootstrapApproved: false, authority: 'OPTIONOMICS_POSITIVE_EARNINGS', evidenceIds: [], observedAt: NOW, reason: 'test',
};
const macroClear: MacroRiskEvidence = {
  policyVersion: 'theta-paper-macro-event-policy-v1' as never, authority: 'PAPER_BOOTSTRAP_MACRO_CALENDAR' as never,
  state: 'KNOWN_FALSE', macroRiskFlag: false, decisionAsOf: NOW, validThrough: NOW, eventCount: 0, nearEventCount: 0,
  evidenceIds: [], reason: 'clear',
} as MacroRiskEvidence;
const earningsAt = (sessions: number | null): OptionomicsEarningsEvidence => ({
  version: 'theta-optionomics-earnings-evidence-v1', authority: 'OPTIONOMICS_SESSION_RESEARCH',
  state: sessions === null ? 'UNKNOWN' : 'KNOWN_POSITIVE_DISTANCE', distanceTradingSessions: sessions, distanceCalendarDays: null,
  coverageAuthority: 'POSITIVE_DISTANCE_ONLY_NO_NEGATIVE_ASSURANCE', providerTimestamp: NOW, thetaObservedAt: NOW,
  thetaFirstObservedAt: null, sessionDate: '2026-10-01', evidenceId: 'e', reason: 'test', paperEntryNegativeAssurance: false,
});
const calendar = (['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'] as const).map((date) =>
  ({ date, open: '09:30', close: '16:00', sessionOpen: null, sessionClose: null }));

test('company event window boundary: earnings on the last session through expiration BLOCKS, one session later CLEARS, unknown BLOCKS (never an assumed clear)', () => {
  const decide = (sessions: number | null): CompanyEventPaperPolicyDecision => applyCompanyEventPaperPolicy({
    decisionAsOf: NOW, expiration: '2026-10-07', calendar, instrument: instrumentFund, earnings: earningsAt(sessions), macro: macroClear });
  assert.equal(decide(5).sessionsThroughExpiration, 5);
  assert.equal(decide(5).action, 'BLOCK');
  assert.equal(decide(5).state, 'KNOWN_NEAR_EARNINGS_BLOCK');
  assert.equal(decide(4).action, 'BLOCK');
  assert.equal(decide(6).action, 'CLEAR');
  assert.equal(decide(null).action, 'BLOCK');
  assert.equal(decide(null).state, 'COVERAGE_UNKNOWN_BLOCK');
  assert.equal(decide(0).action, 'BLOCK');
});
