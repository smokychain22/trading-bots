import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from './broker.js';
import { AlpacaPaperBrokerError, hashBrokerPayload } from './broker.js';
import { authorizeBrokerMutation, type ExecutionGateContext, type PaperExecutionControl } from './execution-control.js';
import type { OrderIntentState } from '../theta/order-intent-state.js';
import { assertValidOrderIntentTransition, isValidOrderIntentTransition } from '../theta/order-intent-state.js';
import { brokerOrderIntentState } from './broker-order-state.js';
import { thetaActionOpensNewRisk } from './order-construction.js';
import { parseOccOptionSymbol } from '../theta/account-exposure.js';

export interface PersistedPaperOrderIntent {
  readonly orderIntentId: string;
  readonly executionAccountId: string;
  readonly request: BrokerOrderRequest;
  readonly status: OrderIntentState;
  readonly action: string;
  readonly decisionId: string;
  readonly persistedAt: string;
  readonly brokerOrderId: string | null;
  readonly chainId: string;
  readonly optionContractId: string | null;
  readonly underlyingId: string;
  readonly executionEvidence: {
    readonly quoteSource: string;
    readonly quoteFeed: string | null;
    readonly quoteSemantics: 'CONSOLIDATED_NBBO' | 'TRUSTED_TWO_SIDED_ORDER_PRICING' | 'PAPER_INDICATIVE_REFERENCE';
    readonly quoteAsOf: string;
    readonly decisionExpiresAt: string;
    readonly quoteContentHash: string;
    readonly aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO';
  };
  readonly authorizationEvidence: {
    readonly executionTier: 'PAPER_EVIDENCE'|'EMPIRICALLY_PROMOTED_PAPER';
    readonly canonicalQuantity: number;
    readonly paperEvidenceQuantity: number;
    readonly empiricalEconomicsReady: boolean;
    readonly expectedAfterCostEv: number|null;
  };
}

export interface ExecutionAttemptRecord {
  readonly orderIntentId: string;
  readonly attemptNo: number;
  readonly requestedAt: string;
  readonly requestPayloadHash: string;
  readonly responseStatus: string | null;
  readonly timeoutFlag: boolean;
  readonly reconcileBeforeRetry: boolean;
}

export interface PaperOrderStore {
  insertIntent(intent: PersistedPaperOrderIntent): Promise<void>;
  getIntent(orderIntentId: string): Promise<PersistedPaperOrderIntent | null>;
  transitionIntent(orderIntentId: string, from: OrderIntentState, to: OrderIntentState, brokerOrderId?: string | null): Promise<void>;
  recordAttempt(attempt: ExecutionAttemptRecord): Promise<void>;
  updateAttempt(orderIntentId: string, attemptNo: number, result: Pick<ExecutionAttemptRecord, 'responseStatus' | 'timeoutFlag' | 'reconcileBeforeRetry'>): Promise<void>;
  unresolvedIntents(): Promise<readonly PersistedPaperOrderIntent[]>;
}

export interface PrepareIntentInput extends Omit<PersistedPaperOrderIntent, 'status' | 'persistedAt' | 'brokerOrderId'> {
  readonly persistedAt: string;
}

export type PaperOrderGate = Omit<ExecutionGateContext,
  'intentPersisted' | 'accountKind' | 'environment' | 'clientOrderId' | 'quantity' | 'operation'>;

