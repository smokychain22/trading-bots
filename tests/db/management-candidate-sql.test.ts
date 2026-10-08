import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { ProductionPaperManagementCandidateSource } from
  '../../src/theta/production-paper-management-candidate-source.js';
import { assembleManagementInput, PostgresManagementInputStore } from '../../src/theta/management-input-state.js';
import { buildReconciledAccountCapital } from '../../src/execution/reconciled-account-capital.js';
import { evaluatePaperBootstrapManagementPolicy } from '../../src/theta/paper-bootstrap-management-policy.js';
import { buildManagementActionFrontier } from '../../src/theta/management-action-frontier.js';

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

test('real PostgreSQL DATE and JSONB reconciliation survive restart-shaped loading through close selection', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString=process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  assert.ok(['127.0.0.1','localhost'].includes(new URL(connectionString).hostname));
  const pool=new Pool({connectionString,max:1});
  const at='2026-10-13T14:00:00.000Z',accountHash='a'.repeat(64);
  const accountCapitalObservation=buildReconciledAccountCapital({equity:'100000',cash:'90000',
    options_buying_power:'84300.25',buying_power:'337201',status:'ACTIVE',trading_blocked:false,account_blocked:false},
  {accountHash,snapshotId:'recon-date-json',requestedAt:at,receivedAt:at});
  try {
    const row=(await pool.query(`SELECT DATE '2026-10-16' AS raw_date,
      DATE '2026-10-16'::text AS expiration_date, $1::jsonb AS reconciliation_detail`,
    [JSON.stringify({accountCapitalObservation})])).rows[0];
    assert.ok(row.raw_date instanceof Date,'characterize pg DATE parser, not a string fixture');
    assert.equal(row.expiration_date,'2026-10-16');
    for (const expiration of [row.raw_date,row.expiration_date]) {
      const state=assembleManagementInput({...row,expiration_date:expiration,physical_account_hash:accountHash,
        chain_id:'chain',lifecycle_state:'CSP_OPEN',underlying_id:'underlying',underlying:'AAPL',
        option_leg_id:'leg',option_contract_id:'contract',quantity:'1',entry_credit_debit:'200',
        contract_symbol:'AAPL261016P00200000',option_type:'PUT',strike:'200',multiplier:'100',
        bid:'0.01',ask:'0.02',quote_as_of:at,feed:'OPRA',quote_quality:'GOOD',realized_option_pnl:'0',
        open_stock_shares:'0',stock_basis_per_share:null,realized_stock_pnl:'0',dividends:'0',fees:'0',
        unknown_fill_fees:true,account_as_of:'2026-10-12T14:00:00Z',fusion_snapshot_id:'fusion',
        reconciliation_quality:'GOOD',broker_option_symbol:'AAPL261016P00200000',broker_option_quantity:'1',
        broker_option_side:'short',broker_option_asset_class:'us_option',broker_option_observed_at:at,
        ledger_option_contract_quantity:'1',snapshot_json:{underlyingState:{last:205},
          marketSession:{isOpen:true},riskState:{newRiskState:'ALLOW_FULL'},eventState:{state:'CLEAR'}}},
      {managementInputSnapshotId:randomUUID(),reconciliationSnapshotId:'recon-date-json',observedAt:at});
      assert.equal(state.market.dte,4,'existing DTE policy includes the expiration-session close');
      assert.equal(state.account.optionsBuyingPower,84300.25);
      assert.ok(!state.hardBlockers.includes('BROKER_DATA_STALE'));
      assert.equal(state.economics.fees,null,'unobserved fees must remain unknown');
      const policy=evaluatePaperBootstrapManagementPolicy(state);
      const frontier=buildManagementActionFrontier(state,policy);
      assert.equal(frontier.selectedAction,'CLOSE_FULL');
      assert.equal(frontier.decisionState,'ACTION_SELECTED');
      assert.equal(frontier.actions.find(a=>a.action==='CLOSE_FULL')?.executionEvidence?.closeEconomicBoundary,0.02);
      assert.equal(frontier.actions.find(a=>a.action==='CLOSE_FULL')?.executionEvidence?.expectedAfterCostEv,null);
    }
  } finally { await pool.end(); }
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
        expiration_date:expiration,size:'100',tradable:true,root_symbol:underlying,
        underlying_symbol:underlying,style:'american',deliverables:[{type:'equity',symbol:underlying,
          amount:'100',allocation_percentage:'100'}]}],next_page_token:null});
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
