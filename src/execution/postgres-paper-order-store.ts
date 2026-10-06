import { Pool } from 'pg';
import { z } from 'zod';
import type { OrderIntentState } from '../theta/order-intent-state.js';
import { assertValidOrderIntentTransition } from '../theta/order-intent-state.js';
import type { BrokerOrderSnapshot } from './broker.js';
import type { DurableMultiLegOrderEvidence, ExecutionAttemptRecord, PaperOrderStore, PersistedPaperOrderIntent } from './paper-order-coordinator.js';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';

const toIso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);

export function persistedPositionIntent(instrumentType: string, side: unknown, raw: unknown) {
  const parsedSide = z.enum(['buy', 'sell']).parse(side);
  if (instrumentType === 'STOCK') {
    if (raw !== null && raw !== undefined) throw new Error('STOCK_POSITION_INTENT_NOT_ALLOWED');
    return undefined;
  }
  if (instrumentType !== 'OPTION') throw new Error('INSTRUMENT_TYPE_INVALID');
  const value = z.enum(['BUY_TO_OPEN', 'BUY_TO_CLOSE', 'SELL_TO_OPEN', 'SELL_TO_CLOSE']).parse(raw);
  if (!value.toLowerCase().startsWith(`${parsedSide}_`)) throw new Error('POSITION_INTENT_SIDE_MISMATCH');
  return value.toLowerCase() as NonNullable<PersistedPaperOrderIntent['request']['position_intent']>;
}

const multiLegEvidenceFromRows=(parent:Record<string,unknown>,rows:readonly Record<string,unknown>[]):DurableMultiLegOrderEvidence|undefined=>{
  if(parent.order_class!=='mleg')return undefined;
  const legs=rows.map(row=>({
    legIndex:Number(row.leg_index),optionContractId:String(row.option_contract_id),providerContractId:String(row.provider_contract_id),
    occSymbol:String(row.occ_symbol),optionType:z.enum(['PUT','CALL']).parse(row.option_type),
    positionIntent:z.enum(['buy_to_open','buy_to_close','sell_to_open','sell_to_close']).parse(row.position_intent),
    ratioQuantity:Number(row.ratio_quantity),expiration:String(row.expiration),strike:Number(row.strike),
    multiplier:Number(row.multiplier),deliverableIdentity:String(row.deliverable_identity),
  }));
  return {orderClass:'mleg',creditDebitDirection:z.enum(['CREDIT','DEBIT']).parse(parent.credit_debit_direction),
    packageIdentity:String(parent.package_identity),legs};
};

export class PostgresPaperOrderStore implements PaperOrderStore {
  constructor(private readonly pool: Pool, private readonly executionAccountId?: string) {}

