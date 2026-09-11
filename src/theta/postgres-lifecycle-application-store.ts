import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { assertValidLifecycleTransition, type ThetaLifecycleState } from './runtime-state.js';

type BaseApplication = {
  readonly evidenceKey: string;
  readonly chainId: string;
  readonly occurredAt: string;
  readonly decisionId: string | null;
  readonly providerActivityRefHash: string | null;
};

export type LifecycleApplication = BaseApplication & (
  | { readonly eventKind: 'SHORT_PUT_ASSIGNMENT'; readonly optionLegId: string; readonly stockLotId: string;
      readonly shares: number; readonly strikePrice: number; readonly brokerBasisPerShare: number | null;
      readonly economicBasisPerShare: number; readonly realizedOptionPnl: number }
  | { readonly eventKind: 'COVERED_CALL_ASSIGNMENT'; readonly optionLegId: string; readonly stockLotId: string;
      readonly shares: number; readonly strikePrice: number; readonly realizedOptionPnl: number;
      readonly realizedStockPnl: number }
  | { readonly eventKind: 'OPTION_EXPIRATION'; readonly optionLegId: string; readonly itm: false;
      readonly realizedOptionPnl: number }
  | { readonly eventKind: 'OPTION_CLOSE'; readonly optionLegId: string; readonly closePricePerShare: number;
      readonly realizedOptionPnl: number; readonly nextState: 'RECOVERY_WAIT' | 'REDEPLOY' | 'CLOSED' }
  | { readonly eventKind: 'OPTION_ROLL'; readonly oldOptionLegId: string; readonly newOptionLegId: string;
      readonly newOptionContractId: string; readonly newQuantity: number; readonly newEntryPricePerShare: number;
      readonly newEntryCreditDebit: number; readonly oldClosePricePerShare: number; readonly oldRealizedPnl: number;
      readonly legKind: 'SHORT_PUT' | 'COVERED_CALL' }
  | { readonly eventKind: 'COVERED_CALL_OPEN'; readonly optionLegId: string; readonly optionContractId: string;
      readonly quantity: number; readonly entryPricePerShare: number; readonly entryCreditDebit: number }
  | { readonly eventKind: 'STOCK_DISPOSAL'; readonly stockLotId: string; readonly disposedPricePerShare: number;
      readonly realizedStockPnl: number }
);

