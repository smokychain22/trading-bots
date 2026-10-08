import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import { assertInlinePayloadWithinPolicy } from '../storage/storage-dataset-policy.js';
import { capitalAdmission, capitalContentHash, capitalEnvelopeSchema, capitalProposalSchema,
  moneyUnits, type CapitalCommitment, type CapitalEnvelope, type CapitalProposal } from './portfolio-capital-reservation.js';
import { deriveQualifiedAccountEnvelope, type AccountCapitalInput, type AccountCapitalResult } from './qualified-account-capital.js';
import { actionPlanContentHash } from './action-plan-integrity.js';
import { assertCapitalIntentMatchesPlan, CapitalPlanAdmissionError, proposalForPlan, type PlanCapitalObservation } from './plan-capital-binding.js';
import type { ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import type { PersistedPaperOrderIntent } from './paper-order-coordinator.js';

type Admission = { reservationId: string; state: 'RESERVED' | 'REPLAY' | 'BLOCKED'; reasons: readonly string[] };
type Row = Record<string, unknown>;
const payload = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  assertInlinePayloadWithinPolicy({ classification: 'CANONICAL_TRADING_STATE',
    serializedBytes: Buffer.byteLength(serialized), errorCode: 'CAPITAL_INLINE_PAYLOAD_TOO_LARGE' });
  return serialized;
};

