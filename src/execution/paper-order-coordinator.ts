import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from './broker.js';
import { AlpacaPaperBrokerError, hashBrokerPayload } from './broker.js';
import { authorizeBrokerMutation, type ExecutionGateContext, type PaperExecutionControl } from './execution-control.js';
import type { OrderIntentState } from '../theta/order-intent-state.js';
import { assertValidOrderIntentTransition, isValidOrderIntentTransition } from '../theta/order-intent-state.js';
import { brokerOrderIntentState } from './broker-order-state.js';
import { thetaActionOpensNewRisk } from './order-construction.js';

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
    readonly quoteSource: 'ALPACA';
    readonly quoteFeed: 'OPRA' | 'SIP' | 'IEX';
    readonly quoteAsOf: string;
    readonly decisionExpiresAt: string;
    readonly quoteContentHash: string;
    readonly aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO';
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
        optionContractId:value.optionContractId,underlyingId:value.underlyingId,executionEvidence:value.executionEvidence});
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
    if (gate.isNewEntry !== expectedNewRisk) throw new Error('ORDER_ACTION_RISK_CLASSIFICATION_MISMATCH');
    const expectedPriceEvidence = intent.action === 'SELL_STOCK' ? 'ALPACA_STOCK_BBO' : 'ALPACA_OPRA_BBO';
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
        await this.store.updateAttempt(orderIntentId, 1, { responseStatus: error instanceof AlpacaPaperBrokerError ? String(error.httpStatus ?? error.category) : 'ERROR', timeoutFlag: false, reconcileBeforeRetry: false });
        await this.store.transitionIntent(orderIntentId, 'SUBMITTING', 'REJECTED');
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

  async syncBrokerSnapshot(orderIntentId: string, brokerOrder: BrokerOrderSnapshot): Promise<OrderIntentState> {
    const intent = await this.store.getIntent(orderIntentId);
    if (intent === null) throw new Error('Order intent cannot be synchronized before persistence.');
    const brokerState = brokerOrderIntentState(brokerOrder) ?? 'SUBMITTED';
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
    assertValidOrderIntentTransition(refreshed.status, 'CANCEL_REQUESTED');
    await this.store.transitionIntent(orderIntentId, refreshed.status, 'CANCEL_REQUESTED', current.id);
    try {
      await this.broker.cancelOrder(current.id, authorization);
    } catch (error) {
      if (error instanceof AlpacaPaperBrokerError && error.category === 'AMBIGUOUS_NETWORK') {
        await this.store.transitionIntent(orderIntentId, 'CANCEL_REQUESTED', 'UNKNOWN_SUBMISSION', current.id);
        return this.reconcileUnknown(orderIntentId);
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
    if ((current.filledQty > 0 && replacement.request.qty <= current.filledQty)
      || replacement.request.qty > original.request.qty) {
      throw new Error('REPLACEMENT_QUANTITY_MAY_NOT_INCREASE_EXPOSURE');
    }
    const persistedReplacement = await this.prepare(replacement);
    if (persistedReplacement.status !== 'READY') return this.reconcileIntent(replacement.orderIntentId);
    const expectedPriceEvidence = original.action === 'SELL_STOCK' ? 'ALPACA_STOCK_BBO' : 'ALPACA_OPRA_BBO';
    if (gate.priceEvidence !== expectedPriceEvidence) throw new Error('ORDER_EXECUTABLE_PRICE_PROVENANCE_MISMATCH');
    const authorization = authorizeBrokerMutation(this.control, {
      ...gate, operation: 'REPLACE', isNewEntry: false, intentPersisted: true,
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
        return this.reconcileUnknown(replacement.orderIntentId);
      }
      await this.store.updateAttempt(replacement.orderIntentId, 1, {
        responseStatus: error instanceof AlpacaPaperBrokerError ? String(error.httpStatus ?? error.category) : 'ERROR',
        timeoutFlag: false, reconcileBeforeRetry: false,
      });
      await this.store.transitionIntent(replacement.orderIntentId, 'SUBMITTING', 'REJECTED');
      throw error;
    }
    await this.store.updateAttempt(replacement.orderIntentId, 1, {
      responseStatus: brokerOrder.status, timeoutFlag: false, reconcileBeforeRetry: false,
    });
    await this.syncBrokerSnapshot(replacement.orderIntentId, brokerOrder);
    const refreshedOriginal = await this.store.getIntent(originalOrderIntentId);
    if (refreshedOriginal !== null && isValidOrderIntentTransition(refreshedOriginal.status, 'CANCELED')) {
      await this.store.transitionIntent(originalOrderIntentId, refreshedOriginal.status, 'CANCELED', current.id);
    }
    return brokerOrder;
  }

  async recoverAfterRestart(): Promise<readonly { orderIntentId: string; resolved: boolean }[]> {
    const unresolved = await this.store.unresolvedIntents();
    const results: Array<{ orderIntentId: string; resolved: boolean }> = [];
    for (const intent of unresolved) {
      if (intent.status === 'SUBMITTING') await this.store.transitionIntent(intent.orderIntentId, 'SUBMITTING', 'UNKNOWN_SUBMISSION');
      const current = await this.store.getIntent(intent.orderIntentId);
      if (current?.status === 'UNKNOWN_SUBMISSION' || current?.status === 'RECONCILING') {
        const resolved = await this.reconcileUnknown(intent.orderIntentId);
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
