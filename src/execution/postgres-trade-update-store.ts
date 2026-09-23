import { Pool } from 'pg';
import { assertValidOrderIntentTransition, type OrderIntentState } from '../theta/order-intent-state.js';
import type { NormalizedTradeUpdate } from './trade-updates.js';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';

export interface PersistedTradeUpdateResult {
  readonly matched: boolean;
  readonly duplicate: boolean;
  readonly fillInserted: boolean;
}
export class PostgresTradeUpdateStore {
  constructor(private readonly pool: Pool) {}

  async apply(update: NormalizedTradeUpdate): Promise<PersistedTradeUpdateResult> {
    return withRuntimePostgresTransaction(this.pool,async(client)=>{
      const match = await client.query(
        `SELECT b.broker_order_id, b.order_intent_id, i.status
         FROM trade.broker_order b
         JOIN trade.order_intent i ON i.order_intent_id = b.order_intent_id
         WHERE b.provider_order_id = $1 OR i.client_order_id = $2
         ORDER BY (b.provider_order_id = $1) DESC, b.created_at DESC LIMIT 1
         FOR UPDATE OF b, i`,
        [update.providerOrderId, update.clientOrderId],
      );
      const row = match.rows[0] as { broker_order_id: string; order_intent_id: string; status: OrderIntentState } | undefined;
      if (row === undefined) {
        return { matched: false, duplicate: false, fillInserted: false };
      }
      const event = await client.query(
        `INSERT INTO trade.broker_order_event
          (broker_order_id, provider_event_id, event_type, event_time, quantity_delta, price_per_share, payload_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (broker_order_id, provider_event_id) DO NOTHING
         RETURNING broker_order_event_id`,
        [row.broker_order_id, update.eventId, update.event, update.eventTime, update.fillQuantity, update.fillPrice, update.payloadHash],
      );
      if (event.rowCount === 0) {
        return { matched: true, duplicate: true, fillInserted: false };
      }
      await client.query(
        `UPDATE trade.broker_order
         SET broker_status = $2, acknowledged_at = COALESCE(acknowledged_at, $3)
         WHERE broker_order_id = $1`,
        [row.broker_order_id, update.event, update.eventTime],
      );
      if (update.orderState !== null && update.orderState !== row.status) {
        assertValidOrderIntentTransition(row.status, update.orderState);
        await client.query('UPDATE trade.order_intent SET status = $2, updated_at = now() WHERE order_intent_id = $1', [row.order_intent_id, update.orderState]);
      }
      let fillInserted = false;
      if (update.providerFillId !== null && update.fillQuantity !== null && update.fillQuantity > 0 && update.fillPrice !== null) {
        const fill = await client.query(
          `INSERT INTO trade.fill(broker_order_id, provider_fill_id, quantity, price_per_share, filled_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (broker_order_id, provider_fill_id) DO NOTHING RETURNING fill_id`,
          [row.broker_order_id, update.providerFillId, update.fillQuantity, update.fillPrice, update.eventTime ?? new Date().toISOString()],
        );
        fillInserted = fill.rowCount === 1;
      }
      return { matched: true, duplicate: false, fillInserted };
    },{verifyCommitted:async(pool,outcome)=>{
      if(!outcome.matched)return true;
      const receipt=await withRuntimePostgresReadRetry(pool,(client)=>client.query(`SELECT boe.payload_hash,
        i.status, EXISTS(SELECT 1 FROM trade.fill f WHERE f.broker_order_id=b.broker_order_id
          AND f.provider_fill_id=$3) AS fill_exists
        FROM trade.broker_order b JOIN trade.order_intent i ON i.order_intent_id=b.order_intent_id
        LEFT JOIN trade.broker_order_event boe ON boe.broker_order_id=b.broker_order_id AND boe.provider_event_id=$2
        WHERE b.provider_order_id=$1 OR i.client_order_id=$4
        ORDER BY (b.provider_order_id=$1) DESC,b.created_at DESC LIMIT 1`,
      [update.providerOrderId,update.eventId,update.providerFillId,update.clientOrderId]));
      const row=receipt.value.rows[0] as Record<string,unknown>|undefined;
      if(row===undefined||row.payload_hash===null)return false;
      if(row.payload_hash!==update.payloadHash
        ||(update.orderState!==null&&row.status!==update.orderState)
        ||(update.providerFillId!==null&&update.fillQuantity!==null&&update.fillQuantity>0
          &&update.fillPrice!==null&&row.fill_exists!==true))
        throw new Error('TRADE_UPDATE_COMMIT_RECONCILIATION_CONFLICT');
      return true;
    }});
  }
}
