import type { Pool } from 'pg';
import { withRuntimePostgresReadRetry } from '../theta/runtime-postgres-client.js';
import { PostgresDefinedRiskLifecycleStore, type DefinedRiskLifecycleEventType } from './postgres-defined-risk-lifecycle-store.js';
import { PostgresDefinedRiskPositionStore } from './postgres-defined-risk-position-store.js';

// Broker-confirmed terminal facts for native spreads. An activity is attributed to a spread ONLY by exact OCC symbol of one of its two durable legs and only when it happened
// after the spread opened. A vanished position, a moneyness guess or an expiration date never creates an event: only a broker activity identity does.

export interface DefinedRiskBrokerFactsResult {
  readonly eventsRecorded: number;
  readonly positionsRefreshed: number;
  readonly emergencies: number;
  readonly stockChainsCreated: number;
}

const ACTIVITY_EVENT: Readonly<Record<string, DefinedRiskLifecycleEventType>> = { OPASN: 'ASSIGNMENT', OPEXP: 'EXPIRATION', OPXRC: 'EXERCISE' };

export async function applyDefinedRiskBrokerFacts(pool: Pool, input: { connectionId: string; observedAt: string }): Promise<DefinedRiskBrokerFactsResult> {
  const positions = new PostgresDefinedRiskPositionStore(pool);
  const lifecycle = new PostgresDefinedRiskLifecycleStore(pool);
  const active = await positions.activePositions();
  if (active.length === 0) return { eventsRecorded: 0, positionsRefreshed: 0, emergencies: 0, stockChainsCreated: 0 };
  let eventsRecorded = 0, emergencies = 0, stockChainsCreated = 0;
  // oldest spread first: when two spreads share a leg symbol, a broker activity is allocated to the oldest spread that still has contracts on that leg
  const ordered = [...active].sort((a, b) => a.orderIntentId.localeCompare(b.orderIntentId));
  for (const position of ordered) {
    const legs = (await withRuntimePostgresReadRetry(pool, (client) => client.query(`SELECT l.leg_index, l.occ_symbol, l.strike::float AS strike, l.multiplier, p.opened_at FROM trade.order_intent_leg l
      JOIN trade.defined_risk_position p ON p.order_intent_id=l.order_intent_id WHERE l.order_intent_id=$1 AND l.position_intent IN ('sell_to_open','buy_to_open') ORDER BY l.leg_index`, [position.orderIntentId]))).value.rows as
      Array<{ leg_index: number; occ_symbol: string; strike: number; multiplier: number; opened_at: Date | null }>;
    const symbols = legs.map((leg) => leg.occ_symbol);
    const facts = (await withRuntimePostgresReadRetry(pool, (client) => client.query(`SELECT provider_activity_ref_hash, activity_type, symbol, quantity::float AS quantity, activity_at
      FROM trade.broker_activity_fact WHERE connection_id=$1 AND symbol = ANY($2) AND activity_type = ANY($3) AND activity_at IS NOT NULL AND activity_at <= $4
      ORDER BY activity_at, provider_activity_ref_hash`, [input.connectionId, symbols, Object.keys(ACTIVITY_EVENT), input.observedAt]))).value.rows as
      Array<{ provider_activity_ref_hash: string; activity_type: string; symbol: string; quantity: number | null; activity_at: Date }>;
    const refreshed = await positions.refresh(position.orderIntentId, input.observedAt);
    const openByLeg: Record<number, number> = { 1: refreshed.exposure.shortOpen, 2: refreshed.exposure.longOpen };
    for (const fact of facts) {
      const leg = legs.find((candidate) => candidate.occ_symbol === fact.symbol);
      const type = ACTIVITY_EVENT[fact.activity_type];
      if (leg === undefined || type === undefined || fact.quantity === null) continue;
      // assignment is a SHORT-leg event and exercise a LONG-leg event; anything else is a contradiction the position state will surface, never a recorded event
      if ((type === 'ASSIGNMENT' && leg.leg_index !== 1) || (type === 'EXERCISE' && leg.leg_index !== 2)) continue;
      if (leg.opened_at !== null && fact.activity_at.getTime() < leg.opened_at.getTime()) continue;
      // what part of this ONE broker activity is already attributed to ANY spread (including this one on an earlier cycle) is read from the ledger, never from memory:
      // a replay, a restart or a second spread sharing the leg symbol can therefore never consume the same contracts twice
      const attributed = (await withRuntimePostgresReadRetry(pool, (client) => client.query(`SELECT COALESCE(sum(contracts),0)::int AS n,
          bool_or(order_intent_id=$2) AS mine FROM trade.multi_leg_lifecycle_event WHERE provider_event_id=$1`, [fact.provider_activity_ref_hash, position.orderIntentId]))).value.rows[0] as { n: number; mine: boolean | null };
      if (attributed.mine === true) continue;
      const left = Math.abs(fact.quantity) - Number(attributed.n);
      const contracts = Math.min(left, openByLeg[leg.leg_index] ?? 0);
      if (!Number.isSafeInteger(contracts) || contracts <= 0) continue;
      openByLeg[leg.leg_index] = (openByLeg[leg.leg_index] ?? 0) - contracts;
      const shares = contracts * leg.multiplier;
      await lifecycle.recordLifecycleEvent({ orderIntentId: position.orderIntentId, chainId: position.chainId, providerEventId: fact.provider_activity_ref_hash, eventType: type, legIndex: leg.leg_index, contracts,
        sharesDelta: type === 'ASSIGNMENT' ? shares : type === 'EXERCISE' ? -shares : null,
        cashFlow: type === 'ASSIGNMENT' ? -leg.strike * shares : type === 'EXERCISE' ? leg.strike * shares : null, occurredAt: fact.activity_at.toISOString(), detail: { source: 'BROKER_ACTIVITY_FACT', activityType: fact.activity_type } });
      eventsRecorded += 1;
    }
    const result = eventsRecorded > 0 ? await positions.refresh(position.orderIntentId, input.observedAt) : refreshed;
    if (result.state === 'DIVERGED_EMERGENCY') emergencies += 1;
    if (result.stockChainId !== null && result.previousState !== 'STOCK_FROM_ASSIGNMENT') stockChainsCreated += 1;
  }
  return { eventsRecorded, positionsRefreshed: ordered.length, emergencies, stockChainsCreated };
}
