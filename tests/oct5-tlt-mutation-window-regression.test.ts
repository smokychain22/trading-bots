import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runCrossSymbolShadowScan, type ShadowScanBoundary, type ShadowSymbolScanResult } from '../src/research/shadow-evidence-runtime.js';
import { requestWindowFence } from '../src/execution/mutation-fence.js';
import { MutationFenceLostError } from '../src/execution/paper-order-coordinator.js';
import type { ThetaShadowCycleResult } from '../src/theta/theta-shadow-cycle.js';
import type { UnderlyingCandidateInput } from '../src/theta/universe-policy.js';

// MANDATORY REGRESSION (Production 2026-10-05). 11 READY Q plans for the one broker-authorized symbol (TLT) existed; 0 reached the broker.
// Plan assembly waited for ~100 research symbols, so each TLT plan was enqueued 130-150 s into its request and claimed after the 150 s
// broker-mutation window: MUTATION_FENCE_LOST:REQUEST_MUTATION_WINDOW_EXPIRED, then DECISION_EXPIRED. Time is scaled 1 s -> 1 ms here; the
// REAL scan and the REAL request-window fence are used. No risk threshold is changed: the fence and its window are the production ones.
const underlying = (symbol: string): UnderlyingCandidateInput => ({ symbol, tradable: true, optionEnabled: true, assetDataValid: true, avgDollarVolume: 1_000_000_000,
  currentPrice: 100, hasUsableOptionChain: true, accountCollateralFeasible: true, ownershipAcceptable: true, unsupportedCorporateActionPending: false, eventNear: false });
const cycle = (symbol: string): ThetaShadowCycleResult => ({ runId: `run-${symbol}`, startedAt: '2026-10-05T18:37:12Z', finishedAt: '2026-10-05T18:37:13Z',
  universeFunnel: {} as never, selectedUnderlying: symbol, underlyingRanking: [], optionChainComplete: true, optionContractsComplete: true, snapshotContentHash: null,
  fusionSnapshot: null, snapshotValidForNewRisk: null, provenance: 'HYBRID', provenanceDetail: [], blockers: [],
  orchestration: { thetaQ: { candidates: [] } } as never } as unknown as ThetaShadowCycleResult);
const research = Array.from({ length: 100 }, (_, index) => `R${String(index).padStart(3, '0')}`);
const universe = [...research, 'TLT'].map(underlying);
const boundary = (): ShadowScanBoundary => ({ universeVersion: 'u', latticeVersion: 'l', strategyVersion: 's', eligibleUnderlyings: universe,
  maxUnderlyings: universe.length, branches: ['THETA_CONVENTIONAL'] });
const WINDOW = 150; // scaled requestMutationWindowMs (150 s -> 150 ms)
const RESEARCH_EVALUATION = 140; // scaled: research breadth took ~130-150 s on 2026-10-05
const TLT_EVALUATION = 10;
const PLAN_AND_CLAIM = 26; // scaled: enqueue -> claim took ~26 s in production
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = async (item: UnderlyingCandidateInput) => { await sleep(item.symbol === 'TLT' ? TLT_EVALUATION : RESEARCH_EVALUATION); return cycle(item.symbol); };

/** the plan -> claim -> coordinator path for one symbol: it reaches the broker only if the request's mutation fence still holds */
const handoff = async (startedAtMs: number, member: ShadowSymbolScanResult, outcomes: string[]) => {
  await sleep(PLAN_AND_CLAIM);
  try { await requestWindowFence(startedAtMs, Date.now, WINDOW)('SUBMIT', 'tlt-plan'); outcomes.push(`${member.symbol}:BROKER_MUTATION_PATH_REACHED`); }
  catch (error) { outcomes.push(`${member.symbol}:${error instanceof MutationFenceLostError ? error.message : 'ERROR'}`); }
};

test('Oct 5 TLT: processing the authorized symbol only after research breadth loses the mutation fence (the old behavior)', async () => {
  const startedAtMs = Date.now();
  const outcomes: string[] = [];
  const scan = await runCrossSymbolShadowScan(boundary(), evaluate, () => new Date().toISOString());
  for (const member of scan.results) if (member.symbol === 'TLT') await handoff(startedAtMs, member, outcomes);
  assert.deepEqual(outcomes, ['TLT:MUTATION_FENCE_LOST:REQUEST_MUTATION_WINDOW_EXPIRED'], 'reproduces the production failure');
});

test('Oct 5 TLT: the authorized symbol is handed off as soon as it is evaluated, inside the fence, while research continues afterward', async () => {
  const startedAtMs = Date.now();
  const outcomes: string[] = [];
  const researchFinished: string[] = [];
  const scan = await runCrossSymbolShadowScan(boundary(), async (item) => {
    const result = await evaluate(item);
    if (item.symbol !== 'TLT') researchFinished.push(item.symbol);
    return result;
  }, () => new Date().toISOString(), { symbols: new Set(['TLT']), handle: async (member) => {
    assert.equal(researchFinished.length, 0, 'the handoff starts before any research symbol has finished');
    await handoff(startedAtMs, member, outcomes);
  } });
  assert.deepEqual(outcomes, ['TLT:BROKER_MUTATION_PATH_REACHED']);
  assert.equal(researchFinished.length, research.length, 'research breadth still completes');
  assert.equal(scan.results.length, universe.length);
  assert.equal(scan.completeness, 'COMPLETE');
});