  async insertIntent(intent: PersistedPaperOrderIntent): Promise<void> {
    const instrumentType = intent.action === 'SELL_STOCK' ? 'STOCK' : 'OPTION';
    const multiLeg=intent.request.order_class==='mleg';
    if(intent.request.qty!==intent.authorizationEvidence.paperEvidenceQuantity||
      intent.authorizationEvidence.paperEvidenceQuantity>intent.authorizationEvidence.canonicalQuantity)
      throw new Error('PAPER_EVIDENCE_QUANTITY_INVALID');
    const positionIntent=multiLeg?undefined:persistedPositionIntent(instrumentType,intent.request.side,intent.request.position_intent?.toUpperCase());
    const evidence=intent.executionEvidence;
    if (!/^[0-9a-f]{64}$/.test(evidence.quoteContentHash)
      || !Number.isFinite(Date.parse(evidence.quoteAsOf)) || !Number.isFinite(Date.parse(evidence.decisionExpiresAt))
      || Date.parse(evidence.decisionExpiresAt)<=Date.parse(evidence.quoteAsOf)) throw new Error('ORDER_EXECUTION_EVIDENCE_INVALID');
    if (instrumentType==='OPTION' && !multiLeg && intent.optionContractId===null) {
      throw new Error('OPTION_ORDER_REQUIRES_QUALIFIED_CONTRACT_EVIDENCE');
    }
    if (instrumentType==='STOCK' && (intent.optionContractId!==null || evidence.quoteSource!=='ALPACA'
      || evidence.quoteFeed===null || !['SIP','IEX'].includes(evidence.quoteFeed))) {
      throw new Error('STOCK_ORDER_EXECUTION_EVIDENCE_INVALID');
    }
    if(multiLeg&&intent.multiLegEvidence===undefined)throw new Error('MULTI_LEG_DURABLE_EVIDENCE_REQUIRED');
    await withRuntimePostgresTransaction(this.pool,async(client)=>{
      await client.query(
      `INSERT INTO trade.order_intent
        (order_intent_id, execution_account_id, decision_id, client_order_id, status,
         instrument_type, broker_symbol, side, quantity, limit_price, time_in_force,
         theta_action, position_intent, intent_persisted_at, created_at, updated_at,
         chain_id, option_contract_id, underlying_id, quote_as_of, decision_expires_at, aegis_state,
         quote_source, quote_feed, quote_semantics, quote_content_hash, execution_tier, canonical_quantity,
         paper_evidence_quantity, empirical_economics_ready, expected_after_cost_ev,
         order_class,package_identity,credit_debit_direction)
       VALUES ($1,$2,$3,$4,$5,$14,$6,$7,$8,$9,$10,$11,$12,$13,$13,$13,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)`,
      [intent.orderIntentId, intent.executionAccountId, intent.decisionId, intent.request.client_order_id,
        intent.status, intent.request.symbol, intent.request.side, intent.request.qty,
        intent.request.limit_price, intent.request.time_in_force, intent.action,
        positionIntent?.toUpperCase() ?? null, intent.persistedAt, instrumentType,
        intent.chainId,intent.optionContractId,intent.underlyingId,evidence.quoteAsOf,evidence.decisionExpiresAt,
        evidence.aegisState,evidence.quoteSource,evidence.quoteFeed,evidence.quoteSemantics,evidence.quoteContentHash,
        intent.authorizationEvidence.executionTier,intent.authorizationEvidence.canonicalQuantity,
        intent.authorizationEvidence.paperEvidenceQuantity,intent.authorizationEvidence.empiricalEconomicsReady,
        intent.authorizationEvidence.expectedAfterCostEv,multiLeg?'mleg':'simple',
        intent.multiLegEvidence?.packageIdentity??null,intent.multiLegEvidence?.creditDebitDirection??null]);
      if(intent.multiLegEvidence!==undefined){
        for(const leg of intent.multiLegEvidence.legs)await client.query(
          `INSERT INTO trade.order_intent_leg(order_intent_id,leg_index,option_contract_id,provider_contract_id,
             occ_symbol,option_type,position_intent,ratio_quantity,expiration,strike,multiplier,deliverable_identity)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [intent.orderIntentId,leg.legIndex,leg.optionContractId,leg.providerContractId,leg.occSymbol,leg.optionType,
            leg.positionIntent,leg.ratioQuantity,leg.expiration,leg.strike,leg.multiplier,leg.deliverableIdentity]);
      }
    },{verifyCommitted:async(pool)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT client_order_id,status,
        decision_id::text,quantity::numeric,quote_content_hash,
        (SELECT count(*)::integer FROM trade.order_intent_leg l WHERE l.order_intent_id=trade.order_intent.order_intent_id) leg_count
        FROM trade.order_intent WHERE order_intent_id=$1`,
      [intent.orderIntentId]));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.client_order_id!==intent.request.client_order_id||row.status!==intent.status
        ||String(row.decision_id)!==intent.decisionId||Number(row.quantity)!==intent.request.qty
        ||row.quote_content_hash!==intent.executionEvidence.quoteContentHash
        ||Number(row.leg_count)!==(intent.multiLegEvidence?.legs.length??0))
        throw new Error('ORDER_INTENT_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
  }

  async getIntent(orderIntentId: string): Promise<PersistedPaperOrderIntent | null> {
    const result = await this.pool.query(
      `SELECT i.order_intent_id, i.execution_account_id, i.decision_id, i.client_order_id,
              i.status, i.broker_symbol, i.side, i.quantity, i.limit_price, i.time_in_force,
              i.theta_action, i.instrument_type, i.position_intent, i.intent_persisted_at,
              i.chain_id,i.option_contract_id,i.underlying_id,i.quote_as_of,i.decision_expires_at,i.aegis_state,
              i.quote_source,i.quote_feed,i.quote_semantics,i.quote_content_hash,i.execution_tier,i.canonical_quantity,
              i.paper_evidence_quantity,i.empirical_economics_ready,i.expected_after_cost_ev,b.provider_order_id,
              i.order_class,i.package_identity,i.credit_debit_direction
       FROM trade.order_intent i
       LEFT JOIN LATERAL (
         SELECT provider_order_id FROM trade.broker_order
         WHERE order_intent_id = i.order_intent_id ORDER BY created_at DESC LIMIT 1
       ) b ON true
       WHERE i.order_intent_id = $1`,
      [orderIntentId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    if (row.chain_id === null || row.chain_id === undefined
      || row.underlying_id === null || row.underlying_id === undefined
      || row.quote_source === null || row.quote_source === undefined
      || row.quote_semantics === null || row.quote_semantics === undefined
      || row.quote_as_of === null || row.quote_as_of === undefined
      || row.decision_expires_at === null || row.decision_expires_at === undefined
      || row.quote_content_hash === null || row.quote_content_hash === undefined
      || row.aegis_state === null || row.aegis_state === undefined) {
      throw new Error('ORDER_INTENT_EXECUTION_LINEAGE_MISSING');
    }
    const legResult=await this.pool.query(`SELECT leg_index,option_contract_id::text,provider_contract_id,occ_symbol,
      option_type,position_intent,ratio_quantity,to_char(expiration,'YYYY-MM-DD') AS expiration,strike,multiplier,deliverable_identity
      FROM trade.order_intent_leg WHERE order_intent_id=$1 ORDER BY leg_index`,[orderIntentId]);
    const multiLegEvidence=multiLegEvidenceFromRows(row,legResult.rows as Record<string,unknown>[]);
    const positionIntent = row.order_class==='mleg'?undefined:persistedPositionIntent(String(row.instrument_type), row.side, row.position_intent);
    return {
      orderIntentId: String(row.order_intent_id),
      executionAccountId: String(row.execution_account_id),
      decisionId: String(row.decision_id),
      action: String(row.theta_action),
      status: String(row.status) as OrderIntentState,
      persistedAt: toIso(row.intent_persisted_at),
      brokerOrderId: row.provider_order_id === null ? null : String(row.provider_order_id),
      chainId:String(row.chain_id),optionContractId:row.option_contract_id===null?null:String(row.option_contract_id),
      underlyingId:String(row.underlying_id),authorizationEvidence:{
        executionTier:z.enum(['PAPER_EVIDENCE','EMPIRICALLY_PROMOTED_PAPER']).parse(row.execution_tier),
        canonicalQuantity:Number(row.canonical_quantity),paperEvidenceQuantity:Number(row.paper_evidence_quantity),
        empiricalEconomicsReady:z.boolean().parse(row.empirical_economics_ready),
        expectedAfterCostEv:row.expected_after_cost_ev===null?null:Number(row.expected_after_cost_ev)},
      executionEvidence:{quoteSource:z.string().min(1).parse(row.quote_source),
        quoteFeed:row.quote_feed===null?null:String(row.quote_feed),
        quoteSemantics:z.enum(['CONSOLIDATED_NBBO','TRUSTED_TWO_SIDED_ORDER_PRICING','PAPER_INDICATIVE_REFERENCE']).parse(row.quote_semantics),quoteAsOf:toIso(row.quote_as_of),
        decisionExpiresAt:toIso(row.decision_expires_at),quoteContentHash:String(row.quote_content_hash),
        aegisState:z.enum(['ALLOW_FULL','ALLOW_REDUCED','HOLD_ONLY','HARD_VETO']).parse(row.aegis_state)},
      request: {
        symbol: String(row.broker_symbol), qty: Number(row.quantity), side: String(row.side) as 'buy' | 'sell',
        type: 'limit', time_in_force: 'day', limit_price: String(row.limit_price), client_order_id: String(row.client_order_id),
        ...(positionIntent === undefined ? {} : { position_intent: positionIntent }),
        ...(multiLegEvidence===undefined?{}:{order_class:'mleg' as const,legs:multiLegEvidence.legs.map(leg=>({symbol:leg.occSymbol,
          side:leg.positionIntent.startsWith('buy_')?'buy' as const:'sell' as const,ratio_qty:leg.ratioQuantity,
          position_intent:leg.positionIntent}))}),
      },
      ...(multiLegEvidence===undefined?{}:{multiLegEvidence}),
    };
  }

  async transitionIntent(orderIntentId: string, from: OrderIntentState, to: OrderIntentState, providerOrderId: string | null = null): Promise<void> {
    assertValidOrderIntentTransition(from, to);
    await withRuntimePostgresTransaction(this.pool,async(client)=>{
      const update = await client.query(
        `UPDATE trade.order_intent SET status = $3, updated_at = now()
         WHERE order_intent_id = $1 AND status = $2 RETURNING order_intent_id`,
        [orderIntentId, from, to],
      );
      if (update.rowCount !== 1) throw new Error('Stale or missing order intent transition.');
      if (providerOrderId !== null) {
        await client.query(
          `INSERT INTO trade.broker_order(order_intent_id, provider_order_id, submitted_at, acknowledged_at, broker_status)
           VALUES ($1, $2, now(), CASE WHEN $3 = 'ACKNOWLEDGED' THEN now() ELSE NULL END, $3)
           ON CONFLICT (order_intent_id, provider_order_id)
           DO UPDATE SET broker_status = EXCLUDED.broker_status`,
          [orderIntentId, providerOrderId, to],
        );
      }
    },{verifyCommitted:async(pool)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT i.status,
        EXISTS(SELECT 1 FROM trade.broker_order b WHERE b.order_intent_id=i.order_intent_id
          AND b.provider_order_id=$2 AND b.broker_status=$3) AS broker_state_matches
        FROM trade.order_intent i WHERE i.order_intent_id=$1`,[orderIntentId,providerOrderId,to]));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.status===to&&(providerOrderId===null||row.broker_state_matches===true))return true;
      if(row.status===from)return false;
      throw new Error('ORDER_INTENT_TRANSITION_COMMIT_RECONCILIATION_CONFLICT');
    }});
  }

  async recordAttempt(attempt: ExecutionAttemptRecord): Promise<void> {
    await withRuntimePostgresTransaction(this.pool,(client)=>client.query(
      `INSERT INTO trade.execution_attempt
        (order_intent_id, attempt_no, requested_at, request_payload_hash, response_status, timeout_flag, reconcile_before_retry)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [attempt.orderIntentId, attempt.attemptNo, attempt.requestedAt, attempt.requestPayloadHash,
        attempt.responseStatus, attempt.timeoutFlag, attempt.reconcileBeforeRetry],
    ).then(()=>undefined),{verifyCommitted:async(pool)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT request_payload_hash,
        response_status,timeout_flag,reconcile_before_retry FROM trade.execution_attempt
        WHERE order_intent_id=$1 AND attempt_no=$2`,[attempt.orderIntentId,attempt.attemptNo]));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.request_payload_hash!==attempt.requestPayloadHash||row.response_status!==attempt.responseStatus
        ||row.timeout_flag!==attempt.timeoutFlag||row.reconcile_before_retry!==attempt.reconcileBeforeRetry)
        throw new Error('EXECUTION_ATTEMPT_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
  }

  async updateAttempt(orderIntentId: string, attemptNo: number, result: Pick<ExecutionAttemptRecord, 'responseStatus' | 'timeoutFlag' | 'reconcileBeforeRetry'>): Promise<void> {
    const update = await withRuntimePostgresTransaction(this.pool,(client)=>client.query(
      `UPDATE trade.execution_attempt
       SET response_at = now(), response_status = $3, timeout_flag = $4, reconcile_before_retry = $5
       WHERE order_intent_id = $1 AND attempt_no = $2`,
      [orderIntentId, attemptNo, result.responseStatus, result.timeoutFlag, result.reconcileBeforeRetry],
    ),{verifyCommitted:async(pool)=>{
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT response_status,timeout_flag,
        reconcile_before_retry FROM trade.execution_attempt WHERE order_intent_id=$1 AND attempt_no=$2`,
      [orderIntentId,attemptNo]));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined)return false;
      if(row.response_status!==result.responseStatus||row.timeout_flag!==result.timeoutFlag
        ||row.reconcile_before_retry!==result.reconcileBeforeRetry)
        throw new Error('EXECUTION_ATTEMPT_UPDATE_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
    if (update.rowCount !== 1) throw new Error('Execution attempt not found.');
  }

  async unresolvedIntents(): Promise<readonly PersistedPaperOrderIntent[]> {
    const result = await this.pool.query(
      `SELECT order_intent_id FROM trade.order_intent
       WHERE status IN ('SUBMITTING','UNKNOWN_SUBMISSION','RECONCILING')
         AND ($1::uuid IS NULL OR execution_account_id=$1)
       ORDER BY updated_at ASC`,
      [this.executionAccountId ?? null],
    );
    const intents = await Promise.all(result.rows.map((row: { order_intent_id: string }) => this.getIntent(row.order_intent_id)));
    return intents.filter((intent): intent is PersistedPaperOrderIntent => intent !== null);
  }

  async activeIntents(): Promise<readonly PersistedPaperOrderIntent[]> {
    const result = await this.pool.query(
      `SELECT order_intent_id FROM trade.order_intent
       WHERE status IN ('SUBMITTED','ACKNOWLEDGED','PARTIAL','CANCEL_REQUESTED')
         AND ($1::uuid IS NULL OR execution_account_id=$1)
       ORDER BY updated_at ASC,order_intent_id ASC`,
      [this.executionAccountId ?? null],
    );
    const intents = await Promise.all(result.rows.map((row: { order_intent_id: string }) => this.getIntent(row.order_intent_id)));
    return intents.filter((intent): intent is PersistedPaperOrderIntent => intent !== null);
  }

  async recordBrokerSnapshot(orderIntentId:string,snapshot:BrokerOrderSnapshot):Promise<void>{
    await withRuntimePostgresTransaction(this.pool,async(client)=>{
      // the parent row's broker_status is owned by transitionIntent (intent-state vocabulary, same as every other order); raw per-leg broker status lives in broker_order_leg_state
      await client.query(`INSERT INTO trade.broker_order(order_intent_id,provider_order_id,submitted_at,broker_status)
        VALUES($1,$2,$3,$4) ON CONFLICT(order_intent_id,provider_order_id) DO NOTHING`,
      [orderIntentId,snapshot.id,snapshot.submittedAt,snapshot.status]);
      if(snapshot.orderClass==='mleg'){
        if(snapshot.legs===undefined)throw new Error('BROKER_MULTI_LEG_STATE_MISSING');
        for(const [index,leg] of snapshot.legs.entries())await client.query(
          `INSERT INTO trade.broker_order_leg_state(order_intent_id,leg_index,provider_parent_order_id,provider_leg_order_id,
             occ_symbol,requested_quantity,filled_quantity,remaining_quantity,average_fill_price,broker_status,observed_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
           ON CONFLICT(order_intent_id,leg_index) DO UPDATE SET
             provider_parent_order_id=EXCLUDED.provider_parent_order_id,provider_leg_order_id=EXCLUDED.provider_leg_order_id,
             occ_symbol=EXCLUDED.occ_symbol,requested_quantity=EXCLUDED.requested_quantity,
             filled_quantity=EXCLUDED.filled_quantity,remaining_quantity=EXCLUDED.remaining_quantity,
             average_fill_price=EXCLUDED.average_fill_price,broker_status=EXCLUDED.broker_status,observed_at=EXCLUDED.observed_at`,
          [orderIntentId,index+1,snapshot.id,leg.id,leg.symbol,leg.qty,leg.filledQty,leg.qty-leg.filledQty,
            leg.filledAvgPrice,leg.status]);
      }
    },{verifyCommitted:async(pool)=>{
      const expected=snapshot.orderClass==='mleg'?(snapshot.legs?.length??0):0;
      const read=await withRuntimePostgresReadRetry(pool,client=>client.query(`SELECT
        EXISTS(SELECT 1 FROM trade.broker_order WHERE order_intent_id=$1 AND provider_order_id=$2) parent,
        (SELECT count(*)::integer FROM trade.broker_order_leg_state WHERE order_intent_id=$1) leg_count`,
      [orderIntentId,snapshot.id]));
      const row=read.value.rows[0] as Record<string,unknown>|undefined;
      return row?.parent===true&&Number(row.leg_count)===expected;
    }});
  }
}
