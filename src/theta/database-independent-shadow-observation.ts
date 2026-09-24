import path from 'node:path';
import type { Environment } from '../config/environment.js';
import { parseOccOptionSymbol } from './account-exposure.js';
import { fetchOptionSnapshots, type AlpacaProviderConfig } from './alpaca-provider.js';
import type { PythonBridgeConfig } from './python-bridge.js';
import { paperInstrumentClassificationManifest } from './paper-entry-safety-policy.js';
import type { PaperEntryBootstrapAssessment } from './paper-entry-bootstrap.js';
import { defaultShadowCycleConfig, optionomicsConfigFromEnvironment } from './theta-shadow-once.js';
import { runThetaShadowCycle, type ThetaShadowCycleResult } from './theta-shadow-cycle.js';
import { discoverRealUniverse, type UniverseDiscoveryResult } from './universe-discovery.js';
import { createLocalAegisRiskObservation, localAegisAssessors, type LocalAegisRiskHistory,
  type LocalAegisRiskObservation } from './local-aegis-risk-history.js';
import { normalizedOptionContractSchema } from './option-contract.js';

export const databaseIndependentShadowObservationVersion='theta-database-independent-shadow-observation-v1' as const;

export interface DatabaseIndependentSymbolObservation {
  readonly symbol:string;
  readonly state:'COMPLETED'|'FAILED';
  readonly failureCode:string|null;
  readonly snapshotId:string|null;
  readonly decisionAsOf:string|null;
  readonly optionContractsComplete:boolean|null;
  readonly optionChainComplete:boolean|null;
  readonly qCandidateCount:number;
  readonly qDecision:string|null;
  readonly qReasonCodes:readonly string[];
  readonly qCandidates:readonly {
    readonly candidateId:string;
    readonly actionFeasible:boolean;
    readonly quantity:number;
    readonly reasonCodes:readonly string[];
    readonly paperBootstrapReasonCodes:readonly string[];
    readonly ownershipOwnability:number|null;
    readonly ownershipComponents:readonly {
      readonly name:string;
      readonly value:number|null;
      readonly reasonCodes:readonly string[];
    }[];
  }[];
  readonly frontierCandidates:readonly {
    readonly candidateId:string;
    readonly branch:string;
    readonly hardBlockers:readonly string[];
    readonly unknownEvidence:readonly string[];
    readonly quantity:number;
    readonly aegisState:string|null;
    readonly aegisFamilies:readonly {
      readonly family:string;
      readonly state:string;
      readonly reasonCodes:readonly string[];
    }[];
    readonly aegisReasonCodes:readonly string[];
  }[];
  readonly canonicalAction:string|null;
  readonly selectedCandidateId:string|null;
  readonly selectedOptionSymbol:string|null;
  readonly selectedQuantity:number;
  readonly aegisState:string|null;
  readonly blockers:readonly string[];
  readonly riskHistory:{readonly scanned:number;readonly spreadQualified:number;readonly spreadRejected:number;
    readonly ivQualified:number;readonly ivRejected:number};
  readonly riskObservations:readonly LocalAegisRiskObservation[];
  readonly exactRefresh:{
    readonly state:'NOT_APPLICABLE'|'READY_READ_ONLY'|'QUOTE_MISSING'|'INCOMPLETE'|'PROVIDER_ERROR';
    readonly optionSymbol:string|null;
    readonly providerTimestamp:string|null;
    readonly receivedAt:string|null;
    readonly bid:number|null;
    readonly ask:number|null;
    readonly brokerMutationSurface:false;
  };
}

export interface DatabaseIndependentShadowObservationReport {
  readonly contractVersion:typeof databaseIndependentShadowObservationVersion;
  readonly startedAt:string;
  readonly finishedAt:string;
  readonly persistenceState:'SPOOLED_LOCAL_PENDING_DB';
  readonly brokerMutationCapability:'BLOCKED_CANONICAL_POSTGRES_REQUIRED';
  readonly deadlinePolicy:{readonly version:'theta-db-independent-deadline-v1';readonly discoveryMs:number;
    readonly cycleMs:number;readonly exactRefreshMs:number};
  readonly universeFunnel:UniverseDiscoveryResult['funnel'];
  readonly universeBlockers:readonly string[];
  readonly approvedSymbolsDiscovered:readonly string[];
  readonly symbols:readonly DatabaseIndependentSymbolObservation[];
}

interface Dependencies {
  discover:typeof discoverRealUniverse;
  runCycle:(config:Parameters<typeof runThetaShadowCycle>[0])=>Promise<ThetaShadowCycleResult>;
  refreshExact:typeof fetchOptionSnapshots;
}

