import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresLifecycleApplicationStore } from '../../src/theta/postgres-lifecycle-application-store.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

test('broker-confirmed lifecycle changes are atomic, replay-safe, and preserve whole-chain economics', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString:url.toString(), max:4 });
  const now = '2026-09-12T15:00:00.000Z';
  try {
    const workspaceId=randomUUID(), providerId=randomUUID(), accountId=randomUUID(), botId=randomUUID();
    const strategyId=randomUUID(), featureId=randomUUID(), riskId=randomUUID(), executionId=randomUUID(), costId=randomUUID();
    const underlyingId=randomUUID();
    await pool.query(`INSERT INTO iam.workspace(workspace_id,name) VALUES($1,$2)`, [workspaceId,`lifecycle-${workspaceId}`]);
    await pool.query(`INSERT INTO core.provider_connection(provider_connection_id,workspace_id,provider_code,environment,secret_ref,status)
      VALUES($1,$2,'ALPACA','PAPER',$3,'GOOD')`, [providerId,workspaceId,`test-${providerId}`]);
    await pool.query(`INSERT INTO core.trading_account(account_id,workspace_id,provider_connection_id,provider_account_id,environment,status)
      VALUES($1,$2,$3,$4,'PAPER','ACTIVE')`, [accountId,workspaceId,providerId,`test-${accountId}`]);
    await pool.query(`INSERT INTO core.strategy_version(strategy_version_id,semantic_version,config_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [strategyId,`test-${strategyId}`,hash(strategyId)]);
    await pool.query(`INSERT INTO core.feature_version(feature_version_id,semantic_version,definition_manifest_json,config_hash) VALUES($1,$2,'{}',$3)`, [featureId,`test-${featureId}`,hash(featureId)]);
    await pool.query(`INSERT INTO core.risk_limit_version(risk_limit_version_id,semantic_version,limits_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [riskId,`test-${riskId}`,hash(riskId)]);
    await pool.query(`INSERT INTO core.execution_version(execution_version_id,semantic_version,policy_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [executionId,`test-${executionId}`,hash(executionId)]);
    await pool.query(`INSERT INTO core.cost_model_version(cost_model_version_id,semantic_version,assumptions_json,config_hash,status) VALUES($1,$2,'{}',$3,'TEST')`, [costId,`test-${costId}`,hash(costId)]);
    await pool.query(`INSERT INTO core.bot_instance(bot_instance_id,workspace_id,account_id,mode,strategy_version_id,risk_limit_version_id,execution_version_id,cost_model_version_id,feature_version_id)
      VALUES($1,$2,$3,'PAPER',$4,$5,$6,$7,$8)`, [botId,workspaceId,accountId,strategyId,riskId,executionId,costId,featureId]);
    await pool.query(`INSERT INTO market.underlying(underlying_id,symbol,asset_type) VALUES($1,$2,'EQUITY')`, [underlyingId,`T${underlyingId.slice(0,8)}`]);

    const putContract=randomUUID(), rolledPutContract=randomUUID(), callContract=randomUUID();
    await pool.query(`INSERT INTO market.option_contract(option_contract_id,contract_symbol,underlying_id,option_type,strike,expiration_date,multiplier,tradable,status)
      VALUES($1,$2,$4,'PUT',50,'2026-10-16',100,true,'ACTIVE'),($3,$5,$4,'PUT',48,'2026-11-20',100,true,'ACTIVE'),($6,$7,$4,'CALL',55,'2026-11-20',100,true,'ACTIVE')`,
    [putContract,`P${putContract.replaceAll('-','')}`,rolledPutContract,underlyingId,`P${rolledPutContract.replaceAll('-','')}`,callContract,`C${callContract.replaceAll('-','')}`]);

    const makeChain = async (state: 'CSP_OPEN' | 'RECOVERY_WAIT', contractId=putContract) => {
      const chainId=randomUUID(), legId=randomUUID();
      await pool.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at) VALUES($1,$2,$3,$4,$5)`,
        [chainId,botId,underlyingId,state,now]);
      if (state === 'CSP_OPEN') await pool.query(`INSERT INTO trade.option_leg(option_leg_id,chain_id,option_contract_id,side,quantity,entry_price_per_share,entry_credit_debit,opened_at)
        VALUES($1,$2,$3,'SHORT',1,2,200,$4)`, [legId,chainId,contractId,now]);
      return { chainId,legId };
    };
    const store = new PostgresLifecycleApplicationStore(pool);

    const assigned = await makeChain('CSP_OPEN');
    const lotId=randomUUID(), assignmentEvidence=hash('assignment-'+assigned.chainId);
    const assignment = {
      eventKind:'SHORT_PUT_ASSIGNMENT' as const,evidenceKey:assignmentEvidence,chainId:assigned.chainId,
      occurredAt:now,decisionId:null,providerActivityRefHash:hash('activity-a'),optionLegId:assigned.legId,
      stockLotId:lotId,shares:100,strikePrice:50,brokerBasisPerShare:50,economicBasisPerShare:50,realizedOptionPnl:200,
    };
    const first = await store.apply(assignment);
    assert.equal(first.finalState,'RECOVERY_WAIT');
    const replay = await store.apply(assignment);
    assert.equal(replay.duplicate,true);

    const callLegId=randomUUID();
    await store.apply({ eventKind:'COVERED_CALL_OPEN',evidenceKey:hash('cc-open-'+assigned.chainId),chainId:assigned.chainId,
      occurredAt:now,decisionId:null,providerActivityRefHash:null,optionLegId:callLegId,optionContractId:callContract,
      quantity:1,entryPricePerShare:1,entryCreditDebit:100 });
    const calledAway = await store.apply({ eventKind:'COVERED_CALL_ASSIGNMENT',evidenceKey:hash('call-away-'+assigned.chainId),
      chainId:assigned.chainId,occurredAt:now,decisionId:null,providerActivityRefHash:hash('activity-b'),
      optionLegId:callLegId,stockLotId:lotId,shares:100,strikePrice:55,realizedOptionPnl:100,realizedStockPnl:500 });
    assert.equal(calledAway.finalState,'CLOSED');
    const economics = await pool.query(`SELECT
      (SELECT sum(realized_pnl) FROM trade.option_leg WHERE chain_id=$1) AS option_pnl,
      (SELECT sum(realized_pnl) FROM trade.stock_lot WHERE chain_id=$1) AS stock_pnl`, [assigned.chainId]);
    assert.equal(Number(economics.rows[0].option_pnl),300);
    assert.equal(Number(economics.rows[0].stock_pnl),500);

    const expired = await makeChain('CSP_OPEN');
    const expiry = await store.apply({ eventKind:'OPTION_EXPIRATION',evidenceKey:hash('expiry-'+expired.chainId),
      chainId:expired.chainId,occurredAt:now,decisionId:null,providerActivityRefHash:hash('activity-c'),
      optionLegId:expired.legId,itm:false,realizedOptionPnl:200 });
    assert.equal(expiry.finalState,'REDEPLOY');

    const rolled = await makeChain('CSP_OPEN');
    const newLegId=randomUUID();
    const roll = await store.apply({ eventKind:'OPTION_ROLL',evidenceKey:hash('roll-'+rolled.chainId),chainId:rolled.chainId,
      occurredAt:now,decisionId:null,providerActivityRefHash:null,oldOptionLegId:rolled.legId,newOptionLegId:newLegId,
      newOptionContractId:rolledPutContract,newQuantity:1,newEntryPricePerShare:1.8,newEntryCreditDebit:180,
      oldClosePricePerShare:3.5,oldRealizedPnl:-150,legKind:'SHORT_PUT' });
    assert.equal(roll.finalState,'CSP_OPEN');
    const rollLegs = await pool.query(`SELECT realized_pnl,rolled_to_option_leg_id FROM trade.option_leg WHERE option_leg_id=$1`, [rolled.legId]);
    assert.equal(Number(rollLegs.rows[0].realized_pnl),-150);
    assert.equal(rollLegs.rows[0].rolled_to_option_leg_id,newLegId);

    const recovery = await makeChain('RECOVERY_WAIT');
    const recoveryLot=randomUUID();
    await pool.query(`INSERT INTO trade.stock_lot(stock_lot_id,chain_id,underlying_id,shares,economic_basis_per_share,acquired_at)
      VALUES($1,$2,$3,100,50,$4)`, [recoveryLot,recovery.chainId,underlyingId,now]);
    const recoveryCallLeg=randomUUID();
    await store.apply({ eventKind:'COVERED_CALL_OPEN',evidenceKey:hash('cc2-open-'+recovery.chainId),chainId:recovery.chainId,
      occurredAt:now,decisionId:null,providerActivityRefHash:null,optionLegId:recoveryCallLeg,optionContractId:callContract,
      quantity:1,entryPricePerShare:1,entryCreditDebit:100 });
    const closeCc = await store.apply({ eventKind:'OPTION_CLOSE',evidenceKey:hash('cc2-close-'+recovery.chainId),chainId:recovery.chainId,
      occurredAt:now,decisionId:null,providerActivityRefHash:null,optionLegId:recoveryCallLeg,closePricePerShare:0.5,
      realizedOptionPnl:50,nextState:'RECOVERY_WAIT' });
    assert.equal(closeCc.finalState,'RECOVERY_WAIT');
    const sold = await store.apply({ eventKind:'STOCK_DISPOSAL',evidenceKey:hash('stock-sale-'+recovery.chainId),chainId:recovery.chainId,
      occurredAt:now,decisionId:null,providerActivityRefHash:null,stockLotId:recoveryLot,disposedPricePerShare:49,realizedStockPnl:-100 });
    assert.equal(sold.finalState,'CLOSED');

    const invalid = await makeChain('CSP_OPEN');
    await assert.rejects(() => store.apply({ ...assignment,evidenceKey:hash('invalid-'+invalid.chainId),chainId:invalid.chainId,
      optionLegId:invalid.legId,stockLotId:randomUUID(),economicBasisPerShare:49 }), /ASSIGNMENT_ECONOMIC_BASIS_INVALID/);
    const unchanged = await pool.query(`SELECT lifecycle_state FROM trade.economic_chain WHERE chain_id=$1`, [invalid.chainId]);
    const openLeg = await pool.query(`SELECT closed_at FROM trade.option_leg WHERE option_leg_id=$1`, [invalid.legId]);
    assert.equal(unchanged.rows[0].lifecycle_state,'CSP_OPEN');
    assert.equal(openLeg.rows[0].closed_at,null);

    const wrongPnl = await makeChain('CSP_OPEN');
    await assert.rejects(() => store.apply({ eventKind:'OPTION_CLOSE',evidenceKey:hash('wrong-pnl-'+wrongPnl.chainId),
      chainId:wrongPnl.chainId,occurredAt:now,decisionId:null,providerActivityRefHash:null,
      optionLegId:wrongPnl.legId,closePricePerShare:1,realizedOptionPnl:999,nextState:'REDEPLOY' }),
    /OPTION_REALIZED_PNL_MISMATCH/);
    const wrongPnlState = await pool.query(`SELECT lifecycle_state FROM trade.economic_chain WHERE chain_id=$1`, [wrongPnl.chainId]);
    assert.equal(wrongPnlState.rows[0].lifecycle_state,'CSP_OPEN');
  } finally { await pool.end(); }
});
