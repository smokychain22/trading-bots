import path from 'node:path';
import type { Pool } from 'pg';
import type { Environment } from '../config/environment.js';
import { AlpacaProviderError, fetchOptionSnapshots, type AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import { discoverRealUniverse } from '../theta/universe-discovery.js';
import { defaultShadowCycleConfig, optionomicsConfigFromEnvironment } from '../theta/theta-shadow-once.js';
import { runThetaShadowCycle } from '../theta/theta-shadow-cycle.js';
import type { PythonBridgeConfig } from '../theta/python-bridge.js';
import { PostgresThetaCycleStore } from '../theta/postgres-theta-cycle-store.js';
import { buildObservationSchedule, PostgresShadowEvidenceRuntimeStore, runCrossSymbolShadowScan } from './shadow-evidence-runtime.js';
import { PostgresPointInTimeEvidenceStore } from './point-in-time-evidence.js';
import { ensureMasterShadowContext } from './master-shadow-context.js';

export interface ProductionShadowScanReport {
  readonly scanId:string; readonly completeness:string; readonly candidateCount:number;
  readonly symbolsAttempted:number; readonly symbolsCompleted:number; readonly observationsScheduled:number;
}

export interface ObservationProcessingReport {readonly due:number;readonly observed:number;readonly missed:number;}

export type ObservationMissReason='HOST_OFFLINE'|'PROVIDER_UNAVAILABLE'|'SESSION_ENDED'|'INVALID_CONTRACT'|'INVALID_QUOTE';
export function classifyObservationFailure(error:unknown):ObservationMissReason {
  if(error instanceof AlpacaProviderError)return 'PROVIDER_UNAVAILABLE';
  return 'PROVIDER_UNAVAILABLE';
}
export function missingObservationReason(contractFound:boolean,enumerationComplete=true,sessionConfirmedEnded=false):ObservationMissReason {
  if(contractFound)return 'INVALID_QUOTE';
  if(!enumerationComplete)return 'PROVIDER_UNAVAILABLE';
  return sessionConfirmedEnded?'SESSION_ENDED':'INVALID_CONTRACT';
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
  const quoteStore=new PostgresPointInTimeEvidenceStore(input.pool); let observed=0,missed=0;
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
        if(await store.markObservationObserved(String(row.observation_job_id),quoteId,observedAt)) observed++;
      }
    }catch(error){
      const reason=classifyObservationFailure(error);
      for(const row of rows) if(await store.markObservationMissed(String(row.observation_job_id),observedAt,reason)) missed++;
    }
  }
  return {due:jobs.rowCount??0,observed,missed};
}

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
});

export async function runProductionShadowEvidenceScan(input:{environment:Environment;pool:Pool;alpaca:AlpacaProviderConfig;now:()=>string}):Promise<ProductionShadowScanReport>{
  if(input.environment.THETA_RUNTIME_MODE!=='THETA_SHADOW_ONLY') throw new Error('THETA_SHADOW_ONLY_REQUIRED');
  const discovery=await discoverRealUniverse(input.alpaca,{discoveryVersion:'theta-shadow-universe-v1',maxCandidateAssets:100,
    allowedExchanges:['NYSE','NASDAQ','ARCA','BATS'],barsLookbackDays:30,barsBatchSize:100,maxOptionabilityChecks:2,minCurrentPrice:5},input.now);
  const optionomics=optionomicsConfigFromEnvironment(input.environment);
  const scan=await runCrossSymbolShadowScan({universeVersion:'theta-shadow-universe-v1',latticeVersion:'lattice-v1-shadow-once',
    strategyVersion:'theta-shadow-once-v1',eligibleUnderlyings:discovery.candidates,maxUnderlyings:2,
    branches:['THETA_CONVENTIONAL','THETA_HOLD_STRIKE','THETA_RECOVERY','THETA_CC','THETA_DEFINED_RISK']},async(underlying)=>{
      const config=defaultShadowCycleConfig(input.alpaca,optionomics,bridge(input.environment),[underlying],discovery.candidatesOrigin);
      return runThetaShadowCycle({...config,evaluationMode:'SHADOW_EVIDENCE',aegisInputs:{
        tickerConcentrationPct:null,sectorConcentrationPct:null,correlationClusterExposurePct:null,
        portfolioCapitalAtRiskPct:null,inventoryCapacityUsedPct:null,assignmentCapacityUsedPct:null,
        recoveryCapacityUsedPct:null,liquidityAcceptable:null,executionQualityAcceptable:null,providerState:null,
        stressGapDetected:false,stressIvShockDetected:null,stressSpreadWideningDetected:null,
      }});
    },input.now);
  const runtimeContext=await loadPersistenceContext(input.pool,input.alpaca,scan.startedAt);
  const cycleStore=new PostgresThetaCycleStore(input.pool),persisted=new Map<string,{fusionSnapshotId:string|null;candidateSetId:string|null}>();
  let observationsScheduled=0;
  const evidenceStore=new PostgresShadowEvidenceRuntimeStore(input.pool);
  for(const member of scan.results){
    if(member.cycle?.fusionSnapshot===null||member.cycle===null) continue;
    const saved=await cycleStore.persist(runtimeContext,member.cycle);
    persisted.set(member.symbol,{fusionSnapshotId:saved.fusionSnapshotId,candidateSetId:saved.candidateSetId});
    if(saved.candidateSetId===null) continue;
    const candidates=await input.pool.query(`SELECT c.candidate_id,oc.contract_symbol FROM trade.candidate c
      JOIN market.option_contract oc ON oc.option_contract_id=c.option_contract_id WHERE c.candidate_set_id=$1`,[saved.candidateSetId]);
    const session=member.cycle.fusionSnapshot.snapshot.marketSession;
    const marketClose=session!==null&&typeof session==='object'&&!Array.isArray(session)&&typeof session.nextClose==='string'
      ? session.nextClose:null;
    if(marketClose===null) continue;
    for(const candidate of candidates.rows){
      observationsScheduled+=await evidenceStore.scheduleObservations(buildObservationSchedule({candidateId:String(candidate.candidate_id),
        contractSymbol:String(candidate.contract_symbol),decisionTime:member.cycle.startedAt,marketClose}));
    }
  }
  await evidenceStore.saveScan(scan,persisted);
  return {scanId:scan.scanId,completeness:scan.completeness,candidateCount:scan.candidateCount,
    symbolsAttempted:scan.symbolsAttempted,symbolsCompleted:scan.symbolsCompleted,observationsScheduled};
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
