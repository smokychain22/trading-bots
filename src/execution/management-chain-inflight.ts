import type { Pool } from 'pg';
import type { AlpacaOpenOrderSnapshot, AlpacaPositionSnapshot } from '../theta/alpaca-provider.js';
import { deriveCommittedShortCallContracts } from '../theta/account-exposure.js';
import { reconcileStockShares, type BrokerStockInventoryEvidence, type StockShareReconciliation } from '../theta/stock-share-reconciliation.js';
import { managementStockExitStateUnknown, stockPartialExitPendingReconciliation,
  type ManagementChainInFlightState, type ManagementStockExitFreezeState } from './management-paper-plan-assembly.js';

/**
 * Read-only evidence feeds for the management plan assembly (MGMT-CROSS-CYCLE-DUP, HDAC-05). Both fail closed: any read
 * error or unprovable row yields UNKNOWN (UNKNOWN / null), which the assembly treats as a blocker.
 */

/** Order-intent states in which the order can no longer reach the broker or change a position. */
export const terminalOrderIntentStates = ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'] as const;

/** Every non-terminal management plan or order intent already persisted for the chain on this execution account. */
export async function readManagementChainInFlight(pool: Pick<Pool, 'query'>, executionAccountId: string,
  chainId: string): Promise<ManagementChainInFlightState> {
  try {
    const plans = await pool.query(
      `SELECT p.action_plan_id::text AS id, p.decision_id::text AS decision_id
         FROM trade.master_paper_action_plan p
        WHERE p.execution_account_id=$1 AND p.plan_json->>'chainId'=$2 AND p.status IN ('READY','CLAIMED','WAITING_GATE')`,
      [executionAccountId, chainId]);
    const intents = await pool.query(
      `SELECT oi.order_intent_id::text AS id, oi.decision_id::text AS decision_id
         FROM trade.order_intent oi
        WHERE oi.execution_account_id=$1 AND oi.chain_id=$2 AND oi.status::text <> ALL($3::text[])`,
      [executionAccountId, chainId, [...terminalOrderIntentStates]]);
    return {
      state: 'KNOWN',
      entries: [
        ...plans.rows.map((row: Record<string, unknown>) => ({
          source: 'ACTION_PLAN' as const, id: String(row.id), decisionId: row.decision_id === null ? null : String(row.decision_id) })),
        ...intents.rows.map((row: Record<string, unknown>) => ({
          source: 'ORDER_INTENT' as const, id: String(row.id), decisionId: row.decision_id === null ? null : String(row.decision_id) })),
      ],
    };
  } catch {
    return { state: 'UNKNOWN' };
  }
}

/**
 * Account-wide short-call contracts already committed on `underlying`: short-call positions in the reconciliation snapshot
 * plus our own non-terminal sell orders on calls of that underlying. Any broker fact that has CURRENT impact (current economic
 * exposure, a current reconciliation defect, or an unknown current impact: `entryBlockingFactCount`) makes the figure UNKNOWN (null),
 * because an unseen open sell-to-open call order could be among them. Settled historical facts (HISTORICAL_RECONCILED /
 * HISTORICAL_ACCOUNTING_ONLY, e.g. the 11 old account activities of the Paper account) are NOT current exposure: counting them (the
 * raw unmatched-fact count) would block every covered call and stock sale of the account forever.
 */
