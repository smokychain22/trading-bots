import { Pool } from 'pg';
import { z } from 'zod';
import type { OrderIntentState } from '../theta/order-intent-state.js';
import { assertValidOrderIntentTransition } from '../theta/order-intent-state.js';
import type { ExecutionAttemptRecord, PaperOrderStore, PersistedPaperOrderIntent } from './paper-order-coordinator.js';

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

export class PostgresPaperOrderStore implements PaperOrderStore {
  constructor(private readonly pool: Pool) {}

  async insertIntent(intent: PersistedPaperOrderIntent): Promise<void> {
    const instrumentType = intent.action === 'SELL_STOCK' ? 'STOCK' : 'OPTION';
    persistedPositionIntent(instrumentType, intent.request.side, intent.request.position_intent?.toUpperCase());
    await this.pool.query(
      `INSERT INTO trade.order_intent
        (order_intent_id, execution_account_id, decision_id, client_order_id, status,
         instrument_type, broker_symbol, side, quantity, limit_price, time_in_force,
         theta_action, position_intent, intent_persisted_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $14, $6, $7, $8, $9, $10, $11, $12, $13, $13, $13)`,
      [intent.orderIntentId, intent.executionAccountId, intent.decisionId, intent.request.client_order_id,
        intent.status, intent.request.symbol, intent.request.side, intent.request.qty,
        intent.request.limit_price, intent.request.time_in_force, intent.action,
        intent.request.position_intent?.toUpperCase() ?? null, intent.persistedAt, instrumentType],
    );
  }

  async getIntent(orderIntentId: string): Promise<PersistedPaperOrderIntent | null> {
    const result = await this.pool.query(
      `SELECT i.order_intent_id, i.execution_account_id, i.decision_id, i.client_order_id,
              i.status, i.broker_symbol, i.side, i.quantity, i.limit_price, i.time_in_force,
              i.theta_action, i.instrument_type, i.position_intent, i.intent_persisted_at, b.provider_order_id
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
    const positionIntent = persistedPositionIntent(String(row.instrument_type), row.side, row.position_intent);
    return {
      orderIntentId: String(row.order_intent_id),
      executionAccountId: String(row.execution_account_id),
      decisionId: String(row.decision_id),
      action: String(row.theta_action),
      status: String(row.status) as OrderIntentState,
      persistedAt: toIso(row.intent_persisted_at),
      brokerOrderId: row.provider_order_id === null ? null : String(row.provider_order_id),
      request: {
        symbol: String(row.broker_symbol), qty: Number(row.quantity), side: String(row.side) as 'buy' | 'sell',
        type: 'limit', time_in_force: 'day', limit_price: String(row.limit_price), client_order_id: String(row.client_order_id),
        ...(positionIntent === undefined ? {} : { position_intent: positionIntent }),
      },
    };
  }

  async transitionIntent(orderIntentId: string, from: OrderIntentState, to: OrderIntentState, providerOrderId: string | null = null): Promise<void> {
    assertValidOrderIntentTransition(from, to);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAttempt(attempt: ExecutionAttemptRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO trade.execution_attempt
        (order_intent_id, attempt_no, requested_at, request_payload_hash, response_status, timeout_flag, reconcile_before_retry)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [attempt.orderIntentId, attempt.attemptNo, attempt.requestedAt, attempt.requestPayloadHash,
        attempt.responseStatus, attempt.timeoutFlag, attempt.reconcileBeforeRetry],
    );
  }

  async updateAttempt(orderIntentId: string, attemptNo: number, result: Pick<ExecutionAttemptRecord, 'responseStatus' | 'timeoutFlag' | 'reconcileBeforeRetry'>): Promise<void> {
    const update = await this.pool.query(
      `UPDATE trade.execution_attempt
       SET response_at = now(), response_status = $3, timeout_flag = $4, reconcile_before_retry = $5
       WHERE order_intent_id = $1 AND attempt_no = $2`,
      [orderIntentId, attemptNo, result.responseStatus, result.timeoutFlag, result.reconcileBeforeRetry],
    );
    if (update.rowCount !== 1) throw new Error('Execution attempt not found.');
  }

  async unresolvedIntents(): Promise<readonly PersistedPaperOrderIntent[]> {
    const result = await this.pool.query(
      `SELECT order_intent_id FROM trade.order_intent
       WHERE status IN ('SUBMITTING','UNKNOWN_SUBMISSION','RECONCILING')
       ORDER BY updated_at ASC`,
    );
    const intents = await Promise.all(result.rows.map((row: { order_intent_id: string }) => this.getIntent(row.order_intent_id)));
    return intents.filter((intent): intent is PersistedPaperOrderIntent => intent !== null);
  }
}
