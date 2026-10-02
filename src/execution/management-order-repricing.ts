import type { Pool } from 'pg';
import { brokerOrderIntentState } from './broker-order-state.js';
import { managementDecisionIsCurrent, planIntegritySelectColumns, planIntegrityRowFromAliases, verifyActionPlanRow } from './action-plan-integrity.js';
import type { StockInventorySource } from './alpaca-stock-inventory-source.js';
import { paperBootstrapPreSubmitQuoteAgePolicy, prepareMasterPaperAction, type ApprovedMasterPaperActionPlan,
  type ExecutionOptionQuoteSource } from './master-paper-action-handoff.js';
import type { PaperOrderCoordinator } from './paper-order-coordinator.js';
import type { ExecutionPriceEventInput } from './postgres-execution-evidence-store.js';
import type { OrderIntentState } from '../theta/order-intent-state.js';
import { paperBootstrapRuntimePolicy } from '../theta/paper-bootstrap-runtime-policy.js';

/**
 * REPRICING_DRIVER (theta-management-reprice-v1).
 *
 * The adaptive limit policy (adaptive-limit-policy.ts) walks a limit from the favourable side toward the economic boundary in
 * `maxAttempts` bounded concessions. This driver is the production caller that actually exercises it for MANAGEMENT orders:
 * working order -> wait interval elapsed -> fresh quote -> same prepareMasterPaperAction gates -> coordinator.replace (next
 * pricingAttempt) -> ... -> boundary reached -> coordinator.cancel -> plan closed -> the next scan makes a NEW decision.
 *
 * SAME_DECISION_REPRICE vs NEW_MANAGEMENT_DECISION: within one decision the economic boundary (SELL floor / BUY ceiling) is the
 * immutable value sealed in the published plan; it is never lowered. When the boundary becomes unreachable, attempts are
 * exhausted, the plan no longer matches reality, or its integrity fails, the working order is cancelled and the plan closed with
 * a typed reason. The in-flight guard then no longer sees a non-terminal order, so the next management scan produces a new
 * frontier -> new decision id -> a freshly recomputed boundary (or a different action). A cancelled plan is never resurrected.
 *
 * Attempt state is never held in memory. It is reconstructed from persisted rows: attempts made = max(order intents of the
 * decision/action/chain, highest recorded price-event attempt number), so it cannot reset on restart, retry, reconciliation or a
 * cancel/replace cycle, and a duplicate trigger inside the wait interval is a no-op because the last action time is persisted too.
 * Maximum attempts and concession schedule come from the plan's sealed pricing policy (adaptive policy: 3 attempts); there is no
 * invented order-lifetime constant: orders are DAY orders and the plan's bounded attempts end the sequence.
 */

export const managementRepricePolicyVersion = 'theta-management-reprice-v1' as const;

export type RepriceReason =
  | 'REPLACED' | 'LIMIT_UNCHANGED' | 'NOT_DUE_WAIT_INTERVAL' | 'ORDER_ALREADY_TERMINAL' | 'PARTIAL_FILL_ORDER_LEFT_WORKING'
  | 'RECONCILIATION_NOT_GOOD' | 'MANAGEMENT_SUBMISSION_NOT_AUTHORIZED' | 'MARKET_CLOSED' | 'QUOTE_UNAVAILABLE'
  | 'ORDER_STATE_UNKNOWN' | 'BROKER_ORDER_NOT_FOUND' | 'ORDER_STATE_NOT_REPRICEABLE' | 'REPLACE_RACE_LOST'
  | 'PRE_SUBMIT_GATE_BLOCKED' | 'LATE_FILL_DURING_CANCEL'
  | 'MAX_ATTEMPTS_REACHED' | 'ECONOMIC_BOUNDARY_UNREACHABLE' | 'ECONOMICS_DISAPPEARED' | 'PLAN_INTEGRITY_MISMATCH' | 'PLAN_NO_LONGER_CURRENT';

export type RepriceBlockClass = 'TRANSIENT_RETRYABLE' | 'REQUIRES_NEW_DECISION' | 'REQUIRES_RECONCILIATION' | 'OWNER_POLICY' | 'TERMINAL';

