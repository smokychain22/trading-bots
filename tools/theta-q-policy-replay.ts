// THETA Q historical policy replay runner. READ-ONLY Alpaca market data + contract listings (paper host); never an order
// endpoint. Raw data lives only in a bounded cache directory passed on the command line and is deleted with --cleanup.
//
// usage: node --import tsx tools/theta-q-policy-replay.ts --env=<production.env> --cache=<dir> --out=<report.json>
//        [--underlyings=SPY,TLT,XLE,AAPL,AMD,META,NVDA] [--cleanup]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { paperBootstrapRuntimePolicy as P } from '../src/theta/paper-bootstrap-runtime-policy.js';
import {
  buildDecisionCandidates, calendarDays, economicProfileGrid, exitPolicies, qPolicyReplayVersion, runSequentialPolicy,
  selectCurrentQ, selectEconomicQ, splitAdjustedCloses, type ContractHistory, type PricingMode, type DecisionPoint, type Episode, type ReplayAssumptions,
  type ReplayCandidate, type UnderlyingHistory,
} from '../src/research/q-policy-replay/replay-engine.js';
import {
  bucketize, bucketKeys, chooseProfiles, computePolicyMetrics, inSampleEpisodes, oosEpisodes, regimeAt, type PolicyMetrics, type SplitPlan,
} from '../src/research/q-policy-replay/replay-metrics.js';

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const envFile = arg('env'), cacheDir = arg('cache'), outFile = arg('out');
if (envFile === undefined || cacheDir === undefined || outFile === undefined) throw new Error('usage: --env= --cache= --out=');
const PRIMARY = ['SPY', 'TLT', 'XLE'];
const SECONDARY = ['AAPL', 'AMD', 'META', 'NVDA'];
const underlyings = (arg('underlyings') ?? [...PRIMARY, ...SECONDARY].join(',')).split(',');

