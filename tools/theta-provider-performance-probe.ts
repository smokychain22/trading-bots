import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fetchOptionSnapshots } from '../src/theta/alpaca-provider.js';
import { normalizeEventEvidence, reconcileEventEvidence } from '../src/theta/normalized-event-evidence.js';

// Bounded offline adapter exercise. Timings describe this machine and this
// synthetic payload only. No provider, PostgreSQL, training or trading calls.
const at='2026-09-30T14:00:00.000Z';
const percentile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(xs.length*p)-1)]!;
type Sample = { collectionMs:number; decodeMs:number; eventMs:number; serializeHashMs:number;
 artifactHash:string; heapDeltaMb:number };
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
  const serializeStart=performance.now();
  const artifact=JSON.stringify([...result.snapshots]);
  const artifactHash=createHash('sha256').update(artifact).digest('hex');
  const serializeHashMs=performance.now()-serializeStart;
  samples.push({collectionMs,decodeMs,eventMs,serializeHashMs,artifactHash,
   heapDeltaMb:(process.memoryUsage().heapUsed-heapBefore)/1048576});
 }
 const timings=Object.fromEntries(['collectionMs','decodeMs','eventMs','serializeHashMs'].map(key=>{
  const values=samples.map(s=>s[key as 'collectionMs']);
  return [key,{p50:percentile(values,.5),p95:percentile(values,.95),max:Math.max(...values)}];
 }));
 results.push({contracts:count,samples:5,timings,heapDeltaMb:samples.map(s=>s.heapDeltaMb),
  deterministicHash:new Set(samples.map(s=>s.artifactHash)).size===1});
}
console.log(JSON.stringify({version:'theta-provider-performance-probe-v1',synthetic:true,results,
 omittedStages:['FEATURE_ENGINE','DATABASE_PERSISTENCE'],providerRequests:0,brokerMutations:0}));
