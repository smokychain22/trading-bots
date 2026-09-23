import type { Pool, PoolClient } from 'pg';
import { withRuntimePostgresTransaction } from './runtime-postgres-client.js';
import {
  componentsFromEvidence,
  knownField,
  unknownField,
  wholeChainComponentEvidenceVersion,
  wholeChainEvidenceHash,
  type StockLotBasisReference,
  type WholeChainComponentEvidence,
  type WholeChainEvidenceField,
  type WholeChainEvidenceSource,
} from './whole-chain-component-evidence.js';

type Row = Record<string, unknown>;

export interface WholeChainLoadContext {
  readonly connectionId: string;
  readonly reconciliationSnapshotId?: string | null;
}

const text = (value: unknown): string | null => value == null ? null : String(value);
const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const sortedIds = (rows: readonly Row[], key: string): readonly string[] => rows.map((row) => String(row[key])).toSorted();
const latestObservedAt = (rows: readonly Row[], key: string): string | null => rows.map((row) => text(row[key]))
  .map((value) => iso(value)).filter((value): value is string => value !== null).toSorted().at(-1) ?? null;

const source = (relation: string, columns: readonly string[], rows: readonly Row[], id: string,
  observedAt: string): WholeChainEvidenceSource => ({
  relation,
  columns,
  recordIds: sortedIds(rows, id),
  observedAt: latestObservedAt(rows, observedAt),
});

const checkedAsOf = (asOf: string): string => {
  const parsed = Date.parse(asOf);
  if (!Number.isFinite(parsed)) throw new Error('WHOLE_CHAIN_AS_OF_INVALID');
  return new Date(parsed).toISOString();
};

const dollarAggregate = (rows: readonly Row[], key: string): number | null => {
  const values = rows.map((row) => number(row[key]));
  return values.every((value): value is number => value !== null) ? sum(values) : null;
};

/**
 * Read-only, point-in-time projection over the canonical lifecycle ledger.
 * It never writes accounting state and never chooses a management action.
 */
export class PostgresWholeChainComponentsRepository {
  constructor(private readonly pool: Pool) {}