const env = loadEnvironmentFile(envFile) as Record<string, unknown>;
const tradingBase = String(env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets');
if (new URL(tradingBase).hostname !== 'paper-api.alpaca.markets') throw new Error('NOT_PAPER_HOST');
const headers = { 'APCA-API-KEY-ID': String(env.ALPACA_API_KEY ?? ''), 'APCA-API-SECRET-KEY': String(env.ALPACA_SECRET_KEY ?? '') };
const DATA = 'https://data.alpaca.markets';
const TODAY = new Date().toISOString().slice(0, 10);

// --- bounded, rate-limited GET (<= 4 in flight, >= 320 ms between starts, 429/5xx backoff) ---
let inFlight = 0, lastStart = 0, requestCount = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped provider JSON, narrowed field by field below
async function get(url: string): Promise<any> {
  const path = new URL(url).pathname;
  if (!(path.startsWith('/v2/options/contracts') || path.startsWith('/v1beta1/options/bars') || path.startsWith('/v2/stocks/')))
    throw new Error(`REPLAY_ENDPOINT_NOT_ALLOWED:${path}`);
  for (let attempt = 0; attempt < 6; attempt++) {
    while (inFlight >= 4 || Date.now() - lastStart < 320) await sleep(40);
    inFlight++; lastStart = Date.now(); requestCount++;
    try {
      const response = await fetch(url, { headers });
      if (response.status === 429 || response.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      if (!response.ok) throw new Error(`HTTP_${response.status}:${path}`);
      return await response.json();
    } finally { inFlight--; }
  }
  throw new Error(`REPLAY_FETCH_RETRIES_EXHAUSTED:${path}`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));
const isoWeek = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)}`;
};

async function stockHistory(symbol: string): Promise<UnderlyingHistory> {
  const dates: string[] = [], closes: number[] = [];
  for (const feed of ['sip', 'iex']) {
    let token: string | null = null; dates.length = 0; closes.length = 0;
    try {
      do {
        const q = new URLSearchParams({ timeframe: '1Day', start: '2023-10-01', adjustment: 'raw', feed, limit: '10000' });
        if (token) q.set('page_token', token);
        const body = await get(`${DATA}/v2/stocks/${symbol}/bars?${q}`);
        // Only completed sessions: today's partial bar is dropped, and recent option bars are not licensed (OPRA) anyway.
        for (const bar of body.bars ?? []) { const d = String(bar.t).slice(0, 10); if (d >= TODAY) continue; dates.push(d); closes.push(Number(bar.c)); }
        token = body.next_page_token ?? null;
      } while (token);
      if (dates.length > 0) return { symbol, dates: [...dates], closes: [...closes] };
    } catch (error) { if (feed === 'iex') throw error; }
  }
  throw new Error(`NO_STOCK_BARS:${symbol}`);
}

interface CachedUnderlying { readonly history: UnderlyingHistory; readonly contracts: readonly [string, number, string, readonly (readonly [string, number, number, number, number])[]][] }

async function loadUnderlying(symbol: string, decisionStart: string): Promise<CachedUnderlying> {
  const file = join(cacheDir as string, `${symbol}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as CachedUnderlying;
  const history = await stockHistory(symbol);
  const dataEnd = history.dates.at(-1) as string;
  // Decisions: first trading date of each ISO week from decisionStart; strike band from trailing RV (point-in-time).
  const decisions = decisionDates(history, decisionStart);
  const listing = new Map<string, { strike: number; expiration: string }>();
  const firstExp = addDays(decisions[0] as string, 25), lastExp = addDays(decisions.at(-1) as string, 60);
  for (let month = firstExp.slice(0, 7); month <= lastExp.slice(0, 7);) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const monthStart = `${month}-01`, monthEnd = iso(new Date(Date.UTC(y, m, 0)));
    const relevant = decisions.filter((d) => addDays(d, 60) >= monthStart && addDays(d, 25) <= monthEnd);
    if (relevant.length > 0) {
      const spots = relevant.map((d) => history.closes[history.dates.indexOf(d)] as number);
      const lo = Math.floor(Math.min(...spots) * 0.6), hi = Math.ceil(Math.max(...spots) * 1.01);
      for (const status of ['inactive', 'active']) {
        let token: string | null = null;
        do {
          const q = new URLSearchParams({ underlying_symbols: symbol, type: 'put', status, expiration_date_gte: monthStart,
            expiration_date_lte: monthEnd, strike_price_gte: String(lo), strike_price_lte: String(hi), limit: '10000' });
          if (token) q.set('page_token', token);
          const body = await get(new URL(`/v2/options/contracts?${q}`, tradingBase).toString());
          for (const k of body.option_contracts ?? []) {
            if (k.root_symbol !== symbol || String(k.size) !== '100') continue; // adjusted/non-standard deliverables excluded
            listing.set(k.symbol, { strike: Number(k.strike_price), expiration: k.expiration_date });
          }
          token = body.next_page_token ?? null;
        } while (token);
      }
    }
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  // EXPIRY_SUBSET_LAST_PER_ISO_WEEK: one expiration per week (Friday, or Thursday when Friday is a holiday).
  const lastPerWeek = new Map<string, string>();
  for (const { expiration } of listing.values()) { const w = isoWeek(expiration); if ((lastPerWeek.get(w) ?? '') < expiration) lastPerWeek.set(w, expiration); }
  const keptExpirations = new Set(lastPerWeek.values());
  const firstNeeded = new Map<string, string>();
  const adjusted = splitAdjustedCloses(history.closes);
  for (const d of decisions) {
    const index = history.dates.indexOf(d), spot = history.closes[index] as number;
    const rets: number[] = [];
    for (let i = Math.max(1, index - 19); i <= index; i++) rets.push(Math.log((adjusted[i] as number) / (adjusted[i - 1] as number)));
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const rv = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, rets.length - 1) * 252);
    const band = Math.min(0.4, Math.max(0.1, 3 * Math.max(rv, 0.15) * 1.25 * Math.sqrt(60 / 365) + 0.02));
    for (const [contractSymbol, k] of listing) {
      if (!keptExpirations.has(k.expiration)) continue;
      const dte = calendarDays(d, k.expiration);
      if (dte < P.conventional.minimumDte || dte > P.conventional.maximumDte) continue;
      if (k.strike < spot * (1 - band) || k.strike > spot * 1.0) continue;
      if (!firstNeeded.has(contractSymbol)) firstNeeded.set(contractSymbol, d);
    }
  }
  // Bars: grouped by expiration, <= 100 symbols per request, from the first decision that needs the contract to its expiry.
  const byExpiration = new Map<string, string[]>();
  for (const s of firstNeeded.keys()) { const e = (listing.get(s) as { expiration: string }).expiration; byExpiration.set(e, [...(byExpiration.get(e) ?? []), s]); }
  const bars = new Map<string, [string, number, number, number, number][]>();
  const jobs: Promise<void>[] = [];
  for (const [expiration, symbols] of byExpiration) {
    for (let i = 0; i < symbols.length; i += 100) {
      const chunk = symbols.slice(i, i + 100);
      const start = chunk.map((s) => firstNeeded.get(s) as string).sort()[0] as string;
      const end = expiration < dataEnd ? expiration : dataEnd;
      jobs.push((async () => {
        let token: string | null = null;
        do {
          const q = new URLSearchParams({ symbols: chunk.join(','), timeframe: '1Day', start, end, limit: '10000' });
          if (token) q.set('page_token', token);
          const body = await get(`${DATA}/v1beta1/options/bars?${q}`);
          for (const [s, list] of Object.entries<{ t: string; c: number; v: number; h: number; l: number }[]>(body.bars ?? {}))
            for (const b of list) { const arr = bars.get(s) ?? []; arr.push([String(b.t).slice(0, 10), Number(b.c), Number(b.v), Number(b.h), Number(b.l)]); bars.set(s, arr); }
          token = body.next_page_token ?? null;
        } while (token);
      })());
      if (jobs.length >= 8) { await Promise.all(jobs); jobs.length = 0; }
    }
  }
  await Promise.all(jobs);
  const cached: CachedUnderlying = { history, contracts: [...firstNeeded.keys()].filter((s) => bars.has(s)).map((s) => {
    const k = listing.get(s) as { strike: number; expiration: string };
    return [s, k.strike, k.expiration, bars.get(s) as [string, number, number, number, number][]];
  }) };
  writeFileSync(file, JSON.stringify(cached));
  return cached;
}

