import assert from 'node:assert/strict';
import test from 'node:test';
import type { Environment } from '../src/config/environment.js';
import { runDatabaseIndependentShadowObservation } from '../src/theta/database-independent-shadow-observation.js';
import type { AlpacaProviderConfig } from '../src/theta/alpaca-provider.js';
import type { ThetaShadowCycleResult } from '../src/theta/theta-shadow-cycle.js';
import type { UniverseDiscoveryResult } from '../src/theta/universe-discovery.js';

const environment={THETA_PYTHON_EXECUTABLE:'python'} as Environment;
const alpaca={tradingApiBase:'https://paper-api.alpaca.markets',marketDataApiBase:'https://data.alpaca.markets',
  apiKey:'test-only',apiSecret:'test-only'} as AlpacaProviderConfig;
const now=()=> '2026-09-24T15:30:00.000Z';

const discovery={candidates:[{symbol:'SPY',currentPrice:670,avgDollarVolume:1_000_000_000,
  hasUsableOptionChain:true,unsupportedCorporateActionPending:null,eventNear:null}],candidatesOrigin:'REAL_PROVIDER',
  blockers:[],funnel:{sourceAssets:1,activeTradable:1,boundedCohort:1,underlyingData:1,liquidity:1,
    optionability:1,optionContracts:1,dteWindow:1,optionQuotes:1,candidateAssembly:1}} as unknown as UniverseDiscoveryResult;

const baseCycle={runId:'cycle',startedAt:now(),finishedAt:now(),universeFunnel:{},selectedUnderlying:'SPY',
  underlyingRanking:[],optionChainComplete:true,optionContractsComplete:true,snapshotContentHash:'a'.repeat(64),
  fusionSnapshot:null,snapshotValidForNewRisk:false,orchestration:null,strategyFrontier:null,
  strategyQualityDiagnostics:null,provenance:'REAL_PROVIDER',provenanceDetail:[],blockers:['AEGIS_EVIDENCE_UNKNOWN']} as unknown as ThetaShadowCycleResult;

test('database-independent observation runs real-path dependencies but can never authorize mutation',async()=>{
  let cycleRuns=0;
  let receivedBootstrapState:string|null=null;
  let receivedRecoveryUnderlyings:readonly string[]|undefined;
  const paperEntryBootstrap={state:'ELIGIBLE_UNCALIBRATED',policyVersion:'theta-paper-entry-bootstrap-v3',
    eligibilityTier:'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED',hardBlockers:[],executionAuthorized:false} as const;
  const report=await runDatabaseIndependentShadowObservation({environment,alpaca,now,paperEntryBootstrap,
    recoveryInventoryUnderlyings:[],dependencies:{
    discover:async()=>discovery,runCycle:async(config)=>{cycleRuns+=1;
      receivedBootstrapState=config.paperEntryBootstrap?.state??null;
      receivedRecoveryUnderlyings=config.recoveryInventoryUnderlyings;return baseCycle;},
  }});
  assert.equal(cycleRuns,1);
  assert.equal(receivedBootstrapState,'ELIGIBLE_UNCALIBRATED');
  assert.deepEqual(receivedRecoveryUnderlyings,[]);
  assert.equal(report.persistenceState,'SPOOLED_LOCAL_PENDING_DB');
  assert.equal(report.brokerMutationCapability,'BLOCKED_CANONICAL_POSTGRES_REQUIRED');
  assert.equal(report.deadlinePolicy.version,'theta-db-independent-deadline-v1');
  assert.deepEqual(report.approvedSymbolsDiscovered,['SPY']);
  assert.equal(report.symbols[0]?.qCandidateCount,0);
  assert.deepEqual(report.symbols[0]?.qReasonCodes,[]);
  assert.deepEqual(report.symbols[0]?.qCandidates,[]);
  assert.equal(report.symbols[0]?.exactRefresh.state,'NOT_APPLICABLE');
});

test('a stalled canonical cycle becomes typed partial evidence within the configured deadline',async()=>{
  const report=await runDatabaseIndependentShadowObservation({environment,alpaca,now,
    deadlineMs:{discovery:100,cycle:5,exactRefresh:100},dependencies:{discover:async()=>discovery,
      runCycle:async()=>new Promise<ThetaShadowCycleResult>(()=>{})}});
  assert.equal(report.symbols[0]?.state,'FAILED');
  assert.equal(report.symbols[0]?.failureCode,'DATABASE_INDEPENDENT_CYCLE_TIMEOUT');
  assert.equal(report.brokerMutationCapability,'BLOCKED_CANONICAL_POSTGRES_REQUIRED');
});

test('database-independent observation refreshes the exact selected contract with a GET-only quote',async()=>{
  const optionSymbol='SPY261016P00600000';
  const cycle={...baseCycle,strategyFrontier:{selectedCandidateId:'candidate-1',selectedQuantity:1,primaryAction:'OPEN',
    branches:[{candidates:[{candidateId:'candidate-1',branch:'THETA_CONVENTIONAL',aegisState:'ALLOW_FULL',
      hardBlockers:[],unknownEvidence:[],sizing:{quantity:1},legs:[{optionSymbol}]}]}]},
    orchestration:{thetaQ:{candidates:[{candidateId:'candidate-1',actionFeasible:true,quantity:1,reasons:[],
      paperBootstrapReasonCodes:[]}]},receipt:{winningAction:'OPEN',reasonCodes:['CANDIDATE_SELECTED']},
      ownershipByCandidateId:{'candidate-1':{ownability:0.8,components:[{name:'LiquidityQuality',value:1,
        reasons:[{code:'LIQUIDITY_ACCEPTABLE'}]}]}},
      aegisByCandidateId:{[optionSymbol]:{newRiskState:'ALLOW_FULL',families:[{family:'SYSTEM',state:'ALLOW_FULL',
        reasons:[{code:'SYSTEM_CLEAR'}]}],reasons:[{code:'ALL_FAMILIES_CLEAR'}]}},
      aegis:{newRiskState:'ALLOW_FULL'}}} as unknown as ThetaShadowCycleResult;
  let refreshCalls=0;
  const report=await runDatabaseIndependentShadowObservation({environment,alpaca,now,dependencies:{
    discover:async()=>discovery,runCycle:async()=>cycle,
    refreshExact:async()=>{refreshCalls+=1;return {complete:true,snapshots:new Map([[optionSymbol,{bid:4.1,ask:4.2,
      bidSize:10,askSize:12,quoteTimestamp:'2026-09-24T15:29:59.000Z'}]])} as never;},
  }});
  assert.equal(refreshCalls,1);
  assert.equal(report.symbols[0]?.exactRefresh.state,'READY_READ_ONLY');
  assert.equal(report.symbols[0]?.exactRefresh.bid,4.1);
  assert.equal(report.symbols[0]?.selectedQuantity,1);
  assert.equal(report.symbols[0]?.canonicalAction,'OPEN');
  assert.equal(report.symbols[0]?.qCandidates[0]?.ownershipOwnability,0.8);
  assert.deepEqual(report.symbols[0]?.frontierCandidates[0]?.aegisFamilies,
    [{family:'SYSTEM',state:'ALLOW_FULL',reasonCodes:['SYSTEM_CLEAR']}]);
  assert.equal(report.brokerMutationCapability,'BLOCKED_CANONICAL_POSTGRES_REQUIRED');
});
