import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import { z } from 'zod';
import type { BrokerActivity, BrokerCalendarSession, BrokerMarketClock, BrokerOrderSnapshot } from './broker.js';
import type { ReadOnlyPaperBroker } from './read-only-paper-broker.js';
import { isValidOrderIntentTransition, type OrderIntentState } from '../theta/order-intent-state.js';
import { brokerOrderIntentState } from './broker-order-state.js';
import {
  classifyBrokerFactBatch,
  type BrokerFactBatchSummary,
  type BrokerFactEvidence,
} from './broker-fact-impact.js';

const accountSchema = z.object({ id: z.string().min(1), status: z.string().nullable().optional() }).passthrough();
const strictNumericBrokerField = z.union([
  z.number().finite(),
  z.string().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/),
]);
const positionSchema = z.object({
  symbol: z.string().min(1), qty: strictNumericBrokerField.nullable().optional(),
  side: z.string().nullable().optional(), asset_class: z.string().nullable().optional(),
  avg_entry_price: strictNumericBrokerField.nullable().optional(),
  current_price: strictNumericBrokerField.nullable().optional(),
  market_value: strictNumericBrokerField.nullable().optional(),
  cost_basis: strictNumericBrokerField.nullable().optional(),
  unrealized_pl: strictNumericBrokerField.nullable().optional(),
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
  readonly factImpactSummary: BrokerFactBatchSummary;
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
  /** Facts with current exposure, a current reconciliation defect, or unknown current impact. */
  readonly entryBlockingFactCount: number;
  readonly brokerFactImpactSummary: Omit<BrokerFactBatchSummary, 'results'>;
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
    detail: { status: order.status, side: order.side, positionIntent: order.positionIntent ?? null,
      quantity: order.qty, filledQuantity: order.filledQty, filledAveragePrice: order.filledAvgPrice,
      submittedAt: order.submittedAt, replacesOrder: order.replaces !== null,
      replacedByOrder: order.replacedBy !== null },
  };
}

function activityFact(activity: BrokerActivity): UnmatchedBrokerFact {
  return {
    factType: 'ACTIVITY', providerFactRefHash: sha256(activity.id), symbol: activity.symbol,
    detail: { activityType: activity.activityType, quantity: activity.quantity, price: activity.price,
      netAmount: activity.netAmount ?? null, perShareAmount: activity.perShareAmount ?? null,
      date: activity.date, linkedOrderRefHash: activity.orderId === null ? null : sha256(activity.orderId) },
  };
}

