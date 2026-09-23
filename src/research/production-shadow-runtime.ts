import path from 'node:path';
import type { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { AlpacaProviderError, fetchOptionSnapshots, type AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import { discoverRealUniverse, type UniverseDiscoveryResult } from '../theta/universe-discovery.js';
import type { UnderlyingCandidateInput } from '../theta/universe-policy.js';
import { defaultShadowCycleConfig, optionomicsConfigFromEnvironment } from '../theta/theta-shadow-once.js';
import { runThetaShadowCycle } from '../theta/theta-shadow-cycle.js';
import type { PythonBridgeConfig } from '../theta/python-bridge.js';
import { PostgresThetaCycleStore } from '../theta/postgres-theta-cycle-store.js';
import { buildObservationSchedule, PostgresShadowEvidenceRuntimeStore, runCrossSymbolShadowScan } from './shadow-evidence-runtime.js';
import { PostgresPointInTimeEvidenceStore } from './point-in-time-evidence.js';
import { ensureMasterShadowContext } from './master-shadow-context.js';
import { PostgresShadowVirtualTrader, type ShadowIntentCreationReport } from './postgres-shadow-virtual-trader.js';
import { assembleMasterPaperEvidencePlan } from '../execution/master-paper-plan-assembly.js';
import { PostgresMasterPaperActionPlanStore } from '../execution/postgres-master-paper-action-plan-store.js';
import { deriveAntiParalysisFindings, PostgresRuntimeBehaviorDiagnosticStore, type RuntimeBehaviorDiagnostic } from '../theta/runtime-behavior-diagnostic.js';
import { buildUniverseBreadthShadowPlan } from './strategy-quality-shadow-diagnostics.js';
import type { BrokerReconciliationResult } from '../execution/broker-reconciliation-worker.js';
import { assessPaperEntryBootstrap, classifyAlpacaBrokerEnvironment } from '../theta/paper-entry-bootstrap.js';
import { loadRecoveryHistory } from '../theta/recovery-history-loader.js';
import { loadPersistedPendingCorporateActionSymbols, persistAlpacaCorporateActionRead, readAlpacaCorporateActions,
  type CorporateActionRead } from '../theta/alpaca-corporate-action-evidence.js';
import type { CanonicalBranchFrontier, CanonicalFrontierCandidate } from '../theta/canonical-strategy-frontier.js';
import { probeAlpacaProcessEnvironmentAuth } from '../providers/readiness.js';
import { refreshAegisIvStress, type AegisIvStressRefreshResult } from '../theta/aegis-iv-stress.js';
import { assessAegisSpreadStressForContracts } from '../theta/aegis-spread-stress.js';
import { assessAlpacaContractIvStressForContracts,
  verifyPersistedAlpacaContractIvAssessment } from '../theta/aegis-alpaca-iv-stress.js';
import { paperBootstrapStressApplicability } from './aegis-stress-baseline-maturity.js';
import type { OptionomicsProviderConfig } from '../theta/optionomics-provider.js';
import { applyCompanyEventPaperPolicy, applyCorporateActionPaperPolicy, buildPaperEntrySafetyPolicyReceipt,
  classifyPaperInstrument } from '../theta/paper-entry-safety-policy.js';
import type { OptionomicsEarningsEvidence } from '../theta/earnings-event-evidence.js';
import type { MacroRiskEvidence } from '../theta/macro-event-policy.js';
import type { AlpacaCalendarSession } from '../theta/alpaca-provider.js';
import { verifyAegisAssessmentIdentity } from '../theta/aegis-assessment-identity.js';

export interface ProductionShadowScanReport {
  readonly scanId:string; readonly completeness:string; readonly candidateCount:number;
  readonly researchMissingScope:readonly string[];
  readonly symbolsAttempted:number; readonly symbolsCompleted:number; readonly observationsScheduled:number;
  readonly actionPlansReady:number; readonly actionPlansBlocked:readonly string[];
  readonly virtualOpening:ShadowIntentCreationReport;
  readonly behaviorDiagnostic:RuntimeBehaviorDiagnostic;
}

export interface ObservationProcessingReport {readonly due:number;readonly observed:number;readonly missed:number;
  readonly shadowFilled:number;readonly shadowPartial:number;readonly shadowExpiredUnfilled:number;}

export type ObservationMissReason='HOST_OFFLINE'|'PROVIDER_UNAVAILABLE'|'SESSION_ENDED'|'INVALID_CONTRACT'|'INVALID_QUOTE';
export function classifyObservationFailure(error:unknown):ObservationMissReason {
  if(error instanceof AlpacaProviderError)return 'PROVIDER_UNAVAILABLE';
  return 'PROVIDER_UNAVAILABLE';
}

const blockerCount=(values:readonly string[]):Readonly<Record<string,number>>=>values.reduce<Record<string,number>>((counts,value)=>{
  counts[value]=(counts[value]??0)+1;return counts;
},{});
const isQuoteEvidence=(value:string):boolean=>/QUOTE|BBO|EXECUTABLE|PRICE/.test(value);
const isLiquidityEvidence=(value:string):boolean=>/LIQUID|SPREAD|OPEN_INTEREST|VOLUME/.test(value);
export function universeDiscoveryDiagnosticBlockers(discovery: UniverseDiscoveryResult): readonly string[] {
  const knownCodes = discovery.blockers.map((blocker) => blocker.split(':', 1)[0] ?? 'UNIVERSE_DISCOVERY_ERROR');
  if (discovery.candidates.length === 0) knownCodes.push('UNIVERSE_DISCOVERY_ZERO_CANDIDATES_COVERAGE_UNVERIFIED');
  return [...new Set(knownCodes)].toSorted();
}
export function paperEntryCandidateCohort(branches:readonly CanonicalBranchFrontier[]):{
  readonly branches:readonly CanonicalBranchFrontier[];
  readonly candidates:readonly CanonicalFrontierCandidate[];
}{
  const entryBranches=branches.filter((branch)=>branch.branch==='THETA_CONVENTIONAL'&&branch.applicable);
  return {branches:entryBranches,candidates:entryBranches.flatMap((branch)=>branch.candidates)};
}
export function ivStressEvidenceForUnderlying(underlying:string, result:AegisIvStressRefreshResult):AegisIvStressRefreshResult {
  if(result.assessment!==null && result.assessment.underlying!==underlying.toUpperCase()) {
    return {state:'INVALID',assessment:null,reason:'AEGIS_IV_STRESS_UNDERLYING_MISMATCH'};
  }
  return result;
}
export async function refreshScanIvStress(input:{readonly pool:Pool;readonly optionomics:OptionomicsProviderConfig|null;
  readonly underlying:string;readonly now:()=>string},
  refresh:typeof refreshAegisIvStress=refreshAegisIvStress):Promise<AegisIvStressRefreshResult>{
  if(input.optionomics===null)return {state:'OBSERVATION_UNKNOWN',assessment:null,reason:'OPTIONOMICS_NOT_CONFIGURED'};
  return ivStressEvidenceForUnderlying(input.underlying,await refresh({pool:input.pool,optionomics:input.optionomics,
    underlying:input.underlying,decisionAsOf:input.now(),freezeDecisionAsOf:input.now}));
}
export function ivStressPaperBlockers(states:ReadonlyMap<string,AegisIvStressRefreshResult>,
  brokerAuthoritySymbols:ReadonlySet<string>):readonly string[]{
  return [...states].sort(([left],[right])=>left.localeCompare(right))
    .flatMap(([symbol,result])=>!ivStressPaperPlanPersistenceReady(result)&&brokerAuthoritySymbols.has(symbol)
      ? [`${symbol}:AEGIS_IV_STRESS_${result.state}`]:[]);
}
export function ivStressPaperPlanPersistenceReady(result:AegisIvStressRefreshResult|undefined):boolean{
  if(result?.assessment===null||result===undefined)return false;
  if(result.assessment.sessionState!=='CURRENT_SESSION'
    ||result.assessment.currentTimingState!=='PROVIDER_ASOF_CURRENT_SESSION')return false;
  if(result.state==='READY')return result.assessment.maturity.state==='DETECTOR_READY';
  // A real, persisted current observation and assessment may invoke the
  // versioned Paper baseline cold-start policy. Provider and persistence
  // failures never qualify for that exception.
  return result.state==='BASELINE_IMMATURE'
    &&paperBootstrapStressApplicability(result.assessment.maturity.state)==='PAPER_COLD_START_NOT_APPLICABLE';
}
export function ivStressApplicability(result:AegisIvStressRefreshResult):'REQUIRED'|'PAPER_COLD_START_NOT_APPLICABLE'{
  return result.state==='BASELINE_IMMATURE' && result.assessment?.sessionState==='CURRENT_SESSION'
    && result.assessment.currentTimingState==='PROVIDER_ASOF_CURRENT_SESSION'
    ? paperBootstrapStressApplicability(result.assessment.maturity.state) : 'REQUIRED';
}
export function missingObservationReason(contractFound:boolean,enumerationComplete=true,sessionConfirmedEnded=false):ObservationMissReason {
  if(contractFound)return 'INVALID_QUOTE';
  if(!enumerationComplete)return 'PROVIDER_UNAVAILABLE';
  return sessionConfirmedEnded?'SESSION_ENDED':'INVALID_CONTRACT';
}

export function applyPendingUnsupportedCorporateActions(
  candidates: readonly UnderlyingCandidateInput[],
  pendingUnsupportedSymbols: ReadonlySet<string>,
): readonly UnderlyingCandidateInput[] {
  return candidates.map((candidate) => ({
    ...candidate,
    // Positive evidence can stop new risk. Alpaca expressly does not
    // guarantee publication timing, so an empty result remains UNKNOWN.
    unsupportedCorporateActionPending: pendingUnsupportedSymbols.has(candidate.symbol) ? true : null,
  }));
}

/** Report independent Paper-entry evidence gaps without changing the entry gate. */
export function paperEntryEventEvidenceBlockers(
  symbol: string,
  evidence: Pick<UnderlyingCandidateInput, 'unsupportedCorporateActionPending' | 'eventNear'> | null,
): readonly string[] {
  const corporateAction = evidence?.unsupportedCorporateActionPending;
  const eventNear = evidence?.eventNear;
  return [
    ...(corporateAction === true ? [`${symbol}:UNSUPPORTED_CORPORATE_ACTION`]
      : corporateAction === false ? [] : [`${symbol}:CORPORATE_ACTION_COVERAGE_UNKNOWN`]),
    ...(eventNear === true ? [`${symbol}:EVENT_PROXIMITY`]
      : eventNear === false ? [] : [`${symbol}:EVENT_PROXIMITY_UNKNOWN`]),
  ];
}

export async function processDueExecutionObservations(input:{pool:Pool;alpaca:AlpacaProviderConfig;now:()=>string}):Promise<ObservationProcessingReport>{
  const observedAt=input.now();
  const jobs=await input.pool.query(`SELECT j.observation_job_id,j.candidate_id,j.contract_symbol,j.horizon_code,j.target_at,u.symbol AS underlying,
    lower(oc.option_type::text) AS option_type
    FROM research.theta_execution_observation_job j JOIN trade.candidate c ON c.candidate_id=j.candidate_id
    JOIN market.option_contract oc ON oc.option_contract_id=c.option_contract_id
    JOIN market.underlying u ON u.underlying_id=oc.underlying_id
    WHERE j.status='PENDING' AND j.target_at <= $1 ORDER BY j.target_at,j.observation_job_id LIMIT 50`,[observedAt]);
  const store=new PostgresShadowEvidenceRuntimeStore(input.pool);
  const quoteStore=new PostgresPointInTimeEvidenceStore(input.pool); const virtualTrader=new PostgresShadowVirtualTrader(input.pool);
  let observed=0,missed=0,shadowFilled=0,shadowPartial=0,shadowExpiredUnfilled=0;
  const byUnderlyingAndType=new Map<string,typeof jobs.rows>();
  for(const row of jobs.rows){
    if(Date.parse(observedAt)-Date.parse(String(row.target_at))>120_000){
      if(await store.markObservationMissed(String(row.observation_job_id),observedAt,'OBSERVATION_MISSED_NO_ACTIVE_WORKER')) missed++;
      continue;
    }
    const key=`${String(row.underlying)}:${String(row.option_type)}`;
    const list=byUnderlyingAndType.get(key)??[];list.push(row);byUnderlyingAndType.set(key,list);
  }
  for(const [key,rows] of byUnderlyingAndType){
    try{
      const [underlying,optionType]=key.split(':') as [string,'put'|'call'];
      const result=await fetchOptionSnapshots(input.alpaca,{underlyingSymbol:underlying,feed:'indicative',optionType,limit:1000,maxPages:10});
      for(const row of rows){
        const quote=result.snapshots.get(String(row.contract_symbol));
        if(quote===undefined){
          const reason=missingObservationReason(false,result.complete);
          if(await store.markObservationMissed(String(row.observation_job_id),observedAt,reason)) missed++;
          continue;
        }
        if(quote.bid===null||quote.ask===null||quote.bid<0||quote.ask<=0||quote.bid>quote.ask){
          if(await store.markObservationMissed(String(row.observation_job_id),observedAt,missingObservationReason(true))) missed++;
          continue;
        }
        const quoteId=String(row.observation_job_id);
        const age=quote.quoteTimestamp===null?null:(Date.parse(observedAt)-Date.parse(quote.quoteTimestamp))/1000;
        await quoteStore.saveQuote({quoteObservationId:quoteId,candidateId:String(row.candidate_id),managementInputSnapshotId:null,
          observationRole:'SUBSEQUENT',observedAt,providerTimestamp:quote.quoteTimestamp,ingestionTimestamp:observedAt,
          source:'ALPACA',operationAlias:'alpaca.get_option_snapshots',feed:'INDICATIVE',contractVersion:'alpaca-option-snapshots-v1',
          bid:quote.bid,ask:quote.ask,bidSize:quote.bidSize,askSize:quote.askSize,proposedLimit:null,
          dataQuality:age===null?'UNKNOWN':age>60?'STALE':'GOOD'});
        if(await store.markObservationObserved(String(row.observation_job_id),quoteId,observedAt)) {
          observed++;
          const resolved=await virtualTrader.resolveObservation(String(row.candidate_id),quoteId,String(row.horizon_code),observedAt);
          if(resolved.state==='FILLED_SHADOW')shadowFilled+=resolved.filledQuantity;
          if(resolved.state==='PARTIAL_SHADOW')shadowPartial+=resolved.filledQuantity;
          if(resolved.state==='EXPIRED_UNFILLED')shadowExpiredUnfilled++;
        }
      }
    }catch(error){
      const reason=classifyObservationFailure(error);
      for(const row of rows) if(await store.markObservationMissed(String(row.observation_job_id),observedAt,reason)) missed++;
    }
  }
  return {due:jobs.rowCount??0,observed,missed,shadowFilled,shadowPartial,shadowExpiredUnfilled};
}

const productionPythonHost:string|undefined=process.env.VERCEL_ENV==='production'
  ? process.env.VERCEL_PROJECT_PRODUCTION_URL??'trading-bots-one.vercel.app':undefined;

const bridge=(environment:Environment):PythonBridgeConfig=>({
  pythonExecutablePath:environment.THETA_PYTHON_EXECUTABLE,
  scriptAllowlist:new Map([
    ['ownership',path.resolve('bots/theta/quant/runtime/ownership_contract.py')],
    ['regime',path.resolve('bots/theta/quant/runtime/regime_contract.py')],
    ['strategyRouter',path.resolve('bots/theta/quant/runtime/strategy_router_contract.py')],
    ['thetaQ',path.resolve('bots/theta/quant/runtime/theta_q_contract.py')],
    ['paretoFrontier',path.resolve('bots/theta/quant/runtime/pareto_frontier_contract.py')],
    ['opportunityFrontier',path.resolve('bots/theta/quant/runtime/opportunity_frontier_contract.py')],
    ['aegis',path.resolve('bots/theta/quant/runtime/aegis_contract.py')],
    ['sizing',path.resolve('bots/theta/quant/runtime/sizing_contract.py')],
    ['executionQuality',path.resolve('bots/theta/quant/runtime/execution_quality_contract.py')],
  ]),timeoutMs:10_000,maxOutputBytes:2_000_000,
  remote:productionPythonHost&&environment.CRON_SECRET?{
    endpoint:`https://${productionPythonHost}/api/quant-runtime`,
    bearerToken:environment.CRON_SECRET,
  }:undefined,
});

export async function runProductionShadowEvidenceScan(input:{environment:Environment;pool:Pool;alpaca:AlpacaProviderConfig;
  executionAccountId?:string|null;reconciliation:BrokerReconciliationResult;now:()=>string}):Promise<ProductionShadowScanReport>{
  if(input.environment.THETA_RUNTIME_MODE!=='MASTER_THETA_PAPER') throw new Error('MASTER_THETA_PAPER_RUNTIME_REQUIRED');
  if(process.env.VERCEL_ENV==='production'){
    // This is deliberately independent of the encrypted master credential.
    // A local dotenv success or broker reconciliation cannot prove that the
    // Vercel Production ALPACA_* pair authenticates.
    const checks=await probeAlpacaProcessEnvironmentAuth(input.environment);
    console.info(JSON.stringify({event:'THETA_ALPACA_ENV_AUTH_V1',source:'VERCEL_PRODUCTION_PROCESS_ENV',
      brokerHost:'paper-api.alpaca.markets',checks}));
  }
  const paperEntryBootstrap=assessPaperEntryBootstrap({
    enabled:true,runtimeMode:input.environment.THETA_RUNTIME_MODE,
    brokerEnvironment:classifyAlpacaBrokerEnvironment(input.alpaca.tradingApiBase),
    accountStatus:input.reconciliation.accountStatus,reconciliationQuality:input.reconciliation.dataQuality,
    localOnlyIntentCount:input.reconciliation.localOnlyIntentCount,
    // Preserve every raw broker fact for audit, while only current exposure,
    // current reconciliation defects, and unknown-current-impact facts block
    // new entry. Settled historical fills/fees/journals do not create false
    // paralysis.
    externalOrUnknownOrderCount:input.reconciliation.entryBlockingFactCount,
    marketOpen:input.reconciliation.marketOpen,
    calendarSessionConfirmed:input.reconciliation.calendarSessionConfirmed,
    followerExecutionEnabled:input.environment.FOLLOWER_PAPER_EXECUTION_ENABLED,
    liveMoneyAuthorized:false,
  });
  const runtimeContext=await loadPersistenceContext(input.pool,input.alpaca,input.now());
  const recoveryRows=await input.pool.query(`SELECT DISTINCT u.symbol
    FROM trade.economic_chain ec
    JOIN trade.stock_lot sl ON sl.chain_id=ec.chain_id AND sl.disposed_at IS NULL
    JOIN market.underlying u ON u.underlying_id=sl.underlying_id
    WHERE ec.bot_instance_id=$1 AND ec.closed_at IS NULL
      AND ec.lifecycle_state IN ('ASSIGNED','STOCK_HELD','RECOVERY_WAIT','CC_PROPOSED','CC_OPEN','CLOSE_CC')
    ORDER BY u.symbol`,[runtimeContext.botInstanceId]);
  const recoveryInventoryUnderlyings=recoveryRows.rows.map((row)=>String((row as Record<string,unknown>).symbol));
  const discovery=await discoverRealUniverse(input.alpaca,{discoveryVersion:'theta-shadow-universe-v1',maxCandidateAssets:100,
    allowedExchanges:['NYSE','NASDAQ','ARCA','BATS'],barsLookbackDays:30,barsBatchSize:100,maxOptionabilityChecks:10,minCurrentPrice:5},input.now);
  const discoveryBlockers=universeDiscoveryDiagnosticBlockers(discovery);
  // Discovery already preserves the existing average-dollar-volume rank.
  // Never alphabetize here because the first two entries are the unchanged
  // champion set and retain broker authority.
  const rankedSymbols=discovery.candidates.map((candidate)=>candidate.symbol);
  const scanOrdinal=Math.max(0,Math.floor(Date.parse(input.now())/60_000));
  const universeBreadthChallenger=buildUniverseBreadthShadowPlan(rankedSymbols,scanOrdinal);
  const scanSymbols=new Set([...universeBreadthChallenger.championSymbols,
    ...universeBreadthChallenger.challengerSymbols.map((candidate)=>candidate.symbol)]);
  const scanUnderlyingsRaw=discovery.candidates.filter((candidate)=>scanSymbols.has(candidate.symbol));
  const runtimeSafetyBlockers:string[]=[];
  let pendingUnsupportedSymbols=new Set<string>();
  let currentPendingUnsupportedSymbols=new Set<string>();
  let corporateActionReadSucceeded=false;
  let corporateActionRead:CorporateActionRead|null=null;
  let corporateActionProviderError=false;
  const corporateActionSymbols=[...new Set([...scanUnderlyingsRaw.map((candidate)=>candidate.symbol),...recoveryInventoryUnderlyings])].sort().slice(0,20);
  if(corporateActionSymbols.length>0){
    try{
      const observedAt=input.now();
      const start=observedAt.slice(0,10);
      const end=new Date(Date.parse(`${start}T00:00:00Z`)+45*86_400_000).toISOString().slice(0,10);
      const read=await readAlpacaCorporateActions({config:input.alpaca,
        symbols:corporateActionSymbols,start,end,observedAt});
      corporateActionRead=read;
      await persistAlpacaCorporateActionRead(input.pool,read);
      if(!read.paginationComplete)runtimeSafetyBlockers.push('ALPACA_CORPORATE_ACTION_PAGINATION_INCOMPLETE');
      const persistedPending=await loadPersistedPendingCorporateActionSymbols(input.pool,{
        symbols:corporateActionSymbols,start,end,decisionAsOf:input.now(),
      });
      currentPendingUnsupportedSymbols=new Set(read.observations.filter((row)=>row.pendingUnsupported).map((row)=>row.symbol));
      pendingUnsupportedSymbols=new Set([...currentPendingUnsupportedSymbols,
        ...persistedPending]);
      corporateActionReadSucceeded=read.paginationComplete;
    }catch{
      corporateActionProviderError=true;
      runtimeSafetyBlockers.push('ALPACA_CORPORATE_ACTION_READ_OR_PERSISTENCE_FAILED');
    }
  }
  const scanUnderlyings=applyPendingUnsupportedCorporateActions(scanUnderlyingsRaw,pendingUnsupportedSymbols);
  const brokerAuthoritySymbols=new Set(universeBreadthChallenger.championSymbols);
  const optionomics=optionomicsConfigFromEnvironment(input.environment);
  // The Optionomics ATM-IV detector is secondary research on schema 064.
  // Do not make an authenticated provider call that can only end in 42P01.
  const optionomicsIvSchemaReady=await input.pool.query(`SELECT to_regclass('risk.aegis_iv_stress_assessment') IS NOT NULL AS ready`)
    .then((result)=>result.rows[0]?.ready===true).catch(()=>false);
  const scan=await runCrossSymbolShadowScan({universeVersion:'theta-shadow-universe-v1',latticeVersion:'lattice-v1-shadow-once',
    strategyVersion:'theta-shadow-once-v1',eligibleUnderlyings:scanUnderlyings,maxUnderlyings:Math.max(1,scanUnderlyings.length),
    branches:['THETA_CONVENTIONAL','THETA_HOLD_STRIKE','THETA_RECOVERY','THETA_CC','THETA_DEFINED_RISK']},async(underlying)=>{
      const ivStressRefresh=optionomicsIvSchemaReady
        ? await refreshScanIvStress({pool:input.pool,optionomics,underlying:underlying.symbol,now:input.now})
        : {state:'PERSISTENCE_ERROR' as const,assessment:null,reason:'OPTIONOMICS_IV_SCHEMA_065_UNAVAILABLE'};
      const config=defaultShadowCycleConfig(input.alpaca,optionomics,bridge(input.environment),[underlying],discovery.candidatesOrigin);
      const recoveryHistory=await loadRecoveryHistory(input.pool,underlying.symbol,input.now());
      return runThetaShadowCycle({...config,evaluationMode:'SHADOW_EVIDENCE',paperEntryBootstrap,recoveryHistory,recoveryInventoryUnderlyings,
        aegisInputsOrigin:'DERIVED_FROM_REAL',
        aegisIvStressEvidence:ivStressRefresh.assessment,
        aegisSpreadStressAssessor:({contracts,decisionAsOf})=>assessAegisSpreadStressForContracts({
          pool:input.pool,contracts,decisionAsOf,
        }),
        aegisAlpacaIvStressAssessor:({contracts,decisionAsOf})=>assessAlpacaContractIvStressForContracts({
          pool:input.pool,contracts,decisionAsOf,
        }),
        aegisInputs:{
        tickerConcentrationPct:null,sectorConcentrationPct:null,correlationClusterExposurePct:null,
        portfolioCapitalAtRiskPct:null,inventoryCapacityUsedPct:null,assignmentCapacityUsedPct:null,
        recoveryCapacityUsedPct:null,liquidityAcceptable:null,executionQualityAcceptable:null,providerState:null,
        stressGapDetected:null,stressIvShockDetected:null,
        stressIvShockApplicability:'REQUIRED',
        stressSpreadWideningDetected:null,
      }});
    },input.now);
  // Research-only breadth challengers retain their own evidence state, but
  // must not become a blocker for the Paper-authorized champion cohort.
  // Optionomics remains in the immutable research snapshot but cannot grant
  // or veto Paper authority while its as-of and schema-065 contract is open.
  const cycleStore=new PostgresThetaCycleStore(input.pool),persisted=new Map<string,{
    fusionSnapshotId:string|null;candidateSetId:string|null;decisionId:string|null;
  }>();
  let observationsScheduled=0;
  let actionPlansReady=0;
  const actionPlansBlocked:string[]=[...runtimeSafetyBlockers];
  const evidenceStore=new PostgresShadowEvidenceRuntimeStore(input.pool);
  for(const member of scan.results){
    if(member.cycle?.fusionSnapshot===null||member.cycle===null) continue;
    const saved=await cycleStore.persist(runtimeContext,member.cycle);
    persisted.set(member.symbol,{fusionSnapshotId:saved.fusionSnapshotId,candidateSetId:saved.candidateSetId,decisionId:saved.decisionId});
    const selectedOptionSymbol=member.cycle.strategyFrontier?.selectedCandidateId??null;
    const selectedFrontierCandidate=member.cycle.strategyFrontier?.branches.flatMap((branch)=>branch.candidates)
      .find((candidate)=>candidate.candidateId===member.cycle?.strategyFrontier?.selectedCandidateId);
    const selectedLeg=selectedFrontierCandidate?.legs[0];
    const eventState=member.cycle.fusionSnapshot.snapshot.eventState;
    const eventObject=eventState!==null&&typeof eventState==='object'&&!Array.isArray(eventState)
      ? eventState as Record<string,unknown>:{};
    const earnings=eventObject.earningsDistance as OptionomicsEarningsEvidence|undefined;
    const macro=eventObject.macroRisk as MacroRiskEvidence|undefined;
    const marketSessionObject=member.cycle.fusionSnapshot.snapshot.marketSession;
    const marketSessionForPolicy=marketSessionObject!==null&&typeof marketSessionObject==='object'&&!Array.isArray(marketSessionObject)
      ? marketSessionObject as Record<string,unknown>:{};
    const calendar=Array.isArray(marketSessionForPolicy.calendar)
      ? marketSessionForPolicy.calendar as unknown as readonly AlpacaCalendarSession[]:[];
    const planDecisionAsOf=String(member.cycle.fusionSnapshot.snapshot.decisionTimeUtc);
    const instrument=earnings===undefined?null:classifyPaperInstrument({symbol:member.symbol,
      decisionAsOf:planDecisionAsOf,earnings});
    const companyEvent=instrument===null||earnings===undefined||macro===undefined||selectedLeg===undefined?null
      :applyCompanyEventPaperPolicy({decisionAsOf:planDecisionAsOf,expiration:selectedLeg.expiration,
        calendar,instrument,earnings,macro});
    const snapshotPositionState=member.cycle.fusionSnapshot.snapshot.positionState;
    const snapshotPositions=snapshotPositionState!==null&&typeof snapshotPositionState==='object'&&!Array.isArray(snapshotPositionState)
      &&Array.isArray((snapshotPositionState as Record<string,unknown>).positions)
      ? (snapshotPositionState as Record<string,unknown>).positions as unknown[]:[];
    const oneRiskyUnderlying=snapshotPositions.every((value)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
      &&String((value as Record<string,unknown>).symbol??'')===member.symbol);
    const corporateAction=selectedLeg===undefined||instrument===null?null:applyCorporateActionPaperPolicy({
      symbol:member.symbol,decisionAsOf:planDecisionAsOf,read:corporateActionRead,
      providerError:corporateActionProviderError,currentPositiveRelevant:currentPendingUnsupportedSymbols.has(member.symbol),
      persistedPositiveRelevance:pendingUnsupportedSymbols.has(member.symbol)?'PENDING_RELEVANT':'EXPIRED_NOT_RELEVANT',
      standardOptionContract:selectedLeg.occSymbol===selectedLeg.optionSymbol&&selectedLeg.contractTradable===true,
      ordinaryDeliverable:selectedLeg.deliverableClassification==='STANDARD_EQUITY',
      verifiedMultiplier:selectedLeg.multiplier===100,approvedFirstPaperInstrument:instrument.paperBootstrapApproved,
      oneRiskyUnderlyingPolicy:oneRiskyUnderlying,reconciliationGood:input.reconciliation.dataQuality==='GOOD'
        &&input.reconciliation.entryBlockingFactCount===0,
      aegisGood:['ALLOW_FULL','ALLOW_REDUCED'].includes(selectedFrontierCandidate?.aegisState??''),
      freshQuote:selectedLeg.bid!==null&&selectedLeg.ask!==null&&selectedLeg.quoteTimestamp!==null
        &&!selectedFrontierCandidate?.unknownEvidence.some((reason)=>reason.startsWith('EXECUTION_QUOTE_REQUIRED')),
    });
    const entrySafetyPolicy=companyEvent===null||corporateAction===null?null
      :buildPaperEntrySafetyPolicyReceipt({decisionAsOf:planDecisionAsOf,companyEvent,corporateAction});
    if(brokerAuthoritySymbols.has(member.symbol)&&selectedFrontierCandidate!==undefined){
      if(entrySafetyPolicy===null)actionPlansBlocked.push(`${member.symbol}:ENTRY_SAFETY_POLICY_EVIDENCE_MISSING`);
      else if(entrySafetyPolicy.action==='BLOCK'){
        if(entrySafetyPolicy.companyEvent.action==='BLOCK')actionPlansBlocked.push(`${member.symbol}:COMPANY_EVENT_POLICY_${entrySafetyPolicy.companyEvent.state}`);
        if(entrySafetyPolicy.corporateAction.action==='BLOCK')actionPlansBlocked.push(`${member.symbol}:CORPORATE_ACTION_POLICY_${entrySafetyPolicy.corporateAction.state}`);
      }
    }
    const alpacaIvVerification=brokerAuthoritySymbols.has(member.symbol)&&selectedOptionSymbol!==null
      &&saved.fusionSnapshotId!==null
      ? await verifyPersistedAlpacaContractIvAssessment({pool:input.pool,
        fusionSnapshotId:saved.fusionSnapshotId,optionSymbol:selectedOptionSymbol,
        underlying:member.symbol,decisionAsOf:String(member.cycle.fusionSnapshot.snapshot.decisionTimeUtc)})
        .catch(()=>({ready:false,reason:'PERSISTED_ALPACA_IV_READ_FAILED',assessment:null}))
      : null;
    if(input.environment.MASTER_PAPER_EXECUTION_ENABLED&&!input.environment.PAPER_PAUSE_NEW_ORDERS
      &&corporateActionReadSucceeded&&entrySafetyPolicy?.action==='CLEAR'
      &&brokerAuthoritySymbols.has(member.symbol)
      &&alpacaIvVerification?.ready===true
      &&member.cycle.strategyFrontier!==null&&saved.decisionId!==null){
      const selected=await input.pool.query(`SELECT d.selected_candidate_id::text AS candidate_id,
        c.option_contract_id::text,oc.underlying_id::text,cv.assumptions_json,
        d.receipt_json->'aegisAssessmentIdentity' AS aegis_assessment_identity
        FROM trade.decision d
        LEFT JOIN trade.candidate c ON c.candidate_id=d.selected_candidate_id
        LEFT JOIN market.option_contract oc ON oc.option_contract_id=c.option_contract_id
        JOIN core.bot_instance bi ON bi.bot_instance_id=$2
        JOIN core.cost_model_version cv ON cv.cost_model_version_id=bi.cost_model_version_id
        WHERE d.decision_id=$1`,[saved.decisionId,runtimeContext.botInstanceId]);
      const row=selected.rows[0] as Record<string,unknown>|undefined;
      const snapshot=member.cycle.fusionSnapshot.snapshot;
      const account=snapshot.accountState!==null&&typeof snapshot.accountState==='object'&&!Array.isArray(snapshot.accountState)
        ? snapshot.accountState as Record<string,unknown>:{};
      const positionState=snapshot.positionState!==null&&typeof snapshot.positionState==='object'&&!Array.isArray(snapshot.positionState)
        ? snapshot.positionState as Record<string,unknown>:{};
      const positions=Array.isArray(positionState.positions)?positionState.positions:[];
      const orders=Array.isArray(positionState.openOrders)?positionState.openOrders:[];
      const assumptions=row?.assumptions_json!==null&&typeof row?.assumptions_json==='object'
        ? row.assumptions_json as Record<string,unknown>:{};
      const aegisAssessmentIdentity=verifyAegisAssessmentIdentity(row?.aegis_assessment_identity);
      const marketSession=snapshot.marketSession!==null&&typeof snapshot.marketSession==='object'&&!Array.isArray(snapshot.marketSession)
        ? snapshot.marketSession as Record<string,unknown>:{};
      const planNow=input.now();
      const boundedExpiry=new Date(Date.parse(planNow)+45_000).toISOString();
      const sessionClose=typeof marketSession.nextClose==='string'&&Number.isFinite(Date.parse(marketSession.nextClose))
        ? new Date(marketSession.nextClose).toISOString():null;
      const decisionExpiresAt=sessionClose!==null&&Date.parse(sessionClose)<Date.parse(boundedExpiry)?sessionClose:boundedExpiry;
      const assembled=assembleMasterPaperEvidencePlan({frontier:member.cycle.strategyFrontier,
        executionAccountId:input.executionAccountId??null,decisionId:saved.decisionId,
        persistedCandidateId:row?.candidate_id==null?null:String(row.candidate_id),
        optionContractId:row?.option_contract_id==null?null:String(row.option_contract_id),
        underlyingId:row?.underlying_id==null?null:String(row.underlying_id),
        accountStatus:typeof account.accountStatus==='string'?account.accountStatus:null,
        optionsApprovedLevel:n(account.optionsApprovedLevel),optionsTradingLevel:n(account.optionsTradingLevel),
        aegisState:selectedFrontierCandidate?.aegisState??null,
        aegisInputOrigin:member.cycle.provenanceDetail.includes('aegisInputs=DERIVED_FROM_REAL')?'DERIVED_FROM_REAL':null,
        aegisAssessmentIdentity,
        entrySafetyPolicy,
        openPositionSymbols:positions.flatMap((value)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
          &&typeof (value as Record<string,unknown>).symbol==='string'?[String((value as Record<string,unknown>).symbol)]:[]),
        openOrderSymbols:orders.flatMap((value)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
          &&typeof (value as Record<string,unknown>).symbol==='string'?[String((value as Record<string,unknown>).symbol)]:[]),
        paperEvidenceRiskCap:input.environment.PAPER_EVIDENCE_RISK_CAP,
        modeledRoundTripCostPerContract:n(assumptions.totalModeledCostPerContract),now:planNow,decisionExpiresAt});
      if(assembled.state==='READY'){
        if(await new PostgresMasterPaperActionPlanStore(input.pool).enqueue(assembled.plan,planNow,
          {botInstanceId:runtimeContext.botInstanceId,underlyingId:assembled.plan.underlyingId}))actionPlansReady++;
      }else if(assembled.state==='BLOCKED')actionPlansBlocked.push(...assembled.blockers.map((blocker)=>`${member.symbol}:${blocker}`));
    }else if(brokerAuthoritySymbols.has(member.symbol)&&entrySafetyPolicy?.action==='CLEAR'
      &&member.cycle.strategyFrontier?.selectedCandidateId!==null
      &&alpacaIvVerification?.ready!==true){
      actionPlansBlocked.push(`${member.symbol}:AEGIS_ALPACA_IV_${alpacaIvVerification?.reason??'MISSING'}`);
    }else if(brokerAuthoritySymbols.has(member.symbol)&&member.cycle.strategyFrontier?.selectedCandidateId!==null
      &&entrySafetyPolicy?.action!=='CLEAR'){
      actionPlansBlocked.push(`${member.symbol}:ENTRY_SAFETY_POLICY_NOT_CLEARED`);
    }else if(!brokerAuthoritySymbols.has(member.symbol)&&member.cycle.strategyFrontier?.selectedCandidateId!==null){
      actionPlansBlocked.push(`${member.symbol}:UNIVERSE_BREADTH_CHALLENGER_NO_BROKER_AUTHORITY`);
    }
    if(saved.candidateSetId===null) continue;
    const candidates=await input.pool.query(`SELECT c.candidate_id,oc.contract_symbol FROM trade.candidate c
      JOIN market.option_contract oc ON oc.option_contract_id=c.option_contract_id WHERE c.candidate_set_id=$1`,[saved.candidateSetId]);
    const session=member.cycle.fusionSnapshot.snapshot.marketSession;
    const marketClose=session!==null&&typeof session==='object'&&!Array.isArray(session)&&typeof session.nextClose==='string'
      ? session.nextClose:null;
    if(marketClose===null) continue;
    const observationRows=candidates.rows.flatMap((candidate)=>buildObservationSchedule({
      candidateId:String(candidate.candidate_id),contractSymbol:String(candidate.contract_symbol),
      decisionTime:member.cycle?.startedAt??scan.startedAt,marketClose,
    }));
    observationsScheduled+=await evidenceStore.scheduleObservations(observationRows);
  }
  await evidenceStore.saveScan(scan,persisted);
  const strategyFrontiers=scan.results.flatMap((member)=>member.cycle?.strategyFrontier?[member.cycle.strategyFrontier]:[]);
  const branchFrontiers=strategyFrontiers.flatMap((frontier)=>frontier.branches);
  // The full branch population remains in strategyDiagnostics and persisted
  // canonical evidence. Entry WAIT/strictness classification is scoped to
  // the sole Paper-authorized Conventional branch. Research counterfactuals
  // must not look like missed executable opportunities or new hard gates.
  const {branches:entryBranches,candidates:entryCandidates}=paperEntryCandidateCohort(branchFrontiers);
  const selectedCandidateIds=new Set(strategyFrontiers.flatMap((frontier)=>frontier.selectedCandidateId?[frontier.selectedCandidateId]:[]));
  const rejectedCandidates=entryCandidates.filter((candidate)=>!selectedCandidateIds.has(candidate.candidateId));
  const hardGateCounts=blockerCount(entryCandidates.flatMap((candidate)=>[...new Set(candidate.hardBlockers)]));
  const strategyDiagnostics=[...new Set(branchFrontiers.map((branch)=>branch.branch))].toSorted().map((branchName)=>{
    const rows=branchFrontiers.filter((branch)=>branch.branch===branchName);
    const candidates=rows.flatMap((branch)=>branch.candidates);
    return {branch:branchName,status:rows[0]?.status??'RESEARCH_ONLY' as const,consideredCount:rows.length,
      applicableCount:rows.filter((branch)=>branch.applicable).length,
      evaluatedCount:rows.filter((branch)=>branch.applicable&&branch.evaluated&&branch.evaluationState!=='BLOCKED_MISSING_INPUT').length,
      rejectedCount:candidates.filter((candidate)=>!selectedCandidateIds.has(candidate.candidateId)).length,
      candidateCount:candidates.length,hardGateRejectionCount:candidates.filter((candidate)=>candidate.hardBlockers.length>0).length,
      dataUnknownCount:candidates.filter((candidate)=>candidate.unknownEvidence.length>0).length,
      routeReasons:[...new Set(rows.flatMap((branch)=>branch.routeReasons))].toSorted(),
      hardGates:blockerCount(candidates.flatMap((candidate)=>[...new Set(candidate.hardBlockers)])),
      missingDataReasons:blockerCount(candidates.flatMap((candidate)=>[...new Set(candidate.unknownEvidence)])),
      reachabilityState:rows.every((branch)=>!branch.applicable)?'NOT_APPLICABLE_CURRENT_SCAN' as const
        :rows.some((branch)=>branch.applicable&&branch.evaluated&&branch.evaluationState!=='BLOCKED_MISSING_INPUT')?'REACHED' as const
          :'BLOCKED_WHEN_APPLICABLE' as const,
    };
  });
  const sessionStates=scan.results.flatMap((member)=>{
    const session=member.cycle?.fusionSnapshot?.snapshot.marketSession;
    if(session===null||typeof session!=='object'||Array.isArray(session))return ['UNKNOWN' as const];
    return [(session as Record<string,unknown>).isOpen===true?'OPEN' as const
      :(session as Record<string,unknown>).isOpen===false?'CLOSED' as const:'UNCONFIRMED' as const];
  });
  const distinctSessions=[...new Set(sessionStates)];
  const session=distinctSessions.length===1?distinctSessions[0]??'UNKNOWN':distinctSessions.length>1?'MIXED' as const
    :input.reconciliation.marketOpen===true&&input.reconciliation.calendarSessionConfirmed===true?'OPEN' as const
      :input.reconciliation.marketOpen===false?'CLOSED' as const:'UNKNOWN' as const;
  const antiParalysisFindings=deriveAntiParalysisFindings({
    candidateHardBlockers:entryCandidates.map((candidate)=>candidate.hardBlockers),strategyReachability:strategyDiagnostics,
  });
  const bestRejectedCandidates=scan.results.flatMap((member)=>{
    const frontier=member.cycle?.strategyFrontier;
    if(frontier===null||frontier===undefined)return [];
    const entryBranch=frontier.branches.find((branch)=>branch.branch==='THETA_CONVENTIONAL');
    const candidate=entryBranch?.candidates.find((item)=>item.candidateId===entryBranch.bestRejectedCandidateId)??null;
    return candidate===null?[]:[{symbol:member.symbol,branch:candidate.branch,candidateId:candidate.candidateId,
      hardBlockers:candidate.hardBlockers,unknownEvidence:candidate.unknownEvidence}];
  });
  const behaviorDiagnostic=await new PostgresRuntimeBehaviorDiagnosticStore(input.pool).persist({
    scanId:scan.scanId,decisionIds:[...persisted.values()].flatMap((value)=>value.decisionId?[value.decisionId]:[]).toSorted(),
    observedAt:scan.finishedAt,session,universeSize:scan.boundary.eligibleSymbols.length,
    strategiesConsidered:branchFrontiers.length,strategiesApplicable:branchFrontiers.filter((branch)=>branch.applicable).length,
    strategiesRejected:branchFrontiers.filter((branch)=>!branch.applicable||branch.evaluationState==='BLOCKED_MISSING_INPUT').length,
    strategyDiagnostics,completeness:discovery.candidates.length===0?'DATA_INSUFFICIENT':scan.completeness,
    globalWaitEarned:scan.globalWaitEarned,globalWaitReasons:scan.globalWaitReasons,
    // Decision-level counts share the Paper-authorized branch population.
    // Strategy-level counts above still include every research alternative.
    candidateCount:entryCandidates.length,
    feasibleCandidateCount:entryCandidates.filter((candidate)=>candidate.structurallyFeasible&&candidate.riskFeasible
      &&candidate.hardBlockers.length===0).length,
    selectedCandidateCount:strategyFrontiers.filter((frontier)=>frontier.selectedCandidateId!==null).length,
    hardRejectedCount:entryBranches.reduce((total,branch)=>total+branch.mechanicallyRejected+branch.hardVetoed,0),
    softRankedCount:entryBranches.reduce((total,branch)=>total+branch.softRanked,0),
    dataInsufficientCount:entryBranches.reduce((total,branch)=>total+branch.dataInsufficient,0),
    quantityZeroCount:entryCandidates.filter((candidate)=>candidate.sizing.quantity===0).length,
    aegisVetoCount:scan.results.filter((member)=>member.cycle?.orchestration?.aegis?.newRiskState==='HARD_VETO').length,
    nearMissCount:strategyFrontiers.filter((frontier)=>frontier.nearMissCandidateId!==null).length,
    softEconomicRejectionCount:rejectedCandidates.filter((candidate)=>candidate.riskFeasible
      &&candidate.hardBlockers.length===0&&candidate.sizing.quantity>0).length,
    dataUnknownRejectionCount:rejectedCandidates.filter((candidate)=>candidate.unknownEvidence.length>0).length,
    quoteRejectionCount:rejectedCandidates.filter((candidate)=>[...candidate.hardBlockers,...candidate.unknownEvidence]
      .some(isQuoteEvidence)).length,
    liquidityRejectionCount:rejectedCandidates.filter((candidate)=>[...candidate.hardBlockers,...candidate.unknownEvidence]
      .some(isLiquidityEvidence)).length,
    hardGateCounts,finalAction:actionPlansReady>0?'ACTION_READY':scan.globalWaitEarned?'WAIT':'SYSTEM_HOLD',
    waitReasons:actionPlansReady>0?[]:[...new Set([...scan.globalWaitReasons,...actionPlansBlocked,...discoveryBlockers])].toSorted(),
    bestRejectedCandidates,antiParalysisFindings,
    universeBreadthChallenger,
    universeDiscoveryFunnel:discovery.funnel,
    strategyQualityChallengers:scan.results.flatMap((member)=>member.cycle?.strategyQualityDiagnostics
      ?[member.cycle.strategyQualityDiagnostics]:[]),
    providerBlockers:[...new Set([...discoveryBlockers,...scan.missingScope,...scan.results.flatMap((member)=>member.errorCode?[member.errorCode]:[])])].toSorted(),
    actionPlansReady,actionPlanBlockers:[...new Set(actionPlansBlocked)].toSorted(),
  });
  const virtualOpening=await new PostgresShadowVirtualTrader(input.pool).createOpeningIntent(scan.scanId,scan.finishedAt);
  return {scanId:scan.scanId,completeness:discovery.candidates.length===0?'DATA_INSUFFICIENT':scan.completeness,
    candidateCount:scan.candidateCount,
    researchMissingScope:scan.researchMissingScope,
    symbolsAttempted:scan.symbolsAttempted,symbolsCompleted:scan.symbolsCompleted,observationsScheduled,
    actionPlansReady,actionPlansBlocked:[...new Set(actionPlansBlocked)].toSorted(),virtualOpening,behaviorDiagnostic};
}

async function loadPersistenceContext(pool:Pool,alpaca:AlpacaProviderConfig,asOf:string){
  const response=await (alpaca.fetchImpl??fetch)(new URL('/v2/account',alpaca.tradingApiBase),{
    headers:{'APCA-API-KEY-ID':alpaca.apiKey,'APCA-API-SECRET-KEY':alpaca.apiSecret}});
  if(!response.ok) throw new Error(`MASTER_ACCOUNT_CONTEXT_HTTP_${response.status}`);
  const account=await response.json() as Record<string,unknown>;
  if(typeof account.id!=='string') throw new Error('MASTER_ACCOUNT_IDENTITY_UNKNOWN');
  const context=await ensureMasterShadowContext(pool,account.id);
  const snapshot=await pool.query(`INSERT INTO trade.account_snapshot(account_id,equity,cash,buying_power,options_buying_power,options_level,as_of,retrieved_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING account_snapshot_id`,[context.accountId,n(account.equity),n(account.cash),n(account.buying_power),
    n(account.options_buying_power),n(account.options_trading_level),asOf]);
  return {botInstanceId:context.botInstanceId,universeVersionId:null,strategyVersionId:context.strategyVersionId,
    featureVersionId:context.featureVersionId,riskLimitVersionId:context.riskLimitVersionId,
    executionVersionId:context.executionVersionId,costModelVersionId:context.costModelVersionId,
    accountSnapshotId:Number(snapshot.rows[0].account_snapshot_id)};
}
const n=(value:unknown):number|null=>value==null||!Number.isFinite(Number(value))?null:Number(value);