function validateAuthorizationEvidence(intent: PersistedPaperOrderIntent | PrepareIntentInput): void {
  // Defense in depth behind buildAlpacaLimitOrder: a persisted sell order on a call contract is only
  // legitimate as an explicit covered-call open. Any other action carrying it is an uncovered short call.
  if (intent.request.side === 'sell' && parseOccOptionSymbol(intent.request.symbol)?.optionType === 'CALL'
    && intent.action !== 'OPEN_CC' && intent.action !== 'ROLL_CC_OPEN') throw new Error('SHORT_CALL_REQUIRES_COVERED_CALL_ACTION');
  const evidence = intent.authorizationEvidence;
  if (!['PAPER_EVIDENCE', 'EMPIRICALLY_PROMOTED_PAPER'].includes(evidence.executionTier)) throw new Error('LIVE_EXECUTION_NOT_AUTHORIZED');
  if (![evidence.canonicalQuantity, evidence.paperEvidenceQuantity, intent.request.qty].every(value => Number.isSafeInteger(value) && value > 0)
    || intent.request.qty !== evidence.paperEvidenceQuantity || evidence.paperEvidenceQuantity > evidence.canonicalQuantity)
    throw new Error('PAPER_EVIDENCE_QUANTITY_INVALID');
  if (thetaActionOpensNewRisk(intent.action) && evidence.executionTier === 'EMPIRICALLY_PROMOTED_PAPER'
    && (evidence.empiricalEconomicsReady !== true || evidence.expectedAfterCostEv === null
      || !Number.isFinite(evidence.expectedAfterCostEv) || evidence.expectedAfterCostEv <= 0))
    throw new Error('EMPIRICAL_PROMOTION_ECONOMICS_NOT_READY');
}

function assertBrokerSnapshotMatches(intent: PersistedPaperOrderIntent, order: BrokerOrderSnapshot): void {
  if (order.clientOrderId !== intent.request.client_order_id || order.symbol !== intent.request.symbol
    || order.side !== intent.request.side || order.qty !== intent.request.qty
    || (order.positionIntent != null && order.positionIntent !== intent.request.position_intent)
    || (intent.brokerOrderId !== null && order.id !== intent.brokerOrderId)) throw new Error('BROKER_ORDER_INTENT_IDENTITY_MISMATCH');
  if (!order.id.trim() || !Number.isSafeInteger(order.qty) || order.qty <= 0
    || !Number.isSafeInteger(order.filledQty) || order.filledQty < 0 || order.filledQty > order.qty
    || (['fill', 'filled'].includes(order.status.toLowerCase()) && order.filledQty !== order.qty))
    throw new Error('BROKER_ORDER_QUANTITY_INVALID');
}

/** Time after a decision window during which an ambiguous submission that is absent at the broker still counts as unresolved. */
export const absentUnknownSubmissionGraceMs = 120_000;

export class PaperOrderCoordinator {
  constructor(
    private readonly broker: PaperBrokerAdapter,
    private readonly store: PaperOrderStore,
    private readonly control: PaperExecutionControl,
  ) {}

  async prepare(input: PrepareIntentInput): Promise<PersistedPaperOrderIntent> {
    const existing = await this.store.getIntent(input.orderIntentId);
    if (existing !== null) {
      const identity=(value:PersistedPaperOrderIntent|PrepareIntentInput)=>hashBrokerPayload({executionAccountId:value.executionAccountId,
        decisionId:value.decisionId,action:value.action,request:value.request,chainId:value.chainId,
        optionContractId:value.optionContractId,underlyingId:value.underlyingId,executionEvidence:value.executionEvidence,
        authorizationEvidence:value.authorizationEvidence});
      const same = identity(existing) === identity(input);
      if (!same) throw new Error('ORDER_INTENT_IDEMPOTENCY_COLLISION');
      return existing;
    }
    const intent: PersistedPaperOrderIntent = { ...input, status: 'READY', brokerOrderId: null };
    await this.store.insertIntent(intent);
    return intent;
  }