export async function readCommittedShortCallContracts(pool: Pick<Pool, 'query'>, input: {
  readonly executionAccountId: string; readonly reconciliationSnapshotId: string; readonly underlying: string;
  readonly entryBlockingFactCount: number;
}): Promise<number | null> {
  if (input.entryBlockingFactCount !== 0) return null;
  try {
    const positions = await pool.query(
      `SELECT symbol, quantity::float8 AS quantity, side, asset_class
         FROM trade.broker_position_snapshot WHERE reconciliation_snapshot_id=$1`,
      [input.reconciliationSnapshotId]);
    const orders = await pool.query(
      `SELECT order_intent_id::text AS id, broker_symbol, side, position_intent, quantity::float8 AS quantity, status::text AS status
         FROM trade.order_intent
        WHERE execution_account_id=$1 AND status::text <> ALL($2::text[]) AND lower(side)='sell'`,
      [input.executionAccountId, [...terminalOrderIntentStates]]);
    // Published-but-not-yet-submitted covered-call opens (READY/CLAIMED/WAITING_GATE plans, e.g. a sibling chain planned in the
    // same cycle) are commitments too; without them two chains planned together could each see zero. Double counting a plan that
    // already became an order intent can only over-block, never under-block.
    const plans = await pool.query(
      `SELECT p.action_plan_id::text AS id, p.plan_json->>'symbol' AS symbol, (p.plan_json->>'quantity')::float8 AS quantity
         FROM trade.master_paper_action_plan p
        WHERE p.execution_account_id=$1 AND p.status IN ('READY','CLAIMED','WAITING_GATE')
          AND p.plan_json->>'action' IN ('OPEN_CC','ROLL_CC_OPEN')`,
      [input.executionAccountId]);
    const planRows: AlpacaOpenOrderSnapshot[] = plans.rows.map((row: Record<string, unknown>) => ({
      orderId: `plan:${String(row.id)}`, clientOrderId: null, symbol: row.symbol === null ? null : String(row.symbol),
      side: 'sell', positionIntent: 'sell_to_open' as const, quantity: row.quantity === null ? null : Number(row.quantity),
      limitPrice: null, status: 'planned', submittedAt: null, receivedAt: '' }));
    // Sell fills that landed AFTER the reconciliation snapshot (a filled or part-filled-then-cancelled covered call is a
    // terminal intent, so it is excluded above, yet the snapshot position does not show it yet). Without this a fresh fill
    // would be a commitment gap. A snapshot with no observed time cannot prove the gap is empty, so it is UNKNOWN.
    const snapshot = await pool.query(
      `SELECT observed_at::text AS observed_at FROM trade.broker_reconciliation_snapshot WHERE reconciliation_snapshot_id=$1`,
      [input.reconciliationSnapshotId]);
    const snapshotObservedAt = (snapshot.rows[0] as Record<string, unknown> | undefined)?.observed_at;
    if (snapshotObservedAt === undefined || snapshotObservedAt === null) return null;
    const lateFills = await pool.query(
      `SELECT oi.order_intent_id::text AS id, oi.broker_symbol, oi.side, oi.position_intent, sum(f.quantity)::float8 AS quantity, oi.status::text AS status
         FROM trade.order_intent oi
         JOIN trade.broker_order bo ON bo.order_intent_id=oi.order_intent_id
         JOIN trade.fill f ON f.broker_order_id=bo.broker_order_id
        WHERE oi.execution_account_id=$1 AND oi.status::text = ANY($2::text[]) AND lower(oi.side)='sell'
          AND f.filled_at > $3::timestamptz
        GROUP BY oi.order_intent_id, oi.broker_symbol, oi.side, oi.position_intent, oi.status`,
      [input.executionAccountId, [...terminalOrderIntentStates], String(snapshotObservedAt)]);
    const positionRows: AlpacaPositionSnapshot[] = positions.rows.map((row: Record<string, unknown>) => ({
      symbol: String(row.symbol), assetClass: row.asset_class === null ? null : String(row.asset_class),
      quantity: row.quantity === null ? null : Number(row.quantity), side: row.side === null ? null : String(row.side),
      avgEntryPrice: null, marketValue: null, unrealizedPl: null, receivedAt: '' }));
    const orderRows: AlpacaOpenOrderSnapshot[] = orders.rows.map((row: Record<string, unknown>) => ({
      orderId: String(row.id), clientOrderId: null, symbol: row.broker_symbol === null ? null : String(row.broker_symbol),
      side: String(row.side).toLowerCase(),
      positionIntent: (row.position_intent === null ? null : String(row.position_intent).toLowerCase()) as AlpacaOpenOrderSnapshot['positionIntent'],
      quantity: row.quantity === null ? null : Number(row.quantity), limitPrice: null, status: String(row.status),
      submittedAt: null, receivedAt: '' }));
    const lateFillRows: AlpacaOpenOrderSnapshot[] = lateFills.rows.map((row: Record<string, unknown>) => ({
      orderId: `fill:${String(row.id)}`, clientOrderId: null, symbol: row.broker_symbol === null ? null : String(row.broker_symbol),
      side: String(row.side).toLowerCase(),
      positionIntent: (row.position_intent === null ? null : String(row.position_intent).toLowerCase()) as AlpacaOpenOrderSnapshot['positionIntent'],
      quantity: row.quantity === null ? null : Number(row.quantity), limitPrice: null, status: String(row.status),
      submittedAt: null, receivedAt: '' }));
    return deriveCommittedShortCallContracts(input.underlying, positionRows, [...orderRows, ...lateFillRows, ...planRows]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// P-A. Terminal partial stock exit freeze (owner Paper policy).
//
// A SELL_STOCK DAY order that is part filled is never replaced and never re-issued automatically; it rests until it fills or the
// session ends. If it then ends CANCELED / EXPIRED with 0 < filled < ordered, the broker holds fewer shares than the THETA ledger
// (the ledger cannot allocate a partial sale across lots, so it has NOT recorded the sale). Until broker shares and ledger shares
// agree again (share reconciliation == RECONCILED) the chain is FROZEN for every action that would sell or cover those shares:
// SELL_STOCK, OPEN_CC, ROLL_CC_OPEN. Closing an existing short call is not frozen (it reduces risk). Realized-P&L attribution of
// the part-filled sale is UNKNOWN / PENDING_RECONCILIATION: nothing here fabricates a lot-level figure.
// ---------------------------------------------------------------------------------------------------------------------------

export { stockPartialExitPendingReconciliation, managementStockExitStateUnknown };

/** Management frontier actions (not order legs) that would sell or cover shares and are therefore frozen. */
export const stockExitFrozenManagementActions: ReadonlySet<string> = new Set(['SELL_STOCK', 'SELL_CC', 'ROLL_CC']);

export interface StockTerminalExitEvidence {
  readonly orderIntentId: string;
  readonly status: 'CANCELED' | 'EXPIRED';
  readonly orderedQuantity: number;
  /** Shares filled according to INGESTED broker fills. Fill ingestion can lag the order state (see evaluateStockExitFreeze). */
  readonly filledQuantity: number;
}

export type StockTerminalExitEvidenceState =
  | { readonly state: 'KNOWN'; readonly exits: readonly StockTerminalExitEvidence[] }
  | { readonly state: 'UNKNOWN' };

/** Terminal (CANCELED / EXPIRED) SELL_STOCK intents of a chain that were not completely filled. Fails closed to UNKNOWN. */
export async function readStockTerminalExitEvidence(pool: Pick<Pool, 'query'>, executionAccountId: string,
  chainId: string): Promise<StockTerminalExitEvidenceState> {
  try {
    const result = await pool.query(
      `SELECT oi.order_intent_id::text AS id, oi.status::text AS status, oi.quantity::float8 AS ordered,
         COALESCE((SELECT sum(f.quantity) FROM trade.broker_order bo JOIN trade.fill f ON f.broker_order_id=bo.broker_order_id
                    WHERE bo.order_intent_id=oi.order_intent_id),0)::float8 AS filled
         FROM trade.order_intent oi
        WHERE oi.execution_account_id=$1 AND oi.chain_id=$2 AND oi.theta_action='SELL_STOCK'
          AND oi.status::text IN ('CANCELED','EXPIRED')
        ORDER BY oi.created_at, oi.order_intent_id`,
      [executionAccountId, chainId]);
    const exits: StockTerminalExitEvidence[] = [];
    for (const raw of result.rows as Record<string, unknown>[]) {
      const ordered = Number(raw.ordered), filled = Number(raw.filled);
      if (!Number.isFinite(ordered) || !Number.isFinite(filled) || ordered <= 0 || filled < 0) return { state: 'UNKNOWN' };
      if (filled >= ordered) continue;
      exits.push({ orderIntentId: String(raw.id), status: String(raw.status) as 'CANCELED' | 'EXPIRED',
        orderedQuantity: ordered, filledQuantity: filled });
    }
    return { state: 'KNOWN', exits };
  } catch {
    return { state: 'UNKNOWN' };
  }
}

export interface StockPartialExitChain {
  readonly chainId: string;
  readonly orderIntentIds: readonly string[];
  readonly filledQuantity: number;
  readonly orderedQuantity: number;
}

/**
 * Account-level, DB-only visibility feed (no broker evidence): chains with a terminal partial SELL_STOCK exit whose ledger lots are
 * still open, i.e. the ledger has not recorded the part sale. Used to keep the state loudly typed in every PENDING_ORDER_MANAGEMENT
 * cycle even while management selects a passive action. The management GATE is evaluateStockExitFreeze (it also needs broker truth).
 */
export async function listStockPartialExitChains(pool: Pick<Pool, 'query'>, executionAccountId: string):
Promise<{ readonly state: 'KNOWN'; readonly chains: readonly StockPartialExitChain[] } | { readonly state: 'UNKNOWN' }> {
  try {
    const result = await pool.query(
      `SELECT x.chain_id, x.id, x.ordered, x.filled FROM (
         SELECT oi.chain_id::text AS chain_id, oi.order_intent_id::text AS id, oi.quantity::float8 AS ordered,
           COALESCE((SELECT sum(f.quantity) FROM trade.broker_order bo JOIN trade.fill f ON f.broker_order_id=bo.broker_order_id
                      WHERE bo.order_intent_id=oi.order_intent_id),0)::float8 AS filled
           FROM trade.order_intent oi
          WHERE oi.execution_account_id=$1 AND oi.theta_action='SELL_STOCK' AND oi.chain_id IS NOT NULL
            AND oi.status::text IN ('CANCELED','EXPIRED')
            AND EXISTS(SELECT 1 FROM trade.stock_lot l WHERE l.chain_id=oi.chain_id AND l.disposed_at IS NULL)) x
       WHERE x.filled > 0 AND x.filled < x.ordered ORDER BY x.chain_id, x.id`, [executionAccountId]);
    const byChain = new Map<string, { ids: string[]; filled: number; ordered: number }>();
    for (const raw of result.rows as Record<string, unknown>[]) {
      const entry = byChain.get(String(raw.chain_id)) ?? { ids: [], filled: 0, ordered: 0 };
      entry.ids.push(String(raw.id)); entry.filled += Number(raw.filled); entry.ordered += Number(raw.ordered);
      byChain.set(String(raw.chain_id), entry);
    }
    return { state: 'KNOWN', chains: [...byChain.entries()].map(([chainId, value]) => ({ chainId, orderIntentIds: value.ids,
      filledQuantity: value.filled, orderedQuantity: value.ordered })) };
  } catch {
    return { state: 'UNKNOWN' };
  }
}

/**
 * Pure freeze decision. FROZEN when the chain has a terminal partial stock exit (0 < filled < ordered) and the account share
 * reconciliation is not RECONCILED, or when it has a terminal not-fully-filled stock exit and the ledger is ahead of the broker
 * (a part fill whose fill rows were not ingested yet looks exactly like this). It clears ONLY when broker and ledger shares agree.
 * Evidence that cannot be read is UNKNOWN, never CLEAR.
 */
export function evaluateStockExitFreeze(input: {
  readonly evidence: StockTerminalExitEvidenceState;
  readonly ledgerShares: number | null | undefined;
  readonly broker: BrokerStockInventoryEvidence | null | undefined;
  readonly reconciliationQuality: string | null;
  readonly now: string;
}): ManagementStockExitFreezeState {
  if (input.evidence.state !== 'KNOWN') return { state: 'UNKNOWN' };
  const exits = input.evidence.exits;
  if (exits.length === 0) return { state: 'CLEAR' };
  const reconciliation: StockShareReconciliation = reconcileStockShares({ ledgerShares: input.ledgerShares ?? null,
    broker: input.broker, reconciliationQuality: input.reconciliationQuality, now: input.now });
  const partial = exits.filter((exit) => exit.filledQuantity > 0);
  const frozen = (cause: 'PARTIAL_FILL_TERMINAL' | 'TERMINAL_EXIT_LEDGER_AHEAD_OF_BROKER'): ManagementStockExitFreezeState => ({
    state: 'FROZEN', code: stockPartialExitPendingReconciliation, cause, reconciliationReason: reconciliation.reason,
    blockClass: reconciliation.blockClass ?? 'REQUIRES_RECONCILIATION',
    orderIntentIds: exits.map((exit) => exit.orderIntentId),
    filledQuantity: partial.reduce((sum, exit) => sum + exit.filledQuantity, 0),
    orderedQuantity: partial.reduce((sum, exit) => sum + exit.orderedQuantity, 0),
    realizedPnlAttribution: 'UNKNOWN_PENDING_RECONCILIATION' });
  if (partial.length > 0 && reconciliation.state !== 'RECONCILED') return frozen('PARTIAL_FILL_TERMINAL');
  if (reconciliation.reason === 'LEDGER_AHEAD_OF_BROKER') return frozen('TERMINAL_EXIT_LEDGER_AHEAD_OF_BROKER');
  return { state: 'CLEAR' };
}