const safeCode=(error:unknown):string=>error instanceof Error&&/^[A-Z0-9_:-]+$/.test(error.message)
  ?error.message:'PROVIDER_OR_COMPUTATION_ERROR';

async function bounded<T>(operation:Promise<T>,milliseconds:number,code:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<T>((_resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error(code)),milliseconds);timer.unref?.();
  })]);}finally{if(timer!==undefined)clearTimeout(timer);}
}

function pythonBridge(environment:Environment):PythonBridgeConfig{
  return {pythonExecutablePath:environment.THETA_PYTHON_EXECUTABLE,scriptAllowlist:new Map([
    ['ownership',path.resolve('bots/theta/quant/runtime/ownership_contract.py')],
    ['regime',path.resolve('bots/theta/quant/runtime/regime_contract.py')],
    ['strategyRouter',path.resolve('bots/theta/quant/runtime/strategy_router_contract.py')],
    ['thetaQ',path.resolve('bots/theta/quant/runtime/theta_q_contract.py')],
    ['paretoFrontier',path.resolve('bots/theta/quant/runtime/pareto_frontier_contract.py')],
    ['opportunityFrontier',path.resolve('bots/theta/quant/runtime/opportunity_frontier_contract.py')],
    ['aegis',path.resolve('bots/theta/quant/runtime/aegis_contract.py')],
    ['sizing',path.resolve('bots/theta/quant/runtime/sizing_contract.py')],
    ['executionQuality',path.resolve('bots/theta/quant/runtime/execution_quality_contract.py')],
  ]),timeoutMs:10_000,maxOutputBytes:2_000_000};
}

async function exactReadOnlyRefresh(alpaca:AlpacaProviderConfig,cycle:ThetaShadowCycleResult,now:()=>string,
  refresh:typeof fetchOptionSnapshots,timeoutMs:number):Promise<DatabaseIndependentSymbolObservation['exactRefresh']>{
  const frontier=cycle.strategyFrontier;
  const selected=frontier?.branches.flatMap((branch)=>branch.candidates)
    .find((candidate)=>candidate.candidateId===frontier.selectedCandidateId)??null;
  const optionSymbol=selected?.legs[0]?.optionSymbol??null;
  if(optionSymbol===null)return {state:'NOT_APPLICABLE',optionSymbol:null,providerTimestamp:null,receivedAt:null,
    bid:null,ask:null,brokerMutationSurface:false};
  const identity=parseOccOptionSymbol(optionSymbol);
  if(identity===null)return {state:'QUOTE_MISSING',optionSymbol,providerTimestamp:null,receivedAt:null,
    bid:null,ask:null,brokerMutationSurface:false};
  const receivedAt=now();
  try{
    const result=await bounded(refresh(alpaca,{underlyingSymbol:identity.underlying,feed:'indicative',
      optionType:identity.optionType.toLowerCase() as 'put'|'call',
      expirationDateGte:identity.expiration,expirationDateLte:identity.expiration,
      strikePriceGte:identity.strike,strikePriceLte:identity.strike,limit:1000,maxPages:10}),timeoutMs,
    'DATABASE_INDEPENDENT_EXACT_REFRESH_TIMEOUT');
    if(!result.complete)return {state:'INCOMPLETE',optionSymbol,providerTimestamp:null,receivedAt,
      bid:null,ask:null,brokerMutationSurface:false};
    const quote=result.snapshots.get(optionSymbol);
    if(quote===undefined||quote.bid===null||quote.ask===null)return {state:'QUOTE_MISSING',optionSymbol,
      providerTimestamp:quote?.quoteTimestamp??null,receivedAt,bid:quote?.bid??null,ask:quote?.ask??null,
      brokerMutationSurface:false};
    return {state:'READY_READ_ONLY',optionSymbol,providerTimestamp:quote.quoteTimestamp,receivedAt,
      bid:quote.bid,ask:quote.ask,brokerMutationSurface:false};
  }catch{
    return {state:'PROVIDER_ERROR',optionSymbol,providerTimestamp:null,receivedAt,bid:null,ask:null,brokerMutationSurface:false};
  }
}

/**
 * Runs the real provider and canonical Q computation path without requiring a
 * database connection. Its output is observation evidence only. It cannot
 * create a canonical Paper plan and exposes no broker mutation callback.
 */