/** Every non-success reason has exactly one recovery class: nothing may block silently and forever. */
export const repriceReasonClass: Readonly<Record<RepriceReason, RepriceBlockClass>> = Object.freeze({
  REPLACED: 'TRANSIENT_RETRYABLE', LIMIT_UNCHANGED: 'TRANSIENT_RETRYABLE', NOT_DUE_WAIT_INTERVAL: 'TRANSIENT_RETRYABLE',
  ORDER_ALREADY_TERMINAL: 'TERMINAL', PARTIAL_FILL_ORDER_LEFT_WORKING: 'OWNER_POLICY',
  RECONCILIATION_NOT_GOOD: 'TRANSIENT_RETRYABLE', MANAGEMENT_SUBMISSION_NOT_AUTHORIZED: 'TRANSIENT_RETRYABLE', MARKET_CLOSED: 'TRANSIENT_RETRYABLE',
  QUOTE_UNAVAILABLE: 'TRANSIENT_RETRYABLE', ORDER_STATE_UNKNOWN: 'REQUIRES_RECONCILIATION', BROKER_ORDER_NOT_FOUND: 'REQUIRES_RECONCILIATION',
  ORDER_STATE_NOT_REPRICEABLE: 'REQUIRES_RECONCILIATION', REPLACE_RACE_LOST: 'TRANSIENT_RETRYABLE', PRE_SUBMIT_GATE_BLOCKED: 'TRANSIENT_RETRYABLE',
  LATE_FILL_DURING_CANCEL: 'TERMINAL', MAX_ATTEMPTS_REACHED: 'REQUIRES_NEW_DECISION', ECONOMIC_BOUNDARY_UNREACHABLE: 'REQUIRES_NEW_DECISION',
  ECONOMICS_DISAPPEARED: 'REQUIRES_NEW_DECISION', PLAN_INTEGRITY_MISMATCH: 'REQUIRES_NEW_DECISION', PLAN_NO_LONGER_CURRENT: 'REQUIRES_NEW_DECISION',
});

export type RepriceOutcome =
  | { readonly kind: 'REPLACED'; readonly orderIntentId: string; readonly newOrderIntentId: string; readonly attemptNo: number; readonly limitPrice: number }
  | { readonly kind: 'KEPT'; readonly orderIntentId: string; readonly attemptNo: number; readonly limitPrice: number }
  | { readonly kind: 'CANCELED'; readonly orderIntentId: string; readonly reason: RepriceReason; readonly attemptNo: number }
  | { readonly kind: 'LEFT_WORKING'; readonly orderIntentId: string; readonly reason: RepriceReason }
  | { readonly kind: 'BLOCKED'; readonly orderIntentId: string; readonly reason: RepriceReason; readonly detail: readonly string[] };

export interface RepriceCandidate {
  readonly orderIntentId: string;
  readonly orderStatus: OrderIntentState;
  readonly limitPrice: number | null;
  /** Attempts already made for this decision/action (>= 1 for a placed order). Reconstructed from persisted rows. */
  readonly attemptsSoFar: number;
  /** Persisted time of the most recent placement/replacement/keep. */
  readonly lastActionAt: string;
  readonly actionPlanId: string;
  /** The integrity-verified sealed plan, or null when the stored row fails verification. */
  readonly plan: ApprovedMasterPaperActionPlan | null;
  readonly integrityMismatches: readonly string[];
  /** The chain is still open and still in the lifecycle state the decision was made in. */
  readonly decisionStillCurrent: boolean;
}

export interface RepriceStore {
  loadCandidates(executionAccountId: string): Promise<readonly RepriceCandidate[]>;
  /** A bounded concession that decides to keep the limit still consumes the attempt (persisted as price-event evidence). */
  closePlan(actionPlanId: string, orderIntentId: string, reason: RepriceReason, at: string): Promise<void>;
}

export interface RepriceDependencies {
  readonly now: () => string;
  readonly executionAccountId: string;
  readonly reconciliationQuality: string | null;
  readonly marketOpen: boolean | null;
  readonly managementSubmissionEnabled: boolean;
  readonly optionsCapabilityVerified: boolean;
  readonly store: RepriceStore;
  readonly coordinator: Pick<PaperOrderCoordinator, 'reconcileIntent' | 'replace' | 'cancel'>;
  readonly quoteSource: ExecutionOptionQuoteSource;
  readonly stockInventory?: StockInventorySource;
  readonly recordPriceEvent?: (input: ExecutionPriceEventInput) => Promise<unknown>;
}

