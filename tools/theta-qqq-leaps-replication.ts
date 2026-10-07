// Runs QQQ_LEAPS_DIP_BUY_V1 replication on real QQQ daily bars (Alpaca market data, read-only).
// MODEL_PRICED over the full stock history; MARKET_PRICED on real option closes where Alpaca option bars exist (2024-02+).
// Writes an aggregate JSON (no raw data) to the path given as argv[2]. Never touches an order endpoint.
//
// usage: node --import tsx tools/theta-qqq-leaps-replication.ts <out.json> [--env-file=<production.env>]
import { writeFileSync } from 'node:fs';
import { loadEnvironmentFile } from '../src/config/environment.js';
import { blackScholes } from '../src/theta/strategy-intelligence/option-payoff.js';
import {
  chooseExpiration, chooseStrike, leapsMetrics, realizedVolProxy, simulateLeaps, sourceMechanicalVariant,
  type DailyBar, type LeapsRuleVariant,
} from '../src/research/source-replication/qqq-leaps.js';

const out = process.argv[2];
if (out === undefined) throw new Error('usage: theta-qqq-leaps-replication.ts <out.json> [--env-file=...]');
const envFile = process.argv.find((a) => a.startsWith('--env-file='))?.slice('--env-file='.length);
const env = (envFile === undefined ? process.env : loadEnvironmentFile(envFile)) as Record<string, unknown>;
const base = String(env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets');
if (new URL(base).hostname !== 'paper-api.alpaca.markets') throw new Error('NOT_PAPER_HOST');
const headers = { 'APCA-API-KEY-ID': String(env.ALPACA_API_KEY ?? ''), 'APCA-API-SECRET-KEY': String(env.ALPACA_SECRET_KEY ?? '') };
const data = 'https://data.alpaca.markets';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped provider JSON, read field-by-field below
async function get(url: string): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, { headers });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 2000 * (attempt + 1))); continue; }
    if (!r.ok) throw new Error(`HTTP_${r.status}`);
    return r.json();
  }
  throw new Error('HTTP_429_EXHAUSTED');
}

// 1. QQQ daily bars (split-adjusted; dividends ignored -- labelled).
const bars: DailyBar[] = [];
let page: string | null = null;
do {
  const q = new URLSearchParams({ timeframe: '1Day', start: '2015-06-01', end: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    adjustment: 'split', feed: 'sip', limit: '10000' });
  if (page) q.set('page_token', page);
  const res = await get(`${data}/v2/stocks/QQQ/bars?${q}`);
  for (const b of res.bars ?? []) bars.push({ date: String(b.t).slice(0, 10), open: Number(b.o), close: Number(b.c) });
  page = res.next_page_token ?? null;
} while (page);

const rate = 0.03; // labelled constant risk-free assumption (no rate history in scope)
const multipliers = [0.9, 1.1, 1.3];
const pricingFor = (ivMultiplier: number) => ({ volatilityAt: realizedVolProxy(bars, 60, ivMultiplier), rate, halfSpreadPct: 0.01,
  commissionPerContractUsd: 0.65, multiplier: 100 });
const modelMark = (vol: (i: number) => number | null) => (i: number, strike: number, expiration: string): number | null => {
  const bar = bars[i] as DailyBar; const v = vol(i);
  if (v === null) return null;
  const years = Math.max(0, (Date.parse(`${expiration}T00:00:00Z`) - Date.parse(`${bar.date}T00:00:00Z`)) / 86_400_000 / 365);
  return blackScholes('CALL', bar.close, strike, years, v, rate).price;
};