  async load(chainId: string, asOfInput: string, context: WholeChainLoadContext): Promise<WholeChainComponentEvidence> {
    const asOf = checkedAsOf(asOfInput);
    if (!chainId.trim() || !context.connectionId.trim()) throw new Error('WHOLE_CHAIN_IDENTITY_REQUIRED');
    return withRuntimePostgresTransaction(this.pool, async (client) => {
      const evidence = await this.loadInTransaction(client, chainId, asOf, context);
      return evidence;
    }, { beginSql: 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' });
  }

  private async loadInTransaction(client: PoolClient, chainId: string, asOf: string,
    context: WholeChainLoadContext): Promise<WholeChainComponentEvidence> {
    const chainResult = await client.query(`SELECT ec.chain_id,ec.opened_at,ec.closed_at,ec.underlying_id,u.symbol,b.account_id
      FROM trade.economic_chain ec JOIN market.underlying u ON u.underlying_id=ec.underlying_id
      JOIN core.bot_instance b ON b.bot_instance_id=ec.bot_instance_id
      JOIN core.trading_account a ON a.account_id=b.account_id AND a.environment='PAPER'
      JOIN core.provider_connection pc ON pc.provider_connection_id=a.provider_connection_id
        AND pc.provider_code='ALPACA' AND pc.environment='PAPER'
      JOIN copy.follower_account fa ON fa.provider_account_ref=a.provider_account_id
        AND fa.follower_account_id=$3 AND fa.environment='PAPER'
        AND fa.account_role='MASTER_THETA_PAPER' AND fa.disconnected_at IS NULL
      WHERE ec.chain_id=$1 AND ec.opened_at <= $2`, [chainId, asOf,context.connectionId]);
    if (chainResult.rowCount !== 1) throw new Error('WHOLE_CHAIN_NOT_FOUND_AT_AS_OF');
    const chain = chainResult.rows[0] as Row;
    const inventory = await client.query(`SELECT COALESCE(sum(sl.shares),0) AS shares
      FROM trade.stock_lot sl JOIN trade.economic_chain ec ON ec.chain_id=sl.chain_id
      JOIN core.bot_instance b ON b.bot_instance_id=ec.bot_instance_id
      WHERE b.account_id=$1 AND sl.underlying_id=$2 AND sl.acquired_at <= $3
        AND (sl.disposed_at IS NULL OR sl.disposed_at > $3)`,[chain.account_id,chain.underlying_id,asOf]);

    const [legsResult, assignmentsResult, expirationsResult, lotsResult, dividendsResult, feeEventsResult,
      fillsResult, tcaResult, markResult] = await Promise.all([
      client.query(`SELECT l.option_leg_id,l.option_contract_id,l.side,l.quantity,l.entry_price_per_share,
          l.entry_credit_debit,l.opened_at,
          CASE WHEN l.closed_at <= $2 THEN l.closed_at END AS closed_at,
          CASE WHEN l.closed_at <= $2 THEN l.close_reason END AS close_reason,
          CASE WHEN l.closed_at <= $2 THEN l.close_price_per_share END AS close_price_per_share,
          CASE WHEN l.closed_at <= $2 THEN l.realized_pnl END AS realized_pnl,
          l.rolled_from_option_leg_id,
          COALESCE(pc.partial_closing_debit,0) AS partial_closing_debit,
          CASE WHEN l.closed_at <= $2 AND EXISTS(SELECT 1 FROM trade.option_leg successor
            WHERE successor.option_leg_id=l.rolled_to_option_leg_id AND successor.opened_at <= $2)
            THEN l.rolled_to_option_leg_id END AS rolled_to_option_leg_id,
          oc.option_type,oc.multiplier
        FROM trade.option_leg l JOIN market.option_contract oc ON oc.option_contract_id=l.option_contract_id
        LEFT JOIN LATERAL(SELECT sum(p.closing_debit) AS partial_closing_debit
          FROM trade.option_partial_close_realization p WHERE p.option_leg_id=l.option_leg_id AND p.occurred_at <= $2) pc ON true
        WHERE l.chain_id=$1 AND l.opened_at <= $2 ORDER BY l.opened_at,l.option_leg_id`, [chainId, asOf]),
      client.query(`SELECT ae.assignment_event_id,ae.option_leg_id,ae.stock_lot_id,ae.assigned_at,ae.shares,
          ae.strike_price,oc.option_type
        FROM trade.assignment_event ae JOIN trade.option_leg l ON l.option_leg_id=ae.option_leg_id
        JOIN market.option_contract oc ON oc.option_contract_id=l.option_contract_id
        WHERE l.chain_id=$1 AND ae.assigned_at <= $2 ORDER BY ae.assigned_at,ae.assignment_event_id`, [chainId, asOf]),
      client.query(`SELECT ee.expiration_event_id,ee.option_leg_id,ee.expired_at,ee.itm
        FROM trade.expiration_event ee JOIN trade.option_leg l ON l.option_leg_id=ee.option_leg_id
        WHERE l.chain_id=$1 AND ee.expired_at <= $2 ORDER BY ee.expired_at,ee.expiration_event_id`, [chainId, asOf]),
      client.query(`SELECT stock_lot_id,shares,economic_basis_per_share,broker_basis_per_share,
          assignment_option_leg_id,acquired_at,
          CASE WHEN disposed_at <= $2 THEN disposed_at END AS disposed_at,
          CASE WHEN disposed_at <= $2 THEN disposed_price_per_share END AS disposed_price_per_share,
          CASE WHEN disposed_at <= $2 THEN realized_pnl END AS realized_pnl
        FROM trade.stock_lot WHERE chain_id=$1 AND acquired_at <= $2 ORDER BY acquired_at,stock_lot_id`, [chainId, asOf]),
      client.query(`SELECT de.dividend_event_id,de.stock_lot_id,de.ex_date,de.amount_per_share,de.created_at,sl.shares
        FROM trade.dividend_event de JOIN trade.stock_lot sl ON sl.stock_lot_id=de.stock_lot_id
        WHERE sl.chain_id=$1 AND de.created_at <= $2 AND de.ex_date <= ($2::timestamptz)::date
        ORDER BY de.ex_date,de.dividend_event_id`, [chainId, asOf]),
      client.query(`SELECT fee_event_id,fee_type,amount,incurred_at FROM trade.fee_event
        WHERE chain_id=$1 AND incurred_at <= $2 ORDER BY incurred_at,fee_event_id`, [chainId, asOf]),
      client.query(`SELECT f.fill_id,f.fees,f.filled_at,oi.order_intent_id
        FROM trade.fill f JOIN trade.broker_order bo ON bo.broker_order_id=f.broker_order_id
        JOIN trade.order_intent oi ON oi.order_intent_id=bo.order_intent_id
        WHERE oi.chain_id=$1 AND f.filled_at <= $2 ORDER BY f.filled_at,f.fill_id`, [chainId, asOf]),
      client.query(`SELECT oi.order_intent_id,tca.transaction_cost_analysis_id,tca.calculated_at,tca.slippage_dollars,
          tca.unknown_reasons_json
        FROM trade.order_intent oi
        JOIN LATERAL (SELECT max(f.filled_at) AS last_fill_at FROM trade.broker_order bo
          JOIN trade.fill f ON f.broker_order_id=bo.broker_order_id
          WHERE bo.order_intent_id=oi.order_intent_id AND f.filled_at <= $2) filled ON filled.last_fill_at IS NOT NULL
        LEFT JOIN trade.transaction_cost_analysis tca ON tca.order_intent_id=oi.order_intent_id
          AND tca.calculated_at <= $2
        WHERE oi.chain_id=$1 ORDER BY oi.order_intent_id`, [chainId, asOf]),
      client.query(`SELECT brs.reconciliation_snapshot_id,brs.observed_at,brs.provider_timestamp,brs.data_quality,
          brs.position_count,bp.quantity,bp.current_price,bp.payload_hash
        FROM trade.broker_reconciliation_snapshot brs
        LEFT JOIN trade.broker_position_snapshot bp ON bp.reconciliation_snapshot_id=brs.reconciliation_snapshot_id
          AND bp.connection_id=brs.connection_id AND bp.symbol=$4
        WHERE brs.connection_id=$1 AND brs.observed_at <= $2
          AND ($3::uuid IS NULL OR brs.reconciliation_snapshot_id=$3)
        ORDER BY brs.observed_at DESC,brs.reconciliation_snapshot_id DESC LIMIT 1`,
      [context.connectionId, asOf, context.reconciliationSnapshotId ?? null, String(chain.symbol)]),
    ]);

    const legs = legsResult.rows as Row[];
    const assignments = assignmentsResult.rows as Row[];
    const expirations = expirationsResult.rows as Row[];
    const lots = lotsResult.rows as Row[];
    const dividends = dividendsResult.rows as Row[];
    const feeEvents = feeEventsResult.rows as Row[];
    const fills = fillsResult.rows as Row[];
    const tcaRows = tcaResult.rows as Row[];
    const markRows = markResult.rows as Row[];

    const originalPuts = legs.filter((row) => row.side === 'SHORT' && row.option_type === 'PUT'
      && row.rolled_from_option_leg_id == null);
    const initialPutPremium = this.singlePremium(originalPuts, asOf, 'INITIAL_PUT_LEG_MISSING_OR_AMBIGUOUS');
    const putCloseCosts = this.putCloseCosts(legs, asOf);

    const rolledPuts = legs.filter((row) => row.side === 'SHORT' && row.option_type === 'PUT'
      && row.rolled_from_option_leg_id != null);
    const putRollLinksValid = this.rollLinksValid(legs, 'PUT', asOf);
    const rollCredits = putRollLinksValid
      ? this.sumPremiums(rolledPuts, asOf, 'ROLL_OPEN_CREDIT_INCOMPLETE')
      : unknownField<number>(asOf, ['PUT_ROLL_LINEAGE_INVALID']);
    const rolledOldPuts = legs.filter((row) => row.side === 'SHORT' && row.option_type === 'PUT'
      && row.close_reason === 'ROLLED' && iso(row.closed_at) !== null && (iso(row.closed_at) as string) <= asOf);
    const rollCloseCosts = this.sumCloseCosts(rolledOldPuts, asOf, 'ROLL_CLOSE_COST_INCOMPLETE');

    const putAssignments = assignments.filter((row) => row.option_type === 'PUT');
    const assignment = this.assignmentEvidence(putAssignments, lots, asOf);

    const openLots = lots.filter((row) => row.disposed_at == null || (iso(row.disposed_at) ?? '') > asOf);
    const openShareValues = openLots.map((row) => number(row.shares));
    const lifecycleOpenShares = openShareValues.every((value): value is number => value !== null)
      ? knownField(sum(openShareValues), asOf, [source('trade.stock_lot', ['shares','acquired_at','disposed_at'], openLots,
        'stock_lot_id', 'acquired_at')])
      : unknownField<number>(asOf, ['OPEN_STOCK_SHARES_INVALID']);
    const openStockShares = this.reconcileOpenShares(lifecycleOpenShares, markRows, asOf,number(inventory.rows[0]?.shares));

    const calls = legs.filter((row) => row.side === 'SHORT' && row.option_type === 'CALL');
    const coveredCallPremium = this.sumPremiums(calls, asOf, 'COVERED_CALL_OPEN_CREDIT_INCOMPLETE');
    const coveredCallCloseCosts = this.rollLinksValid(legs, 'CALL', asOf)
      ? this.coveredCallCloseCosts(calls, assignments, expirations, asOf)
      : unknownField<number>(asOf, ['COVERED_CALL_ROLL_LINEAGE_INVALID']);
    const stockExit = this.stockExitEvidence(lots, assignment.stockSharesAssigned, openStockShares, asOf);
    const dividendEvidence = this.dividendEvidence(dividends, asOf);
    const feeEvidence = this.feeEvidence(fills, feeEvents, asOf);
    const tcaExecutionShortfall = this.slippageEvidence(tcaRows, asOf);
    const stockMark = this.stockMarkEvidence(markRows, openStockShares, asOf);
    const stockLotBasisReferences = this.stockLotReferences(lots);

    const unsigned = {
      contractVersion: wholeChainComponentEvidenceVersion,
      chainId,
      asOf,
      initialPutPremium,
      putCloseCosts,
      rollCredits,
      rollCloseCosts,
      assignmentStrike: assignment.assignmentStrike,
      stockSharesAssigned: assignment.stockSharesAssigned,
      assignmentObservedAt: assignment.assignmentObservedAt,
      dividends: dividendEvidence,
      coveredCallPremium,
      coveredCallCloseCosts,
      stockSaleOrCallAwayProceeds: stockExit,
      fees: feeEvidence,
      tcaExecutionShortfall,
      currentStockMarkPerShare: stockMark,
      openStockShares,
      stockLotBasisReferences,
    };
    const conversion = componentsFromEvidence(unsigned);
    const withoutHash = { ...unsigned, components: conversion.components, componentBlockers: conversion.blockers };
    return { ...withoutHash, contentHash: wholeChainEvidenceHash(withoutHash) };
  }

  private singlePremium(rows: readonly Row[], asOf: string, invalidReason: string): WholeChainEvidenceField<number> {
    const evidenceSource = source('trade.option_leg', ['entry_credit_debit','side','opened_at','rolled_from_option_leg_id'],
      rows, 'option_leg_id', 'opened_at');
    if (rows.length !== 1) return unknownField(asOf, [invalidReason], rows.length > 0 ? [evidenceSource] : []);
    const value = number(rows[0]?.entry_credit_debit);
    return value === null ? unknownField(asOf, [invalidReason], [evidenceSource]) : knownField(value, asOf, [evidenceSource]);
  }

  private sumPremiums(rows: readonly Row[], asOf: string, invalidReason: string): WholeChainEvidenceField<number> {
    const evidenceSource = source('trade.option_leg', ['entry_credit_debit','side','opened_at'], rows,
      'option_leg_id', 'opened_at');
    if (rows.length === 0) return knownField(0, asOf, [evidenceSource], ['NO_MATCHING_OPENING_LEGS']);
    const value = dollarAggregate(rows, 'entry_credit_debit');
    return value === null ? unknownField(asOf, [invalidReason], [evidenceSource]) : knownField(value, asOf, [evidenceSource]);
  }

  private putCloseCosts(rows: readonly Row[],asOf:string):WholeChainEvidenceField<number>{
    const puts=rows.filter((row)=>row.side==='SHORT'&&row.option_type==='PUT');
    const evidenceSource=source('trade.option_leg + trade.option_partial_close_realization',
      ['close_price_per_share','quantity','close_reason','partial_closing_debit'],puts,'option_leg_id','closed_at');
    const costs=puts.map((row)=>{
      const reason=text(row.close_reason),partial=number(row.partial_closing_debit)??0;
      if(reason==='BTC_CLOSE'){
        const close=number(row.close_price_per_share),quantity=number(row.quantity),multiplier=number(row.multiplier);
        return close===null||quantity===null||multiplier===null?null:close*quantity*multiplier;
      }
      if(reason==='ROLLED')return 0;
      return partial;
    });
    return costs.every((value):value is number=>value!==null)
      ?knownField(sum(costs),asOf,[evidenceSource])
      :unknownField(asOf,['PUT_CLOSE_COST_INCOMPLETE'],[evidenceSource]);
  }

  private sumCloseCosts(rows: readonly Row[], asOf: string, invalidReason: string): WholeChainEvidenceField<number> {
    const evidenceSource = source('trade.option_leg', ['close_price_per_share','quantity','close_reason','closed_at'],
      rows, 'option_leg_id', 'closed_at');
    if (rows.length === 0) return knownField(0, asOf, [evidenceSource], ['NO_MATCHING_CLOSE_LEGS']);
    const costs = rows.map((row) => {
      const close = number(row.close_price_per_share), quantity = number(row.quantity), multiplier = number(row.multiplier);
      return close === null || quantity === null || multiplier === null ? null : close * quantity * multiplier;
    });
    return costs.every((value): value is number => value !== null)
      ? knownField(sum(costs), asOf, [evidenceSource])
      : unknownField(asOf, [invalidReason], [evidenceSource]);
  }

  private assignmentEvidence(assignments: readonly Row[], lots: readonly Row[], asOf: string): {
    readonly assignmentStrike: WholeChainEvidenceField<number>;
    readonly stockSharesAssigned: WholeChainEvidenceField<number>;
    readonly assignmentObservedAt: WholeChainEvidenceField<string>;
  } {
    const assignmentSource = source('trade.assignment_event', ['strike_price','shares','assigned_at','stock_lot_id'],
      assignments, 'assignment_event_id', 'assigned_at');
    if (assignments.length === 0) return {
      assignmentStrike: unknownField(asOf, ['NO_PUT_ASSIGNMENT_AS_OF'], [assignmentSource]),
      stockSharesAssigned: knownField(0, asOf, [assignmentSource], ['NO_PUT_ASSIGNMENT_AS_OF']),
      assignmentObservedAt: unknownField(asOf, ['NO_PUT_ASSIGNMENT_AS_OF'], [assignmentSource]),
    };
    const strikes = assignments.map((row) => number(row.strike_price));
    const shares = assignments.map((row) => number(row.shares));
    const times = assignments.map((row) => iso(row.assigned_at));
    const linkedLots = new Map(lots.map((row) => [String(row.stock_lot_id), row]));
    const crossCheckValid = assignments.every((row) => {
      const lotId = text(row.stock_lot_id), assignedShares = number(row.shares);
      if (lotId === null || assignedShares === null) return false;
      return number(linkedLots.get(lotId)?.shares) === assignedShares;
    });
    const uniqueStrikes = [...new Set(strikes.filter((value): value is number => value !== null))];
    if (uniqueStrikes.length !== 1 || !shares.every((value): value is number => value !== null)
      || !times.every((value): value is string => value !== null) || !crossCheckValid) {
      const reason = ['ASSIGNMENT_OR_STOCK_LOT_CROSS_CHECK_INCOMPLETE'];
      return { assignmentStrike:unknownField(asOf, reason, [assignmentSource]),
        stockSharesAssigned:unknownField(asOf, reason, [assignmentSource]),
        assignmentObservedAt:unknownField(asOf, reason, [assignmentSource]) };
    }
    return {
      assignmentStrike: knownField(uniqueStrikes[0] as number, asOf, [assignmentSource]),
      stockSharesAssigned: knownField(sum(shares as number[]), asOf, [assignmentSource]),
      assignmentObservedAt: knownField(times.toSorted().at(0) as string, asOf, [assignmentSource]),
    };
  }

  private coveredCallCloseCosts(calls: readonly Row[], assignments: readonly Row[], expirations: readonly Row[],
    asOf: string): WholeChainEvidenceField<number> {
    const callSource = source('trade.option_leg', ['close_price_per_share','quantity','close_reason','closed_at'], calls,
      'option_leg_id', 'closed_at');
    if (calls.length === 0) return knownField(0, asOf, [callSource], ['NO_COVERED_CALL_LEGS']);
    const assignmentLegs = new Set(assignments.filter((row) => row.option_type === 'CALL').map((row) => String(row.option_leg_id)));
    const expirationLegs = new Set(expirations.map((row) => String(row.option_leg_id)));
    const open = calls.filter((row) => row.closed_at == null || (iso(row.closed_at) ?? '') > asOf);
    if (open.length > 0) return unknownField(asOf, ['OPEN_COVERED_CALL_CLOSE_COST_UNRESOLVED'], [callSource]);
    const costs: number[] = [];
    for (const row of calls) {
      const reason = text(row.close_reason), legId = String(row.option_leg_id);
      if (reason === 'BTC_CLOSE' || reason === 'ROLLED') {
        const close = number(row.close_price_per_share), quantity = number(row.quantity), multiplier = number(row.multiplier);
        if (close === null || quantity === null || multiplier === null) {
          return unknownField(asOf, ['COVERED_CALL_CLOSE_COST_INCOMPLETE'], [callSource]);
        }
        costs.push(close * quantity * multiplier);
      } else if (reason === 'EXPIRE_OTM' && expirationLegs.has(legId)) costs.push(0);
      else if (reason === 'ASSIGNED' && assignmentLegs.has(legId)) costs.push(0);
      else return unknownField(asOf, ['COVERED_CALL_TERMINAL_EVIDENCE_INCOMPLETE'], [callSource]);
    }
    return knownField(sum(costs), asOf, [callSource]);
  }

  private stockExitEvidence(lots: readonly Row[], assignedShares: WholeChainEvidenceField<number>,
    openShares: WholeChainEvidenceField<number>, asOf: string): WholeChainEvidenceField<number> {
    const lotSource = source('trade.stock_lot', ['shares','disposed_at','disposed_price_per_share'], lots,
      'stock_lot_id', 'disposed_at');
    if (assignedShares.status === 'UNKNOWN' || openShares.status === 'UNKNOWN') {
      return unknownField(asOf, ['STOCK_EXIT_DEPENDS_ON_UNKNOWN_ASSIGNMENT_OR_SHARES'], [lotSource]);
    }
    if ((assignedShares.value ?? 0) === 0 || (openShares.value ?? 0) > 0) {
      return unknownField(asOf, ['STOCK_EXIT_NOT_REALIZED_AS_OF'], [lotSource]);
    }
    const disposed = lots.filter((row) => row.disposed_at != null && iso(row.disposed_at) !== null
      && (iso(row.disposed_at) as string) <= asOf);
    const proceeds = disposed.map((row) => {
      const shares = number(row.shares), price = number(row.disposed_price_per_share);
      return shares === null || price === null ? null : shares * price;
    });
    return proceeds.length > 0 && proceeds.every((value): value is number => value !== null)
      ? knownField(sum(proceeds), asOf, [lotSource])
      : unknownField(asOf, ['STOCK_EXIT_PROCEEDS_INCOMPLETE'], [lotSource]);
  }

  private dividendEvidence(rows: readonly Row[], asOf: string): WholeChainEvidenceField<number> {
    const dividendSource = source('trade.dividend_event', ['amount_per_share','ex_date','stock_lot_id'], rows,
      'dividend_event_id', 'created_at');
    const observed = rows.map((row) => {
      const amount = number(row.amount_per_share), shares = number(row.shares);
      return amount === null || shares === null ? null : amount * shares;
    });
    const partial = observed.every((value): value is number => value !== null) ? sum(observed) : null;
    return unknownField(asOf, ['DIVIDEND_COVERAGE_UNPROVEN_NO_ACTIVE_INGESTION_WRITER'], [dividendSource], partial);
  }

  private feeEvidence(fills: readonly Row[], feeEvents: readonly Row[], asOf: string): WholeChainEvidenceField<number> {
    const sources = [
      source('trade.fill', ['fees','filled_at'], fills, 'fill_id', 'filled_at'),
      source('trade.fee_event', ['amount','fee_type','incurred_at'], feeEvents, 'fee_event_id', 'incurred_at'),
    ];
    if (fills.length === 0) return unknownField(asOf, ['NO_LINKED_FILL_FEE_EVIDENCE'], sources);
    if (feeEvents.length > 0) return unknownField(asOf, ['FEE_SOURCE_DEDUPLICATION_UNPROVEN'], sources);
    const values = fills.map((row) => number(row.fees));
    return values.every((value): value is number => value !== null)
      ? knownField(sum(values), asOf, sources, ['ALL_LINKED_FILLS_HAVE_EXPLICIT_FEE_VALUES'])
      : unknownField(asOf, ['ONE_OR_MORE_FILL_FEES_UNKNOWN'], sources);
  }

  private slippageEvidence(rows: readonly Row[], asOf: string): WholeChainEvidenceField<number> {
    const tcaRows = rows.filter((row) => row.transaction_cost_analysis_id != null);
    const tcaSource = source('trade.transaction_cost_analysis', ['slippage_dollars','calculated_at','order_intent_id'],
      tcaRows, 'transaction_cost_analysis_id', 'calculated_at');
    if (rows.length === 0) return unknownField(asOf, ['NO_EXECUTED_ORDER_TCA_SCOPE'], [tcaSource]);
    if (tcaRows.length !== rows.length) return unknownField(asOf, ['MISSING_TCA_FOR_ONE_OR_MORE_EXECUTED_ORDERS'], [tcaSource]);
    const values = tcaRows.map((row) => number(row.slippage_dollars));
    return values.every((value): value is number => value !== null)
      ? knownField(sum(values), asOf, [tcaSource])
      : unknownField(asOf, ['REALIZED_TCA_SLIPPAGE_UNKNOWN'], [tcaSource]);
  }

  private stockMarkEvidence(rows: readonly Row[], openShares: WholeChainEvidenceField<number>,
    asOf: string): WholeChainEvidenceField<number> {
    const markSource = source('trade.broker_position_snapshot', ['current_price','observed_at','payload_hash'], rows,
      'reconciliation_snapshot_id', 'observed_at');
    if ((openShares.value ?? 0) === 0 && openShares.status !== 'UNKNOWN') {
      return unknownField(asOf, ['STOCK_MARK_NOT_REQUIRED_NO_OPEN_STOCK'], [markSource]);
    }
    if (rows.length !== 1 || rows[0]?.data_quality !== 'GOOD') {
      return unknownField(asOf, ['COMPLETE_GOOD_RECONCILIATION_SNAPSHOT_UNAVAILABLE'], [markSource]);
    }
    const price = number(rows[0]?.current_price);
    return price === null
      ? unknownField(asOf, ['BROKER_POSITION_MARK_MISSING_POSITION_ABSENCE_IS_NOT_ZERO'], [markSource])
      : knownField(price, asOf, [markSource], [iso(rows[0]?.provider_timestamp) === null
        ? 'PROVIDER_TIMESTAMP_UNKNOWN' : `PROVIDER_TIMESTAMP_${iso(rows[0]?.provider_timestamp)}`]);
  }

  private reconcileOpenShares(lifecycleShares: WholeChainEvidenceField<number>, rows: readonly Row[],
    asOf: string, aggregateShares: number | null): WholeChainEvidenceField<number> {
    if (lifecycleShares.status === 'UNKNOWN' || rows.length !== 1 || rows[0]?.data_quality !== 'GOOD') {
      return lifecycleShares;
    }
    // Absence in a complete account snapshot is zero account inventory, never
    // a license to reallocate an account position to one economic chain.
    const brokerQuantity = rows[0]?.quantity == null ? 0 : number(rows[0]?.quantity);
    if (brokerQuantity === null || aggregateShares === null || brokerQuantity !== aggregateShares) {
      const reconciliationSource = source('trade.broker_position_snapshot', ['quantity','observed_at','data_quality'], rows,
        'reconciliation_snapshot_id', 'observed_at');
      return unknownField(asOf, ['BROKER_LIFECYCLE_DRIFT'], [...lifecycleShares.sources, reconciliationSource]);
    }
    return lifecycleShares;
  }

  private rollLinksValid(rows: readonly Row[], optionType: 'PUT' | 'CALL', asOf: string): boolean {
    const matching = rows.filter((row) => row.option_type === optionType && row.side === 'SHORT');
    const byId = new Map(matching.map((row) => [String(row.option_leg_id), row]));
    return matching.every((row) => {
      if(row.close_reason==='ROLLED'){
        const successor=byId.get(text(row.rolled_to_option_leg_id)??'');
        if(successor===undefined||text(successor.rolled_from_option_leg_id)!==String(row.option_leg_id))return false;
      }
      const predecessorId = text(row.rolled_from_option_leg_id);
      if (predecessorId === null) return true;
      const predecessor = byId.get(predecessorId);
      return predecessor !== undefined
        && text(predecessor.rolled_to_option_leg_id) === String(row.option_leg_id)
        && predecessor.close_reason === 'ROLLED'
        && iso(predecessor.closed_at) !== null
        && (iso(predecessor.closed_at) as string) <= asOf;
    });
  }

  private stockLotReferences(rows: readonly Row[]): readonly StockLotBasisReference[] {
    return rows.map((row) => {
      const shares = number(row.shares), lifecycleBasis = number(row.economic_basis_per_share);
      const acquiredAt = iso(row.acquired_at), disposedAt = iso(row.disposed_at);
      if (shares === null || lifecycleBasis === null || acquiredAt === null
          || (row.disposed_at != null && disposedAt === null)) {
        throw new Error('WHOLE_CHAIN_STOCK_LOT_REFERENCE_INVALID');
      }
      return {
        stockLotId: String(row.stock_lot_id),
        shares,
        lifecycleEconomicBasisPerShare: lifecycleBasis,
        brokerBasisPerShare: number(row.broker_basis_per_share),
        acquiredAt,
        disposedAt,
      };
    }).toSorted((left, right) => left.acquiredAt.localeCompare(right.acquiredAt) || left.stockLotId.localeCompare(right.stockLotId));
  }
}
