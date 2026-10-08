import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { canonicalHash, dotLabIdentitySchema, type DotLabIdentity } from './contracts.js';
import { resolveWholeChainOutcome } from '../research/outcome-resolver.js';

/** Explicitly injected, isolated canonical database reader. Never loads Production env,
 * registers an account, writes labels, or accepts caller-supplied BROKER_ACTUAL facts. */
export class DotCanonicalLedgerReader {
  readonly identity: DotLabIdentity;
  constructor(private readonly pool: Pool, identity: DotLabIdentity, private readonly sourceSha: string) {
    this.identity = dotLabIdentitySchema.parse(identity);
    z.string().regex(/^[a-f0-9]{40}$/).parse(sourceSha);
  }
  async read(asOf: string) {
    z.string().datetime({ offset: true }).parse(asOf);
    const client = await this.pool.connect();
    let destroyClient = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='5000ms'");
      const account = await client.query(`SELECT environment, provider_account_ref_hash FROM trade.execution_account
        WHERE execution_account_id=$1`, [this.identity.executionAccountId]);
      const expected = createHash('sha256').update(this.identity.providerAccountId).digest('hex');
      if (account.rows.length !== 1 || account.rows[0].environment !== 'PAPER'
        || account.rows[0].provider_account_ref_hash !== expected) throw new Error('DOT_LEDGER_ACCOUNT_BINDING_INVALID');
      const orders = await client.query(`SELECT order_intent_id,chain_id,decision_id,status,theta_action,broker_symbol,
        quantity::text,created_at::text,updated_at::text FROM trade.order_intent
        WHERE execution_account_id=$1 AND created_at<=$2 ORDER BY created_at DESC,order_intent_id LIMIT 51`,
      [this.identity.executionAccountId, asOf]);
      if (orders.rows.length > 50) throw new Error('DOT_LEDGER_WINDOW_REQUIRES_PAGINATION');
      const chainIds = [...new Set(orders.rows.map(row => row.chain_id).filter((id): id is string => typeof id === 'string'))];
      const mixed = await client.query(`SELECT order_intent_id FROM trade.order_intent WHERE chain_id=ANY($1::uuid[])
        AND execution_account_id IS DISTINCT FROM $2 LIMIT 1`, [chainIds, this.identity.executionAccountId]);
      if (mixed.rows.length > 0) throw new Error('DOT_LEDGER_MIXED_ACCOUNT_CHAIN');
      const query = async (sql: string, params: unknown[]) => {
        const result = await client.query(sql, params);
        if (result.rows.length > 500) throw new Error('DOT_LEDGER_FACT_BUDGET_EXCEEDED');
        return result.rows;
      };
      const chains = await query(`SELECT chain_id,lifecycle_state,chain_kind,opened_at::text,closed_at::text
        FROM trade.economic_chain WHERE chain_id=ANY($1::uuid[]) LIMIT 501`, [chainIds]);
      const fills = await query(`SELECT f.fill_id,f.provider_fill_id,oi.chain_id,oi.order_intent_id,bo.provider_order_id,
        oi.option_contract_id,oi.position_intent,oi.instrument_type,oi.underlying_id,oi.side,
        f.quantity::text,f.price_per_share::text,f.fees::text,f.filled_at::text FROM trade.fill f
        JOIN trade.broker_order bo USING(broker_order_id) JOIN trade.order_intent oi USING(order_intent_id)
        WHERE oi.execution_account_id=$1 AND oi.chain_id=ANY($2::uuid[]) LIMIT 501`, [this.identity.executionAccountId, chainIds]);
      const legs = await query(`SELECT ol.option_leg_id,ol.option_contract_id,ol.chain_id,ol.side,ol.quantity::text,
        oc.contract_symbol,oc.multiplier::text,ol.entry_price_per_share::text,ol.close_price_per_share::text,
        ol.closed_at::text,ol.close_reason,ol.realized_pnl::text FROM trade.option_leg ol
        JOIN market.option_contract oc USING(option_contract_id) WHERE ol.chain_id=ANY($1::uuid[]) LIMIT 501`, [chainIds]);
      const stock = await query(`SELECT stock_lot_id,chain_id,underlying_id,shares::text,economic_basis_per_share::text,
        acquired_at::text,disposed_at::text,realized_pnl::text FROM trade.stock_lot WHERE chain_id=ANY($1::uuid[]) LIMIT 501`, [chainIds]);
      const fees = await query(`SELECT fee_event_id,chain_id,amount::text,incurred_at::text
        FROM trade.fee_event WHERE chain_id=ANY($1::uuid[]) LIMIT 501`, [chainIds]);
      const dividends = await query(`SELECT de.dividend_event_id,sl.chain_id,(de.amount_per_share*sl.shares)::text AS amount
        FROM trade.dividend_event de JOIN trade.stock_lot sl USING(stock_lot_id)
        WHERE sl.chain_id=ANY($1::uuid[]) LIMIT 501`, [chainIds]);
      const assignments = await query(`SELECT ar.chain_id,ar.option_symbol,ar.state,ar.stock_quantity::text,
        ar.occurrence_date::text,ar.confirmed_at::text FROM trade.assignment_reconciliation ar
        WHERE ar.execution_account_id=$1 AND ar.chain_id=ANY($2::uuid[]) LIMIT 501`, [this.identity.executionAccountId, chainIds]);
      const expirations = await query(`SELECT ee.option_leg_id,ee.expired_at::text,ee.itm FROM trade.expiration_event ee
        JOIN trade.option_leg ol USING(option_leg_id) WHERE ol.chain_id=ANY($1::uuid[]) LIMIT 501`, [chainIds]);
      // Decision ownership is proved by this account's intent, never by symbol,
      // workspace resemblance, or a caller-supplied strategy label.
      const decisions = await query(`SELECT DISTINCT d.decision_id,d.strategy_branch,d.action_code,d.quantity::text,
        d.status,d.decided_at::text,sv.semantic_version AS strategy_version
        FROM trade.decision d JOIN trade.order_intent oi USING(decision_id)
        JOIN trade.fusion_snapshot fs USING(fusion_snapshot_id)
        JOIN core.strategy_version sv USING(strategy_version_id)
        WHERE oi.execution_account_id=$1 AND oi.created_at<=$2 LIMIT 501`, [this.identity.executionAccountId, asOf]);
      const management = await query(`SELECT management_action_frontier_id,chain_id,observed_at::text,
        selected_action,decision_state,reason_codes_json,content_hash
        FROM trade.management_action_frontier WHERE chain_id=ANY($1::uuid[]) LIMIT 501`, [chainIds]);
      // Present-day reads cannot be represented as a historical snapshot.
      const clock = await client.query('SELECT clock_timestamp()::text AS observed_at');
      const observedAt = z.string().datetime({ offset: true }).parse(new Date(String(clock.rows[0].observed_at)).toISOString());
      const sum = (rows: Record<string, unknown>[], field: string): number | null => {
        if (rows.some(row => typeof row[field] !== 'string' || row[field] === '' || !Number.isFinite(Number(row[field])))) return null;
        return rows.reduce((total, row) => total + Number(row[field]), 0);
      };
      const outcomes = chains.map(chain => {
        const own = (rows: Record<string, unknown>[]) => rows.filter(row => row.chain_id === chain.chain_id);
        const chainFills = own(fills), chainFees = own(fees), chainLegs = own(legs), chainStock = own(stock);
        const knownTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
          && Date.parse(value) <= Date.parse(observedAt);
        const fillFees = sum(chainFills, 'fees'), ledgerFees = sum(chainFees, 'amount');
        const feeKnown = chainFills.length > 0 && chainFills.every(row => row.provider_fill_id !== null
          && row.provider_order_id !== null && row.fees !== null && Number(row.fees) >= 0 && knownTime(row.filled_at))
          && chainFees.every(row => Number(row.amount) >= 0 && knownTime(row.incurred_at))
          && fillFees !== null && ledgerFees !== null && fillFees >= 0
          && ledgerFees >= 0 && Math.abs(fillFees - ledgerFees) < 0.00000001;
        const closeTime = chain.closed_at === null ? null : new Date(String(chain.closed_at));
        if (closeTime !== null && !Number.isFinite(closeTime.getTime())) throw new Error('DOT_LEDGER_TIMESTAMP_INVALID');
        const optionCloseEvidenceComplete = chainLegs.every(leg => {
          if (!knownTime(leg.closed_at)) return false;
          if (leg.close_reason === 'BTC_CLOSE' || leg.close_reason === 'ROLLED') {
            const closeFills = chainFills.filter(fill => fill.option_contract_id === leg.option_contract_id
              && fill.position_intent === (leg.side === 'SHORT' ? 'BUY_TO_CLOSE' : 'SELL_TO_CLOSE')
              && fill.provider_fill_id !== null && fill.provider_order_id !== null && knownTime(fill.filled_at));
            const closedQuantity = sum(closeFills, 'quantity');
            const requiredQuantity = sum(chainLegs.filter(other => other.option_contract_id === leg.option_contract_id
              && other.side === leg.side && ['BTC_CLOSE', 'ROLLED'].includes(String(other.close_reason))), 'quantity');
            return closedQuantity !== null && requiredQuantity !== null && requiredQuantity > 0
              && closedQuantity >= requiredQuantity;
          }
          if (leg.close_reason === 'EXPIRE_OTM') return expirations.some(event => event.option_leg_id === leg.option_leg_id
            && event.itm === false && knownTime(event.expired_at));
          if (leg.close_reason === 'ASSIGNED') return own(assignments).some(event => event.option_symbol === leg.contract_symbol
            && event.state === 'CONFIRMED' && knownTime(event.confirmed_at));
          return false; // Exercise proof needs its canonical producer, never inferred from a label.
        });
        const stockCloseEvidenceComplete = chainStock.every(lot => {
          if (!knownTime(lot.disposed_at)) return false;
          const saleFills = chainFills.filter(fill => fill.instrument_type === 'STOCK' && fill.side === 'sell'
            && fill.underlying_id === lot.underlying_id && fill.provider_fill_id !== null
            && fill.provider_order_id !== null && knownTime(fill.filled_at));
          const sharesSold = sum(saleFills, 'quantity');
          const sharesRequired = sum(chainStock.filter(other => other.underlying_id === lot.underlying_id), 'shares');
          return sharesSold !== null && sharesRequired !== null && sharesRequired > 0 && sharesSold >= sharesRequired;
        });
        const closeEvidenceComplete = optionCloseEvidenceComplete && stockCloseEvidenceComplete;
        const optionEntryEvidenceComplete = chainLegs.every(leg => {
          const entryFills = chainFills.filter(fill => fill.option_contract_id === leg.option_contract_id
            && fill.position_intent === (leg.side === 'SHORT' ? 'SELL_TO_OPEN' : 'BUY_TO_OPEN')
            && fill.provider_fill_id !== null && fill.provider_order_id !== null && knownTime(fill.filled_at));
          const filledQuantity = sum(entryFills, 'quantity');
          const requiredQuantity = sum(chainLegs.filter(other => other.option_contract_id === leg.option_contract_id
            && other.side === leg.side), 'quantity');
          return filledQuantity !== null && requiredQuantity !== null && requiredQuantity > 0 && filledQuantity >= requiredQuantity;
        });
        const resolution = resolveWholeChainOutcome({ chainId: String(chain.chain_id),
          closedAt: closeTime?.toISOString() ?? null, evidenceAvailableAt: observedAt,
          allOptionLegsResolved: chainLegs.every(row => row.closed_at !== null && row.realized_pnl !== null),
          allStockLotsResolved: chainStock.every(row => knownTime(row.disposed_at) && row.realized_pnl !== null),
          executionFeesKnown: feeKnown, economicFactCount: chainLegs.length + chainStock.length,
          optionRealizedPnl: sum(chainLegs, 'realized_pnl'), stockRealizedPnl: sum(chainStock, 'realized_pnl'),
          dividends: sum(own(dividends), 'amount'), fees: feeKnown ? ledgerFees : null });
        return { chainId: chain.chain_id, closeEvidenceComplete, optionEntryEvidenceComplete,
          resolution: closeEvidenceComplete && optionEntryEvidenceComplete ? resolution : { state: 'BLOCKED' as const,
            reasons: [...(resolution.state === 'BLOCKED' ? resolution.reasons : []),
              ...(!closeEvidenceComplete ? ['CANONICAL_BROKER_CLOSE_PROOF_INCOMPLETE'] : []),
              ...(!optionEntryEvidenceComplete ? ['CANONICAL_BROKER_ENTRY_PROOF_INCOMPLETE'] : [])] } };
      });
      await client.query('COMMIT');
      const receipt = { version: 'dot-canonical-ledger-import-v1', providerAccountId: this.identity.providerAccountId,
        executionAccountId: this.identity.executionAccountId, sourceSha: this.sourceSha,
        sourceShaQualification: 'READER_SOURCE_NOT_DEPLOYMENT_PROOF', requestedAsOf: asOf, observedAt,
        temporalQualification: 'CURRENT_LEDGER_NOT_HISTORICAL_PIT', orders: orders.rows, chains, fills, legs, stock,
        brokerQualification: 'CANONICAL_LEDGER_NOT_FRESH_BROKER_RECONCILIATION',
        fees, dividends, assignments, expirations, decisions, management, outcomes,
        rejectionCoverage: 'INTENT_BACKED_ONLY_UNSUBMITTED_OPPORTUNITIES_REQUIRE_ACCOUNT_SCOPED_PRODUCER',
        truthClass: 'BROKER_ACTUAL', brokerAuthority: false,
        profitability: 'EMPIRICALLY_UNPROVEN' };
      return { ...receipt, contentHash: canonicalHash(receipt) };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { destroyClient = true; }
      throw error;
    } finally { client.release(destroyClient); }
  }

  async performance(asOf: string) {
    const ledger = await this.read(asOf);
    const resolved = ledger.outcomes.filter(item => item.resolution.state === 'RESOLVED');
    const pnl = resolved.flatMap(item => item.resolution.state === 'RESOLVED' ? [item.resolution.wholeChainNetPnl] : []);
    const afterCostPnl = pnl.length === 0 ? null : pnl.reduce((total, value) => total + value, 0);
    if (afterCostPnl !== null && !Number.isFinite(afterCostPnl)) throw new Error('DOT_PERFORMANCE_NONFINITE');
    const receipt = { version: 'dot-canonical-performance-v1',
      providerAccountId: ledger.providerAccountId, executionAccountId: ledger.executionAccountId,
      observedAt: ledger.observedAt, ledgerContentHash: ledger.contentHash,
      state: resolved.length > 0 ? 'QUALIFIED_CANONICAL_CLOSED_CHAINS' : 'NO_QUALIFIED_CLOSED_CHAINS',
      resolvedChainCount: resolved.length, unresolvedChainCount: ledger.outcomes.length - resolved.length,
      afterCostPnl, outcomes: ledger.outcomes, decisions: ledger.decisions, management: ledger.management,
      truthClass: 'BROKER_ACTUAL', brokerQualification: ledger.brokerQualification,
      temporalQualification: ledger.temporalQualification, rejectionCoverage: ledger.rejectionCoverage,
      profitability: 'EMPIRICALLY_UNPROVEN', brokerAuthority: false };
    return { ...receipt, contentHash: canonicalHash(receipt) };
  }
}