const variants: Record<string, LeapsRuleVariant> = {
  SOURCE_MECHANICAL_EVERY_TRIGGER: sourceMechanicalVariant,
  MONTHLY_CAP: { ...sourceMechanicalVariant, cadence: 'MONTHLY_CAP' },
  NO_OVERLAP: { ...sourceMechanicalVariant, cadence: 'NO_OVERLAP' },
  GAP_DOWN_TRIGGER: { ...sourceMechanicalVariant, trigger: 'GAP_DOWN_OPEN_1PCT' },
  EXIT_AT_30_DTE: { ...sourceMechanicalVariant, noTargetExit: 'EXIT_AT_30_DTE' },
  MONTHLY_CAP_SMA200: { ...sourceMechanicalVariant, cadence: 'MONTHLY_CAP', regimeFilter: 'CLOSE_ABOVE_SMA200' },
  EVERY_TRIGGER_SMA200: { ...sourceMechanicalVariant, regimeFilter: 'CLOSE_ABOVE_SMA200' },
};

// 2. MODEL_PRICED runs (+ IV-proxy sensitivity) and a chronological split for the regime filter.
const window = (from: string, to: string) => {
  const lo = bars.findIndex((b) => b.date >= from);
  const hiIdx = bars.findIndex((b) => b.date > to);
  return { lo: Math.max(0, lo), hi: hiIdx === -1 ? bars.length : hiIdx };
};
const model: Record<string, unknown> = {};
for (const m of multipliers) {
  for (const [name, variant] of Object.entries(variants)) {
    const pricing = pricingFor(m);
    const result = simulateLeaps(bars, variant, pricing, modelMark(pricing.volatilityAt));
    const byPeriod: Record<string, unknown> = {};
    for (const [label, [from, to]] of Object.entries({ TRAIN_2015_2020: ['2015-06-01', '2020-12-31'], VALIDATION_2021_2022: ['2021-01-01', '2022-12-31'],
      OOS_2023_PLUS: ['2023-01-01', '2100-01-01'] } as Record<string, [string, string]>)) {
      const w = window(from, to);
      const trades = result.trades.filter((t) => t.entryDate >= (bars[w.lo]?.date ?? '') && t.entryDate < (bars[w.hi]?.date ?? '9999'));
      byPeriod[label] = leapsMetrics({ trades, dailyEquity: [], skippedEntries: 0 });
    }
    // Benchmark: hold delta-equivalent QQQ shares (entry delta x 100) over the identical window, no leverage cost modeled.
    const closeOn = new Map(bars.map((b) => [b.date, b.close]));
    const closedTrades = result.trades.filter((t) => t.exitReason !== 'OPEN_AT_DATA_END');
    const bench = closedTrades.map((t) => ((closeOn.get(t.exitDate) ?? 0) - (closeOn.get(t.entryDate) ?? 0)) * t.entryDelta * 100);
    const benchmark = { deltaEquivalentStockPnlUsd: Number(bench.reduce((a, b) => a + b, 0).toFixed(2)),
      deltaEquivalentStockWinRate: bench.length === 0 ? null : Number((bench.filter((x) => x > 0).length / bench.length).toFixed(4)),
      leapsMinusBenchmarkUsd: Number((closedTrades.reduce((a, t) => a + t.pnlUsd, 0) - bench.reduce((a, b) => a + b, 0)).toFixed(2)),
      avgEntryPremiumUsd: closedTrades.length === 0 ? null : Number((closedTrades.reduce((a, t) => a + t.entryPrice * 100, 0) / closedTrades.length).toFixed(2)),
      avgDeltaEquivalentNotionalUsd: closedTrades.length === 0 ? null : Number((closedTrades.reduce((a, t) => a + (closeOn.get(t.entryDate) ?? 0) * t.entryDelta * 100, 0) / closedTrades.length).toFixed(2)) };
    model[`${name}@IVx${m}`] = { all: leapsMetrics(result), skippedEntries: result.skippedEntries, byEntryPeriod: byPeriod, benchmark };
  }
}

