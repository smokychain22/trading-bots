import assert from 'node:assert/strict';
import test from 'node:test';
import {AlpacaProviderError,fetchOptionContracts,fetchOptionSnapshots,fetchStockBars,
  type AlpacaProviderConfig} from '../src/theta/alpaca-provider.js';
import { fetchOptionomicsOptionChain } from '../src/theta/optionomics-provider.js';
const at='2026-09-30T14:00:00.000Z';
const config=(fetchImpl:typeof fetch):AlpacaProviderConfig=>({tradingApiBase:'https://paper-api.alpaca.markets',
  marketDataApiBase:'https://data.alpaca.markets',apiKey:'SYNTHETIC_TEST',apiSecret:'SYNTHETIC_TEST',fetchImpl});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const contract={symbol:'SPY261030P00500000',strike_price:'500',expiration_date:'2026-10-30',size:'100'};
const quote={latestQuote:{bp:1,ap:1.1,t:at},greeks:{delta:-0.2}};
const params={underlyingSymbol:'SPY',expirationDateGte:'2026-10-01',expirationDateLte:'2026-11-01',
  optionType:'put' as const,limit:1000,maxPages:20};
const snapshotParams={...params,feed:'opra' as const};

test('non-finite or nonpositive pagination bounds fail before requesting any provider page', async () => {
  let calls = 0;
  const cfg = config((async () => { calls++; throw new Error('unreachable'); }) as typeof fetch);
  for (const value of [NaN, Infinity, -1, 0, 1.5]) {
    await assert.rejects(fetchOptionContracts(cfg, { ...params, maxPages: value }), /PAGINATION_BOUND_INVALID/);
    await assert.rejects(fetchOptionSnapshots(cfg, { ...snapshotParams, maxPages: value }), /PAGINATION_BOUND_INVALID/);
    await assert.rejects(fetchOptionContracts(cfg, { ...params, limit: value }), /PAGINATION_BOUND_INVALID/);
    await assert.rejects(fetchStockBars(cfg, { symbols: ['SPY'], timeframe: '1Day', start: at, end: at,
      adjustment: 'raw', maxPages: value }, at), /PAGINATION_BOUND_INVALID/);
  }
  assert.equal(calls, 0);
});

for(const count of [0,1,99,100,101,999,1000,1001,1090,1511,2000,2601,5000,10000]){
  test(`snapshot pagination preserves ${count} exact identities including later pages`,async()=>{
    let page=0;
    const cfg=config((async(input)=>{
      assert.equal(new URL(String(input)).searchParams.get('feed'),'opra');
      const start=page++*1000;
      return response({snapshots:Object.fromEntries(Array.from({length:Math.min(1000,count-start)},(_,i)=>[
        `SPY261030P${String(100000+start+i).padStart(8,'0')}`,quote])),
      next_page_token:start+1000<count?String(page):null});
    }) as typeof fetch);
    const result=await fetchOptionSnapshots(cfg,snapshotParams);
    assert.equal(result.snapshots.size,count);
    assert.equal(result.complete,true);
    assert.equal(result.pagesFetched,Math.max(1,Math.ceil(count/1000)));
  });
}

for(const status of [401,403,404,408,429,500,502,503,504]){
  test(`Optionomics HTTP ${status} retains failure and status instead of empty evidence`,async()=>{
    let calls=0;
    const result=await fetchOptionomicsOptionChain({apiBase:'https://optionomics.ai',apiToken:'SYNTHETIC',
      email:'synthetic@example.invalid',maxRetryAttempts:1,now:()=>at,
      fetchImpl:async()=>{calls++;return response({},status);}},'SPY');
    assert.equal(result.kind,'REQUEST_ERROR');
    if(result.kind!=='REQUEST_ERROR')return;
    assert.equal(result.httpStatus,status);
    assert.equal(result.errorClass,status===401?'AUTHENTICATION_FAILED':status===403?'NOT_ENTITLED'
      :status===429?'RATE_LIMITED':'PROVIDER_FAILURE');
    assert.equal(calls,1);
  });
  test(`HTTP ${status} after a valid first page cannot become complete or empty`,async()=>{
    for(const kind of ['contracts','snapshots'] as const){
      let page=0;
      const cfg=config((async()=>++page===1?response({option_contracts:[contract],
        snapshots:{[contract.symbol]:quote},next_page_token:'next'}):response({},status)) as typeof fetch);
      await assert.rejects(kind==='contracts'?fetchOptionContracts(cfg,params):fetchOptionSnapshots(cfg,snapshotParams),
        (e:unknown)=>e instanceof AlpacaProviderError&&e.httpStatus===status);
      assert.equal(page,2);
    }
  });
}