export async function runDatabaseIndependentShadowObservation(input:{
  readonly environment:Environment;
  readonly alpaca:AlpacaProviderConfig;
  readonly paperEntryBootstrap?:PaperEntryBootstrapAssessment;
  /** Broker reconciliation may prove a flat account even while Postgres is
   * unavailable. An explicit empty array is known no recovery inventory.
   * Omission remains UNKNOWN and must not be coerced to empty. */
  readonly recoveryInventoryUnderlyings?:readonly string[];
  readonly localRiskHistory?:LocalAegisRiskHistory;
  readonly now:()=>string;
  readonly deadlineMs?:{readonly discovery:number;readonly cycle:number;readonly exactRefresh:number};
  readonly dependencies?:Partial<Dependencies>;
}):Promise<DatabaseIndependentShadowObservationReport>{
  const dependencies:Dependencies={discover:discoverRealUniverse,runCycle:runThetaShadowCycle,
    refreshExact:fetchOptionSnapshots,...input.dependencies};
  const deadlinePolicy={version:'theta-db-independent-deadline-v1' as const,
    discoveryMs:input.deadlineMs?.discovery??60_000,cycleMs:input.deadlineMs?.cycle??150_000,
    exactRefreshMs:input.deadlineMs?.exactRefresh??30_000};
  if([deadlinePolicy.discoveryMs,deadlinePolicy.cycleMs,deadlinePolicy.exactRefreshMs]
    .some((value)=>!Number.isInteger(value)||value<1))throw new Error('DATABASE_INDEPENDENT_DEADLINE_INVALID');
  const startedAt=input.now();
  const approved=paperInstrumentClassificationManifest.entries.filter((entry)=>entry.paperBootstrapApproved)
    .map((entry)=>entry.symbol);
  const discovery=await bounded(dependencies.discover(input.alpaca,{discoveryVersion:'theta-db-independent-universe-v1',
    maxCandidateAssets:100,allowedExchanges:['NYSE','NASDAQ','ARCA','BATS'],barsLookbackDays:30,barsBatchSize:100,
    maxOptionabilityChecks:10,minCurrentPrice:5,requiredSymbols:approved},input.now),deadlinePolicy.discoveryMs,
  'DATABASE_INDEPENDENT_DISCOVERY_TIMEOUT');
  const approvedSet=new Set(approved);
  const underlyings=discovery.candidates.filter((candidate)=>approvedSet.has(candidate.symbol));
  const optionomics=optionomicsConfigFromEnvironment(input.environment);
  const localAssessors=input.localRiskHistory===undefined?null:localAegisAssessors(input.localRiskHistory);
  const symbols:DatabaseIndependentSymbolObservation[]=[];
  for(const underlying of underlyings){
    try{
      const base=defaultShadowCycleConfig(input.alpaca,optionomics,pythonBridge(input.environment),[underlying],discovery.candidatesOrigin);
      const cycle=await bounded(dependencies.runCycle({...base,evaluationMode:'SHADOW_EVIDENCE',
        paperEntryBootstrap:input.paperEntryBootstrap,
        recoveryInventoryUnderlyings:input.recoveryInventoryUnderlyings,
        aegisSpreadStressAssessor:localAssessors?.spread,
        aegisAlpacaIvStressAssessor:localAssessors?.alpacaIv,
        aegisInputsOrigin:'DERIVED_FROM_REAL',aegisInputs:{tickerConcentrationPct:null,sectorConcentrationPct:null,
          correlationClusterExposurePct:null,portfolioCapitalAtRiskPct:null,inventoryCapacityUsedPct:null,
          assignmentCapacityUsedPct:null,recoveryCapacityUsedPct:null,liquidityAcceptable:null,
          executionQualityAcceptable:null,providerState:null,stressGapDetected:null,stressIvShockDetected:null,
          stressIvShockApplicability:'REQUIRED',stressSpreadWideningDetected:null}}),deadlinePolicy.cycleMs,
      'DATABASE_INDEPENDENT_CYCLE_TIMEOUT');
      const frontier=cycle.strategyFrontier;
      const selected=frontier?.branches.flatMap((branch)=>branch.candidates)
        .find((candidate)=>candidate.candidateId===frontier.selectedCandidateId)??null;
      const q=cycle.orchestration?.thetaQ;
      const candidateIds=new Set(q?.candidates.map((candidate)=>candidate.candidateId)??[]);
      const rawContracts=Array.isArray(cycle.fusionSnapshot?.snapshot.contractCandidates)
        ?cycle.fusionSnapshot.snapshot.contractCandidates:[];
      const riskObservations=rawContracts.flatMap((value)=>{
        const parsed=normalizedOptionContractSchema.safeParse(value);
        if(!parsed.success||!candidateIds.has(parsed.data.optionSymbol)||cycle.snapshotContentHash===null
          ||cycle.fusionSnapshot===null)return [];
        return [createLocalAegisRiskObservation({snapshotId:cycle.snapshotContentHash,
          decisionCycleId:cycle.runId,decisionTime:String(cycle.fusionSnapshot.snapshot.decisionTimeUtc),
          contract:parsed.data})];
      });
      symbols.push({symbol:underlying.symbol,state:'COMPLETED',failureCode:null,
        snapshotId:cycle.snapshotContentHash,decisionAsOf:cycle.fusionSnapshot===null?null
          :String(cycle.fusionSnapshot.snapshot.decisionTimeUtc),
        optionContractsComplete:cycle.optionContractsComplete,optionChainComplete:cycle.optionChainComplete,
        qCandidateCount:q?.candidates.length??0,qDecision:cycle.orchestration?.receipt.winningAction??null,
        qReasonCodes:cycle.orchestration?.receipt.reasonCodes??[],
        qCandidates:q?.candidates.map((candidate)=>{
          const ownership=cycle.orchestration?.ownershipByCandidateId?.[candidate.candidateId];
          return {candidateId:candidate.candidateId,actionFeasible:candidate.actionFeasible,quantity:candidate.quantity,
            reasonCodes:candidate.reasons.map((reason)=>reason.code),
            paperBootstrapReasonCodes:candidate.paperBootstrapReasonCodes,
            ownershipOwnability:ownership?.ownability??null,
            ownershipComponents:ownership?.components.map((component)=>({name:component.name,value:component.value,
              reasonCodes:component.reasons.map((reason)=>reason.code)}))??[]};
        })??[],
        frontierCandidates:frontier?.branches.flatMap((branch)=>branch.candidates.map((candidate)=>{
          // The canonical frontier namespaces candidate IDs by branch while
          // the orchestration map is keyed by the exact OCC contract ID.
          const aegisIdentity=candidate.legs[0]?.optionSymbol??candidate.candidateId;
          const aegis=cycle.orchestration?.aegisByCandidateId?.[aegisIdentity];
          return {candidateId:candidate.candidateId,branch:candidate.branch,hardBlockers:candidate.hardBlockers,
            unknownEvidence:candidate.unknownEvidence,quantity:candidate.sizing?.quantity??0,aegisState:candidate.aegisState,
            aegisFamilies:aegis?.families.map((family)=>({family:family.family,state:family.state,
              reasonCodes:family.reasons.map((reason)=>reason.code)}))??[],
            aegisReasonCodes:aegis?.reasons.map((reason)=>reason.code)??[]};
        }))??[],
        canonicalAction:frontier?.primaryAction??null,selectedCandidateId:frontier?.selectedCandidateId??null,
        selectedOptionSymbol:selected?.legs[0]?.optionSymbol??null,selectedQuantity:frontier?.selectedQuantity??0,
        aegisState:selected?.aegisState??cycle.orchestration?.aegis?.newRiskState??null,blockers:cycle.blockers,
        riskHistory:{scanned:input.localRiskHistory?.scanned??0,
          spreadQualified:input.localRiskHistory?.spread.length??0,
          spreadRejected:input.localRiskHistory?.spreadRejected??0,
          ivQualified:input.localRiskHistory?.alpacaIv.length??0,
          ivRejected:input.localRiskHistory?.ivRejected??0},riskObservations,
        exactRefresh:await exactReadOnlyRefresh(input.alpaca,cycle,input.now,dependencies.refreshExact,deadlinePolicy.exactRefreshMs)});
    }catch(error){
      symbols.push({symbol:underlying.symbol,state:'FAILED',failureCode:safeCode(error),snapshotId:null,decisionAsOf:null,
        optionContractsComplete:null,optionChainComplete:null,qCandidateCount:0,qDecision:null,canonicalAction:null,
        qReasonCodes:[],qCandidates:[],frontierCandidates:[],
        selectedCandidateId:null,selectedOptionSymbol:null,selectedQuantity:0,aegisState:null,blockers:[safeCode(error)],
        riskHistory:{scanned:input.localRiskHistory?.scanned??0,
          spreadQualified:input.localRiskHistory?.spread.length??0,
          spreadRejected:input.localRiskHistory?.spreadRejected??0,
          ivQualified:input.localRiskHistory?.alpacaIv.length??0,
          ivRejected:input.localRiskHistory?.ivRejected??0},riskObservations:[],
        exactRefresh:{state:'NOT_APPLICABLE',optionSymbol:null,providerTimestamp:null,receivedAt:null,bid:null,ask:null,
          brokerMutationSurface:false}});
    }
  }
  return {contractVersion:databaseIndependentShadowObservationVersion,startedAt,finishedAt:input.now(),
    persistenceState:'SPOOLED_LOCAL_PENDING_DB',brokerMutationCapability:'BLOCKED_CANONICAL_POSTGRES_REQUIRED',
    deadlinePolicy,
    universeFunnel:discovery.funnel,universeBlockers:discovery.blockers,
    approvedSymbolsDiscovered:underlyings.map((underlying)=>underlying.symbol),symbols};
}