function decisionDates(history: UnderlyingHistory, start: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const d of history.dates) { if (d < start) continue; const w = isoWeek(d); if (!seen.has(w)) { seen.add(w); out.push(d); } }
  return out;
}

const baseHalfSpread = (mid: number) => Math.max(0.01, 0.03 * mid);
const stressHalfSpread = (mid: number) => Math.max(0.02, 0.06 * mid);
const assumptions = (equity: number | null, stress: boolean, pricingMode: PricingMode = 'CLOSE'): ReplayAssumptions => ({
  riskFreeRate: 0.045, halfSpread: stress ? stressHalfSpread : baseHalfSpread,
  halfSpreadModelId: stress ? 'STRESS_2X:max($0.02,6%_of_mid)' : 'BASE:max($0.01,3%_of_mid)',
  feePerContractSide: 0.05, multiplier: 100, accountEquityUsd: equity,
  hardTickerCapPct: P.aegis.maximumTickerConcentrationPct * P.aegis.hardCapMultiplier,
  lattice: { minDte: P.conventional.minimumDte, maxDte: P.conventional.maximumDte, deltaBands: P.conventional.deltaBands,
    minVolume: P.conventional.minimumVolume, maxSpreadPct: P.conventional.maximumSpreadPct },
  stressGapPct: P.aegis.stressGapThresholdAbsoluteReturn, pricingMode,
});

