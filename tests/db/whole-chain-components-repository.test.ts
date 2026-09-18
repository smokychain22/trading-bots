import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresWholeChainComponentsRepository } from '../../src/theta/postgres-whole-chain-components-repository.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const at = (day: number): string => `2026-09-${String(day).padStart(2,'0')}T15:00:00.000Z`;

test('whole-chain adapter is PIT-safe, deterministic, chain-isolated, and preserves lifecycle economics', {
  skip:!process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString=process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url=new URL(connectionString);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Disposable local database only');
  const pool=new Pool({connectionString:url.toString(),max:4});
  try {
    const workspaceId=randomUUID(),providerId=randomUUID(),accountId=randomUUID(),botId=randomUUID();
    const strategyId=randomUUID(),featureId=randomUUID(),riskId=randomUUID(),executionId=randomUUID(),costId=randomUUID();
    const underlyingId=randomUUID(),connectionId=randomUUID();
    const symbol=`W${underlyingId.replaceAll('-','').slice(0,8).toUpperCase()}`;
    await pool.query(`INSERT INTO iam.workspace(workspace_id,name) VALUES($1,$2)`,[workspaceId,`whole-chain-${workspaceId}`]);
    await pool.query(`INSERT INTO core.provider_connection(provider_connection_id,workspace_id,provider_code,environment,secret_ref,status)
      VALUES($1,$2,'ALPACA','PAPER',$3,'GOOD')`,[providerId,workspaceId,`test-${providerId}`]);
    await pool.query(`INSERT INTO core.trading_account(account_id,workspace_id,provider_connection_id,provider_account_id,environment,status)
      VALUES($1,$2,$3,$4,'PAPER','ACTIVE')`,[accountId,workspaceId,providerId,`test-${accountId}`]);
    await pool.query(`INSERT INTO core.strategy_version(strategy_version_id,semantic_version,config_json,config_hash,status)
      VALUES($1,$2,'{}',$3,'TEST')`,[strategyId,`test-${strategyId}`,hash(strategyId)]);
    await pool.query(`INSERT INTO core.feature_version(feature_version_id,semantic_version,definition_manifest_json,config_hash)
      VALUES($1,$2,'{}',$3)`,[featureId,`test-${featureId}`,hash(featureId)]);
    await pool.query(`INSERT INTO core.risk_limit_version(risk_limit_version_id,semantic_version,limits_json,config_hash,status)
      VALUES($1,$2,'{}',$3,'TEST')`,[riskId,`test-${riskId}`,hash(riskId)]);
    await pool.query(`INSERT INTO core.execution_version(execution_version_id,semantic_version,policy_json,config_hash,status)
      VALUES($1,$2,'{}',$3,'TEST')`,[executionId,`test-${executionId}`,hash(executionId)]);
    await pool.query(`INSERT INTO core.cost_model_version(cost_model_version_id,semantic_version,assumptions_json,config_hash,status)
      VALUES($1,$2,'{}',$3,'TEST')`,[costId,`test-${costId}`,hash(costId)]);
    await pool.query(`INSERT INTO core.bot_instance(bot_instance_id,workspace_id,account_id,mode,strategy_version_id,
      risk_limit_version_id,execution_version_id,cost_model_version_id,feature_version_id)
      VALUES($1,$2,$3,'PAPER',$4,$5,$6,$7,$8)`,[botId,workspaceId,accountId,strategyId,riskId,executionId,costId,featureId]);
    await pool.query(`INSERT INTO market.underlying(underlying_id,symbol,asset_type) VALUES($1,$2,'EQUITY')`,[underlyingId,symbol]);
    await pool.query(`INSERT INTO copy.follower_account(follower_account_id,workspace_id,provider_account_ref,oauth_secret_ref,
      participation,account_ready,account_role) VALUES($1,$2,$3,$4,'STOP_NEW_TRADES_MANAGE_EXISTING',true,'MASTER_THETA_PAPER')`,
    [connectionId,workspaceId,`paper-${connectionId}`,`test-secret-${connectionId}`]);

    const put0=randomUUID(),put1=randomUUID(),put2=randomUUID(),call0=randomUUID(),call1=randomUUID();
    await pool.query(`INSERT INTO market.option_contract(option_contract_id,contract_symbol,underlying_id,option_type,strike,
      expiration_date,multiplier,tradable,status) VALUES
      ($1,$2,$11,'PUT',50,'2026-10-16',100,true,'ACTIVE'),
      ($3,$4,$11,'PUT',48,'2026-11-20',100,true,'ACTIVE'),
      ($5,$6,$11,'PUT',47,'2026-12-18',100,true,'ACTIVE'),
      ($7,$8,$11,'CALL',53,'2026-11-20',100,true,'ACTIVE'),
      ($9,$10,$11,'CALL',55,'2026-12-18',100,true,'ACTIVE')`,
    [put0,`P${put0.replaceAll('-','')}`,put1,`P${put1.replaceAll('-','')}`,put2,`P${put2.replaceAll('-','')}`,
      call0,`C${call0.replaceAll('-','')}`,call1,`C${call1.replaceAll('-','')}`,underlyingId]);

    const chainId=randomUUID(),otherChainId=randomUUID();
    await pool.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at,closed_at)
      VALUES($1,$3,$4,'CLOSED',$5,$6),($2,$3,$4,'CSP_OPEN',$5,NULL)`,
    [chainId,otherChainId,botId,underlyingId,at(10),at(16)]);
    const leg0=randomUUID(),leg1=randomUUID(),leg2=randomUUID(),cc0=randomUUID(),cc1=randomUUID(),otherLeg=randomUUID();
    await pool.query(`INSERT INTO trade.option_leg(option_leg_id,chain_id,option_contract_id,side,quantity,
      entry_price_per_share,entry_credit_debit,opened_at,closed_at,close_reason,close_price_per_share,realized_pnl,
      rolled_from_option_leg_id,rolled_to_option_leg_id) VALUES
      ($1,$7,$8,'SHORT',1,2.00,200,$13,$14,'ROLLED',3.00,-100,NULL,$2),
      ($2,$7,$9,'SHORT',1,1.50,150,$14,$15,'ROLLED',1.00,50,$1,$3),
      ($3,$7,$10,'SHORT',1,1.80,180,$15,$16,'ASSIGNED',NULL,180,$2,NULL),
      ($4,$7,$11,'SHORT',1,1.00,100,$17,$18,'ROLLED',0.60,40,NULL,$5),
      ($5,$7,$12,'SHORT',1,1.20,120,$18,$19,'ASSIGNED',NULL,120,$4,NULL),
      ($6,$20,$8,'SHORT',1,99.00,9900,$13,NULL,NULL,NULL,NULL,NULL,NULL)`,
    [leg0,leg1,leg2,cc0,cc1,otherLeg,chainId,put0,put1,put2,call0,call1,
      at(10),at(11),at(12),at(13),at(14),at(15),at(16),otherChainId]);
    const lotId=randomUUID(),putAssignment=randomUUID(),callAssignment=randomUUID();
    await pool.query(`INSERT INTO trade.stock_lot(stock_lot_id,chain_id,underlying_id,shares,economic_basis_per_share,
      broker_basis_per_share,assignment_option_leg_id,acquired_at,disposed_at,disposed_price_per_share,realized_pnl)
      VALUES($1,$2,$3,100,47,46.5,$4,$5,$6,55,800)`,[lotId,chainId,underlyingId,leg2,at(13),at(16)]);
    await pool.query(`INSERT INTO trade.assignment_event(assignment_event_id,option_leg_id,stock_lot_id,assigned_at,shares,strike_price)
      VALUES($1,$3,$5,$6,100,47),($2,$4,$5,$7,100,55)`,
    [putAssignment,callAssignment,leg2,cc1,lotId,at(13),at(16)]);

    const zeroSnapshot=randomUUID(),openSnapshot=randomUUID(),closedSnapshot=randomUUID();
    const insertSnapshot=async (id:string,observedAt:string,positionCount:number) => pool.query(
      `INSERT INTO trade.broker_reconciliation_snapshot(reconciliation_snapshot_id,connection_id,correlation_id,environment,
       broker_host,account_status,position_count,open_order_count,activity_count,observed_at,provider_timestamp,data_quality,payload_hash)
       VALUES($1,$2,$3,'PAPER','paper-api.alpaca.markets','ACTIVE',$4,0,0,$5,$5,'GOOD',$6)`,
      [id,connectionId,`whole-chain-${id}`,positionCount,observedAt,hash(`snapshot-${id}`)]);
    await insertSnapshot(zeroSnapshot,at(10),0);
    await insertSnapshot(openSnapshot,at(14),1);
    await pool.query(`INSERT INTO trade.broker_position_snapshot(reconciliation_snapshot_id,connection_id,symbol,quantity,side,
      asset_class,observed_at,payload_hash,current_price) VALUES($1,$2,$3,100,'long','us_equity',$4,$5,49.25)`,
    [openSnapshot,connectionId,symbol,at(14),hash('position-'+openSnapshot)]);
    await insertSnapshot(closedSnapshot,at(16),0);

    const intentId=randomUUID(),brokerOrderId=randomUUID(),fillId=randomUUID(),tcaId=randomUUID();
    await pool.query(`INSERT INTO trade.order_intent(order_intent_id,chain_id,client_order_id,status,instrument_type,
      option_contract_id,side,quantity,created_at,updated_at) VALUES($1,$2,$3,'FILLED','OPTION',$4,'SELL',1,$5,$5)`,
    [intentId,chainId,`test-${intentId}`,put0,at(10)]);
    await pool.query(`INSERT INTO trade.broker_order(broker_order_id,order_intent_id,provider_order_id,submitted_at,
      acknowledged_at,broker_status,raw_payload_hash) VALUES($1,$2,$3,$4,$4,'filled',$5)`,
    [brokerOrderId,intentId,`provider-${brokerOrderId}`,at(10),hash('order-'+brokerOrderId)]);
    await pool.query(`INSERT INTO trade.fill(fill_id,broker_order_id,provider_fill_id,quantity,price_per_share,filled_at,fees)
      VALUES($1,$2,$3,1,2,$4,0)`,[fillId,brokerOrderId,`fill-${fillId}`,at(10)]);
    await pool.query(`INSERT INTO trade.transaction_cost_analysis(transaction_cost_analysis_id,order_intent_id,
      contract_version,calculated_at,decision_mid,arrival_mid,fill_price,spread_at_decision,spread_at_arrival,
      spread_at_fill,limit_attempts,latency_ms,slippage_dollars,slippage_bps,spread_capture,fees,
      estimated_market_impact,post_fill_move_json,quote_provider,quote_semantics,provider_timestamp,received_at,
      quote_age_ms,unknown_reasons_json,content_hash) VALUES
      ($1,$2,'test-v1',$3,2.05,2.04,2.00,0.10,0.10,0.10,1,10,5,25,0.5,0,0,'{}','ALPACA',
      'INDICATIVE',$3,$3,0,'[]',$4)`,[tcaId,intentId,at(10),hash('tca-'+tcaId)]);

    const repository=new PostgresWholeChainComponentsRepository(pool);
    const beforeRoll=await repository.load(chainId,'2026-09-10T18:00:00.000Z',{
      connectionId,reconciliationSnapshotId:zeroSnapshot,
    });
    assert.equal(beforeRoll.initialPutPremium.value,200,'initial total-dollar credit must not be multiplied again');
    assert.equal(beforeRoll.rollCredits.status,'KNOWN_ZERO');
    assert.equal(beforeRoll.rollCloseCosts.status,'KNOWN_ZERO');
    assert.equal(beforeRoll.stockSharesAssigned.value,0);
    assert.equal(beforeRoll.fees.status,'KNOWN_ZERO');
    assert.equal(beforeRoll.slippage.value,5);
    assert.equal(beforeRoll.dividends.status,'UNKNOWN','empty dividend rows are never assumed zero');
    assert.equal(beforeRoll.components,null,'unknown dividends keep the economic component set incomplete');

    const afterTwoRolls=await repository.load(chainId,'2026-09-12T18:00:00.000Z',{
      connectionId,reconciliationSnapshotId:zeroSnapshot,
    });
    assert.equal(afterTwoRolls.rollCredits.value,330);
    assert.equal(afterTwoRolls.rollCloseCosts.value,400);
    assert.equal(afterTwoRolls.stockSharesAssigned.value,0,'future assignment must not leak backward');

    const openStock=await repository.load(chainId,'2026-09-14T18:00:00.000Z',{
      connectionId,reconciliationSnapshotId:openSnapshot,
    });
    assert.equal(openStock.assignmentStrike.value,47);
    assert.equal(openStock.stockSharesAssigned.value,100);
    assert.equal(openStock.openStockShares.value,100);
    assert.equal(openStock.currentStockMarkPerShare.value,49.25);
    assert.deepEqual(openStock.stockLotBasisReferences.map((reference)=>({
      lifecycle:reference.lifecycleEconomicBasisPerShare,broker:reference.brokerBasisPerShare,
    })),[{lifecycle:47,broker:46.5}]);
    assert.equal(openStock.coveredCallPremium.value,100);
    assert.equal(openStock.coveredCallCloseCosts.status,'UNKNOWN','an open CC has unresolved close economics');

    const final=await repository.load(chainId,'2026-09-16T18:00:00.000Z',{
      connectionId,reconciliationSnapshotId:closedSnapshot,
    });
    assert.equal(final.coveredCallPremium.value,220);
    assert.equal(final.coveredCallCloseCosts.value,60);
    assert.equal(final.stockSaleOrCallAwayProceeds.value,5500);
    assert.equal(final.openStockShares.value,0);
    assert.equal(final.currentStockMarkPerShare.status,'UNKNOWN');
    assert.equal(final.fees.status,'KNOWN_ZERO');
    assert.equal(final.slippage.value,5);
    assert.equal(final.dividends.status,'UNKNOWN');

    const replay=await repository.load(chainId,'2026-09-12T18:00:00.000Z',{
      connectionId,reconciliationSnapshotId:zeroSnapshot,
    });
    assert.deepEqual(replay,afterTwoRolls,'same chain/asOf and canonical state must replay identically');
    assert.equal(replay.contentHash,afterTwoRolls.contentHash);
    assert.equal(replay.initialPutPremium.value,200,'another chain must never contaminate the selected chain');

    const unknownFeeChain=randomUUID(),unknownFeeLeg=randomUUID(),unknownIntent=randomUUID(),unknownOrder=randomUUID();
    await pool.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at)
      VALUES($1,$2,$3,'CSP_OPEN',$4)`,[unknownFeeChain,botId,underlyingId,at(10)]);
    await pool.query(`INSERT INTO trade.option_leg(option_leg_id,chain_id,option_contract_id,side,quantity,
      entry_price_per_share,entry_credit_debit,opened_at) VALUES($1,$2,$3,'SHORT',1,2,200,$4)`,
    [unknownFeeLeg,unknownFeeChain,put0,at(10)]);
    await pool.query(`INSERT INTO trade.order_intent(order_intent_id,chain_id,client_order_id,status,instrument_type,
      option_contract_id,side,quantity,created_at,updated_at) VALUES($1,$2,$3,'FILLED','OPTION',$4,'SELL',1,$5,$5)`,
    [unknownIntent,unknownFeeChain,`test-${unknownIntent}`,put0,at(10)]);
    await pool.query(`INSERT INTO trade.broker_order(broker_order_id,order_intent_id,provider_order_id,broker_status)
      VALUES($1,$2,$3,'filled')`,[unknownOrder,unknownIntent,`provider-${unknownOrder}`]);
    await pool.query(`INSERT INTO trade.fill(fill_id,broker_order_id,provider_fill_id,quantity,price_per_share,filled_at,fees)
      VALUES($1,$2,$3,1,2,$4,NULL)`,[randomUUID(),unknownOrder,`fill-${unknownOrder}`,at(10)]);
    const unknownFee=await repository.load(unknownFeeChain,'2026-09-10T18:00:00.000Z',{
      connectionId,reconciliationSnapshotId:zeroSnapshot,
    });
    assert.equal(unknownFee.fees.status,'UNKNOWN');
    assert.equal(unknownFee.slippage.status,'UNKNOWN','missing TCA is never zero slippage');

    const ccCloseChain=randomUUID(),ccCloseLeg=randomUUID(),ccCloseLot=randomUUID();
    const ccExpiryChain=randomUUID(),ccExpiryLeg=randomUUID(),ccExpiryLot=randomUUID();
    const stockSaleChain=randomUUID(),stockSalePut=randomUUID(),stockSaleLot=randomUUID();
    await pool.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at,closed_at)
      VALUES($1,$4,$5,'RECOVERY_WAIT',$6,NULL),($2,$4,$5,'RECOVERY_WAIT',$6,NULL),
      ($3,$4,$5,'CLOSED',$6,$7)`,[ccCloseChain,ccExpiryChain,stockSaleChain,botId,underlyingId,at(10),at(12)]);
    await pool.query(`INSERT INTO trade.stock_lot(stock_lot_id,chain_id,underlying_id,shares,economic_basis_per_share,acquired_at,
      disposed_at,disposed_price_per_share,realized_pnl) VALUES
      ($1,$4,$7,100,50,$8,NULL,NULL,NULL),($2,$5,$7,100,50,$8,NULL,NULL,NULL),
      ($3,$6,$7,100,50,$8,$9,49,-100)`,
    [ccCloseLot,ccExpiryLot,stockSaleLot,ccCloseChain,ccExpiryChain,stockSaleChain,underlyingId,at(10),at(12)]);
    await pool.query(`INSERT INTO trade.option_leg(option_leg_id,chain_id,option_contract_id,side,quantity,entry_price_per_share,
      entry_credit_debit,opened_at,closed_at,close_reason,close_price_per_share,realized_pnl) VALUES
      ($1,$4,$7,'SHORT',1,.75,75,$8,$9,'BTC_CLOSE',.25,50),
      ($2,$5,$7,'SHORT',1,.75,75,$8,$9,'EXPIRE_OTM',NULL,75),
      ($3,$6,$10,'SHORT',1,2,200,$8,$9,'ASSIGNED',NULL,200)`,
    [ccCloseLeg,ccExpiryLeg,stockSalePut,ccCloseChain,ccExpiryChain,stockSaleChain,call0,at(10),at(11),put0]);
    await pool.query(`INSERT INTO trade.expiration_event(expiration_event_id,option_leg_id,expired_at,itm)
      VALUES($1,$2,$3,false)`,[randomUUID(),ccExpiryLeg,at(11)]);
    await pool.query(`INSERT INTO trade.assignment_event(assignment_event_id,option_leg_id,stock_lot_id,assigned_at,shares,strike_price)
      VALUES($1,$2,$3,$4,100,50)`,[randomUUID(),stockSalePut,stockSaleLot,at(11)]);
    const ccClosed=await repository.load(ccCloseChain,'2026-09-11T18:00:00.000Z',{
      connectionId,reconciliationSnapshotId:openSnapshot,
    });
    assert.equal(ccClosed.coveredCallPremium.value,75);
    assert.equal(ccClosed.coveredCallCloseCosts.value,25);
    const ccExpired=await repository.load(ccExpiryChain,'2026-09-11T18:00:00.000Z',{
      connectionId,reconciliationSnapshotId:openSnapshot,
    });
    assert.equal(ccExpired.coveredCallCloseCosts.status,'KNOWN_ZERO');
    const stockSold=await repository.load(stockSaleChain,'2026-09-12T18:00:00.000Z',{
      connectionId,reconciliationSnapshotId:closedSnapshot,
    });
    assert.equal(stockSold.stockSaleOrCallAwayProceeds.value,4900);
  } finally {
    await pool.end();
  }
});
