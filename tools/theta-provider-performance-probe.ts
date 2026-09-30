import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchOptionSnapshots } from '../src/theta/alpaca-provider.js';
import { normalizeEventEvidence, reconcileEventEvidence } from '../src/theta/normalized-event-evidence.js';
import { fetchOptionomicsOptionChain } from '../src/theta/optionomics-provider.js';
import { buildOptionomicsFeatureSnapshot } from '../src/theta/optionomics-feature-engine.js';
import { LocalResearchHistorySpool } from '../src/storage/local-research-history-spool.js';

// Bounded offline adapter exercise. Timings describe this machine and this
// synthetic payload only. No provider, PostgreSQL, training or trading calls.
const at='2026-09-30T14:00:00.000Z';
const percentile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(xs.length*p)-1)]!;
type Sample = { collectionMs:number; decodeMs:number; eventMs:number; serializeHashMs:number;
 featureNormalizationMs:number; featureCalculationMs:number; localPersistenceMs:number; localReadbackMs:number;
 artifactHash:string; heapDeltaMb:number; sampledHeapMaxMb:number };
const results=[];
for(const count of [2601,5000,10000]){
 const samples:Sample[]=[];
 for(let trial=0;trial<5;trial++){
  let page=0,decodeMs=0;
  const heapBefore=process.memoryUsage().heapUsed;
  const started=performance.now();
  const result=await fetchOptionSnapshots({tradingApiBase:'https://paper-api.alpaca.markets',
   marketDataApiBase:'https://data.alpaca.markets',apiKey:'SYNTHETIC',apiSecret:'SYNTHETIC',
   fetchImpl:(async()=>{
    const start=page++*1000;
    const text=JSON.stringify({snapshots:Object.fromEntries(Array.from({length:Math.min(1000,count-start)},(_,i)=>[
     `SPY261030P${String(100000+start+i).padStart(8,'0')}`,{latestQuote:{bp:1,ap:1.05,t:at},greeks:{delta:-0.2}}])),
    next_page_token:start+1000<count?String(page):null});
    return {ok:true,status:200,json:async()=>{const t=performance.now();const body=JSON.parse(text);decodeMs+=performance.now()-t;return body;}} as Response;
   }) as typeof fetch}, {underlyingSymbol:'SPY',expirationDateGte:'2026-10-01',expirationDateLte:'2026-11-01',
    optionType:'put',feed:'opra',limit:1000,maxPages:20});
  const collectionMs=performance.now()-started;
  if(result.snapshots.size!==count||!result.complete)throw new Error('SYNTHETIC_COLLECTION_INCOMPLETE');
  const eventStart=performance.now();
  const events=Array.from({length:count},()=>normalizeEventEvidence({source:'OPTIONOMICS',providerEventId:'duplicate',
   underlying:'SPY',eventType:'DISTRIBUTION',eventTime:at,knownAt:at,observedAt:at,payloadHash:'a'.repeat(64),applicable:true},at));
  const unique=reconcileEventEvidence(events);
  const eventMs=performance.now()-eventStart;
  if(unique.length!==1)throw new Error('SYNTHETIC_DUPLICATE_COUNT_INFLATED');
  const normalizationStarted=performance.now();
  const featureChain=await fetchOptionomicsOptionChain({apiBase:'https://optionomics.ai',
   email:'synthetic@example.com',apiToken:'SYNTHETIC_TEST_TOKEN',now:()=>at,sleepImpl:async()=>{},
   fetchImpl:async()=>new Response(JSON.stringify([...result.snapshots].map(([symbol,quote],i)=>({
    symbol,underlying:'SPY',expiration:'2026-10-30',option_type:'put',strike:(100000+i)/1000,
    bid:quote.bid,ask:quote.ask,delta:-0.2,implied_volatility:.25,as_of:at}))),
     {headers:{'content-type':'application/json'}})},'SPY');
  if(featureChain.kind!=='VALUE_PRESENT')throw new Error('SYNTHETIC_FEATURE_NORMALIZATION_INCOMPLETE');
  const featureNormalizationMs=performance.now()-normalizationStarted;
  const featureStart=performance.now();
  const features=buildOptionomicsFeatureSnapshot({chain:featureChain.value,flowWindows:[],stockPrice:500,
   multiplierByContract:new Map([...result.snapshots.keys()].map(symbol=>[symbol,100])),skewDeltaTolerance:.05});
  const featureCalculationMs=performance.now()-featureStart;
  if(features.contracts.length!==count)throw new Error('SYNTHETIC_FEATURE_COUNT_MISMATCH');
  const featureHeap=process.memoryUsage().heapUsed;
  const serializeStart=performance.now();
  const artifact=JSON.stringify(features.contracts);
  const artifactHash=createHash('sha256').update(artifact).digest('hex');
  const serializeHashMs=performance.now()-serializeStart;
  const temporary=mkdtempSync(join(tmpdir(),'theta-phase2-perf-'));
  let spool:LocalResearchHistorySpool|undefined;
  let localPersistenceMs=0,localReadbackMs=0;
  try{
   const persistStart=performance.now();
   spool=new LocalResearchHistorySpool(join(temporary,'synthetic.sqlite'));
   spool.append({botNamespace:'THETA_SYNTHETIC_TEST',batchId:'batch',family:'CONTRACT_PATH_DATASET',
    sourceSha:'a'.repeat(40),decisionCycleId:'cycle',snapshotId:'snapshot',observedAt:at,rowCount:count,payload:features.contracts});
   localPersistenceMs=performance.now()-persistStart;
   const readStart=performance.now();
   if(!spool.verifyBatch('batch'))throw new Error('SYNTHETIC_LOCAL_PERSISTENCE_HASH_FAILED');
   localReadbackMs=performance.now()-readStart;
  }finally{spool?.close();rmSync(temporary,{recursive:true,force:true});}
  samples.push({collectionMs,decodeMs,eventMs,serializeHashMs,featureNormalizationMs,featureCalculationMs,
   localPersistenceMs,localReadbackMs,artifactHash,
   sampledHeapMaxMb:Math.max(heapBefore,featureHeap,process.memoryUsage().heapUsed)/1048576,
   heapDeltaMb:(process.memoryUsage().heapUsed-heapBefore)/1048576});
 }
 const timings=Object.fromEntries(['collectionMs','decodeMs','eventMs','featureNormalizationMs','featureCalculationMs',
  'serializeHashMs','localPersistenceMs','localReadbackMs'].map(key=>{
  const values=samples.map(s=>s[key as 'collectionMs']);
  return [key,{p50:percentile(values,.5),p95:percentile(values,.95),max:Math.max(...values)}];
 }));
 results.push({contracts:count,samples:5,timings,heapDeltaMb:samples.map(s=>s.heapDeltaMb),
  sampledHeapMaxMb:Math.max(...samples.map(s=>s.sampledHeapMaxMb)),memoryMeasurement:'STAGE_SAMPLES_NOT_PROCESS_PEAK',
  deterministicHash:new Set(samples.map(s=>s.artifactHash)).size===1});
}
console.log(JSON.stringify({version:'theta-provider-performance-probe-v2',synthetic:true,results,
 persistenceBackend:'CANONICAL_LOCAL_RESEARCH_SQLITE_WAL',
 omittedStages:['PRODUCTION_POSTGRES_LATENCY'],providerRequests:0,brokerMutations:0}));
