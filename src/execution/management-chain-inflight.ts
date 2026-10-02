import type { Pool } from 'pg';
import type { AlpacaOpenOrderSnapshot, AlpacaPositionSnapshot } from '../theta/alpaca-provider.js';
import { deriveCommittedShortCallContracts } from '../theta/account-exposure.js';
import type { ManagementChainInFlightState } from './management-paper-plan-assembly.js';

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
 * plus our own non-terminal sell orders on calls of that underlying. Any external / unknown broker fact in the snapshot
 * makes the figure UNKNOWN (null), because an unseen open sell-to-open call order could be among them.
 */
export async function readCommittedShortCallContracts(pool: Pick<Pool, 'query'>, input: {
  readonly executionAccountId: string; readonly reconciliationSnapshotId: string; readonly underlying: string;
  readonly externalOrUnknownCount: number;
}): Promise<number | null> {
  if (input.externalOrUnknownCount !== 0) return null;
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
    return deriveCommittedShortCallContracts(input.underlying, positionRows, [...orderRows, ...planRows]);
  } catch {
    return null;
  }
}