export interface LifecycleApplicationResult {
  readonly applicationId: string;
  readonly duplicate: boolean;
  readonly chainId: string;
  readonly eventKind: LifecycleApplication['eventKind'];
  readonly transitionPath: readonly ThetaLifecycleState[];
  readonly finalState: ThetaLifecycleState;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const validHash = (value: string | null): boolean => value === null || /^[0-9a-f]{64}$/.test(value);
const closeEnough = (actual: number, expected: number): boolean =>
  Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 0.000001;

interface OpenLegEconomics {
  readonly side: string;
  readonly quantity: number;
  readonly entryCreditDebit: number | null;
  readonly optionType: 'PUT' | 'CALL';
  readonly strike: number;
  readonly multiplier: number;
  readonly contractUnderlyingId: string;
  readonly chainUnderlyingId: string;
}

function transitionPath(application: LifecycleApplication, current: ThetaLifecycleState): readonly ThetaLifecycleState[] {
  if (application.eventKind === 'SHORT_PUT_ASSIGNMENT' && current === 'CSP_OPEN') return ['ASSIGNED', 'STOCK_HELD', 'RECOVERY_WAIT'];
  if (application.eventKind === 'COVERED_CALL_ASSIGNMENT' && current === 'CC_OPEN') return ['CALL_AWAY', 'CLOSED'];
  if (application.eventKind === 'OPTION_EXPIRATION') {
    if (current === 'CSP_OPEN') return ['EXPIRE_OTM', 'REDEPLOY'];
    if (current === 'CC_OPEN') return ['EXPIRE_OTM', 'RECOVERY_WAIT'];
  }
  if (application.eventKind === 'OPTION_CLOSE') {
    if (current === 'CSP_OPEN' && ['REDEPLOY', 'CLOSED'].includes(application.nextState)) return ['BTC_CLOSE', application.nextState];
    if (current === 'CC_OPEN' && ['RECOVERY_WAIT', 'REDEPLOY'].includes(application.nextState)) return ['CLOSE_CC', application.nextState];
  }
  if (application.eventKind === 'OPTION_ROLL') {
    if (application.legKind === 'SHORT_PUT' && current === 'CSP_OPEN') return ['ROLL_DECISION', 'CSP_PROPOSED', 'CSP_OPEN'];
    if (application.legKind === 'COVERED_CALL' && current === 'CC_OPEN') return ['ROLL_DECISION', 'CC_PROPOSED', 'CC_OPEN'];
  }
  if (application.eventKind === 'COVERED_CALL_OPEN' && current === 'RECOVERY_WAIT') return ['CC_PROPOSED', 'CC_OPEN'];
  if (application.eventKind === 'STOCK_DISPOSAL' && current === 'RECOVERY_WAIT') return ['CLOSE_STOCK', 'CLOSED'];
  throw new Error('LIFECYCLE_EVENT_STATE_MISMATCH');
}

async function applyTransition(client: PoolClient, application: LifecycleApplication,
  current: ThetaLifecycleState, next: ThetaLifecycleState): Promise<void> {
  assertValidLifecycleTransition(current, next);
  await client.query(
    `INSERT INTO trade.lifecycle_transition(chain_id,from_state,to_state,decision_id,transitioned_at)
     VALUES($1,$2,$3,$4,$5)`,
    [application.chainId,current,next,application.decisionId,application.occurredAt],
  );
  await client.query(
    `UPDATE trade.economic_chain SET lifecycle_state=$2,
       closed_at=CASE WHEN $2='CLOSED' THEN $3::timestamptz ELSE closed_at END WHERE chain_id=$1`,
    [application.chainId,next,application.occurredAt],
  );
}

export class PostgresLifecycleApplicationStore {
  constructor(private readonly pool: Pool) {}