// A canceled intent alone cannot prove zero fills. Require the broker's
// reported cumulative quantity and exact identity, then match the fill ledger.
const terminalEvidenceSchema = z.object({
  eventId:z.string().uuid(), executionAccountId:z.string().uuid(), reservationId:z.string().uuid(),
  observedAt:z.string().datetime({offset:true}),
  brokerOrder:z.object({ id:z.string().min(1), clientOrderId:z.string().min(1),
    quantity:z.number().int().positive(), filledQuantity:z.number().int().nonnegative(),
    status:z.enum(['FILLED','CANCELED','REJECTED','EXPIRED']),
    source:z.literal('ALPACA_PAPER_GET'), responseHash:z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict();
export type CapitalTerminalEvidence = z.infer<typeof terminalEvidenceSchema>;

/** Database concurrency boundary only. No provider surface, no retry after a
 * broker timeout, no separate sizing or strategy authority. Callers can use
 * reserveInTransaction to commit claims and canonical plans together. */
export class PostgresPortfolioCapitalStore {
  constructor(private readonly pool: Pool, private readonly clock: () => string = () => new Date().toISOString()) {}

  async reservePlanInTransaction(client: PoolClient, plan: ApprovedMasterPaperActionPlan,
    observation: PlanCapitalObservation): Promise<void> {
    // Contract/cost versions belong to the persisted decision, not whatever a
    // worker currently calls its default cost model. No provider wait in tx.
    const costs = await client.query(`SELECT cv.assumptions_json->>'totalModeledCostPerContract' AS cost
      FROM trade.decision d JOIN trade.fusion_snapshot fs USING(fusion_snapshot_id)
      JOIN core.cost_model_version cv USING(cost_model_version_id) WHERE d.decision_id=$1`, [plan.decisionId]);
    const cost = costs.rows[0]?.cost;
    if (typeof cost !== 'string') throw new Error('CAPITAL_DECISION_COST_EVIDENCE_MISSING');
    const ids = plan.definedRisk?.legs.map(x => x.optionContractId) ?? [plan.optionContractId];
    const contracts = await client.query(`SELECT option_contract_id::text,contract_symbol,strike::text,multiplier::text
      FROM market.option_contract WHERE option_contract_id=ANY($1::uuid[]) AND underlying_id=$2 AND option_type='PUT'`,
    [ids, plan.underlyingId]);
    if (contracts.rows.length !== ids.length || contracts.rows.some(r => {
      const evidence = observation.contracts.find(c => c.symbol === r.contract_symbol);
      return !evidence || moneyUnits(String(evidence.multiplier)) !== moneyUnits(r.multiplier)
        || moneyUnits(evidence.strike) !== moneyUnits(r.strike);
    })) throw new Error('CAPITAL_PERSISTED_CONTRACT_MISMATCH');
    const proposal = proposalForPlan(plan, observation, cost);
    const result = await this.reserveQualifiedInTransaction(client, observation, [proposal]);
    if (result.receipt.state === 'BLOCKED') throw new CapitalPlanAdmissionError(result.receipt.reasons);
    const admission = result.admissions[0];
    if (!admission || admission.state === 'BLOCKED') throw new CapitalPlanAdmissionError(admission?.reasons ?? []);
  }

  /** Called by the ONE durable order-intent store, in the insert transaction.
   * Legacy/unbound opens cannot sneak around plan reservation on schema 071.
   * Risk-reducing closes do not acquire an opening capital reservation. */
  async bindPlanIntentInTransaction(client: PoolClient, intent: PersistedPaperOrderIntent): Promise<void> {
    const accountHash = await this.lock(client, intent.executionAccountId);
    const rows = await client.query(`SELECT r.reservation_id,r.proposal_json,r.content_hash,r.remaining_quantity,
      r.order_intent_id,r.state,e.envelope_json,e.content_hash AS envelope_hash,p.plan_json,p.content_hash AS plan_hash,p.status AS plan_status
      FROM trade.capital_reservation r JOIN trade.capital_envelope e USING(envelope_id)
      JOIN trade.master_paper_action_plan p ON p.action_plan_id=r.reservation_id
      WHERE r.provider_account_ref_hash=$1 AND r.execution_account_id=$2
        AND r.proposal_json->>'decisionId'=$3 AND p.execution_account_id=r.execution_account_id
      FOR UPDATE OF r`, [accountHash,intent.executionAccountId,intent.decisionId]);
    const r = rows.rows[0];
    if (rows.rows.length !== 1) throw new Error('CAPITAL_RESERVED_PLAN_REQUIRED');
    const proposal = capitalProposalSchema.parse(r.proposal_json), envelope = capitalEnvelopeSchema.parse(r.envelope_json);
    const plan = assertCapitalIntentMatchesPlan(intent,r.plan_json);
    if (capitalContentHash(proposal) !== r.content_hash || capitalContentHash(envelope) !== r.envelope_hash
      || envelope.qualification?.accountHash !== accountHash || actionPlanContentHash(plan) !== r.plan_hash
      || proposal.authorityHash !== r.plan_hash || proposal.reservationId !== plan.actionPlanId
      || proposal.decisionId !== plan.decisionId || proposal.candidateRef !== plan.candidateId
      || proposal.strategy !== (plan.strategyBranch ?? 'THETA_CONVENTIONAL')
      || proposal.quantity !== intent.request.qty || Number(r.remaining_quantity) !== intent.request.qty
      || !['RESERVED','SUBMISSION_POSSIBLE'].includes(r.state)
      || (r.order_intent_id !== null && r.order_intent_id !== intent.orderIntentId)
      || !['READY','CLAIMED'].includes(r.plan_status)) throw new Error('CAPITAL_RESERVED_PLAN_INTEGRITY_INVALID');
    const now = Date.parse(this.clock());
    if (!Number.isFinite(now) || now < Date.parse(envelope.observedAt) || now >= Date.parse(envelope.expiresAt)
      || now >= Date.parse(plan.decisionExpiresAt)) throw new Error('CAPITAL_INTENT_ENVELOPE_STALE');
    await this.bindIntentInTransaction(client,intent.executionAccountId,proposal.reservationId,intent.orderIntentId);
  }

  /** Composable producer -> database-lineage loader -> admission -> persistence.
   * Fetch broker observations BEFORE entering this transaction. Commitments are
   * always loaded under the physical account lock, never accepted from callers.
   * The existing legacy primitive is not a Production activation switch. */
  async reserveQualifiedInTransaction(client: PoolClient,
    input: Omit<AccountCapitalInput, 'commitments' | 'now'>,
    proposals: readonly CapitalProposal[]): Promise<{ receipt: AccountCapitalResult | { state: 'REPLAY'; envelope: CapitalEnvelope };
      admissions: readonly Admission[] }> {
    const accountHash = await this.lock(client, input.executionAccountId);
    if (accountHash !== input.accountHash) throw new Error('CAPITAL_ACCOUNT_IDENTITY_CONFLICT');
    const observationHash = capitalContentHash(input);
    const previous = await client.query('SELECT envelope_json FROM trade.capital_envelope WHERE envelope_id=$1', [input.envelopeId]);
    if (previous.rows.length) {
      const envelope = capitalEnvelopeSchema.parse(previous.rows[0].envelope_json);
      if (envelope.qualification?.observationHash !== observationHash || envelope.qualification.accountHash !== accountHash)
        throw new Error('CAPITAL_ENVELOPE_IDENTITY_CONFLICT');
      // Reuse immutable qualification, never regenerate a different receipt
      // from the reservations created by the original transaction.
      return { receipt: { state: 'REPLAY', envelope },
        admissions: await this.reserveInTransaction(client, envelope, proposals, this.clock()) };
    }
    const result = await client.query(`SELECT r.reservation_id,r.remaining_quantity,r.proposal_json,r.content_hash,
      r.order_intent_id,i.decision_id,i.client_order_id,i.broker_symbol,i.quantity,i.order_class,
      (SELECT sum(f.quantity) FROM trade.fill f JOIN trade.broker_order b USING(broker_order_id)
        WHERE b.order_intent_id=r.order_intent_id) AS filled_quantity,
      (SELECT array_agg(b.provider_order_id ORDER BY b.provider_order_id) FROM trade.broker_order b
        WHERE b.order_intent_id=r.order_intent_id) AS broker_ids
      FROM trade.capital_reservation r LEFT JOIN trade.order_intent i ON i.order_intent_id=r.order_intent_id
        AND i.execution_account_id=r.execution_account_id
      WHERE r.provider_account_ref_hash=$1 AND r.remaining_quantity>0 ORDER BY r.reservation_id LIMIT 1001`, [accountHash]);
    if (result.rows.length > 1000) throw new Error('CAPITAL_ACTIVE_COMMITMENT_BOUND_EXCEEDED');
    const commitments = result.rows.map((r: Row) => {
      const proposal = capitalProposalSchema.parse(r.proposal_json);
      if (capitalContentHash(proposal) !== r.content_hash) throw new Error('CAPITAL_COMMITMENT_INTEGRITY_INVALID');
      const ids = r.broker_ids as string[] | null;
      return { reservationId: String(r.reservation_id), remainingQuantity: Number(r.remaining_quantity), proposal, accountHash,
        intent: r.order_intent_id === null || ids?.length !== 1 ? null : {
          orderIntentId: String(r.order_intent_id), decisionId: String(r.decision_id),
          clientOrderId: String(r.client_order_id), brokerOrderId: String(ids[0]), symbol: String(r.broker_symbol),
          quantity: Number(r.quantity), filledQuantity: r.filled_quantity === null ? 0 : Number(r.filled_quantity),
          orderClass: r.order_class,
        } };
    });
    // Re-read the clock AFTER lock acquisition. An observation can expire while
    // another worker owns the account, without ever sending a broker request.
    const at = this.clock();
    const receipt = deriveQualifiedAccountEnvelope({ ...input, now: at, commitments });
    if (receipt.state === 'BLOCKED') return { receipt, admissions: [] };
    const envelope: CapitalEnvelope = { ...receipt.envelope, qualification: {
      producerVersion: 'theta-account-capital-csp-v1', accountHash, policyHash: receipt.policyHash,
      inputHash: receipt.inputHash, receiptHash: receipt.receiptHash, observationHash,
      sourceEvidenceHashes: [input.account.contentHash, input.positions.contentHash, input.orders.contentHash],
      usedByDimension: receipt.usedByDimension, softLimitByDimension: receipt.softLimitByDimension,
      retainedReasons: [...receipt.retainedReasons], aegisReassessmentRequired: true, brokerAuthority: false,
    } };
    return { receipt, admissions: await this.reserveInTransaction(client, envelope, proposals, at) };
  }

  async reserve(envelope: CapitalEnvelope, proposals: readonly CapitalProposal[], at: string): Promise<readonly Admission[]> {
    return withRuntimePostgresTransaction(this.pool, client => this.reserveInTransaction(client, envelope, proposals, at));
  }

  private async lock(client: PoolClient, executionAccountId: string): Promise<string> {
    const account = await client.query(`SELECT provider_account_ref_hash FROM trade.execution_account
      WHERE execution_account_id=$1 AND environment='PAPER' AND account_ready=true FOR SHARE`, [executionAccountId]);
    if (account.rows.length !== 1) throw new Error('CAPITAL_ACCOUNT_UNAVAILABLE');
    const accountHash = String(account.rows[0].provider_account_ref_hash);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`capital:${accountHash}`]);
    return accountHash;
  }

  async reserveInTransaction(client: PoolClient, raw: CapitalEnvelope, rawProposals: readonly CapitalProposal[], at: string): Promise<readonly Admission[]> {
    const envelope = capitalEnvelopeSchema.parse(raw);
    const envelopePayload = payload(envelope);
    if (rawProposals.length === 0 || rawProposals.length > 100) throw new Error('CAPITAL_BATCH_BOUND_INVALID');
    const proposals = rawProposals.map(p => capitalProposalSchema.parse(p));
    if (!Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(envelope.observedAt)
      || Date.parse(at) >= Date.parse(envelope.expiresAt)) throw new Error('CAPITAL_ENVELOPE_STALE');
    if (new Set(proposals.map(p => p.reservationId)).size !== proposals.length
      || new Set(proposals.map(p => p.proposalRef)).size !== proposals.length) throw new Error('CAPITAL_BATCH_DUPLICATE');
    const accountHash = await this.lock(client, envelope.executionAccountId);
    if (envelope.qualification !== undefined && envelope.qualification.accountHash !== accountHash)
      throw new Error('CAPITAL_ACCOUNT_IDENTITY_CONFLICT');
    const latest = await client.query(`SELECT envelope_id,observed_at,content_hash FROM trade.capital_envelope
      WHERE provider_account_ref_hash=$1 ORDER BY observed_at DESC LIMIT 1`, [accountHash]);
    const old = latest.rows[0] as Row | undefined;
    const envelopeHash = capitalContentHash(envelope);
    if (old !== undefined && new Date(String(old.observed_at)).getTime() > Date.parse(envelope.observedAt))
      throw new Error('CAPITAL_ENVELOPE_SUPERSEDED');
    // The same broker/risk observation cannot acquire a larger competing
    // budget merely by minting a different envelope ID.
    if (old !== undefined && new Date(String(old.observed_at)).getTime() === Date.parse(envelope.observedAt)
      && old.content_hash !== envelopeHash) throw new Error('CAPITAL_ENVELOPE_IDENTITY_CONFLICT');
    await client.query(`INSERT INTO trade.capital_envelope(envelope_id,provider_account_ref_hash,observed_at,expires_at,
      evidence_hash,content_hash,envelope_json) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(envelope_id) DO NOTHING`,
    [envelope.envelopeId,accountHash,envelope.observedAt,envelope.expiresAt,envelope.evidenceHash,envelopeHash,envelopePayload]);
    const check = await client.query('SELECT content_hash FROM trade.capital_envelope WHERE envelope_id=$1', [envelope.envelopeId]);
    if (check.rows[0]?.content_hash !== envelopeHash) throw new Error('CAPITAL_ENVELOPE_IDENTITY_CONFLICT');
    const rows = await client.query(`SELECT reservation_id,proposal_ref,content_hash,proposal_json,remaining_quantity
      FROM trade.capital_reservation WHERE provider_account_ref_hash=$1 AND (remaining_quantity>0
        OR reservation_id=ANY($2::uuid[]) OR proposal_ref=ANY($3::text[])) ORDER BY reservation_id LIMIT 1001`,
    [accountHash,[...proposals.map(p => p.reservationId),...Object.keys(envelope.reflected)],proposals.map(p => p.proposalRef)]);
    if (rows.rows.length > 1000) throw new Error('CAPITAL_ACTIVE_COMMITMENT_BOUND_EXCEEDED');
    const commitments: CapitalCommitment[] = rows.rows.map((r: Row) => {
      const proposal = capitalProposalSchema.parse(r.proposal_json);
      if (capitalContentHash(proposal) !== r.content_hash || proposal.reservationId !== r.reservation_id)
        throw new Error('CAPITAL_COMMITMENT_INTEGRITY_INVALID');
      return { reservationId: String(r.reservation_id), proposal, remainingQuantity: Number(r.remaining_quantity) };
    });
    const results: Admission[] = [];
    // This is the sovereign frontier's order, not arrival-race economic ranking.
    for (const proposal of proposals) {
      const contentHash = capitalContentHash(proposal);
      const prior = rows.rows.find((r: Row) => r.reservation_id === proposal.reservationId || r.proposal_ref === proposal.proposalRef) as Row | undefined;
      if (prior !== undefined) {
        if (prior.content_hash !== contentHash || prior.reservation_id !== proposal.reservationId)
          throw new Error('CAPITAL_RESERVATION_IDEMPOTENCY_CONFLICT');
        results.push({ reservationId: proposal.reservationId, state: 'REPLAY', reasons: [] });
        continue;
      }
      const reasons = Date.parse(at) >= Date.parse(proposal.quoteExpiresAt) ? ['CAPITAL_QUOTE_STALE']
        : capitalAdmission(envelope, commitments, proposal);
      if (reasons.length) { results.push({ reservationId: proposal.reservationId, state: 'BLOCKED', reasons }); continue; }
      await client.query(`INSERT INTO trade.capital_reservation(reservation_id,provider_account_ref_hash,execution_account_id,
        envelope_id,proposal_ref,content_hash,proposal_json,remaining_quantity,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RESERVED')`, [proposal.reservationId,accountHash,envelope.executionAccountId,
        envelope.envelopeId,proposal.proposalRef,contentHash,payload(proposal),proposal.quantity]);
      commitments.push({ reservationId: proposal.reservationId, proposal, remainingQuantity: proposal.quantity });
      results.push({ reservationId: proposal.reservationId, state: 'RESERVED', reasons: [] });
    }
    return results;
  }

  /** Binding is atomic with intent persistence when composed by the caller.
   * Once bound, elapsed time or a missing HTTP response can never release it. */
  async bindIntentInTransaction(client: PoolClient, executionAccountId: string, reservationId: string, orderIntentId: string): Promise<void> {
    const accountHash = await this.lock(client, executionAccountId);
    const result = await client.query(`UPDATE trade.capital_reservation r SET order_intent_id=i.order_intent_id,state='SUBMISSION_POSSIBLE'
      FROM trade.order_intent i WHERE r.reservation_id=$1 AND r.provider_account_ref_hash=$2
        AND i.order_intent_id=$3 AND i.execution_account_id=r.execution_account_id
        AND i.decision_id::text=r.proposal_json->>'decisionId'
        AND i.quantity=(r.proposal_json->>'quantity')::numeric AND r.remaining_quantity=i.quantity
        AND (r.order_intent_id IS NULL OR r.order_intent_id=i.order_intent_id)
        AND r.state IN ('RESERVED','SUBMISSION_POSSIBLE') RETURNING r.reservation_id`, [reservationId,accountHash,orderIntentId]);
    if (result.rowCount !== 1) throw new Error('CAPITAL_INTENT_BINDING_INVALID');
  }

  /** A terminal zero-fill broker rejection/cancel releases all; a partial
   * cancel releases ONLY unfilled units. Filled units remain committed until
   * a qualified envelope reflects them. UNKNOWN/PARTIAL/CANCEL_PENDING are
   * never terminal evidence. No broker callback alone closes a position. */
  async reconcileTerminal(raw: CapitalTerminalEvidence): Promise<void> {
    await withRuntimePostgresTransaction(this.pool, client => this.reconcileTerminalInTransaction(client, raw));
  }

  /** The canonical broker reconciliation uses its existing transaction after
   * durable broker-order and fill persistence. Never acquire another client or
   * commit a capital release independently of those facts. */
  async reconcileTerminalInTransaction(client: PoolClient, raw: CapitalTerminalEvidence): Promise<void> {
    const input = terminalEvidenceSchema.parse(raw);
    const evidencePayload = payload(input);
    const { status, filledQuantity } = input.brokerOrder;
      const accountHash = await this.lock(client,input.executionAccountId);
      const hash = capitalContentHash(input);
      const event = await client.query('SELECT content_hash FROM trade.capital_reservation_event WHERE event_id=$1',[input.eventId]);
      if (event.rows.length) {
        if (event.rows[0].content_hash !== hash) throw new Error('CAPITAL_RECONCILIATION_IDEMPOTENCY_CONFLICT');
        return;
      }
      const result = await client.query(`SELECT r.*,i.status::text AS intent_status,i.order_class,
        i.client_order_id,i.quantity,
        (SELECT count(*)::integer FROM trade.broker_order b WHERE b.order_intent_id=r.order_intent_id
          AND b.provider_order_id=$3) AS matching_broker_orders,
        COALESCE((SELECT sum(f.quantity) FROM trade.fill f JOIN trade.broker_order b USING(broker_order_id)
          WHERE b.order_intent_id=r.order_intent_id),0)::text AS filled_quantity
        FROM trade.capital_reservation r JOIN trade.order_intent i ON i.order_intent_id=r.order_intent_id
        WHERE r.reservation_id=$1 AND r.provider_account_ref_hash=$2 FOR UPDATE OF r,i`,
      [input.reservationId,accountHash,input.brokerOrder.id]);
      const r = result.rows[0] as Row | undefined;
      if (r === undefined || r.intent_status !== status || Number(r.filled_quantity) !== filledQuantity
        || r.client_order_id !== input.brokerOrder.clientOrderId || Number(r.quantity) !== input.brokerOrder.quantity
        || r.matching_broker_orders !== 1)
        throw new Error('CAPITAL_TERMINAL_LEDGER_MISMATCH');
      // A native spread needs leg-level completion/assignment evidence. Parent
      // quantity alone must never release asymmetric remaining-leg exposure.
      if (r.order_class === 'mleg') throw new Error('CAPITAL_PACKAGE_RECONCILIATION_REQUIRED');
      const proposal = capitalProposalSchema.parse(r.proposal_json);
      if (filledQuantity > Number(r.remaining_quantity)
        || (status === 'FILLED' && filledQuantity !== proposal.quantity)
        || (status === 'REJECTED' && filledQuantity !== 0)
        || Date.parse(input.observedAt) < new Date(String(r.created_at)).getTime()
        || (r.last_reconciled_at !== null && Date.parse(input.observedAt) < new Date(String(r.last_reconciled_at)).getTime()))
        throw new Error('CAPITAL_TERMINAL_QUANTITY_OR_TIME_INVALID');
      await client.query(`UPDATE trade.capital_reservation SET remaining_quantity=$2,state='RECONCILED',last_reconciled_at=$3
        WHERE reservation_id=$1`,[input.reservationId,filledQuantity,input.observedAt]);
      await client.query(`INSERT INTO trade.capital_reservation_event(event_id,reservation_id,observed_at,content_hash,evidence_json)
        VALUES($1,$2,$3,$4,$5)`,[input.eventId,input.reservationId,input.observedAt,hash,evidencePayload]);
  }
}
