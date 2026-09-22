import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { ProductionPaperManagementCandidateSource } from
  '../../src/theta/production-paper-management-candidate-source.js';
import { PostgresManagementInputStore } from '../../src/theta/management-input-state.js';

test('management discovery and input queries compile against migrated PostgreSQL and remain master scoped',{
  skip:!process.env.TEST_DATABASE_URL,
},async()=>{
  const connectionString=process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url=new URL(connectionString);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Disposable local database only');
  const pool=new Pool({connectionString:url.toString(),max:2});
  try{
    const invalidConnection=randomUUID(),invalidReconciliation=randomUUID();
    const source=new ProductionPaperManagementCandidateSource(pool,{
      tradingApiBase:'https://paper-api.alpaca.markets',marketDataApiBase:'https://data.alpaca.markets',
      apiKey:'test-only',apiSecret:'test-only',fetchImpl:(async()=>{throw new Error('BROKER_FETCH_NOT_EXPECTED');}) as typeof fetch,
    });
    assert.deepEqual(await source.loadSubjects(invalidConnection,invalidReconciliation),[]);
    assert.deepEqual(await new PostgresManagementInputStore(pool).assembleAndPersistOpenChains(
      invalidConnection,invalidReconciliation,new Date().toISOString()),[]);
  }finally{await pool.end();}
});

test('management candidate producer batches a real-shaped broker lattice into immutable local quote evidence',{
  skip:!process.env.TEST_DATABASE_URL,
},async()=>{
  const connectionString=process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url=new URL(connectionString);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Disposable local database only');
  const pool=new Pool({connectionString:url.toString(),max:2});
  try{
    const underlyingId=randomUUID(),underlying=`M${underlyingId.replaceAll('-','').slice(0,6).toUpperCase()}`;
    const expiration=new Date(Date.now()+40*86_400_000).toISOString().slice(0,10);
    const oldExpiration=new Date(Date.now()+20*86_400_000).toISOString().slice(0,10);
    const symbol=`${underlying}${expiration.slice(2).replaceAll('-','')}P00195000`;
    const quoteTimestamp=new Date().toISOString();
    await pool.query(`INSERT INTO market.underlying(underlying_id,symbol,asset_type)
      VALUES($1,$2,'EQUITY')`,[underlyingId,underlying]);
    const subject={chainId:randomUUID(),underlyingId,underlying,lifecycleState:'CSP_OPEN',
      currentContractSymbol:null,currentContractId:null,currentOptionType:'PUT' as const,
      currentExpiration:oldExpiration,currentMultiplier:100,optionQuantity:1,stockShares:0};
    const fetchImpl=(async(input:RequestInfo|URL)=>{
      const path=new URL(input instanceof URL?input.toString():String(input)).pathname;
      if(path==='/v2/options/contracts')return Response.json({option_contracts:[{symbol,strike_price:'195',
        expiration_date:expiration,size:'100',tradable:true}],next_page_token:null});
      if(path===`/v1beta1/options/snapshots/${underlying}`)return Response.json({snapshots:{
        [symbol]:{latestQuote:{bp:'1.5',ap:'1.6',bs:'8',as:'9',t:quoteTimestamp}},
      },next_page_token:null});
      throw new Error('UNEXPECTED_BROKER_OPERATION');
    }) as typeof fetch;
    class FixtureSource extends ProductionPaperManagementCandidateSource{
      override async loadSubjects():Promise<readonly typeof subject[]>{return [subject];}
    }
    const source=new FixtureSource(pool,{tradingApiBase:'https://paper-api.alpaca.markets',
      marketDataApiBase:'https://data.alpaca.markets',apiKey:'test-only',apiSecret:'test-only',fetchImpl});
    const first=(await source.discover(randomUUID(),randomUUID())).get(subject.chainId);
    assert.equal(first?.state,'READY');
    assert.equal(first.rollCandidates.length,1);
    assert.equal(first.rollCandidates[0]?.symbol,symbol);
    assert.equal(first.rollCandidates[0]?.quoteFeed,'PAPER_INDICATIVE_REFERENCE');
    const second=(await source.discover(randomUUID(),randomUUID())).get(subject.chainId);
    assert.equal(second?.state,'READY');
    const persisted=await pool.query(`SELECT count(*)::int AS count FROM market.option_quote_snapshot q
      JOIN market.option_contract c ON c.option_contract_id=q.option_contract_id
      WHERE c.contract_symbol=$1 AND q.feed='INDICATIVE'`,[symbol]);
    assert.equal(persisted.rows[0]?.count,1,'same provider quote revision must be idempotent');
  }finally{await pool.end();}
});