  async submit(orderIntentId: string, gate: PaperOrderGate): Promise<BrokerOrderSnapshot | null> {
    const intent = await this.store.getIntent(orderIntentId);
    if (intent === null) throw new Error('Order intent must be persisted before submission.');
    const expectedNewRisk = thetaActionOpensNewRisk(intent.action);
    validateAuthorizationEvidence(intent);
    if (gate.isNewEntry !== expectedNewRisk) throw new Error('ORDER_ACTION_RISK_CLASSIFICATION_MISMATCH');
    const expectedPriceEvidence = intent.action === 'SELL_STOCK' ? 'ALPACA_STOCK_BBO' : 'QUALIFIED_OPTION_BBO';
    if (gate.priceEvidence !== expectedPriceEvidence) throw new Error('ORDER_EXECUTABLE_PRICE_PROVENANCE_MISMATCH');
    const authorization = authorizeBrokerMutation(this.control, {
      ...gate,
      intentPersisted: true,
      accountKind: this.broker.accountKind,
      environment: this.broker.environment,
      clientOrderId: intent.request.client_order_id,
      quantity: intent.request.qty,
      operation: 'SUBMIT',
    });
    assertValidOrderIntentTransition(intent.status, 'SUBMITTING');
    await this.store.transitionIntent(orderIntentId, intent.status, 'SUBMITTING');
    await this.store.recordAttempt({
      orderIntentId,
      attemptNo: 1,
      requestedAt: gate.now,
      requestPayloadHash: hashBrokerPayload(intent.request),
      responseStatus: null,
      timeoutFlag: false,
      reconcileBeforeRetry: false,
    });

    let brokerOrder: BrokerOrderSnapshot;
    try {
      brokerOrder = await this.broker.submitOrder(intent.request, authorization);
    } catch (error) {
      if (!(error instanceof AlpacaPaperBrokerError) || error.category !== 'AMBIGUOUS_NETWORK') {
        const found = await this.settleDefiniteMutationFailure(orderIntentId, error);
        if (found !== null) return found;
        throw error;
      }
      await this.store.updateAttempt(orderIntentId, 1, { responseStatus: null, timeoutFlag: true, reconcileBeforeRetry: true });
      await this.store.transitionIntent(orderIntentId, 'SUBMITTING', 'UNKNOWN_SUBMISSION');
      return this.reconcileUnknown(orderIntentId);
    }
    // Keep broker mutation outside the persistence catch path. If either write
    // below fails after Alpaca accepted the POST, SUBMITTING remains restart-
    // recoverable and must never be mislabeled REJECTED.
    await this.store.updateAttempt(orderIntentId, 1, { responseStatus: brokerOrder.status, timeoutFlag: false, reconcileBeforeRetry: false });
    await this.syncBrokerSnapshot(orderIntentId, brokerOrder);
    return brokerOrder;
  }

  /**
   * A definite (non-ambiguous) failure of a SUBMIT/REPLACE mutation while the intent is SUBMITTING. 429 (not processed) and
   * 409/422 (possibly "client_order_id must be unique", i.e. the order may ALREADY exist) are reconciled by client order id
   * BEFORE the intent is called REJECTED, so a live broker order can never sit behind a REJECTED intent and a retry can never
   * mint a second economically identical order. If the reconciliation read itself fails, the intent becomes
   * UNKNOWN_SUBMISSION (restart-recoverable). Returns the broker order when one exists; null after marking REJECTED.
   */
  private async settleDefiniteMutationFailure(orderIntentId: string, error: unknown): Promise<BrokerOrderSnapshot | null> {
    const broker = error instanceof AlpacaPaperBrokerError ? error : null;
    const status = broker === null ? 'ERROR' : String(broker.httpStatus ?? broker.category);
    const mustReconcile = broker !== null && (broker.category === 'RATE_LIMITED'
      || (broker.category === 'BROKER_REJECTED' && (broker.httpStatus === 409 || broker.httpStatus === 422)));
    await this.store.updateAttempt(orderIntentId, 1, { responseStatus: status, timeoutFlag: false, reconcileBeforeRetry: mustReconcile });
    if (mustReconcile) {
      const intent = await this.store.getIntent(orderIntentId);
      if (intent === null) throw new Error('Order intent disappeared during submission failure handling.');
      let existing: BrokerOrderSnapshot | null;
      try {
        existing = await this.broker.getOrderByClientOrderId(intent.request.client_order_id);
      } catch {
        await this.store.transitionIntent(orderIntentId, 'SUBMITTING', 'UNKNOWN_SUBMISSION');
        throw error;
      }
      if (existing !== null) {
        await this.syncBrokerSnapshot(orderIntentId, existing);
        return existing;
      }
    }
    await this.store.transitionIntent(orderIntentId, 'SUBMITTING', 'REJECTED');
    return null;
  }

