import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ThetaLifecycleState } from './runtime-state.js';
import type { ManagementActionFrontier } from './management-action-frontier.js';

export const managementInputVersion = 'theta-management-input-v1' as const;

export interface ManagementInputState {
  readonly contractVersion: typeof managementInputVersion;
  readonly managementInputSnapshotId: string;
  readonly reconciliationSnapshotId: string;
  readonly fusionSnapshotId: string | null;
  readonly chainId: string;
  readonly observedAt: string;
  readonly lifecycleState: ThetaLifecycleState;
  readonly underlying: string;
  readonly contract: {
    readonly optionLegId: string | null;
    readonly symbol: string | null;
    readonly optionType: 'PUT' | 'CALL' | null;
    readonly strike: number | null;
    readonly expiration: string | null;
    readonly multiplier: number | null;
    readonly contracts: number | null;
  };
  readonly economics: {
    readonly entryCreditDebit: number | null;
    readonly realizedOptionPnl: number;
    readonly unrealizedOptionPnl: number | null;
    readonly openStockShares: number;
    readonly stockBasisPerShare: number | null;
    readonly stockMarkPerShare: number | null;
    readonly unrealizedStockPnl: number | null;
    readonly realizedStockPnl: number;
    readonly dividends: number;
    readonly fees: number;
    readonly wholeChainPnl: number | null;
  };
  readonly market: {
    readonly spot: number | null;
    readonly optionBid: number | null;
    readonly optionAsk: number | null;
    readonly quoteTimestamp: string | null;
    readonly quoteFeed: string | null;
    readonly quoteQuality: string | null;
    readonly dte: number | null;
    readonly moneyness: number | null;
    readonly delta: number | null;
    readonly gamma: number | null;
    readonly theta: number | null;
    readonly vega: number | null;
    readonly iv: number | null;
  };
  readonly account: {
    readonly buyingPower: number | null;
    readonly optionsBuyingPower: number | null;
    readonly availableCapital: number | null;
  };
  readonly context: {
    readonly eventState: unknown | null;
    readonly dividendExDateState: unknown | null;
    readonly ownershipQuality: unknown | null;
    readonly assignmentCapacity: unknown | null;
    readonly recoveryState: unknown | null;
    readonly concentration: unknown | null;
    readonly sectorCorrelation: unknown | null;
    readonly aegisState: unknown | null;
    readonly executionState: unknown | null;
  };
  readonly unknownFields: readonly string[];
  readonly hardBlockers: readonly string[];
  readonly economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY';
  readonly contentHash: string;
}

type Row = Record<string, unknown>;

const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