interface Prepared { readonly history: UnderlyingHistory; readonly adjusted: UnderlyingHistory; readonly contracts: ReadonlyMap<string, ContractHistory>; readonly decisionDates: readonly string[] }
function prepare(cached: CachedUnderlying, decisionStart: string): Prepared {
  const contracts = new Map<string, ContractHistory>(cached.contracts.map(([symbol, strike, expiration, list]) =>
    [symbol, { symbol, strike, expiration, bars: new Map(list.map(([d, c, v, h, l]) => [d, { close: c, volume: v, high: h, low: l }])) }]));
  return { history: cached.history, adjusted: { ...cached.history, closes: splitAdjustedCloses(cached.history.closes) }, contracts,
    decisionDates: decisionDates(cached.history, decisionStart) };
}
function buildDecisions(p: Prepared, a: ReplayAssumptions): DecisionPoint[] {
  const all = [...p.contracts.values()];
  return p.decisionDates.map((date) => {
    const index = p.history.dates.indexOf(date), spot = p.history.closes[index] as number;
    const live = all.filter((c) => c.expiration > date && c.bars.has(date));
    return { date, spot, regime: regimeAt(p.adjusted, index), candidates: buildDecisionCandidates({ underlying: p.history.symbol, date, spot, contracts: live, assumptions: a }) };
  });
}

// ---------------------------------------------------------------------------
const decisionStart = '2024-03-04';
const plan: SplitPlan = { trainEnd: '2025-02-28', validationEnd: '2025-08-31' };
mkdirSync(cacheDir, { recursive: true });
const startedAt = Date.now();
const prepared = new Map<string, Prepared>();
for (const u of underlyings) {
  const cached = await loadUnderlying(u, decisionStart);
  prepared.set(u, prepare(cached, decisionStart));
  console.log(`loaded ${u}: contracts=${cached.contracts.length} days=${cached.history.dates.length} requests=${requestCount}`);
}
const dataEnd = [...prepared.values()].map((p) => p.history.dates.at(-1) as string).sort()[0] as string;

type Selector = { readonly id: string; readonly kind: 'CURRENT_Q' | 'ECONOMIC_Q' | 'PROFILE'; readonly select: (c: readonly ReplayCandidate[]) => ReplayCandidate | null };
const selectorsFor = (a: ReplayAssumptions): Selector[] => [
  { id: 'CURRENT_Q_EMULATION', kind: 'CURRENT_Q', select: (c) => selectCurrentQ(c, a) },
  { id: 'ECONOMIC_Q', kind: 'ECONOMIC_Q', select: (c) => selectEconomicQ(c, null) },
  ...economicProfileGrid().map((profile): Selector => ({ id: `ECON_${profile.id}`, kind: 'PROFILE', select: (c) => selectEconomicQ(c, profile) })),
];

interface ComboResult {
  readonly selection: string; readonly exit: string; readonly kind: Selector['kind'];
  readonly episodes: readonly Episode[]; readonly censored: number; readonly excluded: number; readonly waits: number; readonly decisions: number;
}
function runUniverse(names: readonly string[], a: ReplayAssumptions, selectorFilter?: (s: Selector) => boolean, exitFilter?: (id: string) => boolean): ComboResult[] {
  const selectors = selectorsFor(a).filter(selectorFilter ?? (() => true));
  const results = new Map<string, { selection: string; exit: string; kind: Selector['kind']; episodes: Episode[]; censored: number; excluded: number; waits: number; decisions: number }>();
  for (const u of names) {
    const p = prepared.get(u) as Prepared;
    const decisions = buildDecisions(p, a);
    // Selection depends only on the decision snapshot: precompute once per selector, then reuse across exits.
    for (const s of selectors) {
      const chosenByDate = new Map(decisions.map((d) => [d.date, s.select(d.candidates)]));
      for (const e of exitPolicies.filter((x) => exitFilter === undefined || exitFilter(x.id))) {
        const r = runSequentialPolicy({ underlying: p.history, decisions, contractsBySymbol: p.contracts, exit: e, assumptions: a,
          select: (_candidates, decision) => chosenByDate.get(decision.date) ?? null });
        const key = `${s.id}|${e.id}`;
        const acc = results.get(key) ?? { selection: s.id, exit: e.id, kind: s.kind, episodes: [], censored: 0, excluded: 0, waits: 0, decisions: 0 };
        acc.episodes.push(...r.episodes); acc.censored += r.censored; acc.excluded += r.corporateActionExcluded; acc.waits += r.waits; acc.decisions += r.decisionsConsidered;
        results.set(key, acc);
      }
    }
  }
  return [...results.values()];
}