  async syncBrokerSnapshot(orderIntentId: string, brokerOrder: BrokerOrderSnapshot): Promise<OrderIntentState> {
    const intent = await this.store.getIntent(orderIntentId);
    if (intent === null) throw new Error('Order intent cannot be synchronized before persistence.');
    assertBrokerSnapshotMatches(intent, brokerOrder);
    let brokerState = brokerOrderIntentState(brokerOrder);
    if (brokerState === null) throw new Error('BROKER_ORDER_STATUS_UNKNOWN');
    // CANCEL_REQUESTED has no direct edge to EXPIRED/REJECTED; an unfilled order that ends that way after a cancel request is
    // operationally canceled. Without this the intent would be stuck in CANCEL_REQUESTED forever (silently ignored edge).
    if (intent.status === 'CANCEL_REQUESTED' && (brokerState === 'EXPIRED' || brokerState === 'REJECTED')) brokerState = 'CANCELED';
    if (intent.status === brokerState) return brokerState;
    const terminal = new Set<OrderIntentState>(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']);
    if (terminal.has(intent.status)) return intent.status;
    if (!isValidOrderIntentTransition(intent.status, brokerState)) return intent.status;
    await this.store.transitionIntent(orderIntentId, intent.status, brokerState, brokerOrder.id);
    return brokerState;
  }

  async reconcileUnknown(orderIntentId: string): Promise<BrokerOrderSnapshot | null> {
    const intent = await this.store.getIntent(orderIntentId);
    if (intent === null) throw new Error('Unknown order intent cannot be reconciled.');
    if (intent.status !== 'UNKNOWN_SUBMISSION' && intent.status !== 'RECONCILING') throw new Error('Only ambiguous submissions may use unknown-submission reconciliation.');
    if (intent.status === 'UNKNOWN_SUBMISSION') await this.store.transitionIntent(orderIntentId, 'UNKNOWN_SUBMISSION', 'RECONCILING');
    const brokerOrder = await this.broker.getOrderByClientOrderId(intent.request.client_order_id);
    if (brokerOrder === null) return null;
    await this.syncBrokerSnapshot(orderIntentId, brokerOrder);
    return brokerOrder;
  }

  async reconcileIntent(orderIntentId: string): Promise<BrokerOrderSnapshot | null> {
    const intent = await this.store.getIntent(orderIntentId);
    if (intent === null) throw new Error('Order intent cannot be reconciled before persistence.');
    if (intent.status === 'UNKNOWN_SUBMISSION' || intent.status === 'RECONCILING') return this.reconcileUnknown(orderIntentId);
    const brokerOrder = await this.broker.getOrderByClientOrderId(intent.request.client_order_id);
    if (brokerOrder !== null) await this.syncBrokerSnapshot(orderIntentId, brokerOrder);
    return brokerOrder;
  }

  async cancel(orderIntentId: string, gate: PaperOrderGate): Promise<BrokerOrderSnapshot | null> {
    const intent = await this.store.getIntent(orderIntentId);
    if (intent === null) throw new Error('Order intent must be persisted before cancellation.');
    const current = await this.broker.getOrderByClientOrderId(intent.request.client_order_id);
    if (current === null) throw new Error('BROKER_ORDER_NOT_FOUND_RECONCILIATION_REQUIRED');
    const currentState = await this.syncBrokerSnapshot(orderIntentId, current);
    if (['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(currentState)) return current;
    const refreshed = await this.store.getIntent(orderIntentId);
    if (refreshed === null) throw new Error('Order intent disappeared during cancellation.');
    const authorization = authorizeBrokerMutation(this.control, {
      ...gate, operation: 'CANCEL', intentPersisted: true,
      accountKind: this.broker.accountKind, environment: this.broker.environment,
      clientOrderId: intent.request.client_order_id, quantity: intent.request.qty,
    });
    // A previous cancel attempt that failed definitively (429, 4xx) leaves CANCEL_REQUESTED; cancel is idempotent at the
    // broker, so it may be re-issued from that state. Any other state must follow the transition table.
    if (refreshed.status !== 'CANCEL_REQUESTED') {
      assertValidOrderIntentTransition(refreshed.status, 'CANCEL_REQUESTED');
      await this.store.transitionIntent(orderIntentId, refreshed.status, 'CANCEL_REQUESTED', current.id);
    }
    try {
      await this.broker.cancelOrder(current.id, authorization);
    } catch (error) {
      if (error instanceof AlpacaPaperBrokerError && error.category === 'AMBIGUOUS_NETWORK') {
        await this.store.transitionIntent(orderIntentId, 'CANCEL_REQUESTED', 'UNKNOWN_SUBMISSION', current.id);
        return this.reconcileUnknown(orderIntentId);
      }
      // 404/422 on cancel usually means the order already reached a terminal state (filled/canceled/expired) between our
      // read and the DELETE. Re-read broker truth; a terminal result is the answer, not an error.
      if (error instanceof AlpacaPaperBrokerError && error.category === 'BROKER_REJECTED' && (error.httpStatus === 404 || error.httpStatus === 422)) {
        const reread = await this.broker.getOrderByClientOrderId(intent.request.client_order_id);
        if (reread !== null) {
          const state = await this.syncBrokerSnapshot(orderIntentId, reread);
          if (['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(state)) return reread;
        }
      }
      // A definite cancel error does not mean the working order was rejected.
      // Leave CANCEL_REQUESTED for mandatory broker reconciliation.
      throw error;
    }
    const after = await this.broker.getOrderByClientOrderId(intent.request.client_order_id);
    if (after !== null) await this.syncBrokerSnapshot(orderIntentId, after);
    return after;
  }

  async replace(originalOrderIntentId: string, replacement: PrepareIntentInput,
    gate: PaperOrderGate): Promise<BrokerOrderSnapshot | null> {
    const original = await this.store.getIntent(originalOrderIntentId);
    if (original === null) throw new Error('Original order intent must be persisted before replacement.');
    const current = await this.broker.getOrderByClientOrderId(original.request.client_order_id);
    if (current === null) throw new Error('BROKER_ORDER_NOT_FOUND_RECONCILIATION_REQUIRED');
    const currentState = await this.syncBrokerSnapshot(originalOrderIntentId, current);
    if (['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(currentState)) return current;
    if (replacement.action !== original.action || replacement.decisionId !== original.decisionId
      || replacement.executionAccountId !== original.executionAccountId) throw new Error('REPLACEMENT_LINEAGE_MISMATCH');
    if (replacement.request.symbol !== original.request.symbol || replacement.request.side !== original.request.side
      || replacement.request.position_intent !== original.request.position_intent) throw new Error('REPLACEMENT_EXPOSURE_MISMATCH');
    // Paper policy (owner): a part-filled stock sale is never replaced; it rests as its bounded DAY order and the remainder is
    // not auto-resubmitted at terminal state.
    if (original.action === 'SELL_STOCK' && current.filledQty > 0) throw new Error('PARTIAL_STOCK_SELL_REPLACE_FORBIDDEN');
    if ((current.filledQty > 0 && replacement.request.qty <= current.filledQty)
      || replacement.request.qty > original.request.qty) {
      throw new Error('REPLACEMENT_QUANTITY_MAY_NOT_INCREASE_EXPOSURE');
    }
    validateAuthorizationEvidence(replacement);
    const persistedReplacement = await this.prepare(replacement);
    if (persistedReplacement.status !== 'READY') return this.reconcileIntent(replacement.orderIntentId);
    const expectedPriceEvidence = original.action === 'SELL_STOCK' ? 'ALPACA_STOCK_BBO' : 'QUALIFIED_OPTION_BBO';
    if (gate.priceEvidence !== expectedPriceEvidence) throw new Error('ORDER_EXECUTABLE_PRICE_PROVENANCE_MISMATCH');
    const authorization = authorizeBrokerMutation(this.control, {
      ...gate, operation: 'REPLACE', isNewEntry: thetaActionOpensNewRisk(replacement.action), intentPersisted: true,
      accountKind: this.broker.accountKind, environment: this.broker.environment,
      clientOrderId: replacement.request.client_order_id, quantity: replacement.request.qty,
    });
    await this.store.transitionIntent(replacement.orderIntentId, 'READY', 'SUBMITTING');
    await this.store.recordAttempt({ orderIntentId: replacement.orderIntentId, attemptNo: 1, requestedAt: gate.now,
      requestPayloadHash: hashBrokerPayload(replacement.request), responseStatus: null,
      timeoutFlag: false, reconcileBeforeRetry: false });
    let brokerOrder: BrokerOrderSnapshot;
    try {
      brokerOrder = await this.broker.replaceOrder(current.id, {
        qty: replacement.request.qty, limit_price: replacement.request.limit_price,
        time_in_force: replacement.request.time_in_force, client_order_id: replacement.request.client_order_id,
      }, authorization);
    } catch (error) {
      if (error instanceof AlpacaPaperBrokerError && error.category === 'AMBIGUOUS_NETWORK') {
        await this.store.updateAttempt(replacement.orderIntentId, 1, { responseStatus: null, timeoutFlag: true, reconcileBeforeRetry: true });
        await this.store.transitionIntent(replacement.orderIntentId, 'SUBMITTING', 'UNKNOWN_SUBMISSION');
        const resolved = await this.reconcileUnknown(replacement.orderIntentId);
        // The replacement exists at the broker, so the original was replaced there: close it locally too instead of leaving
        // it ACTIVE until some later reconcile pass happens to notice.
        if (resolved !== null) await this.closeReplacedOriginal(originalOrderIntentId, current.id);
        return resolved;
      }
      const found = await this.settleDefiniteMutationFailure(replacement.orderIntentId, error);
      if (found === null) {
        // The replace was refused (e.g. 422 because the original just filled/canceled). Refresh the original from broker truth
        // so a terminal original is not left looking active; broker read failures here must not mask the replace error.
        await this.refreshOriginalFromBroker(originalOrderIntentId, original.request.client_order_id);
        throw error;
      }
      await this.closeReplacedOriginal(originalOrderIntentId, current.id);
      return found;
    }
    await this.store.updateAttempt(replacement.orderIntentId, 1, {
      responseStatus: brokerOrder.status, timeoutFlag: false, reconcileBeforeRetry: false,
    });
    await this.syncBrokerSnapshot(replacement.orderIntentId, brokerOrder);
    await this.closeReplacedOriginal(originalOrderIntentId, current.id);
    return brokerOrder;
  }

  private async closeReplacedOriginal(originalOrderIntentId: string, brokerOrderId: string): Promise<void> {
    const refreshedOriginal = await this.store.getIntent(originalOrderIntentId);
    if (refreshedOriginal !== null && isValidOrderIntentTransition(refreshedOriginal.status, 'CANCELED')) {
      await this.store.transitionIntent(originalOrderIntentId, refreshedOriginal.status, 'CANCELED', brokerOrderId);
    }
  }

  private async refreshOriginalFromBroker(originalOrderIntentId: string, clientOrderId: string): Promise<void> {
    try {
      const latest = await this.broker.getOrderByClientOrderId(clientOrderId);
      if (latest !== null) await this.syncBrokerSnapshot(originalOrderIntentId, latest);
    } catch (error) {
      if (!(error instanceof AlpacaPaperBrokerError)) throw error;
    }
  }

  /**
   * Resolves ambiguous (SUBMITTING / UNKNOWN_SUBMISSION / RECONCILING) intents from broker truth. An intent whose order is STILL absent
   * at the broker by client order id long after its decision window can never have been accepted (submission is synchronous), so it
   * becomes EXPIRED (terminal) instead of blocking the account's order management and the chain forever. Within the grace period an
   * absent order stays unresolved: never a blind resubmit.
   */
  async recoverAfterRestart(now: string = new Date().toISOString()): Promise<readonly { orderIntentId: string; resolved: boolean }[]> {
    const unresolved = await this.store.unresolvedIntents();
    const results: Array<{ orderIntentId: string; resolved: boolean }> = [];
    let stopForRateLimit = false;
    for (const intent of unresolved) {
      // One provider outage/429 must not abort recovery of the remaining intents, and after a 429 no further broker reads
      // are issued in this pass (no retry storm); they stay unresolved for the next pass.
      if (stopForRateLimit) { results.push({ orderIntentId: intent.orderIntentId, resolved: false }); continue; }
      if (intent.status === 'SUBMITTING') await this.store.transitionIntent(intent.orderIntentId, 'SUBMITTING', 'UNKNOWN_SUBMISSION');
      const current = await this.store.getIntent(intent.orderIntentId);
      if (current?.status === 'UNKNOWN_SUBMISSION' || current?.status === 'RECONCILING') {
        let resolved: BrokerOrderSnapshot | null;
        try {
          resolved = await this.reconcileUnknown(intent.orderIntentId);
        } catch (error) {
          if (!(error instanceof AlpacaPaperBrokerError)) throw error;
          if (error.category === 'RATE_LIMITED') stopForRateLimit = true;
          results.push({ orderIntentId: intent.orderIntentId, resolved: false });
          continue;
        }
        if (resolved === null) {
          const refreshed = await this.store.getIntent(intent.orderIntentId);
          const windowEnd = Date.parse(refreshed?.executionEvidence.decisionExpiresAt ?? '');
          if (refreshed?.status === 'RECONCILING' && Number.isFinite(windowEnd) && Date.parse(now) > windowEnd + absentUnknownSubmissionGraceMs) {
            await this.store.transitionIntent(intent.orderIntentId, 'RECONCILING', 'EXPIRED');
            results.push({ orderIntentId: intent.orderIntentId, resolved: true });
            continue;
          }
        }
        results.push({ orderIntentId: intent.orderIntentId, resolved: resolved !== null });
      }
    }
    return results;
  }
}

export class InMemoryPaperOrderStore implements PaperOrderStore {
  readonly intents = new Map<string, PersistedPaperOrderIntent>();
  readonly attempts = new Map<string, ExecutionAttemptRecord>();

  async insertIntent(intent: PersistedPaperOrderIntent): Promise<void> {
    if (this.intents.has(intent.orderIntentId)) throw new Error('Duplicate order intent.');
    if ([...this.intents.values()].some((item) => item.request.client_order_id === intent.request.client_order_id)) throw new Error('Duplicate client_order_id.');
    this.intents.set(intent.orderIntentId, intent);
  }
  async getIntent(orderIntentId: string): Promise<PersistedPaperOrderIntent | null> { return this.intents.get(orderIntentId) ?? null; }
  async transitionIntent(orderIntentId: string, from: OrderIntentState, to: OrderIntentState, brokerOrderId: string | null = null): Promise<void> {
    const intent = this.intents.get(orderIntentId);
    if (intent === undefined || intent.status !== from) throw new Error('Stale or missing order intent transition.');
    assertValidOrderIntentTransition(from, to);
    this.intents.set(orderIntentId, { ...intent, status: to, brokerOrderId: brokerOrderId ?? intent.brokerOrderId });
  }
  async recordAttempt(attempt: ExecutionAttemptRecord): Promise<void> {
    const key = `${attempt.orderIntentId}:${attempt.attemptNo}`;
    if (this.attempts.has(key)) throw new Error('Duplicate execution attempt.');
    this.attempts.set(key, attempt);
  }
  async updateAttempt(orderIntentId: string, attemptNo: number, result: Pick<ExecutionAttemptRecord, 'responseStatus' | 'timeoutFlag' | 'reconcileBeforeRetry'>): Promise<void> {
    const key = `${orderIntentId}:${attemptNo}`;
    const attempt = this.attempts.get(key);
    if (attempt === undefined) throw new Error('Execution attempt not found.');
    this.attempts.set(key, { ...attempt, ...result });
  }
  async unresolvedIntents(): Promise<readonly PersistedPaperOrderIntent[]> {
    return [...this.intents.values()].filter((intent) => ['SUBMITTING', 'UNKNOWN_SUBMISSION', 'RECONCILING'].includes(intent.status));
  }
}
