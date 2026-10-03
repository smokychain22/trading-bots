// Offline, deterministic stress harness for the strategy/evidence pipeline (no network, no database, no broker).
// Stages per chain size: frontier build -> content hash -> bounded Postgres projection -> JSON serialization -> local archive batch.
// It measures wall time, heap and RSS, and serialized sizes. Used by tests/phase4-large-chain-stress.test.ts, tests/phase4-long-soak.test.ts
// and (as a CLI) to record the evidence-based baseline in docs/operations/THETA_PHASE4_PERFORMANCE_BASELINE_20261003.json.
import v8 from 'node:v8';
import vm from 'node:vm';
import { canonicalFrontierResearchBatch } from '../src/storage/canonical-frontier-local-archive.js';
import { buildCanonicalStrategyFrontier, canonicalStrategyFrontierContentHash, type CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { projectCanonicalFrontierForPostgres } from '../src/theta/postgres-cycle-evidence-storage.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';

const NOW = '2026-09-14T15:00:00.000Z';
const DATES = ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13'];
const FAMILIES: StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];

export function makeContracts(count: number, seed0 = 12345): NormalizedOptionContract[] {
  const out: NormalizedOptionContract[] = [];
  let seed = seed0;
  const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let index = 0; index < count; index += 1) {
    const expiration = DATES[index % DATES.length] as string;
    const strike = 50 + Math.floor(index / DATES.length) * 0.5;
    const symbol = `SYN${expiration.slice(2, 4)}${expiration.slice(5, 7)}${expiration.slice(8, 10)}P${String(Math.round(strike * 1000)).padStart(8, '0')}`;
    const bid = Math.max(0.05, Math.round(rand() * 400) / 100);
    out.push(normalizeOptionContract({
      source: 'ALPACA', underlying: 'SYN', optionSymbol: symbol, occSymbol: symbol, optionType: 'PUT', strike, expiration,
      asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200,
      underlyingTimestamp: NOW, bid, ask: bid + 0.05 + rand() * 0.1, bidSize: 20, askSize: 18, lastTradePrice: bid, lastTradeSize: 1,
      quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 10 + Math.floor(rand() * 500), volumeSource: 'ALPACA',
      openInterest: 50 + Math.floor(rand() * 2000), openInterestSource: 'OPTIONOMICS', iv: 0.2 + rand() * 0.3,
      delta: -(0.05 + rand() * 0.4), gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: NOW,
      greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.5,
    }, NOW));
  }
  return out;
}

const routing = (eligible: readonly StrategyFamily[]) => parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: FAMILIES.map((strategyFamily) => ({ strategyFamily, eligible: eligible.includes(strategyFamily),
    eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE', reasons: [{ code: 'R', polarity: 0, detail: 'stress' }], policyVersion: 'router-v1' })),
});
const BASE = { snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1', stock: null, assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL' as const,
  buyingPower: 100_000, brokerAllowedQty: 10, sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3, assignmentCapacityQtyCap: 3, tailRiskQtyCap: 2,
    correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 }, eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const };

export const productionLikeFamilies: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_D', 'THETA_A', 'THETA_C'];

export function buildFrontier(contracts: NormalizedOptionContract[], eligible: readonly StrategyFamily[] = productionLikeFamilies): CanonicalStrategyFrontier {
  return buildCanonicalStrategyFrontier({ ...BASE, contracts, routing: routing(eligible) } as never);
}

export interface StageMeasurement { readonly buildMs: number; readonly hashMs: number; readonly projectMs: number; readonly stringifyMs: number; readonly archiveMs: number; readonly totalMs: number }
export interface SizeMeasurement {
  readonly contracts: number; readonly candidates: number; readonly stages: StageMeasurement;
  readonly frontierBytes: number; readonly projectionBytes: number; readonly archiveRows: number; readonly archiveBytes: number;
  readonly heapUsedMb: number; readonly rssMb: number; readonly heapRetainedAfterGcMb: number | null;
}

let gcFn: (() => void) | null | undefined;
export function forceGc(): (() => void) | null {
  if (gcFn !== undefined) return gcFn;
  try {
    v8.setFlagsFromString('--expose-gc');
    gcFn = vm.runInNewContext('gc') as () => void;
  } catch { gcFn = null; }
  return gcFn;
}
const mb = (bytes: number): number => Math.round((bytes / 1048576) * 10) / 10;

export function measureOnce(contractCount: number): SizeMeasurement {
  const contracts = makeContracts(contractCount);
  const t0 = performance.now();
  const frontier = buildFrontier(contracts);
  const t1 = performance.now();
  const hash = canonicalStrategyFrontierContentHash((({ contentHash, ...rest }) => (void contentHash, rest))(frontier));
  const t2 = performance.now();
  const projection = projectCanonicalFrontierForPostgres(frontier);
  const projectionBytes = Buffer.byteLength(canonicalJson(projection.projection as never));
  const t3 = performance.now();
  const frontierBytes = Buffer.byteLength(JSON.stringify(frontier));
  const t4 = performance.now();
  const batch = canonicalFrontierResearchBatch(JSON.parse(JSON.stringify(frontier)), { frontier_id: '55555555-5555-4555-8555-555555555555',
    fusion_snapshot_id: '66666666-6666-4666-8666-666666666666', observed_at: frontier.timestamp, content_hash: frontier.contentHash }, 'a'.repeat(40));
  const archiveBytes = Buffer.byteLength(JSON.stringify(batch.receiptInput.payload));
  const t5 = performance.now();
  if (hash !== frontier.contentHash) throw new Error('STRESS_HASH_NOT_REPRODUCIBLE');
  const usage = process.memoryUsage();
  const candidates = frontier.branches.reduce((total, branch) => total + branch.candidates.length, 0);
  return { contracts: contractCount, candidates, frontierBytes, projectionBytes, archiveRows: batch.rowCount, archiveBytes,
    stages: { buildMs: t1 - t0, hashMs: t2 - t1, projectMs: t3 - t2, stringifyMs: t4 - t3, archiveMs: t5 - t4, totalMs: t5 - t0 },
    heapUsedMb: mb(usage.heapUsed), rssMb: mb(usage.rss), heapRetainedAfterGcMb: null };
}

/** Best of `repeats` runs (timing noise on a shared machine), then the heap that is still retained after a forced GC. */
export function measure(contractCount: number, repeats = 2): SizeMeasurement {
  let best = measureOnce(contractCount);
  for (let index = 1; index < repeats; index += 1) { const next = measureOnce(contractCount); if (next.stages.totalMs < best.stages.totalMs) best = next; }
  const gc = forceGc();
  let retained: number | null = null;
  if (gc !== null) { gc(); gc(); retained = mb(process.memoryUsage().heapUsed); }
  return { ...best, heapRetainedAfterGcMb: retained };
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('theta-stress-harness.ts') && process.argv.includes('--baseline')) {
  const sizes = (process.argv.find((arg) => arg.startsWith('--sizes='))?.slice(8) ?? '100,300,1000,2619,5000,10000').split(',').map(Number);
  const rows = sizes.map((size) => measure(size, 3));
  console.log(JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, rows }, null, 2));
}