test('identical reordered contract/snapshot pages deduplicate and conflicting evidence fails typed',async()=>{
  for(const conflict of [false,true]){
    let page=0;
    const cfg=config((async()=>response({option_contracts:[{...contract,strike_price:conflict&&page>0?'501':'500'}],
      snapshots:{[contract.symbol]:{...quote,latestQuote:{...quote.latestQuote,bp:conflict&&page>0?2:1}}},
      next_page_token:page++===0?'next':null})) as typeof fetch);
    if(conflict)await assert.rejects(fetchOptionContracts(cfg,params),(e:unknown)=>e instanceof AlpacaProviderError
      &&e.safeDetailCode==='ALPACA_CONTRACT_DUPLICATE_CONFLICT');
    else assert.equal((await fetchOptionContracts(cfg,params)).items.length,1);
    page=0;
    if(conflict)await assert.rejects(fetchOptionSnapshots(cfg,snapshotParams),(e:unknown)=>e instanceof AlpacaProviderError
      &&e.safeDetailCode==='ALPACA_SNAPSHOT_DUPLICATE_CONFLICT');
    else assert.equal((await fetchOptionSnapshots(cfg,snapshotParams)).snapshots.size,1);
  }
});

test('empty terminal page and omitted optional terminal token are valid without fabricating extra rows',async()=>{
  // Alpaca's official SDK models next_page_token as optional/default null.
  // Omission alone cannot prove a lost page, so do not invent that conclusion.
  for(const omitted of [true,false]){
    let page=0;
    const cfg=config((async()=>++page===1?response({option_contracts:[contract],next_page_token:'last'}):
      response({option_contracts:[],...(omitted?{}:{next_page_token:null})})) as typeof fetch);
    const result=await fetchOptionContracts(cfg,params);
    assert.equal(result.complete,true);assert.equal(result.items.length,1);assert.equal(result.pagesFetched,2);
  }
});

test('malformed, partial and timed-out later pages cannot certify completed contract or quote enumeration',async()=>{
  for(const kind of ['contracts','snapshots'] as const) {
    for(const fault of ['json','partial','token','timeout'] as const) {
      let calls=0;
      const cfg={...config(async(_url,init)=>{
        if(calls++===0)return response({option_contracts:[contract],snapshots:{[contract.symbol]:quote},next_page_token:'next'});
        if(fault==='json')return new Response('not-json',{status:200});
        if(fault==='partial')return response({next_page_token:null});
        if(fault==='token')return response({option_contracts:[],snapshots:{},next_page_token:7});
        return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',
          ()=>reject(new DOMException('synthetic timeout','AbortError')),{once:true}));
      }),requestTimeoutMs:20};
      await assert.rejects(kind==='contracts'?fetchOptionContracts(cfg,params):fetchOptionSnapshots(cfg,snapshotParams),
        (error:unknown)=>error instanceof AlpacaProviderError
          &&error.errorClass===(fault==='timeout'?'PROVIDER_TIMEOUT':'MALFORMED_RESPONSE'));
      assert.equal(calls,2);
    }
  }
});

test('bars cannot inflate independent history through repeated observations or token loops',async()=>{
  const bar={t:at,o:100,h:101,l:99,c:100,v:100,vw:0};
  const input={symbols:['SPY'],timeframe:'1Day',start:at,end:at,feed:'iex',maxPages:3,adjustment:'raw' as const};
  for(const mode of ['identical','conflict','token-loop'] as const){
    let page=0;
    const cfg=config((async()=>response({bars:{SPY:[{...bar,c:mode==='conflict'&&page>0?101:100}]},
      next_page_token:++page===1||mode==='token-loop'?'next':null})) as typeof fetch);
    if(mode==='identical'){
      const result=await fetchStockBars(cfg,input,at);
      assert.equal(result.bars.length,1);assert.equal(result.providerZeroVwapCount,1);assert.equal(result.complete,true);
    }else await assert.rejects(fetchStockBars(cfg,input,at),(e:unknown)=>e instanceof AlpacaProviderError
      &&e.safeDetailCode===(mode==='conflict'?'ALPACA_BAR_DUPLICATE_CONFLICT':'ALPACA_BAR_PAGINATION_INVALID'));
  }
});