// 3. MARKET_PRICED: same rule, contract chosen by model delta (labelled), priced on real option closes, 2024-02-15 onward.
const marketStart = bars.findIndex((b) => b.date >= '2024-02-15');
const marketBars = bars.slice(Math.max(0, marketStart - 61)); // keep 60 sessions of history for the vol proxy
const volMarket = realizedVolProxy(marketBars, 60, 1.1);
const occ = (strike: number, expiration: string) => `QQQ${expiration.slice(2, 4)}${expiration.slice(5, 7)}${expiration.slice(8, 10)}C${String(Math.round(strike * 1000)).padStart(8, '0')}`;
const priceCache = new Map<string, Map<string, number>>();
async function closes(symbol: string): Promise<Map<string, number>> {
  const cached = priceCache.get(symbol); if (cached) return cached;
  const map = new Map<string, number>(); let p: string | null = null;
  do {
    const q = new URLSearchParams({ symbols: symbol, timeframe: '1Day', start: '2024-02-01', limit: '10000' });
    if (p) q.set('page_token', p);
    const res = await get(`${data}/v1beta1/options/bars?${q}`);
    for (const b of res.bars?.[symbol] ?? []) map.set(String(b.t).slice(0, 10), Number(b.c));
    p = res.next_page_token ?? null;
  } while (p);
  priceCache.set(symbol, map); return map;
}
// Pre-resolve contracts for every trigger day so the synchronous simulator can read real closes.
const chosen = new Map<number, { strike: number; expiration: string; delta: number }>();
for (let i = 61; i < marketBars.length; i++) {
  const bar = marketBars[i] as DailyBar; const prev = marketBars[i - 1] as DailyBar;
  if (bar.close / prev.close - 1 > -0.01) continue;
  const v = volMarket(i); if (v === null) continue;
  const expiration = chooseExpiration(bar.date, 365);
  const years = (Date.parse(`${expiration}T00:00:00Z`) - Date.parse(`${bar.date}T00:00:00Z`)) / 86_400_000 / 365;
  const pick = chooseStrike(bar.close, years, v, rate, 0.6);
  chosen.set(i, { ...pick, expiration });
  await closes(occ(pick.strike, expiration));
}
const marketMark = (i: number, strike: number, expiration: string) => priceCache.get(occ(strike, expiration))?.get((marketBars[i] as DailyBar).date) ?? null;
const marketResults: Record<string, unknown> = {};
for (const name of ['SOURCE_MECHANICAL_EVERY_TRIGGER', 'MONTHLY_CAP', 'NO_OVERLAP'] as const) {
  const variant = variants[name] as LeapsRuleVariant;
  const result = simulateLeaps(marketBars.slice(61), variant, { volatilityAt: (i) => volMarket(i + 61), rate, halfSpreadPct: 0.01,
    commissionPerContractUsd: 0.65, multiplier: 100 },
  (i, k, e) => marketMark(i + 61, k, e), (i) => chosen.get(i + 61) ?? null);
  marketResults[name] = { ...leapsMetrics(result), skippedEntriesNoOptionPrint: result.skippedEntries };
}

writeFileSync(out, JSON.stringify({
  replication: 'QQQ_LEAPS_DIP_BUY_V1', provenance: 'OWNER_CURATED_SOURCE_CLAIM; THETA independent replication',
  sourceTargetsNotThetaResults: { trades: 112, winRate: 0.911, totalPnlUsd: 176000, profitFactor: 6.26, avgWinUsd: 2000, avgLossUsd: -3300, maxDrawdownUsd: 18000, avgHoldDays: 127 },
  data: { underlyingBars: bars.length, from: bars[0]?.date, to: bars[bars.length - 1]?.date, feed: 'SIP daily, split-adjusted, dividends ignored',
    optionContractsPricedInMarketMode: priceCache.size },
  assumptions: { rate, ivProxy: 'RV60 x {0.9,1.1,1.3}, clamped [0.12, 0.60] (MODEL ONLY, not market IV; no skew)', halfSpreadPctPerSide: 0.01,
    commissionPerContractUsd: 0.65, entry: 'trigger-day close (SOURCE_RULE_UNSPECIFIED)', strikeGrid: '$5 >= $100 spot',
    marketModeContractChoice: 'model delta from RV60x1.1 proxy; priced on real Alpaca option daily closes' },
  model, market: marketResults,
}, null, 1));
console.log('written', out, 'bars', bars.length, 'optionContracts', priceCache.size);
