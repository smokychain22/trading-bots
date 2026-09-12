import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { BrokerActivity, BrokerCalendarSession, BrokerMarketClock, BrokerOrderSnapshot } from './broker.js';
import type { ReadOnlyPaperBroker } from './read-only-paper-broker.js';
import { isValidOrderIntentTransition, type OrderIntentState } from '../theta/order-intent-state.js';
import { brokerOrderIntentState } from './broker-order-state.js';

const accountSchema = z.object({ id: z.string().min(1), status: z.string().nullable().optional() }).passthrough();
const positionSchema = z.object({
  symbol: z.string().min(1), qty: z.union([z.string(), z.number()]).nullable().optional(),
  side: z.string().nullable().optional(), asset_class: z.string().nullable().optional(),
  avg_entry_price: z.union([z.string(), z.number()]).nullable().optional(),
  current_price: z.union([z.string(), z.number()]).nullable().optional(),
  market_value: z.union([z.string(), z.number()]).nullable().optional(),
  cost_basis: z.union([z.string(), z.number()]).nullable().optional(),
  unrealized_pl: z.union([z.string(), z.number()]).nullable().optional(),
}).passthrough();

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  }
  return item;
});

export type BrokerFactType = 'ORDER' | 'ACTIVITY' | 'POSITION';
export interface UnmatchedBrokerFact {
  readonly factType: BrokerFactType;
  readonly providerFactRefHash: string;
  readonly symbol: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface BrokerPositionEvidence {
  readonly symbol: string;
  readonly quantity: number | null;
  readonly side: string | null;
  readonly assetClass: string | null;
  readonly averageEntryPrice: number | null;
  readonly currentPrice: number | null;
  readonly marketValue: number | null;
  readonly costBasis: number | null;
  readonly unrealizedPnl: number | null;
}

export interface ReconciledBrokerOrder {
  readonly orderIntentId: string;
  readonly providerOrderId: string;
  readonly providerOrderIdHash: string;
  readonly brokerStatus: string;
  readonly brokerIntentState: OrderIntentState | null;
}

export { brokerOrderIntentState } from './broker-order-state.js';

export interface BrokerReconciliationSnapshotInput {
  readonly snapshotId: string;
  readonly connectionId: string;
  readonly correlationId: string;
  readonly providerAccountRefHash: string;
  readonly accountStatus: string | null;
  readonly marketClock: BrokerMarketClock | null;
  readonly calendarSessions: readonly BrokerCalendarSession[] | null;
  readonly positionCount: number;
  readonly openOrderCount: number;
  readonly activityCount: number;
  readonly positions: readonly BrokerPositionEvidence[];
  readonly activities: readonly BrokerActivity[];
  readonly matchedOrders: readonly ReconciledBrokerOrder[];
  readonly missingLocalIntentIds: readonly string[];
  readonly unmatchedFacts: readonly UnmatchedBrokerFact[];
  readonly observedAt: string;
  readonly payloadHash: string;
}

export interface BrokerReconciliationStore {
  matchOrders(providerAccountRefHash: string, orders: readonly BrokerOrderSnapshot[]): Promise<{
    readonly matched: readonly ReconciledBrokerOrder[];
    readonly unmatched: readonly BrokerOrderSnapshot[];
    readonly missingLocalIntentIds: readonly string[];
  }>;
  persist(input: BrokerReconciliationSnapshotInput): Promise<void>;
}

export interface BrokerReconciliationResult {
  readonly snapshotId: string;
  readonly correlationId: string;
  readonly accountStatus: string | null;
  readonly positionCount: number;
  readonly openOrderCount: number;
  readonly activityCount: number;
  readonly matchedOrderCount: number;
  readonly externalOrUnknownCount: number;
  readonly localOnlyIntentCount: number;
  readonly marketOpen: boolean | null;
  readonly calendarSessionConfirmed: boolean;
  readonly dataQuality: 'GOOD' | 'UNKNOWN';
  readonly observedAt: string;
}

function safePosition(raw: unknown): BrokerPositionEvidence {
  const parsed = positionSchema.parse(raw);
  const numberOrNull = (value: string | number | null | undefined): number | null => {
    if (value == null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  return {
    symbol: parsed.symbol,
    quantity: numberOrNull(parsed.qty),
    side: parsed.side ?? null,
    assetClass: parsed.asset_class ?? null,
    averageEntryPrice: numberOrNull(parsed.avg_entry_price),
    currentPrice: numberOrNull(parsed.current_price),
    marketValue: numberOrNull(parsed.market_value),
    costBasis: numberOrNull(parsed.cost_basis),
    unrealizedPnl: numberOrNull(parsed.unrealized_pl),
  };
}

function orderFact(order: BrokerOrderSnapshot): UnmatchedBrokerFact {
  return {
    factType: 'ORDER', providerFactRefHash: sha256(order.id), symbol: order.symbol,
    detail: { status: order.status, side: order.side, quantity: order.qty, filledQuantity: order.filledQty },
  };
}

function activityFact(activity: BrokerActivity): UnmatchedBrokerFact {
  return {
    factType: 'ACTIVITY', providerFactRefHash: sha256(activity.id), symbol: activity.symbol,
    detail: { activityType: activity.activityType, quantity: activity.quantity, date: activity.date },
  };
}

function marketDateAt(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

/**
 * Executes a complete read-only broker reconciliation. It never calls a
 * mutation method and fails closed if the encrypted credential resolves to a
 * different broker identity than the designated master connection.
 */
export async function runReadOnlyBrokerReconciliation(input: {
  readonly broker: ReadOnlyPaperBroker;
  readonly store: BrokerReconciliationStore;
  readonly connectionId: string;
  readonly expectedProviderAccountRef: string;
  readonly correlationId: string;
  readonly now: () => string;
}): Promise<BrokerReconciliationResult> {
  if (input.broker.environment !== 'PAPER' || input.broker.accountKind !== 'MASTER_API_KEY') {
    throw new Error('MASTER_PAPER_BROKER_REQUIRED');
  }
  const observedAt = input.now();
  const account = accountSchema.parse(await input.broker.getAccount());
  if (account.id !== input.expectedProviderAccountRef) throw new Error('MASTER_BROKER_IDENTITY_MISMATCH');

  const marketDate = marketDateAt(observedAt);
  const [rawPositions, allOrders, activities, marketClock, calendarSessions] = await Promise.all([
    input.broker.getPositions(), input.broker.getOrders('all'), input.broker.getActivities(),
    input.broker.getClock?.() ?? Promise.resolve(null),
    input.broker.getCalendar?.(marketDate, marketDate) ?? Promise.resolve(null),
  ]);
  const positions = rawPositions.map(safePosition).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const orders = [...allOrders].sort((a, b) => a.id.localeCompare(b.id));
  const sortedActivities = [...activities].sort((a, b) => a.id.localeCompare(b.id));
  const providerAccountRefHash = sha256(account.id);
  const matches = await input.store.matchOrders(providerAccountRefHash, orders);
  const knownOrderIds = new Set(matches.matched.map((order) => order.providerOrderId));

  const unmatchedFacts: UnmatchedBrokerFact[] = [
    ...matches.unmatched.map(orderFact),
    ...positions.map((position) => ({
      factType: 'POSITION' as const,
      providerFactRefHash: sha256(`${position.symbol}:${position.side ?? ''}:${position.quantity ?? 'UNKNOWN'}`),
      symbol: position.symbol,
      detail: {
        quantity: position.quantity, side: position.side, assetClass: position.assetClass,
        averageEntryPrice: position.averageEntryPrice, currentPrice: position.currentPrice,
        marketValue: position.marketValue, costBasis: position.costBasis,
        unrealizedPnl: position.unrealizedPnl,
      },
    })),
    ...sortedActivities.filter((activity) => activity.orderId === null || !knownOrderIds.has(activity.orderId)).map(activityFact),
  ];
  const payloadHash = sha256(canonicalJson({
    account: { status: account.status ?? null }, positions, orders: orders.map((order) => ({
      idHash: sha256(order.id), clientOrderIdHash: sha256(order.clientOrderId), status: order.status,
      symbol: order.symbol, quantity: order.qty, filledQuantity: order.filledQty,
    })), activities: sortedActivities.map((activity) => ({ idHash: sha256(activity.id), type: activity.activityType })),
    marketClock, calendarSessions,
  }));
  const snapshotId = randomUUID();
  await input.store.persist({
    snapshotId, connectionId: input.connectionId, correlationId: input.correlationId,
    providerAccountRefHash, accountStatus: account.status ?? null,
    marketClock, calendarSessions,
    positionCount: positions.length, openOrderCount: orders.filter((order) => !['filled', 'canceled', 'expired', 'rejected'].includes(order.status)).length,
    activityCount: sortedActivities.length, positions, activities: sortedActivities, matchedOrders: matches.matched,
    missingLocalIntentIds: matches.missingLocalIntentIds, unmatchedFacts, observedAt, payloadHash,
  });
  const calendarSessionConfirmed = calendarSessions?.some((session) =>
    session.date === marketDate && session.open !== null && session.close !== null) ?? false;
  const dataQuality = account.status != null && marketClock?.timestamp != null
    && marketClock.isOpen != null && calendarSessions !== null ? 'GOOD' : 'UNKNOWN';
  return {
    snapshotId, correlationId: input.correlationId, accountStatus: account.status ?? null,
    positionCount: positions.length,
    openOrderCount: orders.filter((order) => !['filled', 'canceled', 'expired', 'rejected'].includes(order.status)).length,
    activityCount: sortedActivities.length, matchedOrderCount: matches.matched.length,
    externalOrUnknownCount: unmatchedFacts.length, localOnlyIntentCount: matches.missingLocalIntentIds.length,
    marketOpen: marketClock?.isOpen ?? null, calendarSessionConfirmed, dataQuality, observedAt,
  };
}

export class PostgresBrokerReconciliationStore implements BrokerReconciliationStore {
  constructor(private readonly pool: Pool) {}

  async matchOrders(providerAccountRefHash: string, orders: readonly BrokerOrderSnapshot[]) {
    const execution = await this.pool.query(
      `SELECT execution_account_id FROM trade.execution_account
       WHERE provider_account_ref_hash=$1 AND environment='PAPER'`, [providerAccountRefHash],
    );
    const executionAccountId = execution.rows[0]?.execution_account_id as string | undefined;
    if (executionAccountId === undefined) return { matched: [], unmatched: [...orders], missingLocalIntentIds: [] };
    const local = await this.pool.query(
      `SELECT i.order_intent_id,i.client_order_id,i.status,b.provider_order_id
       FROM trade.order_intent i LEFT JOIN trade.broker_order b ON b.order_intent_id=i.order_intent_id
       WHERE i.execution_account_id=$1`, [executionAccountId],
    );
    const byProvider = new Map<string, string>();
    const byClient = new Map<string, string>();
    for (const row of local.rows) {
      byClient.set(String(row.client_order_id), String(row.order_intent_id));
      if (row.provider_order_id != null) byProvider.set(String(row.provider_order_id), String(row.order_intent_id));
    }
    const matched: ReconciledBrokerOrder[] = [];
    const unmatched: BrokerOrderSnapshot[] = [];
    for (const order of orders) {
      const orderIntentId = byProvider.get(order.id) ?? byClient.get(order.clientOrderId);
      if (orderIntentId === undefined) unmatched.push(order);
      else matched.push({
        orderIntentId, providerOrderId: order.id, providerOrderIdHash: sha256(order.id),
        brokerStatus: order.status, brokerIntentState: brokerOrderIntentState(order),
      });
    }
    const brokerClientIds = new Set(orders.map((order) => order.clientOrderId));
    const missingLocalIntentIds = local.rows
      .filter((row) => ['SUBMITTING','UNKNOWN_SUBMISSION','RECONCILING'].includes(String(row.status)))
      .filter((row) => !brokerClientIds.has(String(row.client_order_id)))
      .map((row) => String(row.order_intent_id));
    return { matched, unmatched, missingLocalIntentIds };
  }

  async persist(input: BrokerReconciliationSnapshotInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO trade.broker_reconciliation_snapshot(
          reconciliation_snapshot_id,connection_id,correlation_id,environment,broker_host,account_status,
          position_count,open_order_count,activity_count,matched_order_count,external_or_unknown_count,
          observed_at,provider_timestamp,data_quality,payload_hash,detail_json)
         VALUES($1,$2,$3,'PAPER','paper-api.alpaca.markets',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
        [input.snapshotId, input.connectionId, input.correlationId, input.accountStatus,
          input.positionCount, input.openOrderCount, input.activityCount, input.matchedOrders.length,
          input.unmatchedFacts.length, input.observedAt, input.marketClock?.timestamp ?? null,
          input.accountStatus != null && input.marketClock?.timestamp != null
            && input.marketClock.isOpen != null && input.calendarSessions !== null ? 'GOOD' : 'UNKNOWN',
          input.payloadHash,
          JSON.stringify({
            localOnlyIntentCount: input.missingLocalIntentIds.length,
            marketOpen: input.marketClock?.isOpen ?? null,
            nextOpen: input.marketClock?.nextOpen ?? null,
            nextClose: input.marketClock?.nextClose ?? null,
            calendarSessionConfirmed: input.calendarSessions?.some((session) =>
              session.open !== null && session.close !== null) ?? false,
          })],
      );
      for (const fact of input.unmatchedFacts) {
        await client.query(
          `INSERT INTO trade.unmatched_broker_fact(
            connection_id,reconciliation_snapshot_id,fact_type,provider_fact_ref_hash,symbol,
            classification,observed_at,detail_json)
           VALUES($1,$2,$3,$4,$5,'EXTERNAL_OR_UNKNOWN',$6,$7::jsonb)
           ON CONFLICT(connection_id,fact_type,provider_fact_ref_hash) DO NOTHING`,
          [input.connectionId, input.snapshotId, fact.factType, fact.providerFactRefHash,
            fact.symbol, input.observedAt, JSON.stringify(fact.detail)],
        );
      }
      for (const position of input.positions) {
        await client.query(
          `INSERT INTO trade.broker_position_snapshot(
             reconciliation_snapshot_id,connection_id,symbol,quantity,side,asset_class,observed_at,payload_hash,
             average_entry_price,current_price,market_value,cost_basis,unrealized_pnl)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [input.snapshotId, input.connectionId, position.symbol, position.quantity, position.side,
            position.assetClass, input.observedAt, sha256(canonicalJson(position)), position.averageEntryPrice,
            position.currentPrice, position.marketValue, position.costBasis, position.unrealizedPnl],
        );
      }
      for (const activity of input.activities) {
        await client.query(
          `INSERT INTO trade.broker_activity_fact(
             connection_id,provider_activity_ref_hash,activity_type,symbol,quantity,price,
             activity_at,provider_order_ref_hash,first_observed_at,last_observed_at,payload_hash)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)
           ON CONFLICT(connection_id,provider_activity_ref_hash) DO UPDATE SET
             last_observed_at=EXCLUDED.last_observed_at`,
          [input.connectionId, sha256(activity.id), activity.activityType, activity.symbol,
            activity.quantity, activity.price, activity.date, activity.orderId === null ? null : sha256(activity.orderId),
            input.observedAt, sha256(canonicalJson({
              type: activity.activityType, symbol: activity.symbol, quantity: activity.quantity,
              price: activity.price, date: activity.date,
            }))],
        );
      }
      for (const order of input.matchedOrders) await this.recordMatchedOrder(client, input, order);
      for (const activity of input.activities) await this.recordBrokerFill(client,input,activity);
      for (const orderIntentId of input.missingLocalIntentIds) {
        await client.query(
          `INSERT INTO trade.reconciliation_event(order_intent_id,state,detected_at,detail_json)
           SELECT $1,'LOCAL_ONLY_INTENT',$2,$3::jsonb
           WHERE NOT EXISTS (SELECT 1 FROM trade.reconciliation_event
             WHERE order_intent_id=$1 AND state='LOCAL_ONLY_INTENT' AND resolved_at IS NULL)`,
          [orderIntentId, input.observedAt, JSON.stringify({ reconciliationSnapshotId: input.snapshotId })],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async recordBrokerFill(client:PoolClient,input:BrokerReconciliationSnapshotInput,activity:BrokerActivity):Promise<void> {
    if (activity.activityType!=='FILL' || activity.orderId===null || activity.quantity===null || activity.quantity<=0
      || activity.price===null || !Number.isFinite(activity.price) || activity.date===null) return;
    const brokerOrder=await client.query(`SELECT bo.broker_order_id FROM trade.broker_order bo
      JOIN trade.order_intent oi ON oi.order_intent_id=bo.order_intent_id
      JOIN trade.execution_account ea ON ea.execution_account_id=oi.execution_account_id
      WHERE bo.provider_order_id=$1 AND ea.provider_account_ref_hash=$2`,[activity.orderId,input.providerAccountRefHash]);
    if (brokerOrder.rowCount!==1) return;
    const brokerOrderId=String(brokerOrder.rows[0].broker_order_id);
    await client.query(`INSERT INTO trade.broker_order_event(broker_order_id,provider_event_id,event_type,event_time,
      quantity_delta,price_per_share,payload_hash) VALUES($1,$2,'FILL',$3,$4,$5,$6)
      ON CONFLICT(broker_order_id,provider_event_id) DO NOTHING`,[brokerOrderId,activity.id,activity.date,
      activity.quantity,activity.price,sha256(canonicalJson(activity))]);
    await client.query(`INSERT INTO trade.fill(fill_id,broker_order_id,provider_fill_id,quantity,price_per_share,filled_at,fees)
      VALUES($1,$2,$3,$4,$5,$6,NULL) ON CONFLICT(broker_order_id,provider_fill_id) DO NOTHING`,[
      deterministicFillUuid(`${brokerOrderId}:${activity.id}`),brokerOrderId,activity.id,activity.quantity,activity.price,activity.date]);
  }

  private async recordMatchedOrder(client: PoolClient, input: BrokerReconciliationSnapshotInput, order: ReconciledBrokerOrder) {
    await client.query(
      `INSERT INTO trade.broker_order(order_intent_id,provider_order_id,submitted_at,broker_status)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(order_intent_id,provider_order_id) DO UPDATE SET broker_status=EXCLUDED.broker_status`,
      [order.orderIntentId, order.providerOrderId, input.observedAt, order.brokerStatus],
    );
    if (order.brokerIntentState === null) return;
    const intent = await client.query(
      `SELECT status FROM trade.order_intent WHERE order_intent_id=$1 FOR UPDATE`, [order.orderIntentId],
    );
    const current = intent.rows[0]?.status as OrderIntentState | undefined;
    if (current === undefined || current === order.brokerIntentState) return;
    if (isValidOrderIntentTransition(current, order.brokerIntentState)) {
      await client.query(
        `UPDATE trade.order_intent SET status=$2,updated_at=now() WHERE order_intent_id=$1`,
        [order.orderIntentId, order.brokerIntentState],
      );
      return;
    }
    await client.query(
      `INSERT INTO trade.reconciliation_event(order_intent_id,state,detected_at,detail_json)
       SELECT $1,'QUARANTINED',$2,$3::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM trade.reconciliation_event
         WHERE order_intent_id=$1 AND state='QUARANTINED' AND resolved_at IS NULL)`,
      [order.orderIntentId, input.observedAt, JSON.stringify({
        reconciliationSnapshotId: input.snapshotId, providerOrderIdHash: order.providerOrderIdHash,
        brokerStatus: order.brokerStatus, localStatus: current, brokerIntentState: order.brokerIntentState,
        reason: 'OUT_OF_ORDER_OR_CONTRADICTORY_BROKER_STATE',
      })],
    );
  }
}

function deterministicFillUuid(value:string):string {
  const bytes=Buffer.from(sha256(value).slice(0,32),'hex');
  const version=bytes.at(6),variant=bytes.at(8); if (version===undefined||variant===undefined) throw new Error('FILL_UUID_INVALID');
  bytes[6]=(version&0x0f)|0x40; bytes[8]=(variant&0x3f)|0x80; const hex=bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