const inSampleOf = (eps: readonly Episode[]) => inSampleEpisodes(eps, plan);
const oosOf = (eps: readonly Episode[]) => oosEpisodes(eps, plan);
const compact = (m: PolicyMetrics) => ({ n: m.n, winRate: m.winRate, wilson95: m.winRateWilson95, avgWin: m.averageWin, avgLoss: m.averageLoss,
  expectancy: m.expectancy, profitFactor: m.profitFactor, maxDD: m.maxDrawdown, es5: m.expectedShortfall5, meanRoc: m.meanRoc,
  es5Roc: m.expectedShortfall5Roc, maxDDRoc: m.maxDrawdownRocUnits, totalPnl: m.totalPnl, annualizedRocOnCapitalDays: m.annualizedReturnOnCapitalDays,
  assignmentRate: m.assignmentRate, avgHoldDays: m.averageHoldDays, slippage: m.modeledSlippageTotal, modelPricedExits: m.modelPricedExitCount });

const quarterStarts = (() => {
  const out: string[] = [];
  for (let start = '2025-03-01'; start <= dataEnd;) { out.push(start); const next = addDays(start, 92).slice(0, 8) + '01'; start = next; }
  return out;
})();
const quarterEnd = (start: string): string => addDays(addDays(start, 92).slice(0, 8) + '01', -1);
const comboKey = (c: { readonly selection: string; readonly exit: string }) => `${c.selection}|${c.exit}`;

/** Compact selection evidence for one combo: in-sample metrics and, per quarter, metrics on outcomes known before it. */
interface SelectionSummary { readonly inSample: PolicyMetrics; readonly beforeQuarter: Readonly<Record<string, PolicyMetrics>> }
const summarize = (episodes: readonly Episode[]): SelectionSummary => ({
  inSample: computePolicyMetrics(inSampleOf(episodes)),
  beforeQuarter: Object.fromEntries(quarterStarts.map((q) => [q, computePolicyMetrics(episodes.filter((e) => e.exitDate < q))])),
});

function rollingWalkForward(combos: readonly ComboResult[], base: ReadonlyMap<string, SelectionSummary>,
  stresses: readonly ReadonlyMap<string, SelectionSummary>[]): Record<string, unknown> {
  // Expanding window: for each quarter from 2025-03, choose profiles on outcomes EXITED before the quarter (base and
  // stressed), evaluate the chosen policy only on entries inside the quarter.
  const pools = combos.filter((c) => c.kind === 'PROFILE');
  const out: Record<string, Episode[]> = { CONSERVATIVE: [], BALANCED: [], AGGRESSIVE: [] };
  const picks: unknown[] = [];
  for (const start of quarterStarts) {
    const end = quarterEnd(start);
    const evidence = pools.map((c) => {
      const k = comboKey(c);
      return { policyId: k, inSample: (base.get(k) as SelectionSummary).beforeQuarter[start] as PolicyMetrics,
        inSampleStress: stresses.map((s) => (s.get(k) as SelectionSummary).beforeQuarter[start] as PolicyMetrics) };
    });
    const choices = chooseProfiles(evidence);
    picks.push({ quarter: start, choices: choices.map((x) => [x.profile, x.policyId]) });
    for (const choice of choices) {
      if (choice.policyId === null) continue;
      const combo = pools.find((c) => comboKey(c) === choice.policyId) as ComboResult;
      (out[choice.profile] as Episode[]).push(...combo.episodes.filter((e) => e.entryDate >= start && e.entryDate <= end));
    }
  }
  return { method: 'EXPANDING_WINDOW_QUARTERLY_OUTCOMES_KNOWN_BEFORE_QUARTER_STRESS_GATED', picks,
    results: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, compact(computePolicyMetrics(v))])) };
}