test('Production wiring: the evidence scan hands broker-authorized symbols to the priority handler, serialized, and the fence policy is unchanged', async () => {
  const source = readFileSync(new URL('../src/research/production-shadow-runtime.ts', import.meta.url), 'utf8');
  assert.match(source, /\},input\.now,\{symbols:brokerAuthoritySymbols,handle:async\(member\)=>\{/);
  assert.match(source, /priorityChain=priorityChain\.then\(async\(\)=>\{try\{await processMember\(member\);\}/);
  assert.match(source, /if\(!processedSymbols\.has\(member\.symbol\)\)await processMember\(member\);/, 'research members are processed once, afterward');
  const { requestMutationWindowMs } = await import('../src/execution/mutation-fence.js');
  assert.equal(requestMutationWindowMs, 150_000, 'the mutation fence was not weakened');
});

// The runtime pool is two connections shared by ~100 concurrent research symbols. A broker-authorized symbol's evaluation, plan and handoff
// get their own connection lane so research queries can never queue them (the 2026-10-05 plans waited ~26 s between plan and claim).
test('Execution connection lane: authorized-symbol DB work and the handoff use a dedicated pool, research uses the shared one', () => {
  const handler = readFileSync(new URL('../src/theta/autonomous-runtime-handler.ts', import.meta.url), 'utf8');
  assert.match(handler, /executionPool \?\?= createRuntimePostgresPool\(environment\.DATABASE_URL,undefined,\{maximumConnections:1,applicationName:'theta-runtime-execution'\}\)/);
  assert.match(handler, /runAutonomousRuntimeCycle\(environment, runtimePool, new Date\(\),\{scope,executionPool,/);
  const runtime = readFileSync(new URL('../src/theta/autonomous-runtime.ts', import.meta.url), 'utf8');
  assert.equal((runtime.match(/priorityPool:executionPool,/g) ?? []).length, 2, 'both scan entry points pass the lane');
  assert.match(runtime, /const planStore=new PostgresMasterPaperActionPlanStore\(executionPool\);/);
  assert.match(runtime, /new PostgresPaperOrderStore\(executionPool,master\.executionAccountId\)/);
  const scan = readFileSync(new URL('../src/research/production-shadow-runtime.ts', import.meta.url), 'utf8');
  assert.match(scan, /const lanePool=\(symbol:string\):Pool=>input\.priorityPool!==undefined&&brokerAuthoritySymbols\.has\(symbol\)\?input\.priorityPool:input\.pool;/);
  assert.match(scan, /new PostgresMasterPaperActionPlanStore\(memberPool\)\.enqueue/);
});

// SELECTED-CANDIDATE / ACTION-READY LOSS DETECTOR: a broker-authorized selected candidate that reaches no plan, a READY plan that is not
// inserted, and a selection the assembler turns into no entry action must each record an exact leaf reason (never a silent WAIT).
test('every way a selected authorized candidate can fail to become an enqueued plan records an exact reason', () => {
  const scan = readFileSync(new URL('../src/research/production-shadow-runtime.ts', import.meta.url), 'utf8');
  assert.match(scan, /PLAN_NOT_ENQUEUED_\$\{enqueued\.disposition\}/);
  assert.match(scan, /SELECTED_WITHOUT_ENTRY_ACTION:\$\{blocker\}/);
  assert.match(scan, /SELECTED_CANDIDATE_DROPPED:\$\{!planEvidenceEnabled\?'PLAN_ENQUEUE_DISABLED_BY_ENVIRONMENT'/);
  for (const reason of ['CORPORATE_ACTION_READ_INCOMPLETE', 'SELECTED_DECISION_NOT_PERSISTED', 'PLAN_PRECONDITION_UNMET']) assert.ok(scan.includes(`'${reason}'`), reason);
});

test('2026-10-07 OPEN REGRESSION: one evidence request scans the full frontier at most ONCE, even when the immediate handoff is not SUCCEEDED', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/theta/autonomous-runtime.ts', 'utf8').replace(/\r\n/g, '\n');
  const waitRecheck = source.slice(source.indexOf("if (jobType === 'WAIT_RECHECK')"), source.indexOf("if (jobType === 'OPPORTUNITY_SCAN')"));
  const marked = waitRecheck.indexOf('opportunityScanCompleted=true;');
  const firstEarlyReturn = waitRecheck.indexOf("immediateHandoff.result.status!=='SUCCEEDED')return immediateHandoff.result;");
  const incompleteReturn = waitRecheck.indexOf('return degraded(`WAIT_RECHECK_SCAN_');
  assert.ok(marked > 0 && firstEarlyReturn > 0 && incompleteReturn > 0, 'the WAIT_RECHECK block keeps its shape');
  assert.ok(marked < firstEarlyReturn && marked < incompleteReturn,
    'the rescan is recorded BEFORE any early return (a SKIPPED handoff under the canary lock must not trigger a second full scan)');
  assert.match(waitRecheck, /if\(scan\.completeness==='COMPLETE'\)await cycleStore\.markNearMissesTriggered\(/,
    'near misses re-evaluated by a complete scan are marked, so WAIT_RECHECK does not re-run them every cycle');
  assert.match(source, /if\(opportunityScanCompleted\)return skipped\('FULL_FRONTIER_ALREADY_RESCANNED'\);/);
});
