import type { Pool } from 'pg';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';
import { applyShadowCspOpening, classifyConservativeShadowFill, selectShadowOpeningCandidate,
  shadowAccountingPolicyVersion, shadowContentHash, shadowFillPolicyVersion, shadowSelectionPolicyVersion,
  type ShadowOpeningCandidate } from './shadow-virtual-trader.js';

export interface ShadowIntentCreationReport {
  readonly state: 'CREATED' | 'WAIT' | 'ACTIVE_SHADOW_RISK_EXISTS' | 'ACCOUNT_STATE_UNKNOWN';
  readonly intentId: string | null;
  readonly candidateId: string | null;
  readonly reasonCodes: readonly string[];
}

export interface ShadowObservationResolutionReport {
  readonly state: 'NO_INTENT' | 'NO_CHANGE' | 'FILLED_SHADOW' | 'PARTIAL_SHADOW' | 'UNFILLED_SHADOW' | 'EXPIRED_UNFILLED' | 'UNKNOWN_EXECUTABILITY';
  readonly filledQuantity: number;
}

const finite = (value:unknown):number|null => value===null||value===undefined||!Number.isFinite(Number(value))?null:Number(value);
const integer = (value:unknown):number => Number.isInteger(Number(value))?Number(value):0;

export class PostgresShadowVirtualTrader {
  constructor(private readonly pool:Pool) {}

  async createOpeningIntent(scanId:string,createdAt:string):Promise<ShadowIntentCreationReport>{
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['theta-shadow-opening-intent']);
      const active=await client.query(`SELECT 1 FROM research.theta_shadow_order_intent i
        JOIN LATERAL (SELECT state FROM research.theta_shadow_order_event e WHERE e.shadow_intent_id=i.shadow_intent_id
          ORDER BY e.occurred_at DESC,e.created_at DESC LIMIT 1) latest ON true
        WHERE latest.state IN ('PENDING_SHADOW','PARTIAL_SHADOW','FILLED_SHADOW') LIMIT 1`);
      if((active.rowCount??0)>0){await client.query('COMMIT');return {state:'ACTIVE_SHADOW_RISK_EXISTS',intentId:null,candidateId:null,reasonCodes:['MANAGEMENT_FIRST_ACTIVE_SHADOW_RISK']};}

