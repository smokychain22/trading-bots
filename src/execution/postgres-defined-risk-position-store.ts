import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withRuntimePostgresReadRetry, withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import { assessDefinedRiskState, definedRiskTerminalStates, type DefinedRiskPositionState, type DefinedRiskStateAssessment } from './defined-risk-position.js';
import { computeDefinedRiskWholeChainAccounting } from './defined-risk-lifecycle.js';

type Row = Record<string, unknown>;
const num = (value: unknown): number => Number(value ?? 0);
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

// An order intent that can still change broker state. UNKNOWN_SUBMISSION / RECONCILING count as working: an ambiguous order may be live.
const WORKING_STATUSES = ['SUBMITTING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL', 'CANCEL_REQUESTED', 'UNKNOWN_SUBMISSION', 'RECONCILING'] as const;

export interface DefinedRiskPositionSnapshot {
  readonly orderIntentId: string;
  readonly chainId: string;
  readonly underlyingId: string;
  readonly quantity: number;
  readonly multiplier: number;
  readonly expiration: string;
  readonly shortStrike: number;
  readonly longStrike: number;
  readonly state: DefinedRiskPositionState;
}

export interface DefinedRiskRefreshResult extends DefinedRiskStateAssessment {
  readonly orderIntentId: string;
  readonly chainId: string;
  readonly previousState: DefinedRiskPositionState;
  readonly stockChainId: string | null;
  readonly stockShares: number;
}

/**
 * The durable authority for one native spread. State is NEVER stored as an opinion that later code trusts: every refresh recomputes it from the persisted per-leg broker
 * truth (order legs + broker_order_leg_state) and the persisted broker-confirmed lifecycle events, so a restart, a replayed event or a late broker update converges on
 * the same answer. Terminal states are never left.
 */
export class PostgresDefinedRiskPositionStore {
  constructor(private readonly pool: Pool) {}

