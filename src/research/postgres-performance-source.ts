// Read-only Postgres source for the performance dashboard: one row per broker-ledger economic chain, using the same
// ledger tables as src/research/outcome-resolver.ts (option_leg, stock_lot, dividend_event, fee_event, fill). It runs
// inside a READ ONLY transaction and never writes. Capital is the largest short-put collateral of the chain
// (strike x multiplier x quantity); capital-days = that collateral x chain days (labelled approximation).

import type { Pool } from 'pg';
import type { PerformanceEpisode } from './performance-analytics-dashboard.js';

export const performanceEpisodeSql = `SELECT ec.chain_id::text AS episode_id, ec.chain_kind, ec.opened_at, ec.closed_at,
  (SELECT d.strategy_branch FROM trade.order_intent oi JOIN trade.decision d ON d.decision_id = oi.decision_id
     WHERE oi.chain_id = ec.chain_id ORDER BY oi.created_at LIMIT 1) AS strategy,
  (SELECT d.policy_version FROM trade.order_intent oi JOIN trade.decision d ON d.decision_id = oi.decision_id
     WHERE oi.chain_id = ec.chain_id ORDER BY oi.created_at LIMIT 1) AS strategy_version,
  COALESCE((SELECT sum(ol.realized_pnl) FROM trade.option_leg ol WHERE ol.chain_id = ec.chain_id), 0)::text AS option_pnl,
  COALESCE((SELECT sum(sl.realized_pnl) FROM trade.stock_lot sl WHERE sl.chain_id = ec.chain_id), 0)::text AS stock_pnl,
  COALESCE((SELECT sum(de.amount_per_share * sl.shares) FROM trade.dividend_event de JOIN trade.stock_lot sl USING (stock_lot_id)
     WHERE sl.chain_id = ec.chain_id), 0)::text AS dividends,
  COALESCE((SELECT sum(fe.amount) FROM trade.fee_event fe WHERE fe.chain_id = ec.chain_id), 0)::text AS fees,
  NOT EXISTS (SELECT 1 FROM trade.fill f JOIN trade.broker_order bo ON bo.broker_order_id = f.broker_order_id
     JOIN trade.order_intent oi ON oi.order_intent_id = bo.order_intent_id WHERE oi.chain_id = ec.chain_id AND f.fees IS NULL) AS fees_known,
  NOT EXISTS (SELECT 1 FROM trade.option_leg ol WHERE ol.chain_id = ec.chain_id AND (ol.closed_at IS NULL OR ol.realized_pnl IS NULL)) AS legs_resolved,
  NOT EXISTS (SELECT 1 FROM trade.stock_lot sl WHERE sl.chain_id = ec.chain_id AND (sl.disposed_at IS NULL OR sl.realized_pnl IS NULL)) AS lots_resolved,
  EXISTS (SELECT 1 FROM trade.option_leg ol WHERE ol.chain_id = ec.chain_id AND ol.close_reason = 'ASSIGNED') AS assigned,
  (SELECT max(oc.strike * oc.multiplier * ol.quantity) FROM trade.option_leg ol JOIN market.option_contract oc USING (option_contract_id)
     WHERE ol.chain_id = ec.chain_id AND ol.side = 'SHORT' AND oc.option_type = 'PUT')::text AS collateral
  FROM trade.economic_chain ec
  WHERE ec.opened_at >= $1::timestamptz
  ORDER BY ec.opened_at, ec.chain_id`;

export interface PerformanceEpisodeRow {
  readonly episode_id: string; readonly chain_kind: string; readonly opened_at: Date | string; readonly closed_at: Date | string | null;
  readonly strategy: string | null; readonly strategy_version: string | null; readonly option_pnl: string; readonly stock_pnl: string;
  readonly dividends: string; readonly fees: string; readonly fees_known: boolean; readonly legs_resolved: boolean; readonly lots_resolved: boolean;
  readonly assigned: boolean; readonly collateral: string | null;
}

const iso = (v: Date | string | null) => v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/** Maps a ledger row; an unresolved or fee-unknown chain has null P&L (never a fabricated zero). */
export function performanceEpisodeFromRow(row: PerformanceEpisodeRow): PerformanceEpisode {
  const closedAt = iso(row.closed_at); const openedAt = iso(row.opened_at) as string;
  const resolved = closedAt !== null && row.legs_resolved && row.lots_resolved && row.fees_known;
  const gross = Number(row.option_pnl) + Number(row.stock_pnl) + Number(row.dividends);
  const fees = Number(row.fees);
  const collateral = row.collateral === null ? null : Number(row.collateral);
  const days = closedAt === null ? null : (Date.parse(closedAt) - Date.parse(openedAt)) / 86_400_000;
  return {
    episodeId: row.episode_id, strategy: row.strategy ?? `UNKNOWN_STRATEGY:${row.chain_kind}`, strategyVersion: row.strategy_version ?? 'UNKNOWN_VERSION',
    regime: null, openedAt, closedAt: resolved ? closedAt : null, netPnlUsd: resolved ? gross - fees : null, grossPnlUsd: resolved ? gross : null,
    feesUsd: row.fees_known ? fees : null, slippageUsd: null, capitalRequiredUsd: collateral,
    capitalDays: collateral === null || days === null ? null : collateral * days, assigned: row.assigned,
    calledAway: null, evidenceSource: 'BROKER_CONFIRMED_FILLS',
  };
}

export async function loadPerformanceEpisodes(pool: Pool, since: string): Promise<readonly PerformanceEpisode[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const result = await client.query<PerformanceEpisodeRow>(performanceEpisodeSql, [since]);
    await client.query('COMMIT');
    return result.rows.map(performanceEpisodeFromRow);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