      const result=await client.query(`SELECT c.candidate_id,p.decision_id,p.fusion_snapshot_id,c.option_contract_id,
          oc.contract_symbol,u.symbol AS underlying,oc.option_type::text,oc.strike::text,oc.expiration_date::text,oc.multiplier::text,
          c.rank,(c.metrics_json->'thetaQ'->>'quantity') AS quantity,c.ownership_score::text,
          q.quote_observation_id,q.bid::text,q.ask::text,q.bid_size::text,q.ask_size::text,q.provider_timestamp,q.data_quality,
          p.decision_time,p.strategy_version,p.risk_version,p.feature_version,p.cost_model_version,p.execution_model_version,
          fs.bot_instance_id,fs.account_snapshot_id,a.account_id,a.equity::text,a.cash::text,a.buying_power::text
        FROM research.theta_shadow_scan_member sm
        JOIN trade.candidate c ON c.candidate_set_id=sm.candidate_set_id
        JOIN trade.candidate_point_in_time_evidence p ON p.candidate_id=c.candidate_id
        JOIN market.option_contract oc ON oc.option_contract_id=c.option_contract_id
        JOIN market.underlying u ON u.underlying_id=oc.underlying_id
        JOIN trade.fusion_snapshot fs ON fs.fusion_snapshot_id=p.fusion_snapshot_id
        JOIN trade.account_snapshot a ON a.account_snapshot_id=fs.account_snapshot_id
        LEFT JOIN market.execution_quote_observation q ON q.candidate_id=c.candidate_id AND q.observation_role='DECISION'
        WHERE sm.scan_id=$1 AND c.action_feasible=true ORDER BY c.candidate_id`,[scanId]);
      const candidates:ShadowOpeningCandidate[]=result.rows.map((row)=>({
        candidateId:String(row.candidate_id),decisionId:row.decision_id===null?null:String(row.decision_id),fusionSnapshotId:String(row.fusion_snapshot_id),
        optionContractId:String(row.option_contract_id),contractSymbol:String(row.contract_symbol),underlying:String(row.underlying),
        optionType:String(row.option_type) as 'PUT'|'CALL',strike:Number(row.strike),expiration:String(row.expiration_date),multiplier:Number(row.multiplier),
        rank:row.rank===null?null:Number(row.rank),quantity:integer(row.quantity),ownershipScore:finite(row.ownership_score),bid:finite(row.bid),ask:finite(row.ask),
        bidSize:finite(row.bid_size),askSize:finite(row.ask_size),quoteTimestamp:row.provider_timestamp===null?null:String(row.provider_timestamp),
        quoteQuality:String(row.data_quality??'UNKNOWN'),decisionTime:String(row.decision_time),strategyVersion:String(row.strategy_version),
        riskVersion:String(row.risk_version),featureVersion:String(row.feature_version),costModelVersion:String(row.cost_model_version),
        executionModelVersion:String(row.execution_model_version),
      }));
      const selection=selectShadowOpeningCandidate(candidates);
      if(selection.candidate===null){await client.query('COMMIT');return {state:'WAIT',intentId:null,candidateId:null,reasonCodes:selection.reasonCodes};}
      const selected=selection.candidate,row=result.rows.find((item)=>String(item.candidate_id)===selected.candidateId);
      const equity=finite(row?.equity),cash=finite(row?.cash),buyingPower=finite(row?.buying_power);
      if(row===undefined||equity===null||cash===null||buyingPower===null||equity<=0||cash<0||buyingPower<selected.strike*selected.multiplier*selected.quantity){
        await client.query('COMMIT');return {state:'ACCOUNT_STATE_UNKNOWN',intentId:null,candidateId:selected.candidateId,reasonCodes:['VIRTUAL_ACCOUNT_SEED_OR_COLLATERAL_UNKNOWN']};
      }
      const shadowAccountId=deterministicRuntimeUuid(`shadow-account:${String(row.bot_instance_id)}`);
      await client.query(`INSERT INTO research.theta_shadow_virtual_account(shadow_account_id,bot_instance_id,seed_account_snapshot_id,
        initial_equity,initial_cash,policy_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(bot_instance_id) DO NOTHING`,
        [shadowAccountId,row.bot_instance_id,row.account_snapshot_id,equity,cash,shadowAccountingPolicyVersion,createdAt]);
      const initialSnapshotId=deterministicRuntimeUuid(`shadow-account-snapshot:${shadowAccountId}:initial`);
      const initialPayload={shadowAccountId,asOf:createdAt,cash,equity,reservedCollateral:0,buyingPower,realizedPnl:0,unrealizedPnl:0,openOptionContracts:0,stockShares:0};
      await client.query(`INSERT INTO research.theta_shadow_account_snapshot(shadow_account_snapshot_id,shadow_account_id,as_of,cash,equity,
        reserved_collateral,buying_power,realized_pnl,unrealized_pnl,open_option_contracts,stock_shares,policy_version,content_hash,created_at)
        VALUES($1,$2,$3,$4,$5,0,$6,0,0,0,0,$7,$8,$3) ON CONFLICT(content_hash) DO NOTHING`,
        [initialSnapshotId,shadowAccountId,createdAt,cash,equity,buyingPower,shadowAccountingPolicyVersion,shadowContentHash(initialPayload)]);
      const intentId=deterministicRuntimeUuid(`shadow-intent:${scanId}:${selected.candidateId}:SELL_TO_OPEN`);
      const payload={intentId,scanId,candidateId:selected.candidateId,decisionId:selected.decisionId,fusionSnapshotId:selected.fusionSnapshotId,
        contract:selected.contractSymbol,positionIntent:'SELL_TO_OPEN',quantity:selected.quantity,multiplier:selected.multiplier,limit:selected.bid,
        decisionBid:selected.bid,decisionAsk:selected.ask,decisionTime:selected.decisionTime,selectionPolicyVersion:shadowSelectionPolicyVersion,
        executionPolicyVersion:shadowFillPolicyVersion,reasonCodes:selection.reasonCodes,executionAuthorized:false};
      await client.query(`INSERT INTO research.theta_shadow_order_intent(shadow_intent_id,shadow_account_id,scan_id,candidate_id,decision_id,
        fusion_snapshot_id,option_contract_id,strategy_branch,position_intent,quantity,multiplier,limit_price,decision_bid,decision_ask,
        decision_bid_size,decision_ask_size,quote_observation_id,decision_time,quote_timestamp,selection_policy_version,execution_policy_version,
        cost_model_version,reason_codes_json,content_hash,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'THETA_CONVENTIONAL','SELL_TO_OPEN',$8,$9,$10,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22)
        ON CONFLICT(scan_id,position_intent) DO NOTHING`,[intentId,shadowAccountId,scanId,selected.candidateId,selected.decisionId,
          selected.fusionSnapshotId,selected.optionContractId,selected.quantity,selected.multiplier,selected.bid,selected.ask,selected.bidSize,
          selected.askSize,row.quote_observation_id,selected.decisionTime,selected.quoteTimestamp,shadowSelectionPolicyVersion,shadowFillPolicyVersion,
          selected.costModelVersion,JSON.stringify(selection.reasonCodes),shadowContentHash(payload),createdAt]);
      const eventPayload={intentId,state:'PENDING_SHADOW',reasonCode:'AWAITING_LATER_PRICE_THROUGH',createdAt};
      await client.query(`INSERT INTO research.theta_shadow_order_event(shadow_order_event_id,shadow_intent_id,state,occurred_at,
        reason_code,policy_version,evidence_json,content_hash,created_at) VALUES($1,$2,'PENDING_SHADOW',$3,$4,$5,$6::jsonb,$7,$3)
        ON CONFLICT(content_hash) DO NOTHING`,[deterministicRuntimeUuid(`shadow-order-event:${intentId}:PENDING`),intentId,createdAt,
          'AWAITING_LATER_PRICE_THROUGH',shadowFillPolicyVersion,JSON.stringify({decisionQuoteObservationId:row.quote_observation_id}),shadowContentHash(eventPayload)]);
      await client.query('COMMIT');
      return {state:'CREATED',intentId,candidateId:selected.candidateId,reasonCodes:selection.reasonCodes};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  async resolveObservation(candidateId:string,quoteObservationId:string,horizonCode:string,observedAt:string):Promise<ShadowObservationResolutionReport>{
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const found=await client.query(`SELECT i.*,oc.strike::text,oc.multiplier::text,u.underlying_id,
          q.bid::text,q.ask::text,q.bid_size::text,q.ask_size::text,
          latest.state AS latest_state,latest.remaining_quantity,
          a.cash::text,a.equity::text,a.reserved_collateral::text,a.buying_power::text,a.realized_pnl::text,
          a.unrealized_pnl::text,a.open_option_contracts,a.stock_shares,cv.assumptions_json AS cost_assumptions
        FROM research.theta_shadow_order_intent i
        JOIN market.option_contract oc ON oc.option_contract_id=i.option_contract_id JOIN market.underlying u ON u.underlying_id=oc.underlying_id
        JOIN trade.candidate_point_in_time_evidence p ON p.candidate_id=i.candidate_id
        JOIN core.cost_model_version cv ON cv.cost_model_version_id::text=p.cost_model_version
        JOIN market.execution_quote_observation q ON q.quote_observation_id=$2
        JOIN LATERAL (SELECT state,remaining_quantity FROM research.theta_shadow_order_event e WHERE e.shadow_intent_id=i.shadow_intent_id
          ORDER BY e.occurred_at DESC,e.created_at DESC LIMIT 1) latest ON true
        JOIN LATERAL (SELECT * FROM research.theta_shadow_account_snapshot s WHERE s.shadow_account_id=i.shadow_account_id
          ORDER BY s.as_of DESC,s.created_at DESC LIMIT 1) a ON true
        WHERE i.candidate_id=$1 FOR UPDATE OF i`,[candidateId,quoteObservationId]);
      const row=found.rows[0];
      if(row===undefined){await client.query('COMMIT');return {state:'NO_INTENT',filledQuantity:0};}
      if(!['PENDING_SHADOW','UNFILLED_SHADOW','UNKNOWN_EXECUTABILITY','PARTIAL_SHADOW'].includes(String(row.latest_state))){
        await client.query('COMMIT');return {state:'NO_CHANGE',filledQuantity:0};
      }
      const remaining=row.remaining_quantity===null?Number(row.quantity):Number(row.remaining_quantity);
      const assessment=classifyConservativeShadowFill({side:String(row.position_intent).startsWith('SELL')?'SELL':'BUY',requestedQuantity:remaining,
        limit:Number(row.limit_price),bid:finite(row.bid),ask:finite(row.ask),bidSize:finite(row.bid_size),askSize:finite(row.ask_size),finalObservation:horizonCode==='EOD'});
      const eventIdentity=`shadow-order-event:${row.shadow_intent_id}:${quoteObservationId}:${assessment.state}`;
      const eventId=deterministicRuntimeUuid(eventIdentity);
      const eventPayload={intentId:row.shadow_intent_id,quoteObservationId,state:assessment.state,assessment};
      await client.query(`INSERT INTO research.theta_shadow_order_event(shadow_order_event_id,shadow_intent_id,state,occurred_at,quote_observation_id,
        filled_quantity,remaining_quantity,reason_code,policy_version,evidence_json,content_hash,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$4) ON CONFLICT(content_hash) DO NOTHING`,[eventId,row.shadow_intent_id,
          assessment.state,observedAt,quoteObservationId,assessment.filledQuantity,assessment.remainingQuantity,assessment.reasonCode,
          shadowFillPolicyVersion,JSON.stringify({horizonCode,bid:finite(row.bid),ask:finite(row.ask),bidSize:finite(row.bid_size),askSize:finite(row.ask_size)}),shadowContentHash(eventPayload)]);
      if(assessment.filledQuantity!==null&&assessment.fillPrice!==null){
        const fillId=deterministicRuntimeUuid(`shadow-fill:${row.shadow_intent_id}:${quoteObservationId}`);
        const gross=assessment.fillPrice*Number(row.multiplier)*assessment.filledQuantity;
        const perContractCost=finite(row.cost_assumptions?.totalModeledCostPerContract);
        const modeledCost=perContractCost===null?null:perContractCost*assessment.filledQuantity;
        const fillPayload={fillId,intentId:row.shadow_intent_id,quoteObservationId,quantity:assessment.filledQuantity,price:assessment.fillPrice,gross,modeledCost};
        await client.query(`INSERT INTO research.theta_shadow_fill(shadow_fill_id,shadow_intent_id,quote_observation_id,quantity,price,multiplier,
          gross_cashflow,modeled_cost,filled_at,fill_policy_version,evidence_class,content_hash,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'LIVE_SHADOW',$11,$9) ON CONFLICT(shadow_intent_id,quote_observation_id) DO NOTHING`,
          [fillId,row.shadow_intent_id,quoteObservationId,assessment.filledQuantity,assessment.fillPrice,row.multiplier,gross,modeledCost,observedAt,shadowFillPolicyVersion,shadowContentHash(fillPayload)]);
        const chainId=deterministicRuntimeUuid(`shadow-chain:${row.shadow_intent_id}`);
        await client.query(`INSERT INTO research.theta_shadow_chain(shadow_chain_id,shadow_account_id,underlying_id,opening_intent_id,opened_at,
          strategy_version,risk_version,feature_version,cost_model_version,execution_model_version,evidence_class,created_at)
          SELECT $1,i.shadow_account_id,$2,i.shadow_intent_id,$3,p.strategy_version,p.risk_version,p.feature_version,p.cost_model_version,
            p.execution_model_version,'LIVE_SHADOW',$3 FROM research.theta_shadow_order_intent i
          JOIN trade.candidate_point_in_time_evidence p ON p.candidate_id=i.candidate_id WHERE i.shadow_intent_id=$4
          ON CONFLICT(opening_intent_id) DO NOTHING`,[chainId,row.underlying_id,observedAt,row.shadow_intent_id]);
        const collateral=Number(row.strike)*Number(row.multiplier)*assessment.filledQuantity;
        const lifecyclePayload={chainId,fillId,eventType:assessment.state==='PARTIAL_SHADOW'?'CSP_PARTIAL':'CSP_OPENED',quantity:assessment.filledQuantity,gross,collateral};
        const lifecycleId=deterministicRuntimeUuid(`shadow-lifecycle:${fillId}`);
        await client.query(`INSERT INTO research.theta_shadow_lifecycle_event(shadow_lifecycle_event_id,shadow_chain_id,event_type,from_state,to_state,
          occurred_at,shadow_fill_id,quantity,cashflow,realized_pnl,unrealized_pnl,secured_collateral,capital_days,reason_code,evidence_json,content_hash,created_at)
          VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,NULL,NULL,$9,0,$10,$11::jsonb,$12,$5) ON CONFLICT(content_hash) DO NOTHING`,
          [lifecycleId,chainId,assessment.state==='PARTIAL_SHADOW'?'CSP_PARTIAL':'CSP_OPENED',assessment.state==='PARTIAL_SHADOW'?'CSP_PARTIAL':'CSP_OPEN',
            observedAt,fillId,assessment.filledQuantity,gross,collateral,assessment.reasonCode,JSON.stringify({quoteObservationId,modeledCost:'UNKNOWN'}),shadowContentHash(lifecyclePayload)]);
        const nextCollateral=Number(row.reserved_collateral)+collateral;
        const nextOpenContracts=Number(row.open_option_contracts)+assessment.filledQuantity;
        const economicInputsKnown=modeledCost!==null&&finite(row.cash)!==null&&finite(row.equity)!==null&&finite(row.buying_power)!==null
          &&finite(row.realized_pnl)!==null&&finite(row.unrealized_pnl)!==null;
        const next=economicInputsKnown?applyShadowCspOpening({prior:{cash:Number(row.cash),equity:Number(row.equity),
          reservedCollateral:Number(row.reserved_collateral),buyingPower:Number(row.buying_power),realizedPnl:Number(row.realized_pnl),
          unrealizedPnl:Number(row.unrealized_pnl),openOptionContracts:Number(row.open_option_contracts)},quantity:assessment.filledQuantity,
          strike:Number(row.strike),multiplier:Number(row.multiplier),fillPrice:assessment.fillPrice,markAsk:Number(row.ask),modeledCost}):null;
        const snapshotPayload={shadowAccountId:row.shadow_account_id,asOf:observedAt,cash:next?.cash??null,equity:next?.equity??null,
          reservedCollateral:nextCollateral,buyingPower:next?.buyingPower??null,realizedPnl:next?.realizedPnl??null,
          unrealizedPnl:next?.unrealizedPnl??null,openOptionContracts:nextOpenContracts,stockShares:Number(row.stock_shares),
          sourceEventId:lifecycleId,costState:modeledCost===null?'UNKNOWN':'MODELED_UNCALIBRATED'};
        await client.query(`INSERT INTO research.theta_shadow_account_snapshot(shadow_account_snapshot_id,shadow_account_id,as_of,cash,equity,
          reserved_collateral,buying_power,realized_pnl,unrealized_pnl,open_option_contracts,stock_shares,source_event_id,policy_version,content_hash,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$3) ON CONFLICT(content_hash) DO NOTHING`,
          [deterministicRuntimeUuid(`shadow-account-snapshot:${lifecycleId}`),row.shadow_account_id,observedAt,next?.cash??null,next?.equity??null,nextCollateral,
            next?.buyingPower??null,next?.realizedPnl??null,next?.unrealizedPnl??null,nextOpenContracts,row.stock_shares,lifecycleId,shadowAccountingPolicyVersion,shadowContentHash(snapshotPayload)]);
      }
      await client.query('COMMIT');
      return {state:assessment.state,filledQuantity:assessment.filledQuantity??0};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}