export interface RepriceReport {
  readonly examined: number;
  readonly replaced: number;
  readonly kept: number;
  readonly canceled: number;
  readonly leftWorking: number;
  readonly blocked: number;
  readonly outcomes: readonly RepriceOutcome[];
}

const workingStates: ReadonlySet<OrderIntentState> = new Set<OrderIntentState>(['SUBMITTED', 'ACKNOWLEDGED', 'PARTIAL']);
const terminalStates: ReadonlySet<OrderIntentState> = new Set<OrderIntentState>(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']);

const priceEvidenceFor = (action: string): 'ALPACA_STOCK_BBO' | 'QUALIFIED_OPTION_BBO' =>
  action === 'SELL_STOCK' ? 'ALPACA_STOCK_BBO' : 'QUALIFIED_OPTION_BBO';

const economicReasonFor = (blocker: string): RepriceReason | null => {
  if (blocker.endsWith('ECONOMIC_BOUNDARY_UNREACHABLE')) return 'ECONOMIC_BOUNDARY_UNREACHABLE';
  if (blocker.endsWith('MAX_ATTEMPTS_REACHED')) return 'MAX_ATTEMPTS_REACHED';
  if (blocker.endsWith('ECONOMICS_DISAPPEARED')) return 'ECONOMICS_DISAPPEARED';
  return null;
};

async function repriceOne(deps: RepriceDependencies, candidate: RepriceCandidate): Promise<RepriceOutcome> {
  const orderIntentId = candidate.orderIntentId;
  const at = deps.now();
  const blocked = (reason: RepriceReason, detail: readonly string[] = []): RepriceOutcome => ({ kind: 'BLOCKED', orderIntentId, reason, detail });
  const leftWorking = (reason: RepriceReason): RepriceOutcome => ({ kind: 'LEFT_WORKING', orderIntentId, reason });
  if (!deps.managementSubmissionEnabled) return blocked('MANAGEMENT_SUBMISSION_NOT_AUTHORIZED');
  if (deps.reconciliationQuality !== 'GOOD') return blocked('RECONCILIATION_NOT_GOOD');
  const plan = candidate.plan;

  const cancelOrder = async (reason: RepriceReason): Promise<RepriceOutcome> => {
    const action = plan?.action ?? 'CLOSE_CSP';
    const stepWindow = paperBootstrapRuntimePolicy.quoteAge.planWindowManagementMilliseconds;
    let after;
    try {
      after = await deps.coordinator.cancel(orderIntentId, { baseHostname: 'paper-api.alpaca.markets', accountVerified: true,
        optionsCapabilityVerified: deps.optionsCapabilityVerified, aegisState: plan?.aegisState ?? 'HOLD_ONLY', quoteFresh: true,
        priceEvidence: priceEvidenceFor(action), decisionExpiresAt: new Date(Date.parse(at) + stepWindow).toISOString(), now: at, isNewEntry: false });
    } catch { return blocked('ORDER_STATE_UNKNOWN', ['CANCEL_FAILED_RECONCILE_BEFORE_RETRY']); }
    const state = after === null ? null : brokerOrderIntentState(after);
    if (state === 'FILLED') return leftWorking('LATE_FILL_DURING_CANCEL');
    if (state === 'PARTIAL') return blocked('ORDER_STATE_NOT_REPRICEABLE', ['CANCEL_NOT_COMPLETED_PARTIAL_FILL']);
    if (state !== 'CANCELED' && state !== 'EXPIRED' && state !== 'REJECTED' && state !== 'CANCEL_REQUESTED') {
      return blocked('ORDER_STATE_UNKNOWN', ['CANCEL_RESULT_UNKNOWN']);
    }
    if (state === 'CANCEL_REQUESTED') return blocked('ORDER_STATE_NOT_REPRICEABLE', ['CANCEL_PENDING']);
    await deps.store.closePlan(candidate.actionPlanId, orderIntentId, reason, at);
    return { kind: 'CANCELED', orderIntentId, reason, attemptNo: candidate.attemptsSoFar };
  };

  // 1. The sealed plan must still be exactly what was approved, and its decision still current.
  if (plan === null) return cancelOrder('PLAN_INTEGRITY_MISMATCH');
  if (!candidate.decisionStillCurrent) return cancelOrder('PLAN_NO_LONGER_CURRENT');

  // 2. Broker truth first. Unknown / missing broker state never becomes a retry or a fill.
  let broker;
  try { broker = await deps.coordinator.reconcileIntent(orderIntentId); } catch { return blocked('ORDER_STATE_UNKNOWN'); }
  if (broker === null) return blocked('BROKER_ORDER_NOT_FOUND');
  const state = brokerOrderIntentState(broker);
  if (state === null) return blocked('ORDER_STATE_UNKNOWN');
  if (terminalStates.has(state)) return leftWorking('ORDER_ALREADY_TERMINAL');
  if (!workingStates.has(state)) return blocked('ORDER_STATE_NOT_REPRICEABLE', [state]);
  const partiallyFilled = broker.filledQty > 0;
  // A part-filled order is NEVER replaced: the fills belong to the original broker order, a replacement would carry only the
  // later fills, and neither intent would then satisfy the one-intent-fully-filled rule the lifecycle router needs, stranding
  // the ledger. It rests at its last bounded price (DAY order) until it fills or the session ends, and terminal-partial
  // accounting runs on the original intent. Partial-position accounting beyond that is OWNER_POLICY.
  if (partiallyFilled) return leftWorking('PARTIAL_FILL_ORDER_LEFT_WORKING');

  // 3. Wait interval (persisted last action time, so a duplicate trigger or restart cannot double-step).
  const elapsed = Date.parse(at) - Date.parse(candidate.lastActionAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return blocked('ORDER_STATE_UNKNOWN', ['LAST_ACTION_TIME_INVALID']);
  if (elapsed < plan.pricingPolicy.waitIntervalMs) return leftWorking('NOT_DUE_WAIT_INTERVAL');

  // 4. Attempts exhausted: the bounded concession sequence is over (part-filled orders never get here, see above).
  if (candidate.attemptsSoFar >= plan.pricingPolicy.maxAttempts) return cancelOrder('MAX_ATTEMPTS_REACHED');
  if (deps.marketOpen !== true) return blocked('MARKET_CLOSED');
  if (candidate.limitPrice === null || !Number.isFinite(candidate.limitPrice) || candidate.limitPrice <= 0) return blocked('ORDER_STATE_UNKNOWN', ['PREVIOUS_LIMIT_UNKNOWN']);

  // 5. All pre-submit gates again, on a fresh quote, for the NEXT pricing attempt. The plan economics (boundary, quantity,
  //    identity, share evidence) are the sealed ones; only the attempt index, previous limit and step window change.
  const stepPlan: ApprovedMasterPaperActionPlan = { ...plan, pricingAttempt: candidate.attemptsSoFar, previousLimit: candidate.limitPrice,
    decisionExpiresAt: new Date(Date.parse(at) + paperBootstrapRuntimePolicy.quoteAge.planWindowManagementMilliseconds).toISOString() };
  const prepared = await prepareMasterPaperAction(stepPlan, deps.quoteSource, at, true, paperBootstrapPreSubmitQuoteAgePolicy, deps.now, deps.stockInventory);

  // The adaptive policy decided the concession lands on the limit already resting: no broker mutation, but the attempt is spent
  // (persisted as price-event evidence) so the bounded sequence still terminates. (The handoff reports a non-PLACE/REPLACE
  // decision as PRICE_REJECTED, so KEEP is recognised from the pricing decision itself.)
  if (prepared.pricing?.action === 'KEEP' && prepared.pricing.limitPrice !== null && prepared.quote !== null) {
    const attemptNo = candidate.attemptsSoFar + 1;
    if (deps.recordPriceEvent === undefined) return blocked('ORDER_STATE_UNKNOWN', ['ATTEMPT_EVIDENCE_SINK_MISSING']);
    await deps.recordPriceEvent({ orderIntentId, eventType: 'REPLACEMENT', eventTime: prepared.evaluatedAt, quote: prepared.quote,
      quoteAgeMs: prepared.quoteAgeMs, pricing: prepared.pricing, fillPrice: null, filledQuantity: null, attemptNo,
      reasonCode: 'ADAPTIVE_LIMIT_KEEP' });
    return { kind: 'KEPT', orderIntentId, attemptNo, limitPrice: prepared.pricing.limitPrice };
  }

  if (prepared.state === 'READY_TO_SUBMIT' && prepared.command !== null && prepared.pricing !== null && prepared.quote !== null) {
    const attemptNo = candidate.attemptsSoFar + 1;
    const limitPrice = prepared.pricing.limitPrice as number;
    let replacement;
    try { replacement = await deps.coordinator.replace(orderIntentId, prepared.command, prepared.command.gate); }
    catch (error) {
      // Idempotency collision / lineage / already-replaced races are lost races, not new exposure and not a retry of an unknown.
      const message = error instanceof Error ? error.message : String(error);
      if (/IDEMPOTENCY_COLLISION|REPLACEMENT_|Stale or missing order intent transition|BROKER_ORDER_NOT_FOUND/.test(message)) return blocked('REPLACE_RACE_LOST', [message]);
      throw error;
    }
    if (replacement !== null && brokerOrderIntentState(replacement) === 'FILLED') return leftWorking('ORDER_ALREADY_TERMINAL');
    if (deps.recordPriceEvent !== undefined) {
      try {
        await deps.recordPriceEvent({ orderIntentId: prepared.command.orderIntentId, eventType: 'REPLACEMENT', eventTime: prepared.evaluatedAt,
          quote: prepared.quote, quoteAgeMs: prepared.quoteAgeMs, pricing: prepared.pricing, fillPrice: null, filledQuantity: null, attemptNo,
          reasonCode: `REPRICE:${managementRepricePolicyVersion}` });
      } catch { /* evidence-only; the broker action and the persisted intent are the authority */ }
    }
    return { kind: 'REPLACED', orderIntentId, newOrderIntentId: prepared.command.orderIntentId, attemptNo, limitPrice };
  }

  if (prepared.state === 'PRICE_REJECTED') {
    const economic = prepared.blockers.map(economicReasonFor).find((reason) => reason !== null) ?? null;
    if (economic !== null) return cancelOrder(economic);
    return blocked('QUOTE_UNAVAILABLE', prepared.blockers);
  }
  if (prepared.state === 'NO_QUOTE' || prepared.state === 'QUOTE_REJECTED') return blocked('QUOTE_UNAVAILABLE', prepared.blockers);
  return blocked('PRE_SUBMIT_GATE_BLOCKED', prepared.blockers);
}

/** Runs one bounded repricing pass over every working management order of the execution account. Never throws for a single order. */
export async function runManagementRepricing(deps: RepriceDependencies): Promise<RepriceReport> {
  const candidates = await deps.store.loadCandidates(deps.executionAccountId);
  const outcomes: RepriceOutcome[] = [];
  for (const candidate of candidates) {
    try { outcomes.push(await repriceOne(deps, candidate)); }
    catch (error) {
      outcomes.push({ kind: 'BLOCKED', orderIntentId: candidate.orderIntentId, reason: 'ORDER_STATE_UNKNOWN',
        detail: [error instanceof Error ? error.message.slice(0, 120) : 'UNKNOWN_ERROR'] });
    }
  }
  const count = (kind: RepriceOutcome['kind']) => outcomes.filter((outcome) => outcome.kind === kind).length;
  return { examined: candidates.length, replaced: count('REPLACED'), kept: count('KEPT'), canceled: count('CANCELED'),
    leftWorking: count('LEFT_WORKING'), blocked: count('BLOCKED'), outcomes };
}

// ---------------------------------------------------------------------------------------------------------------------------
// PostgreSQL store
// ---------------------------------------------------------------------------------------------------------------------------

const toIso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);

export class PostgresManagementRepriceStore implements RepriceStore {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async loadCandidates(executionAccountId: string): Promise<readonly RepriceCandidate[]> {
    const working = await this.pool.query(
      `SELECT oi.order_intent_id::text AS order_intent_id, oi.decision_id::text AS decision_id, oi.chain_id::text AS chain_id,
         oi.theta_action, oi.status::text AS status, oi.limit_price::float8 AS limit_price,
         p.action_plan_id::text AS plan_row_id, p.management_input_snapshot_id::text AS plan_snapshot_id, ${planIntegritySelectColumns},
         ec.closed_at AS chain_closed_at, ec.lifecycle_state::text AS chain_state, mis.lifecycle_state::text AS plan_state
       FROM trade.order_intent oi
       JOIN trade.master_paper_action_plan p ON p.decision_id=oi.decision_id AND p.execution_account_id=oi.execution_account_id
         AND p.authority_kind='MANAGEMENT' AND p.plan_json->>'action'=oi.theta_action AND p.status='SUBMITTED'
       JOIN trade.economic_chain ec ON ec.chain_id=oi.chain_id
       LEFT JOIN trade.management_input_snapshot mis ON mis.management_input_snapshot_id=p.management_input_snapshot_id
       WHERE oi.execution_account_id=$1 AND oi.status::text IN ('SUBMITTED','ACKNOWLEDGED','PARTIAL')
       ORDER BY oi.created_at, oi.order_intent_id`, [executionAccountId]);
    const candidates: RepriceCandidate[] = [];
    for (const raw of working.rows as Record<string, unknown>[]) {
      const state = await this.pool.query(
        `SELECT count(DISTINCT oi.order_intent_id)::int AS intents,
           COALESCE(max(pe.attempt_no), 0)::int AS max_attempt_no,
           max(GREATEST(oi.intent_persisted_at, COALESCE(pe.event_time, oi.intent_persisted_at))) AS last_action_at
         FROM trade.order_intent oi
         LEFT JOIN trade.execution_price_event pe ON pe.order_intent_id=oi.order_intent_id
         WHERE oi.execution_account_id=$1 AND oi.decision_id=$2 AND oi.theta_action=$3 AND oi.chain_id=$4`,
        [executionAccountId, raw.decision_id, raw.theta_action, raw.chain_id]);
      const attempts = state.rows[0] as Record<string, unknown> | undefined;
      if (attempts === undefined || attempts.last_action_at === null || attempts.last_action_at === undefined) continue;
      const integrity = verifyActionPlanRow(planIntegrityRowFromAliases(raw));
      candidates.push({
        orderIntentId: String(raw.order_intent_id), orderStatus: String(raw.status) as OrderIntentState,
        limitPrice: raw.limit_price === null ? null : Number(raw.limit_price),
        attemptsSoFar: Math.max(Number(attempts.intents), Number(attempts.max_attempt_no)),
        lastActionAt: toIso(attempts.last_action_at), actionPlanId: String(raw.plan_row_id),
        plan: integrity.ok ? integrity.plan : null, integrityMismatches: integrity.mismatches,
        decisionStillCurrent: managementDecisionIsCurrent({ legSequence: Number(raw.ip_leg_sequence), chainClosed: raw.chain_closed_at !== null,
          chainState: raw.chain_state == null ? null : String(raw.chain_state), planState: raw.plan_state == null ? null : String(raw.plan_state) }),
      });
    }
    return candidates;
  }

  async closePlan(actionPlanId: string, orderIntentId: string, reason: RepriceReason, at: string): Promise<void> {
    // SUBMITTED -> TERMINAL. Operational columns only; the economic payload stays sealed.
    const updated = await this.pool.query(
      `UPDATE trade.master_paper_action_plan SET status='TERMINAL', last_blockers_json=$2::jsonb, updated_at=$3
       WHERE action_plan_id=$1 AND status='SUBMITTED' RETURNING action_plan_id`,
      [actionPlanId, JSON.stringify([reason]), at]);
    if ((updated.rowCount ?? 0) === 1) {
      await this.pool.query(
        `INSERT INTO trade.master_paper_action_plan_event(action_plan_event_id,action_plan_id,state,event_time,detail_json)
         VALUES(gen_random_uuid(),$1,'TERMINAL',$2,$3::jsonb)`,
        [actionPlanId, at, JSON.stringify({ blockers: [reason], orderIntentId, class: repriceReasonClass[reason], policy: managementRepricePolicyVersion })]);
    }
  }
}

/**
 * A READY order intent that never reached the broker (a crash between persisting the intent and submitting it) holds the chain's
 * in-flight guard forever. Once its decision window has passed and no broker order exists it can never be submitted, so it
 * becomes EXPIRED (terminal) and releases the chain. Intents with any broker order row are never touched.
 */
export async function expireStaleReadyOrderIntents(pool: Pick<Pool, 'query'>, executionAccountId: string, now: string): Promise<number> {
  const result = await pool.query(
    `UPDATE trade.order_intent oi SET status='EXPIRED', updated_at=$3
     WHERE oi.execution_account_id=$1 AND oi.status::text='READY' AND oi.decision_expires_at < $2::timestamptz
       AND NOT EXISTS (SELECT 1 FROM trade.broker_order bo WHERE bo.order_intent_id=oi.order_intent_id)
     RETURNING oi.order_intent_id`, [executionAccountId, now, now]);
  return result.rowCount ?? 0;
}