function marketDateAt(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

const terminalOrderStatuses = new Set(['filled', 'canceled', 'expired', 'rejected', 'replaced']);
const activeOrderStatuses = new Set([
  'new', 'partially_filled', 'pending_new', 'accepted', 'accepted_for_bidding',
  'pending_cancel', 'pending_replace', 'done_for_day', 'stopped', 'suspended', 'calculated',
]);
const settledActivityTypes = new Set(['FILL', 'FEE', 'JNLC', 'DIV']);
const isTerminalOrderStatus = (status: string): boolean => terminalOrderStatuses.has(status.toLowerCase());

const activityTypeForImpact = (value: string): BrokerFactEvidence['activityType'] => {
  const normalized = value.toUpperCase();
  return normalized === 'FILL' || normalized === 'FEE' || normalized === 'JNLC' || normalized === 'DIV'
    ? normalized : 'OTHER';
};

function buildBrokerFactImpactEvidence(input: {
  readonly unmatchedOrders: readonly BrokerOrderSnapshot[];
  readonly positions: readonly BrokerPositionEvidence[];
  readonly unmatchedActivities: readonly BrokerActivity[];
  readonly allOrders: readonly BrokerOrderSnapshot[];
  readonly observedAt: string;
}): readonly BrokerFactEvidence[] {
  const currentPositionSymbols = new Set(input.positions.map((position) => position.symbol));
  const ordersById = new Map(input.allOrders.map((order) => [order.id, order] as const));
  const evidence: BrokerFactEvidence[] = [];

  for (const order of input.unmatchedOrders) {
    const status = order.status.toLowerCase();
    const active = activeOrderStatuses.has(status);
    const terminal = terminalOrderStatuses.has(status);
    evidence.push({
      factId: sha256(order.id), brokerObjectType: 'ORDER', activityType: null,
      eventTimestamp: order.submittedAt, firstSeenTimestamp: input.observedAt,
      linkedLocalOrderId: null, linkedLocalChainId: null,
      currentBrokerOrderExists: active ? true : terminal ? false : null,
      currentPositionExists: currentPositionSymbols.has(order.symbol),
      currentUnsettledObligationExists: active ? true : terminal ? false : null,
      cashEffect: null,
      reconciliationStatus: terminal ? 'RECONCILED' : active ? 'UNRECONCILED' : 'UNKNOWN',
    });
  }

  for (const position of input.positions) {
    evidence.push({
      factId: sha256(`${position.symbol}:${position.side ?? ''}:${position.quantity ?? 'UNKNOWN'}`),
      brokerObjectType: 'POSITION', activityType: null, eventTimestamp: input.observedAt,
      firstSeenTimestamp: input.observedAt, linkedLocalOrderId: null, linkedLocalChainId: null,
      currentBrokerOrderExists: false, currentPositionExists: true,
      currentUnsettledObligationExists: false, cashEffect: position.marketValue,
      reconciliationStatus: 'UNRECONCILED',
    });
  }

  for (const activity of input.unmatchedActivities) {
    const relatedOrder = activity.orderId === null ? null : ordersById.get(activity.orderId) ?? null;
    const relatedStatus = relatedOrder?.status.toLowerCase() ?? null;
    const activeOrder = relatedStatus === null ? false : activeOrderStatuses.has(relatedStatus);
    const terminalOrder = relatedStatus === null ? false : terminalOrderStatuses.has(relatedStatus);
    const settledActivity = settledActivityTypes.has(activity.activityType.toUpperCase());
    const currentPosition = activity.symbol === null ? false : currentPositionSymbols.has(activity.symbol);
    const settlementKnown = terminalOrder || (activity.orderId === null && settledActivity);
    evidence.push({
      factId: sha256(activity.id), brokerObjectType: 'ACTIVITY',
      activityType: activityTypeForImpact(activity.activityType), eventTimestamp: activity.date,
      firstSeenTimestamp: input.observedAt, linkedLocalOrderId: null, linkedLocalChainId: null,
      currentBrokerOrderExists: activeOrder ? true : settlementKnown ? false : null,
      currentPositionExists: currentPosition,
      currentUnsettledObligationExists: activeOrder ? true : settlementKnown ? false : null,
      cashEffect: activity.netAmount ?? null,
      reconciliationStatus: settlementKnown ? 'RECONCILED' : activeOrder ? 'UNRECONCILED' : 'UNKNOWN',
    });
  }
  return evidence;
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
  const unmatchedActivities = sortedActivities
    .filter((activity) => activity.orderId === null || !knownOrderIds.has(activity.orderId));

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
    ...unmatchedActivities.map(activityFact),
  ];
  const factImpactSummary = classifyBrokerFactBatch(buildBrokerFactImpactEvidence({
    unmatchedOrders: matches.unmatched, positions, unmatchedActivities, allOrders: orders, observedAt,
  }));
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
    positionCount: positions.length, openOrderCount: orders.filter((order) => !isTerminalOrderStatus(order.status)).length,
    activityCount: sortedActivities.length, positions, activities: sortedActivities, matchedOrders: matches.matched,
    missingLocalIntentIds: matches.missingLocalIntentIds, unmatchedFacts, factImpactSummary, observedAt, payloadHash,
  });
  const calendarSessionConfirmed = calendarSessions?.some((session) =>
    session.date === marketDate && session.open !== null && session.close !== null) ?? false;
  const dataQuality = account.status != null && marketClock?.timestamp != null
    && marketClock.isOpen != null && calendarSessions !== null ? 'GOOD' : 'UNKNOWN';
  return {
    snapshotId, correlationId: input.correlationId, accountStatus: account.status ?? null,
    positionCount: positions.length,
    openOrderCount: orders.filter((order) => !isTerminalOrderStatus(order.status)).length,
    activityCount: sortedActivities.length, matchedOrderCount: matches.matched.length,
    externalOrUnknownCount: unmatchedFacts.length, localOnlyIntentCount: matches.missingLocalIntentIds.length,
    entryBlockingFactCount: factImpactSummary.entryBlockingFactCount,
    brokerFactImpactSummary: {
      version: factImpactSummary.version, totalFacts: factImpactSummary.totalFacts,
      entryBlockingFactCount: factImpactSummary.entryBlockingFactCount,
      currentEconomicExposureCount: factImpactSummary.currentEconomicExposureCount,
      currentReconciliationDefectCount: factImpactSummary.currentReconciliationDefectCount,
      historicalReconciledCount: factImpactSummary.historicalReconciledCount,
      historicalAccountingOnlyCount: factImpactSummary.historicalAccountingOnlyCount,
      unknownCurrentImpactCount: factImpactSummary.unknownCurrentImpactCount,
    },
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
    await withRuntimePostgresTransaction(this.pool, async (client) => {
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
            brokerFactImpactSummary: input.factImpactSummary,
            marketOpen: input.marketClock?.isOpen ?? null,
            nextOpen: input.marketClock?.nextOpen ?? null,
            nextClose: input.marketClock?.nextClose ?? null,
            calendarSessions: input.calendarSessions?.map((session)=>({date:session.date,open:session.open,close:session.close})) ?? null,
            calendarSessionConfirmed: input.calendarSessions?.some((session) =>
              session.open !== null && session.close !== null) ?? false,
            // A reconciliation snapshot is immutable per cycle. Keep the
            // current broker fact shape here because the distinct-fact table
            // intentionally does not overwrite its first observation.
            unmatchedFactObservations: input.unmatchedFacts.map((fact)=>({
              factType:fact.factType,providerFactRefHash:fact.providerFactRefHash,
              symbol:fact.symbol,detail:fact.detail,
            })),
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
             activity_at,provider_order_ref_hash,first_observed_at,last_observed_at,payload_hash,net_amount,per_share_amount)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12)
           ON CONFLICT(connection_id,provider_activity_ref_hash) DO UPDATE SET
             last_observed_at=EXCLUDED.last_observed_at`,
          [input.connectionId, sha256(activity.id), activity.activityType, activity.symbol,
            activity.quantity, activity.price, activity.date, activity.orderId === null ? null : sha256(activity.orderId),
            input.observedAt, sha256(canonicalJson({
              type: activity.activityType, symbol: activity.symbol, quantity: activity.quantity,
              price: activity.price, date: activity.date,netAmount:activity.netAmount??null,perShareAmount:activity.perShareAmount??null,
            })),activity.netAmount??null,activity.perShareAmount??null],
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
    });
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