  /** the chain a spread lives on is a DEFINED_RISK chain, never a Wheel chain: Wheel loaders filter on chain_kind and can not see it */
  async ensureDefinedRiskChain(input: { chainId: string; botInstanceId: string; underlyingId: string; openedAt: string }): Promise<void> {
    await withRuntimePostgresTransaction(this.pool, async (client) => {
      await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at,chain_kind)
        VALUES($1,$2,$3,'WAIT',$4,'DEFINED_RISK') ON CONFLICT(chain_id) DO NOTHING`, [input.chainId, input.botInstanceId, input.underlyingId, input.openedAt]);
      const kind = await client.query(`SELECT chain_kind FROM trade.economic_chain WHERE chain_id=$1`, [input.chainId]);
      if (kind.rows[0]?.chain_kind !== 'DEFINED_RISK') throw new Error('DEFINED_RISK_CHAIN_ID_BELONGS_TO_A_WHEEL_CHAIN');
    });
  }

  /** Registers the position from the DURABLE parent + legs (never from an in-memory plan). Idempotent. */
  async register(orderIntentId: string): Promise<DefinedRiskPositionSnapshot> {
    return withRuntimePostgresTransaction(this.pool, async (client) => {
      const parent = (await client.query(`SELECT order_intent_id::text, chain_id::text, underlying_id::text, quantity::int AS quantity, order_class, theta_action
        FROM trade.order_intent WHERE order_intent_id=$1 FOR SHARE`, [orderIntentId])).rows[0] as Row | undefined;
      if (parent === undefined || parent.order_class !== 'mleg' || parent.theta_action !== 'OPEN_DEFINED_RISK' || parent.chain_id === null || parent.underlying_id === null) {
        throw new Error('DEFINED_RISK_POSITION_REQUIRES_DURABLE_OPEN_PARENT');
      }
      const chain = (await client.query(`SELECT chain_kind FROM trade.economic_chain WHERE chain_id=$1`, [parent.chain_id])).rows[0] as Row | undefined;
      if (chain?.chain_kind !== 'DEFINED_RISK') throw new Error('DEFINED_RISK_POSITION_REQUIRES_DEFINED_RISK_CHAIN');
      const legs = (await client.query(`SELECT leg_index, position_intent, strike::float AS strike, multiplier, to_char(expiration,'YYYY-MM-DD') AS expiration
        FROM trade.order_intent_leg WHERE order_intent_id=$1 ORDER BY leg_index`, [orderIntentId])).rows as Row[];
      const shortLeg = legs.find((leg) => leg.position_intent === 'sell_to_open'), longLeg = legs.find((leg) => leg.position_intent === 'buy_to_open');
      if (legs.length !== 2 || shortLeg === undefined || longLeg === undefined || shortLeg.expiration !== longLeg.expiration || num(shortLeg.multiplier) !== num(longLeg.multiplier)
        || num(shortLeg.strike) <= num(longLeg.strike)) throw new Error('DEFINED_RISK_POSITION_LEG_STRUCTURE_INVALID');
      await client.query(`INSERT INTO trade.defined_risk_position(order_intent_id,chain_id,underlying_id,quantity,multiplier,expiration,short_strike,long_strike,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING_OPEN') ON CONFLICT(order_intent_id) DO NOTHING`,
      [orderIntentId, parent.chain_id, parent.underlying_id, num(parent.quantity), num(shortLeg.multiplier), shortLeg.expiration, num(shortLeg.strike), num(longLeg.strike)]);
      return this.load(client, orderIntentId);
    });
  }

  async load(clientOrPool: PoolClient | Pool, orderIntentId: string): Promise<DefinedRiskPositionSnapshot> {
    const row = (await clientOrPool.query(`SELECT order_intent_id::text, chain_id::text, underlying_id::text, quantity, multiplier, to_char(expiration,'YYYY-MM-DD') AS expiration,
      short_strike::float AS short_strike, long_strike::float AS long_strike, state FROM trade.defined_risk_position WHERE order_intent_id=$1`, [orderIntentId])).rows[0] as Row | undefined;
    if (row === undefined) throw new Error('DEFINED_RISK_POSITION_NOT_REGISTERED');
    return { orderIntentId: String(row.order_intent_id), chainId: String(row.chain_id), underlyingId: String(row.underlying_id), quantity: num(row.quantity), multiplier: num(row.multiplier),
      expiration: String(row.expiration), shortStrike: num(row.short_strike), longStrike: num(row.long_strike), state: row.state as DefinedRiskPositionState };
  }

  /** every spread that still has, or may have, broker exposure: the set the management scan must cover */
  async activePositions(): Promise<readonly DefinedRiskPositionSnapshot[]> {
    const rows = await withRuntimePostgresReadRetry(this.pool, (client) => client.query(`SELECT order_intent_id::text FROM trade.defined_risk_position
      WHERE state IN ('PENDING_OPEN','ASYMMETRIC_OPEN','OPEN','CLOSE_PENDING','DIVERGED_EMERGENCY') ORDER BY opened_at NULLS LAST, order_intent_id`));
    return Promise.all((rows.value.rows as Row[]).map((row) => this.load(this.pool, String(row.order_intent_id))));
  }

  /** Recompute the state from durable truth and persist it (plus accounting, plus the resulting stock chain when the broker assigned shares). Idempotent. */
  async refresh(orderIntentId: string, observedAt: string): Promise<DefinedRiskRefreshResult> {
    if (!Number.isFinite(Date.parse(observedAt))) throw new Error('DEFINED_RISK_REFRESH_TIME_INVALID');
    return withRuntimePostgresTransaction(this.pool, async (client) => {
      const locked = (await client.query(`SELECT state FROM trade.defined_risk_position WHERE order_intent_id=$1 FOR UPDATE`, [orderIntentId])).rows[0] as Row | undefined;
      if (locked === undefined) throw new Error('DEFINED_RISK_POSITION_NOT_REGISTERED');
      const position = await this.load(client, orderIntentId);
      const previousState = position.state;
      const legRows = (await client.query(`SELECT oi.theta_action, l.position_intent, COALESCE(sum(s.filled_quantity),0)::int AS filled,
          sum(s.filled_quantity*s.average_fill_price) FILTER (WHERE s.average_fill_price IS NOT NULL) AS notional,
          bool_or(s.filled_quantity>0 AND s.average_fill_price IS NULL) AS price_unknown
        FROM trade.order_intent oi JOIN trade.order_intent_leg l ON l.order_intent_id=oi.order_intent_id
        LEFT JOIN trade.broker_order_leg_state s ON s.order_intent_id=l.order_intent_id AND s.leg_index=l.leg_index
        WHERE oi.chain_id=$1 AND oi.order_class='mleg' GROUP BY 1,2`, [position.chainId])).rows as Row[];
      const fills = (action: string, intent: string): { filled: number; notional: number | null } => {
        const row = legRows.find((candidate) => candidate.theta_action === action && candidate.position_intent === intent);
        if (row === undefined) return { filled: 0, notional: 0 };
        return { filled: num(row.filled), notional: row.price_unknown === true ? null : num(row.notional) };
      };
      const shortOpen = fills('OPEN_DEFINED_RISK', 'sell_to_open'), longOpen = fills('OPEN_DEFINED_RISK', 'buy_to_open');
      const shortClose = fills('CLOSE_DEFINED_RISK', 'buy_to_close'), longClose = fills('CLOSE_DEFINED_RISK', 'sell_to_close');
      const workingRows = (await client.query(`SELECT theta_action, bool_or(status::text = ANY($2)) AS working FROM trade.order_intent
        WHERE chain_id=$1 AND order_class='mleg' GROUP BY 1`, [position.chainId, [...WORKING_STATUSES]])).rows as Row[];
      const working = (action: string): boolean => workingRows.find((row) => row.theta_action === action)?.working === true;
      const eventRows = (await client.query(`SELECT event_type, leg_index, COALESCE(sum(contracts),0)::int AS contracts, count(*)::int AS events
        FROM trade.multi_leg_lifecycle_event WHERE order_intent_id=$1 GROUP BY 1,2`, [orderIntentId])).rows as Row[];
      const eventContracts = (type: string, leg: number | null): number => eventRows.filter((row) => row.event_type === type && (leg === null ? row.leg_index === null : row.leg_index === leg))
        .reduce((sum, row) => sum + num(row.contracts), 0);
      const parentExpiration = eventRows.some((row) => row.event_type === 'EXPIRATION' && row.leg_index === null);
      const legExpired = (leg: number): number => eventContracts('EXPIRATION', leg);
      let shortClosed = shortClose.filled + eventContracts('ASSIGNMENT', 1) + legExpired(1);
      let longClosed = longClose.filled + eventContracts('EXERCISE', 2) + legExpired(2);
      if (parentExpiration) { shortClosed = shortOpen.filled; longClosed = longOpen.filled; }
      const assignedContracts = eventContracts('ASSIGNMENT', 1), exercisedContracts = eventContracts('EXERCISE', 2);
      let assessment: DefinedRiskStateAssessment;
      try {
        assessment = assessDefinedRiskState({ shortOpened: shortOpen.filled, longOpened: longOpen.filled, shortClosed, longClosed, requestedSpreads: position.quantity,
          openOrderWorking: working('OPEN_DEFINED_RISK'), closeOrderWorking: working('CLOSE_DEFINED_RISK'),
          events: { assignedContracts, exercisedContracts, expirationRecorded: eventRows.some((row) => row.event_type === 'EXPIRATION') } });
      } catch (error) {
        // broker truth that contradicts itself (more contracts removed than were ever opened) is a typed emergency, never a thrown crash and never a quiet pass
        if (!(error instanceof Error) || error.message !== 'DEFINED_RISK_LEG_FILLS_INVALID') throw error;
        assessment = { state: 'DIVERGED_EMERGENCY', reasons: ['LEG_TRUTH_INCONSISTENT'], netStockContracts: assignedContracts - exercisedContracts,
          exposure: { shortOpen: 0, longOpen: 0, nakedShortContracts: 0, excessLongContracts: 0, hedgedSpreads: 0 } };
      }
      // a terminal state is never left: a late broker event can add facts, it can not reopen a closed spread
      const nextState = definedRiskTerminalStates.has(previousState) ? previousState : assessment.state;
      const terminal = definedRiskTerminalStates.has(nextState);
      await client.query(`UPDATE trade.defined_risk_position SET state=$2,
          opened_at=COALESCE(opened_at, CASE WHEN $2 <> 'PENDING_OPEN' THEN $3::timestamptz END),
          closed_at=CASE WHEN $4 THEN COALESCE(closed_at,$3::timestamptz) ELSE NULL END, updated_at=now() WHERE order_intent_id=$1`, [orderIntentId, nextState, observedAt, terminal]);

      // whole-chain accounting from the ACTUAL per-leg fills; unknown prices/fees stay unknown
      const perShare = (open: { filled: number; notional: number | null }, close: { filled: number; notional: number | null }): { open: number | null; close: number | null } => ({
        open: open.filled > 0 && open.notional !== null ? open.notional / open.filled : null, close: close.filled > 0 && close.notional !== null ? close.notional / close.filled : null });
      const shortAvg = perShare(shortOpen, shortClose), longAvg = perShare(longOpen, longClose);
      const openingCredit = shortAvg.open !== null && longAvg.open !== null ? Number((shortAvg.open - longAvg.open).toFixed(4)) : null;
      const closingDebit = shortAvg.close !== null && longAvg.close !== null ? Number((shortAvg.close - longAvg.close).toFixed(4)) : null;
      const feeRows = (await client.query(`SELECT count(*)::int AS n, COALESCE(sum(amount),0)::float AS total FROM trade.fee_event WHERE chain_id=$1`, [position.chainId])).rows[0] as Row;
      const feesKnown = num(feeRows.n) > 0;
      const assignmentCash = num((await client.query(`SELECT COALESCE(sum(cash_flow),0)::float AS total FROM trade.multi_leg_lifecycle_event WHERE order_intent_id=$1`, [orderIntentId])).rows[0]?.total);
      const accounting = computeDefinedRiskWholeChainAccounting({ quantity: position.quantity, multiplier: position.multiplier,
        openingNetCreditPerShare: openingCredit === null ? null : Math.max(0, openingCredit), openingFees: feesKnown ? num(feeRows.total) : null,
        closingNetDebitPerShare: closingDebit === null ? null : Math.max(0, closingDebit), closingFees: feesKnown ? 0 : null, assignmentExerciseCashFlow: assignmentCash,
        lifecycle: nextState === 'CLOSED' || nextState === 'EXPIRED_WORTHLESS' ? 'CLOSED' : nextState === 'STOCK_FROM_ASSIGNMENT' ? 'STOCK_INVENTORY' : nextState === 'DIVERGED_EMERGENCY' ? 'UNKNOWN' : 'OPEN' });
      // expiry worthless: the closing debit is zero by definition (no order), not unknown
      const finalAccounting = nextState === 'EXPIRED_WORTHLESS' && closingDebit === null
        ? computeDefinedRiskWholeChainAccounting({ quantity: position.quantity, multiplier: position.multiplier, openingNetCreditPerShare: openingCredit === null ? null : Math.max(0, openingCredit),
          openingFees: feesKnown ? num(feeRows.total) : null, closingNetDebitPerShare: 0, closingFees: feesKnown ? 0 : null, assignmentExerciseCashFlow: assignmentCash, lifecycle: 'CLOSED' }) : accounting;
      if (previousState !== 'PENDING_OPEN' || openingCredit !== null || terminal) {
        await client.query(`INSERT INTO trade.multi_leg_chain_accounting(order_intent_id,chain_id,opening_net_credit,opening_fees,closing_net_debit,closing_fees,
            assignment_exercise_cash_flow,realized_pnl,realized_pnl_before_fees,pnl_state,remaining_exposure)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT(order_intent_id) DO UPDATE SET closing_net_debit=EXCLUDED.closing_net_debit,closing_fees=EXCLUDED.closing_fees,
            assignment_exercise_cash_flow=EXCLUDED.assignment_exercise_cash_flow,realized_pnl=EXCLUDED.realized_pnl,realized_pnl_before_fees=EXCLUDED.realized_pnl_before_fees,
            pnl_state=EXCLUDED.pnl_state,remaining_exposure=EXCLUDED.remaining_exposure,updated_at=now(),
            opening_net_credit=COALESCE(trade.multi_leg_chain_accounting.opening_net_credit,EXCLUDED.opening_net_credit),
            opening_fees=COALESCE(trade.multi_leg_chain_accounting.opening_fees,EXCLUDED.opening_fees)`,
        [orderIntentId, position.chainId, finalAccounting.openingNetCredit, finalAccounting.openingFees, finalAccounting.closingNetDebit, finalAccounting.closingFees,
          finalAccounting.assignmentExerciseCashFlow, finalAccounting.realizedPnl, finalAccounting.realizedPnlBeforeFees, finalAccounting.pnlState, finalAccounting.remainingUnrealizedExposure]);
      }

      let stockChainId: string | null = null, stockShares = 0;
      if (nextState === 'STOCK_FROM_ASSIGNMENT' && assessment.netStockContracts > 0) {
        const created = await this.ensureStockChain(client, position, assessment.netStockContracts, observedAt);
        stockChainId = created.chainId; stockShares = created.shares;
      }
      return { ...assessment, state: nextState, orderIntentId, chainId: position.chainId, previousState, stockChainId, stockShares };
    });
  }

  /**
   * Stock handed over by the broker (assignment net of exercise) starts a NEW Wheel chain at RECOVERY_WAIT, so the existing recovery (A) / covered-call (C) paths own it from there.
   * The chain keeps the originating spread chain (origin_chain_id) and its identity is derived from the spread, so a replay can never create a duplicate lot.
   */
  private async ensureStockChain(client: PoolClient, position: DefinedRiskPositionSnapshot, netContracts: number, at: string): Promise<{ chainId: string; shares: number }> {
    const existing = (await client.query(`SELECT chain_id::text FROM trade.economic_chain WHERE origin_chain_id=$1 AND chain_kind='WHEEL'`, [position.chainId])).rows[0] as Row | undefined;
    const shares = netContracts * position.multiplier;
    if (existing !== undefined) return { chainId: String(existing.chain_id), shares };
    const origin = (await client.query(`SELECT bot_instance_id FROM trade.economic_chain WHERE chain_id=$1`, [position.chainId])).rows[0] as Row;
    const seed = hash(`theta-defined-risk-stock-chain-v1:${position.orderIntentId}`);
    const chainId = `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-8${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
    await client.query(`INSERT INTO trade.economic_chain(chain_id,bot_instance_id,underlying_id,lifecycle_state,opened_at,chain_kind,origin_chain_id)
      VALUES($1,$2,$3,'RECOVERY_WAIT',$4,'WHEEL',$5) ON CONFLICT(chain_id) DO NOTHING`, [chainId, origin.bot_instance_id, position.underlyingId, at, position.chainId]);
    for (const [from, to] of [['WAIT', 'ASSIGNED'], ['ASSIGNED', 'STOCK_HELD'], ['STOCK_HELD', 'RECOVERY_WAIT']] as const) {
      await client.query(`INSERT INTO trade.lifecycle_transition(chain_id,from_state,to_state,transitioned_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [chainId, from, to, at]);
    }
    // the stock was delivered at the SHORT strike; the spread's own credit/debit stays in the spread accounting (no double counting)
    await client.query(`INSERT INTO trade.stock_lot(stock_lot_id,chain_id,underlying_id,shares,economic_basis_per_share,broker_basis_per_share,acquired_at)
      VALUES($1,$2,$3,$4,$5,$5,$6) ON CONFLICT(stock_lot_id) DO NOTHING`, [randomUUID(), chainId, position.underlyingId, shares, position.shortStrike, at]);
    return { chainId, shares };
  }
}