  async apply(application: LifecycleApplication): Promise<LifecycleApplicationResult> {
    if (!/^[0-9a-f]{64}$/.test(application.evidenceKey) || !validHash(application.providerActivityRefHash)) {
      throw new Error('LIFECYCLE_EVIDENCE_HASH_INVALID');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [application.evidenceKey]);
      const existing = await client.query(
        `SELECT lifecycle_application_id,chain_id,event_kind,transition_path_json
         FROM trade.lifecycle_application WHERE evidence_key=$1`, [application.evidenceKey],
      );
      if (existing.rowCount === 1) {
        if (String(existing.rows[0].chain_id) !== application.chainId || String(existing.rows[0].event_kind) !== application.eventKind) {
          throw new Error('LIFECYCLE_IDEMPOTENCY_CONFLICT');
        }
        const path = existing.rows[0].transition_path_json as ThetaLifecycleState[];
        await client.query('COMMIT');
        return { applicationId:String(existing.rows[0].lifecycle_application_id),duplicate:true,
          chainId:application.chainId,eventKind:application.eventKind,transitionPath:path,finalState:path.at(-1) ?? 'WAIT' };
      }
      const chain = await client.query(`SELECT lifecycle_state FROM trade.economic_chain WHERE chain_id=$1 FOR UPDATE`, [application.chainId]);
      if (chain.rowCount !== 1) throw new Error('ECONOMIC_CHAIN_NOT_FOUND');
      let current = String(chain.rows[0].lifecycle_state) as ThetaLifecycleState;
      const path = transitionPath(application, current);
      await this.mutateEconomicState(client, application, current);
      for (const next of path) {
        await applyTransition(client, application, current, next);
        current = next;
      }
      const applicationId = randomUUID();
      const resultHash = hash(JSON.stringify({ chainId:application.chainId,eventKind:application.eventKind,path,finalState:current }));
      await client.query(
        `INSERT INTO trade.lifecycle_application(lifecycle_application_id,evidence_key,chain_id,event_kind,
          provider_activity_ref_hash,transition_path_json,applied_at,result_hash,detail_json)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)`,
        [applicationId,application.evidenceKey,application.chainId,application.eventKind,
          application.providerActivityRefHash,JSON.stringify(path),application.occurredAt,resultHash,
          JSON.stringify({ decisionId:application.decisionId })],
      );
      await client.query('COMMIT');
      return { applicationId,duplicate:false,chainId:application.chainId,eventKind:application.eventKind,
        transitionPath:path,finalState:current };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async mutateEconomicState(client: PoolClient, application: LifecycleApplication,
    current: ThetaLifecycleState): Promise<void> {
    if (application.eventKind === 'SHORT_PUT_ASSIGNMENT') {
      if (application.providerActivityRefHash === null) throw new Error('BROKER_ASSIGNMENT_EVIDENCE_REQUIRED');
      const leg = await this.openLegEconomics(client, application.optionLegId, application.chainId);
      if (leg.side !== 'SHORT' || leg.optionType !== 'PUT' || leg.contractUnderlyingId !== leg.chainUnderlyingId) {
        throw new Error('ASSIGNMENT_OPTION_LEG_INVALID');
      }
      const expectedShares = leg.quantity * leg.multiplier;
      if (application.shares <= 0 || application.strikePrice <= 0
        || !closeEnough(application.shares, expectedShares)
        || !closeEnough(application.strikePrice, leg.strike)
        || !closeEnough(application.economicBasisPerShare, leg.strike)) {
        throw new Error('ASSIGNMENT_ECONOMIC_BASIS_INVALID');
      }
      this.assertOptionRealizedPnl(leg, 0, application.realizedOptionPnl);
      await this.closeLeg(client, application.optionLegId, application.chainId, application.occurredAt,
        'ASSIGNED', null, application.realizedOptionPnl);
      const stock = await client.query(
        `INSERT INTO trade.stock_lot(stock_lot_id,chain_id,underlying_id,shares,economic_basis_per_share,
           broker_basis_per_share,assignment_option_leg_id,acquired_at)
         SELECT $1,$2,underlying_id,$3,$4,$5,$6,$7 FROM trade.economic_chain WHERE chain_id=$2 RETURNING stock_lot_id`,
        [application.stockLotId,application.chainId,application.shares,application.economicBasisPerShare,
          application.brokerBasisPerShare,application.optionLegId,application.occurredAt],
      );
      if (stock.rowCount !== 1) throw new Error('ASSIGNMENT_STOCK_LOT_NOT_CREATED');
      await client.query(
        `INSERT INTO trade.assignment_event(option_leg_id,stock_lot_id,assigned_at,shares,strike_price)
         VALUES($1,$2,$3,$4,$5)`,
        [application.optionLegId,application.stockLotId,application.occurredAt,application.shares,application.strikePrice],
      );
      return;
    }
    if (application.eventKind === 'COVERED_CALL_ASSIGNMENT') {
      if (application.providerActivityRefHash === null) throw new Error('BROKER_ASSIGNMENT_EVIDENCE_REQUIRED');
      const leg = await this.openLegEconomics(client, application.optionLegId, application.chainId);
      if (leg.side !== 'SHORT' || leg.optionType !== 'CALL' || leg.contractUnderlyingId !== leg.chainUnderlyingId
        || !closeEnough(application.shares, leg.quantity * leg.multiplier)
        || !closeEnough(application.strikePrice, leg.strike)) {
        throw new Error('CALL_AWAY_OPTION_LEG_INVALID');
      }
      this.assertOptionRealizedPnl(leg, 0, application.realizedOptionPnl);
      const stockEconomics = await this.openStockLotEconomics(client, application.stockLotId, application.chainId);
      if (!closeEnough(stockEconomics.shares, application.shares)
        || !closeEnough((application.strikePrice - stockEconomics.economicBasisPerShare) * stockEconomics.shares,
          application.realizedStockPnl)) {
        throw new Error('CALL_AWAY_STOCK_ECONOMICS_INVALID');
      }
      await this.closeLeg(client, application.optionLegId, application.chainId, application.occurredAt,
        'ASSIGNED', null, application.realizedOptionPnl);
      const lot = await client.query(
        `UPDATE trade.stock_lot SET disposed_at=$2,disposed_price_per_share=$3,realized_pnl=$4
         WHERE stock_lot_id=$1 AND chain_id=$5 AND disposed_at IS NULL AND shares=$6 RETURNING stock_lot_id`,
        [application.stockLotId,application.occurredAt,application.strikePrice,application.realizedStockPnl,
          application.chainId,application.shares],
      );
      if (lot.rowCount !== 1) throw new Error('COVERED_STOCK_LOT_NOT_FOUND');
      await client.query(
        `INSERT INTO trade.assignment_event(option_leg_id,stock_lot_id,assigned_at,shares,strike_price)
         VALUES($1,$2,$3,$4,$5)`,
        [application.optionLegId,application.stockLotId,application.occurredAt,application.shares,application.strikePrice],
      );
      return;
    }
    if (application.eventKind === 'OPTION_EXPIRATION') {
      if (application.providerActivityRefHash === null) throw new Error('BROKER_EXPIRATION_EVIDENCE_REQUIRED');
      const leg = await this.openLegEconomics(client, application.optionLegId, application.chainId);
      if (leg.side !== 'SHORT' || leg.contractUnderlyingId !== leg.chainUnderlyingId) {
        throw new Error('EXPIRING_OPTION_LEG_INVALID');
      }
      this.assertOptionRealizedPnl(leg, 0, application.realizedOptionPnl);
      await this.closeLeg(client, application.optionLegId, application.chainId, application.occurredAt,
        'EXPIRE_OTM', 0, application.realizedOptionPnl);
      await client.query(`INSERT INTO trade.expiration_event(option_leg_id,expired_at,itm) VALUES($1,$2,false)`,
        [application.optionLegId,application.occurredAt]);
      return;
    }
    if (application.eventKind === 'OPTION_CLOSE') {
      const leg = await this.openLegEconomics(client, application.optionLegId, application.chainId);
      if (leg.side !== 'SHORT' || leg.contractUnderlyingId !== leg.chainUnderlyingId
        || (current === 'CSP_OPEN' && leg.optionType !== 'PUT')
        || (current === 'CC_OPEN' && leg.optionType !== 'CALL')) {
        throw new Error('CLOSING_OPTION_LEG_INVALID');
      }
      this.assertOptionRealizedPnl(leg, application.closePricePerShare, application.realizedOptionPnl);
      await this.closeLeg(client, application.optionLegId, application.chainId, application.occurredAt,
        'BTC_CLOSE', application.closePricePerShare, application.realizedOptionPnl);
      return;
    }
    if (application.eventKind === 'OPTION_ROLL') {
      if (application.newQuantity <= 0) throw new Error('OPEN_ROLL_LEG_INVALID');
      const oldLegEconomics = await this.openLegEconomics(client, application.oldOptionLegId, application.chainId);
      const expectedType = application.legKind === 'SHORT_PUT' ? 'PUT' : 'CALL';
      if (oldLegEconomics.side !== 'SHORT' || oldLegEconomics.optionType !== expectedType
        || oldLegEconomics.contractUnderlyingId !== oldLegEconomics.chainUnderlyingId) {
        throw new Error('ROLL_OLD_LEG_INVALID');
      }
      this.assertOptionRealizedPnl(oldLegEconomics, application.oldClosePricePerShare, application.oldRealizedPnl);
      const nextContract = await this.contractEconomics(client, application.newOptionContractId, application.chainId);
      if (nextContract.optionType !== expectedType || nextContract.contractUnderlyingId !== nextContract.chainUnderlyingId
        || !closeEnough(application.newEntryCreditDebit,
          application.newEntryPricePerShare * nextContract.multiplier * application.newQuantity)) {
        throw new Error('ROLL_NEW_LEG_INVALID');
      }
      const oldLeg = await client.query(
        `UPDATE trade.option_leg SET closed_at=$2,close_reason='ROLLED',close_price_per_share=$3,
           realized_pnl=$4,rolled_to_option_leg_id=$5
         WHERE option_leg_id=$1 AND chain_id=$6 AND closed_at IS NULL RETURNING option_leg_id`,
        [application.oldOptionLegId,application.occurredAt,application.oldClosePricePerShare,
          application.oldRealizedPnl,application.newOptionLegId,application.chainId],
      );
      if (oldLeg.rowCount !== 1) throw new Error('OPEN_ROLL_LEG_NOT_FOUND');
      await client.query(
        `INSERT INTO trade.option_leg(option_leg_id,chain_id,option_contract_id,decision_id,side,quantity,
           entry_price_per_share,entry_credit_debit,opened_at,rolled_from_option_leg_id)
         VALUES($1,$2,$3,$4,'SHORT',$5,$6,$7,$8,$9)`,
        [application.newOptionLegId,application.chainId,application.newOptionContractId,application.decisionId,
          application.newQuantity,application.newEntryPricePerShare,application.newEntryCreditDebit,
          application.occurredAt,application.oldOptionLegId],
      );
      return;
    }
    if (application.eventKind === 'COVERED_CALL_OPEN') {
      if (application.quantity <= 0) throw new Error('COVERED_CALL_QUANTITY_INVALID');
      const contract = await this.contractEconomics(client, application.optionContractId, application.chainId);
      const stockShares = await client.query(
        `SELECT COALESCE(sum(shares),0) AS shares FROM trade.stock_lot
         WHERE chain_id=$1 AND disposed_at IS NULL`, [application.chainId],
      );
      const availableShares = Number(stockShares.rows[0]?.shares ?? 0);
      if (contract.optionType !== 'CALL' || contract.contractUnderlyingId !== contract.chainUnderlyingId
        || availableShares < application.quantity * contract.multiplier
        || !closeEnough(application.entryCreditDebit,
          application.entryPricePerShare * contract.multiplier * application.quantity)) {
        throw new Error('COVERED_CALL_COVERAGE_INVALID');
      }
      await client.query(
        `INSERT INTO trade.option_leg(option_leg_id,chain_id,option_contract_id,decision_id,side,quantity,
           entry_price_per_share,entry_credit_debit,opened_at)
         VALUES($1,$2,$3,$4,'SHORT',$5,$6,$7,$8)`,
        [application.optionLegId,application.chainId,application.optionContractId,application.decisionId,
          application.quantity,application.entryPricePerShare,application.entryCreditDebit,application.occurredAt],
      );
      return;
    }
    const stockEconomics = await this.openStockLotEconomics(client, application.stockLotId, application.chainId);
    if (!closeEnough((application.disposedPricePerShare - stockEconomics.economicBasisPerShare) * stockEconomics.shares,
      application.realizedStockPnl)) {
      throw new Error('STOCK_DISPOSAL_ECONOMICS_INVALID');
    }
    const lot = await client.query(
      `UPDATE trade.stock_lot SET disposed_at=$2,disposed_price_per_share=$3,realized_pnl=$4
       WHERE stock_lot_id=$1 AND chain_id=$5 AND disposed_at IS NULL RETURNING stock_lot_id`,
      [application.stockLotId,application.occurredAt,application.disposedPricePerShare,
        application.realizedStockPnl,application.chainId],
    );
    if (lot.rowCount !== 1) throw new Error('OPEN_STOCK_LOT_NOT_FOUND');
  }

  private async closeLeg(client: PoolClient, optionLegId: string, chainId: string, occurredAt: string,
    closeReason: 'BTC_CLOSE' | 'EXPIRE_OTM' | 'ASSIGNED', closePrice: number | null, realizedPnl: number): Promise<void> {
    const leg = await client.query(
      `UPDATE trade.option_leg SET closed_at=$2,close_reason=$3,close_price_per_share=$4,realized_pnl=$5
       WHERE option_leg_id=$1 AND chain_id=$6 AND closed_at IS NULL RETURNING option_leg_id`,
      [optionLegId,occurredAt,closeReason,closePrice,realizedPnl,chainId],
    );
    if (leg.rowCount !== 1) throw new Error('OPEN_OPTION_LEG_NOT_FOUND');
  }

  private async openLegEconomics(client: PoolClient, optionLegId: string,
    chainId: string): Promise<OpenLegEconomics> {
    const result = await client.query(
      `SELECT l.side,l.quantity,l.entry_credit_debit,oc.option_type,oc.strike,oc.multiplier,
         oc.underlying_id AS contract_underlying_id,ec.underlying_id AS chain_underlying_id
       FROM trade.option_leg l
       JOIN market.option_contract oc ON oc.option_contract_id=l.option_contract_id
       JOIN trade.economic_chain ec ON ec.chain_id=l.chain_id
       WHERE l.option_leg_id=$1 AND l.chain_id=$2 AND l.closed_at IS NULL`,
      [optionLegId,chainId],
    );
    if (result.rowCount !== 1) throw new Error('OPEN_OPTION_LEG_NOT_FOUND');
    const row = result.rows[0];
    const optionType = String(row.option_type);
    const quantity = Number(row.quantity), strike = Number(row.strike), multiplier = Number(row.multiplier);
    if (!['PUT','CALL'].includes(optionType) || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(strike) || strike <= 0 || !Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error('OPTION_LEG_ECONOMICS_INVALID');
    }
    const entryCreditDebit = row.entry_credit_debit == null ? null : Number(row.entry_credit_debit);
    if (entryCreditDebit !== null && !Number.isFinite(entryCreditDebit)) throw new Error('OPTION_LEG_ECONOMICS_INVALID');
    return { side:String(row.side),quantity,entryCreditDebit,optionType:optionType as 'PUT' | 'CALL',strike,multiplier,
      contractUnderlyingId:String(row.contract_underlying_id),chainUnderlyingId:String(row.chain_underlying_id) };
  }

  private async contractEconomics(client: PoolClient, optionContractId: string, chainId: string): Promise<{
    readonly optionType: 'PUT' | 'CALL'; readonly multiplier: number;
    readonly contractUnderlyingId: string; readonly chainUnderlyingId: string;
  }> {
    const result = await client.query(
      `SELECT oc.option_type,oc.multiplier,oc.underlying_id AS contract_underlying_id,
         ec.underlying_id AS chain_underlying_id
       FROM market.option_contract oc CROSS JOIN trade.economic_chain ec
       WHERE oc.option_contract_id=$1 AND ec.chain_id=$2`, [optionContractId,chainId],
    );
    if (result.rowCount !== 1) throw new Error('OPTION_CONTRACT_NOT_FOUND');
    const row = result.rows[0], optionType = String(row.option_type), multiplier = Number(row.multiplier);
    if (!['PUT','CALL'].includes(optionType) || !Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error('OPTION_CONTRACT_ECONOMICS_INVALID');
    }
    return { optionType:optionType as 'PUT' | 'CALL',multiplier,
      contractUnderlyingId:String(row.contract_underlying_id),chainUnderlyingId:String(row.chain_underlying_id) };
  }

  private async openStockLotEconomics(client: PoolClient, stockLotId: string, chainId: string): Promise<{
    readonly shares: number; readonly economicBasisPerShare: number;
  }> {
    const result = await client.query(
      `SELECT shares,economic_basis_per_share FROM trade.stock_lot
       WHERE stock_lot_id=$1 AND chain_id=$2 AND disposed_at IS NULL`, [stockLotId,chainId],
    );
    if (result.rowCount !== 1) throw new Error('OPEN_STOCK_LOT_NOT_FOUND');
    const shares = Number(result.rows[0].shares), economicBasisPerShare = Number(result.rows[0].economic_basis_per_share);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(economicBasisPerShare)) {
      throw new Error('STOCK_LOT_ECONOMICS_INVALID');
    }
    return { shares,economicBasisPerShare };
  }

  private assertOptionRealizedPnl(leg: OpenLegEconomics, closePricePerShare: number,
    suppliedRealizedPnl: number): void {
    if (leg.entryCreditDebit === null || !Number.isFinite(closePricePerShare) || closePricePerShare < 0) {
      throw new Error('OPTION_REALIZED_PNL_INPUT_UNKNOWN');
    }
    const expected = leg.entryCreditDebit - closePricePerShare * leg.multiplier * leg.quantity;
    if (!closeEnough(suppliedRealizedPnl, expected)) throw new Error('OPTION_REALIZED_PNL_MISMATCH');
  }
}