const text = (value: unknown): string | null => value == null ? null : String(value);

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function daysToExpiration(expiration: string | null, observedAt: string): number | null {
  if (expiration === null) return null;
  const start = Date.parse(observedAt);
  const end = Date.parse(`${expiration.slice(0, 10)}T20:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - start) / 86_400_000));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export interface ManagementInputChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

const ignoredChangePaths = new Set([
  'managementInputSnapshotId', 'reconciliationSnapshotId', 'observedAt', 'contentHash',
]);

export function diffManagementInputs(previous: ManagementInputState | null,
  current: ManagementInputState): readonly ManagementInputChange[] {
  if (previous === null) return [{ path:'INITIAL_SNAPSHOT', before:null, after:'PRESENT' }];
  const changes: ManagementInputChange[] = [];
  const visit = (before: unknown, after: unknown, path: string): void => {
    if (ignoredChangePaths.has(path)) return;
    if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object' &&
        !Array.isArray(before) && !Array.isArray(after)) {
      const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
      for (const key of [...keys].sort()) visit((before as Record<string,unknown>)[key],
        (after as Record<string,unknown>)[key], path ? `${path}.${key}` : key);
      return;
    }
    if (canonicalJson(before) !== canonicalJson(after)) changes.push({ path,before:before ?? null,after:after ?? null });
  };
  visit(previous,current,'');
  return changes;
}

export function assembleManagementInput(row: Row, input: {
  readonly managementInputSnapshotId: string;
  readonly reconciliationSnapshotId: string;
  readonly observedAt: string;
}): ManagementInputState {
  const snapshot = object(row.snapshot_json);
  const position = object(row.broker_position);
  const contractSymbol = text(row.contract_symbol);
  const multiplier = numeric(row.multiplier);
  const contracts = numeric(row.quantity);
  const entryCreditDebit = numeric(row.entry_credit_debit);
  const bid = numeric(row.bid);
  const ask = numeric(row.ask);
  const stockShares = numeric(row.open_stock_shares) ?? 0;
  const stockBasis = numeric(row.stock_basis_per_share);
  const stockMark = numeric(position.currentPrice);
  const realizedOptionPnl = numeric(row.realized_option_pnl) ?? 0;
  const realizedStockPnl = numeric(row.realized_stock_pnl) ?? 0;
  const dividends = numeric(row.dividends) ?? 0;
  const fees = numeric(row.fees) ?? 0;
  const optionMark = entryCreditDebit !== null && ask !== null && multiplier !== null && contracts !== null
    ? entryCreditDebit - ask * multiplier * contracts : null;
  const stockMtm = stockShares === 0 ? 0
    : stockBasis !== null && stockMark !== null ? (stockMark - stockBasis) * stockShares : null;
  const hasOpenOption = contractSymbol !== null && contracts !== null && contracts > 0;
  const wholeChainPnl = (!hasOpenOption || optionMark !== null) && stockMtm !== null
    ? realizedOptionPnl + (optionMark ?? 0) + realizedStockPnl + stockMtm + dividends - fees : null;
  const expiration = text(row.expiration_date)?.slice(0, 10) ?? null;
  const spot = stockMark ?? numeric(snapshot.underlyingState && object(snapshot.underlyingState).last);
  const strike = numeric(row.strike);
  const unknownFields: string[] = [];
  const required = (name: string, value: unknown): void => { if (value === null || value === undefined) unknownFields.push(name); };
  if (hasOpenOption) {
    required('contract.multiplier', multiplier);
    required('market.optionBid', bid);
    required('market.optionAsk', ask);
    required('market.quoteTimestamp', row.quote_as_of);
    required('market.delta', null);
    required('market.gamma', null);
    required('market.theta', null);
    required('market.vega', null);
    required('market.iv', null);
  }
  if (stockShares > 0) required('economics.stockMarkPerShare', stockMark);
  required('account.buyingPower', row.buying_power);
  required('account.optionsBuyingPower', row.options_buying_power);
  required('context.eventState', snapshot.eventState ?? null);
  required('context.dividendExDateState', null);
  required('context.ownershipQuality', snapshot.expertPriorState ?? null);
  required('context.assignmentCapacity', object(snapshot.riskState).assignmentCapacity ?? null);
  required('context.concentration', object(snapshot.portfolioExposure).concentration ?? null);
  required('context.sectorCorrelation', object(snapshot.portfolioExposure).sectorCorrelation ?? null);
  required('context.aegisState', snapshot.riskState ?? null);
  required('context.executionState', null);
  if (row.fusion_snapshot_id == null) unknownFields.push('fusionSnapshotId');

  const hardBlockers: string[] = [];
  if (hasOpenOption && multiplier === null) hardBlockers.push('MULTIPLIER_UNKNOWN');
  if (hasOpenOption && (bid === null || ask === null || row.quote_as_of == null)) hardBlockers.push('EXECUTABLE_QUOTE_UNAVAILABLE');
  if (hasOpenOption && text(row.quote_quality) !== 'GOOD') hardBlockers.push('BROKER_DATA_INVALID');
  const quoteAgeMs = row.quote_as_of == null ? null : Date.parse(input.observedAt) - Date.parse(String(row.quote_as_of));
  if (quoteAgeMs !== null && (!Number.isFinite(quoteAgeMs) || quoteAgeMs < 0 || quoteAgeMs > 30_000)) {
    hardBlockers.push('BROKER_DATA_STALE');
  }
  const accountAgeMs = row.account_as_of == null ? null : Date.parse(input.observedAt) - Date.parse(String(row.account_as_of));
  if (accountAgeMs !== null && (!Number.isFinite(accountAgeMs) || accountAgeMs < 0 || accountAgeMs > 180_000)) {
    hardBlockers.push('BROKER_DATA_STALE');
  }
  if (contracts !== null && contracts < 0) hardBlockers.push('INVALID_CONTRACT');
  if (row.lifecycle_state == null) hardBlockers.push('LIFECYCLE_TRUTH_BROKEN');

  const unsigned = {
    contractVersion: managementInputVersion,
    managementInputSnapshotId: input.managementInputSnapshotId,
    reconciliationSnapshotId: input.reconciliationSnapshotId,
    fusionSnapshotId: text(row.fusion_snapshot_id), chainId: String(row.chain_id), observedAt: input.observedAt,
    lifecycleState: String(row.lifecycle_state) as ThetaLifecycleState, underlying: String(row.underlying),
    contract: { optionLegId: text(row.option_leg_id), symbol: contractSymbol,
      optionType: text(row.option_type) as 'PUT' | 'CALL' | null, strike, expiration, multiplier, contracts },
    economics: { entryCreditDebit, realizedOptionPnl, unrealizedOptionPnl: hasOpenOption ? optionMark : 0,
      openStockShares: stockShares, stockBasisPerShare: stockBasis, stockMarkPerShare: stockMark,
      unrealizedStockPnl: stockMtm, realizedStockPnl, dividends, fees, wholeChainPnl },
    market: { spot, optionBid: bid, optionAsk: ask, quoteTimestamp: text(row.quote_as_of),
      quoteFeed: text(row.feed), quoteQuality: text(row.quote_quality), dte: daysToExpiration(expiration, input.observedAt),
      moneyness: spot !== null && strike !== null && spot > 0 ? strike / spot : null,
      delta: null, gamma: null, theta: null, vega: null, iv: null },
    account: { buyingPower: numeric(row.buying_power), optionsBuyingPower: numeric(row.options_buying_power),
      availableCapital: numeric(row.options_buying_power) ?? numeric(row.buying_power) },
    context: { eventState: snapshot.eventState ?? null, dividendExDateState: null,
      ownershipQuality: snapshot.expertPriorState ?? null,
      assignmentCapacity: object(snapshot.riskState).assignmentCapacity ?? null,
      recoveryState: snapshot.recoveryState ?? null,
      concentration: object(snapshot.portfolioExposure).concentration ?? null,
      sectorCorrelation: object(snapshot.portfolioExposure).sectorCorrelation ?? null,
      aegisState: snapshot.riskState ?? null, executionState: null },
    unknownFields: [...new Set(unknownFields)].sort(), hardBlockers: [...new Set(hardBlockers)].sort(),
    economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY' as const,
  };
  const hashable = Object.fromEntries(
    Object.entries(unsigned).filter(([key]) => key !== 'managementInputSnapshotId'),
  );
  return { ...unsigned, contentHash: createHash('sha256').update(canonicalJson(hashable)).digest('hex') };
}

export class PostgresManagementInputStore {
  constructor(private readonly pool: Pool) {}

  async assembleAndPersistOpenChains(connectionId: string, reconciliationSnapshotId: string, observedAt: string): Promise<readonly ManagementInputState[]> {
    const result = await this.pool.query(`
      SELECT ec.chain_id,ec.lifecycle_state,u.symbol AS underlying,
        ol.option_leg_id,ol.quantity,ol.entry_credit_debit,oc.contract_symbol,oc.option_type,
        oc.strike,oc.expiration_date,oc.multiplier,
        oq.bid,oq.ask,oq.as_of AS quote_as_of,oq.feed,oq.quality AS quote_quality,
        totals.realized_option_pnl,stocks.open_stock_shares,stocks.stock_basis_per_share,
        totals.realized_stock_pnl,totals.dividends,totals.fees,
        a.buying_power,a.options_buying_power,a.as_of AS account_as_of,fs.fusion_snapshot_id,fs.snapshot_json,
        CASE WHEN bp.symbol IS NULL THEN NULL ELSE jsonb_build_object(
          'averageEntryPrice',bp.average_entry_price,'currentPrice',bp.current_price,
          'marketValue',bp.market_value,'costBasis',bp.cost_basis,'unrealizedPnl',bp.unrealized_pnl
        ) END AS broker_position
      FROM trade.economic_chain ec
      JOIN market.underlying u ON u.underlying_id=ec.underlying_id
      JOIN core.bot_instance bi ON bi.bot_instance_id=ec.bot_instance_id
      JOIN trade.broker_reconciliation_snapshot brs
        ON brs.reconciliation_snapshot_id=$2 AND brs.connection_id=$1
      LEFT JOIN LATERAL (
        SELECT l.* FROM trade.option_leg l WHERE l.chain_id=ec.chain_id AND l.closed_at IS NULL
        ORDER BY l.opened_at DESC LIMIT 1
      ) ol ON true
      LEFT JOIN market.option_contract oc ON oc.option_contract_id=ol.option_contract_id
      LEFT JOIN LATERAL (
        SELECT q.* FROM market.option_quote_snapshot q WHERE q.option_contract_id=oc.option_contract_id
        ORDER BY q.as_of DESC LIMIT 1
      ) oq ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(l.realized_pnl),0) AS realized_option_pnl,
          COALESCE((SELECT sum(s.realized_pnl) FROM trade.stock_lot s WHERE s.chain_id=ec.chain_id),0) AS realized_stock_pnl,
          COALESCE((SELECT sum(d.amount_per_share*s.shares) FROM trade.dividend_event d JOIN trade.stock_lot s ON s.stock_lot_id=d.stock_lot_id WHERE s.chain_id=ec.chain_id),0) AS dividends,
          COALESCE((SELECT sum(f.amount) FROM trade.fee_event f WHERE f.chain_id=ec.chain_id),0) AS fees
        FROM trade.option_leg l WHERE l.chain_id=ec.chain_id
      ) totals ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(s.shares),0) AS open_stock_shares,
          CASE WHEN sum(s.shares)>0 THEN sum(s.economic_basis_per_share*s.shares)/sum(s.shares) END AS stock_basis_per_share
        FROM trade.stock_lot s WHERE s.chain_id=ec.chain_id AND s.disposed_at IS NULL
      ) stocks ON true
      LEFT JOIN LATERAL (
        SELECT s.* FROM trade.account_snapshot s WHERE s.account_id=bi.account_id ORDER BY s.as_of DESC LIMIT 1
      ) a ON true
      LEFT JOIN LATERAL (
        SELECT f.* FROM trade.fusion_snapshot f WHERE f.bot_instance_id=bi.bot_instance_id ORDER BY f.decision_time DESC LIMIT 1
      ) fs ON true
      LEFT JOIN trade.broker_position_snapshot bp ON bp.reconciliation_snapshot_id=$2 AND bp.symbol=u.symbol
      WHERE ec.closed_at IS NULL ORDER BY ec.opened_at,ec.chain_id`, [connectionId, reconciliationSnapshotId]);
    const states: ManagementInputState[] = result.rows.map((row) => assembleManagementInput(row, {
      managementInputSnapshotId: randomUUID(), reconciliationSnapshotId, observedAt,
    }));
    if (states.length === 0) return [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let index = 0; index < states.length; index += 1) {
        let state = states[index];
        if (state === undefined) throw new Error('MANAGEMENT_INPUT_INDEX_INVALID');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [state.chainId]);
        const previous = await client.query(
          `SELECT management_input_snapshot_id,input_json,content_hash FROM trade.management_input_snapshot
           WHERE chain_id=$1 ORDER BY observed_at DESC,created_at DESC LIMIT 1`, [state.chainId],
        );
        const previousState = previous.rowCount === 1 ? previous.rows[0].input_json as ManagementInputState : null;
        if (previous.rows[0]?.content_hash === state.contentHash) {
          state = { ...state, managementInputSnapshotId:String(previous.rows[0].management_input_snapshot_id) };
          states[index] = state;
          continue;
        }
        const changes = diffManagementInputs(previousState,state);
        await client.query(
        `INSERT INTO trade.management_input_snapshot(
          management_input_snapshot_id,previous_management_input_snapshot_id,reconciliation_snapshot_id,
          fusion_snapshot_id,chain_id,observed_at,lifecycle_state,input_json,unknown_fields_json,change_json,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)
         ON CONFLICT(chain_id,content_hash) DO NOTHING`,
        [state.managementInputSnapshotId,previous.rows[0]?.management_input_snapshot_id ?? null,
          state.reconciliationSnapshotId,state.fusionSnapshotId,state.chainId,state.observedAt,state.lifecycleState,
          JSON.stringify(state),JSON.stringify(state.unknownFields),JSON.stringify(changes),state.contentHash],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    return states;
  }

  async persistFrontiers(states: readonly ManagementInputState[], frontiers: readonly ManagementActionFrontier[]): Promise<void> {
    if (states.length !== frontiers.length) throw new Error('MANAGEMENT_FRONTIER_INPUT_COUNT_MISMATCH');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (let index = 0; index < states.length; index += 1) {
        const state = states[index];
        const frontier = frontiers[index];
        if (state === undefined || frontier === undefined || state.chainId !== frontier.chainId) {
          throw new Error('MANAGEMENT_FRONTIER_CHAIN_MISMATCH');
        }
        const payload = canonicalJson(frontier);
        await client.query(
          `INSERT INTO trade.management_action_frontier(
            management_action_frontier_id,management_input_snapshot_id,chain_id,observed_at,lifecycle_state,
            economic_model_state,actions_json,selected_action,second_best_action,decision_state,reason_codes_json,content_hash)
           VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12)
           ON CONFLICT(management_input_snapshot_id,content_hash) DO NOTHING`,
          [randomUUID(),state.managementInputSnapshotId,state.chainId,state.observedAt,state.lifecycleState,
            frontier.economicModelState,JSON.stringify(frontier.actions),frontier.selectedAction,
            frontier.secondBestAction,frontier.decisionState,JSON.stringify(frontier.reasonCodes),
            createHash('sha256').update(payload).digest('hex')],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}