function universeReport(name: string, names: readonly string[], equity: number | null): Record<string, unknown> {
  const a = assumptions(equity, false);
  const combos = runUniverse(names, a);
  const byKey = new Map(combos.map((c) => [comboKey(c), c]));
  const baseSummary = new Map(combos.map((c) => [comboKey(c), summarize(c.episodes)]));
  // Stress runs: keep only compact summaries plus OOS/full metrics (episodes are dropped immediately).
  const stressRun = (aa: ReplayAssumptions) => {
    const summaries = new Map<string, SelectionSummary>(), oos = new Map<string, unknown>();
    for (const c of runUniverse(names, aa)) {
      summaries.set(comboKey(c), summarize(c.episodes));
      oos.set(comboKey(c), { full: compact(computePolicyMetrics(c.episodes)), oos: compact(computePolicyMetrics(oosOf(c.episodes))) });
    }
    return { summaries, oos };
  };
  const spread = stressRun(assumptions(equity, true));
  const prints = stressRun(assumptions(equity, false, 'ADVERSE_EXTREME'));
  const profileEvidence = combos.filter((c) => c.kind === 'PROFILE').map((c) => {
    const k = comboKey(c);
    return { policyId: k, inSample: (baseSummary.get(k) as SelectionSummary).inSample,
      inSampleStress: [(spread.summaries.get(k) as SelectionSummary).inSample, (prints.summaries.get(k) as SelectionSummary).inSample] };
  });
  const choices = chooseProfiles(profileEvidence);
  const stressRejected = profileEvidence.filter((e) => e.inSample.n >= 20 && (e.inSample.expectancy ?? 0) > 0
    && !e.inSampleStress.every((m) => m.n >= 20 && (m.expectancy ?? 0) > 0)).length;
  const keyCombos = ['CURRENT_Q_EMULATION|CURRENT_MGMT_EMULATION', 'CURRENT_Q_EMULATION|HOLD_TO_EXPIRY', 'CURRENT_Q_EMULATION|FIXED_50',
    'ECONOMIC_Q|CURRENT_MGMT_EMULATION', 'ECONOMIC_Q|HOLD_TO_EXPIRY', 'ECONOMIC_Q|FIXED_50', 'ECONOMIC_Q|FIXED_50+RISK_2X', 'ECONOMIC_Q|DYNAMIC+RISK_2X',
    ...new Set(choices.flatMap((c) => c.policyId === null ? [] : [c.policyId]))];
  const table = (filter: (eps: readonly Episode[]) => readonly Episode[]) => Object.fromEntries(keyCombos.map((k) => {
    const c = byKey.get(k); return [k, c === undefined ? null : compact(computePolicyMetrics(filter(c.episodes)))]; }));
  const baselineExits = Object.fromEntries(['CURRENT_Q_EMULATION', 'ECONOMIC_Q'].map((sel) => [sel, Object.fromEntries(exitPolicies.map((e) => {
    const c = byKey.get(`${sel}|${e.id}`) as ComboResult;
    return [e.id, { inSample: compact(computePolicyMetrics(inSampleOf(c.episodes))), oos: compact(computePolicyMetrics(oosOf(c.episodes))),
      full: compact(computePolicyMetrics(c.episodes)), censored: c.censored, waits: c.waits, excluded: c.excluded }];
  }))]));
  const surface = Object.fromEntries(['HOLD_TO_EXPIRY', 'FIXED_50', 'FIXED_50+RISK_2X', 'CURRENT_MGMT_EMULATION'].map((exit) => [exit,
    combos.filter((c) => c.kind === 'PROFILE' && c.exit === exit && c.selection.endsWith('_Rnone')).map((c) => {
      const m = (baseSummary.get(comboKey(c)) as SelectionSummary).inSample;
      const ps = (prints.summaries.get(comboKey(c)) as SelectionSummary).inSample;
      return { profile: c.selection, n: m.n, expectancy: m.expectancy, annRoc: m.annualizedReturnOnCapitalDays, es5Roc: m.expectedShortfall5Roc,
        maxDDRoc: m.maxDrawdownRocUnits, winRate: m.winRate, adversePrintExpectancy: ps.expectancy };
    })]));
  const buckets = Object.fromEntries(keyCombos.map((k) => {
    const c = byKey.get(k); if (c === undefined) return [k, null];
    return [k, Object.fromEntries(Object.entries(bucketKeys).map(([bn, fn]) => [bn, Object.fromEntries(Object.entries(bucketize(c.episodes, fn)).map(([b, m]) => [b, compact(m)]))]))];
  }));
  const curr = byKey.get('CURRENT_Q_EMULATION|HOLD_TO_EXPIRY') as ComboResult;
  return { universe: name, underlyings: names, capitalMode: equity === null ? 'UNCONSTRAINED_PER_CONTRACT' : `EQUITY_ASSUMPTION_${equity}_HARD_TICKER_CAP_${a.hardTickerCapPct}`,
    coverage: { decisionsConsideredCurrentQHold: curr.decisions, episodesCurrentQHold: curr.episodes.length, censoredCurrentQHold: curr.censored,
      waitsCurrentQHold: curr.waits, corporateActionExcluded: curr.excluded, policiesEvaluated: combos.length,
      profilePoliciesRejectedByStressGate: stressRejected },
    profileChoices: choices, inSampleKey: table(inSampleOf), oosKey: table(oosOf), fullKey: table((e) => e),
    rollingWalkForward: rollingWalkForward(combos, baseSummary, [spread.summaries, prints.summaries]), baselineExits,
    sensitivitySurfaceInSample: surface, buckets,
    spreadStress: Object.fromEntries(keyCombos.map((k) => [k, spread.oos.get(k) ?? null])),
    tradePrintStress: Object.fromEntries(keyCombos.map((k) => [k, prints.oos.get(k) ?? null])) };
}

