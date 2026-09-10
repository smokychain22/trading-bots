import type { BrokerOrderRequest, BrokerOrderSnapshot, PaperBrokerAdapter } from './broker.js';
import { AlpacaPaperBrokerError, hashBrokerPayload } from './broker.js';
import { authorizeBrokerMutation, type ExecutionGateContext, type PaperExecutionControl } from './execution-control.js';
import type { OrderIntentState } from '../theta/order-intent-state.js';
import { assertValidOrderIntentTransition } from '../theta/order-intent-state.js';

export interface PersistedPaperOrderIntent {
  readonly orderIntentId: string;
  readonly executionAccountId: string;
  readonly request: BrokerOrderRequest;
  readonly status: OrderIntentState;
  readonly action: string;
  readonly decisionId: string;
  readonly persistedAt: string;
  readonly brokerOrderId: string | null;
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

export class PaperOrderCoordinator {
  constructor(
    private readonly broker: PaperBrokerAdapter,
    private readonly store: PaperOrderStore,
    private readonly control: PaperExecutionControl,
  ) {}

  async prepare(input: PrepareIntentInput): Promise<PersistedPaperOrderIntent> {
    const intent: PersistedPaperOrderIntent = { ...input, status: 'READY', brokerOrderId: null };
    await this.store.insertIntent(intent);
    return intent;
  }

  async submit(orderIntentId: string, gate: Omit<ExecutionGateContext, 'intentPersisted' | 'accountKind' | 'environment' | 'clientOrderId' | 'quantity'>): Promise<BrokerOrderSnapshot | null> {
    const intent = await this.store.getIntent(orderIntentId);
    if (intent === null) throw new Error('Order intent must be persisted before submission.');
    const authorization = authorizeBrokerMutation(this.control, {
      ...gate,
      intentPersisted: true,
      accountKind: this.broker.accountKind,
      environment: this.broker.environment,
      clientOrderId: intent.request.client_order_id,
      quantity: intent.request.qty,
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

    try {
      const brokerOrder = await this.broker.submitOrder(intent.request, authorization);
      await this.store.updateAttempt(orderIntentId, 1, { responseStatus: brokerOrder.status, timeoutFlag: false, reconcileBeforeRetry: false });
      await this.store.transitionIntent(orderIntentId, 'SUBMITTING', 'SUBMITTED', brokerOrder.id);
      return brokerOrder;
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
  }

  async reconcileUnknown(orderIntentId: string): Promise<BrokerOrderSnapshot | null> {
    const intent = await this.store.getIntent(orderIntentId);
    if (intent === null) throw new Error('Unknown order intent cannot be reconciled.');
    if (intent.status !== 'UNKNOWN_SUBMISSION' && intent.status !== 'RECONCILING') throw new Error('Only ambiguous submissions may use unknown-submission reconciliation.');
    if (intent.status === 'UNKNOWN_SUBMISSION') await this.store.transitionIntent(orderIntentId, 'UNKNOWN_SUBMISSION', 'RECONCILING');
    const brokerOrder = await this.broker.getOrderByClientOrderId(intent.request.client_order_id);
    if (brokerOrder === null) return null;
    await this.store.transitionIntent(orderIntentId, 'RECONCILING', 'SUBMITTED', brokerOrder.id);
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