const report = {
  version: qPolicyReplayVersion, generatedAt: new Date().toISOString(), dataEnd, decisionStart, splitPlan: plan,
  labels: ['OPTION_PRICE_IS_DAILY_TRADE_CLOSE_NOT_QUOTE', 'MODELED_HALF_SPREAD_BASE_max($0.01,3%)_STRESS_2X', 'GREEKS_BS_INVERTED_FIXED_RATE_0.045_Q_0',
    'TIMING_MISMATCH_OPTION_LAST_TRADE_VS_UNDERLYING_CLOSE', 'OPEN_INTEREST_NOT_EVALUABLE', 'ASSIGNMENT_MARKED_AT_EXPIRY_CLOSE',
    'SURVIVORSHIP_FIXED_UNIVERSE', 'EXPIRY_SUBSET_LAST_PER_ISO_WEEK', 'STRIKE_BAND_PIT_RV_BASED', 'ONE_CONTRACT_SEQUENTIAL_NON_OVERLAPPING_PER_UNDERLYING',
    'CURRENT_Q_IS_AN_EMULATION', 'NO_AEGIS_OWNERSHIP_EVENT_GATES', 'FEES_0.05_PER_CONTRACT_SIDE', 'EV_NOT_USED'],
  primary: universeReport('PRIMARY_APPROVED_CAPITAL_CONSTRAINED', underlyings.filter((u) => PRIMARY.includes(u)), 100_000),
  research: universeReport('RESEARCH_ALL_UNCONSTRAINED', underlyings, null),
  requests: requestCount, runtimeSeconds: Math.round((Date.now() - startedAt) / 1000),
};
writeFileSync(outFile, JSON.stringify(report, null, 1));
console.log(`report written: requests=${requestCount} seconds=${report.runtimeSeconds}`);
if (process.argv.includes('--cleanup')) { rmSync(cacheDir, { recursive: true, force: true }); console.log('cache deleted'); }
