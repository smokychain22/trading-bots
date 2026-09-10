export interface PaperExecutionControl {
  readonly masterEnabled: boolean;
  readonly followerEnabled: boolean;
  readonly pauseNewOrders: boolean;
}

export interface ExecutionGateContext {
  readonly accountKind: 'MASTER_API_KEY' | 'FOLLOWER_OAUTH';
  readonly environment: 'PAPER';
  readonly baseHostname: string;
  readonly accountVerified: boolean;
  readonly optionsCapabilityVerified: boolean;
  readonly intentPersisted: boolean;
  readonly aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO';
  readonly quantity: number;
  readonly quoteFresh: boolean;
  readonly decisionExpiresAt: string;
  readonly clientOrderId: string;
  readonly now: string;
  readonly isNewEntry: boolean;
}

export interface ExecutionGateResult {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
}

const issuedPermits = new WeakSet<object>();
export interface BrokerMutationAuthorization {
  readonly authorizedAt: string;
  readonly clientOrderId: string;
  readonly quantity: number;
}

export function evaluateExecutionGate(control: PaperExecutionControl, context: ExecutionGateContext): ExecutionGateResult {
  const blockers: string[] = [];
  const enabled = context.accountKind === 'MASTER_API_KEY' ? control.masterEnabled : control.followerEnabled;
  if (!enabled) blockers.push(context.accountKind === 'MASTER_API_KEY' ? 'MASTER_EXECUTION_DISABLED' : 'FOLLOWER_EXECUTION_DISABLED');
  if (context.environment !== 'PAPER' || context.baseHostname !== 'paper-api.alpaca.markets') blockers.push('PAPER_ENVIRONMENT_REQUIRED');
  if (control.pauseNewOrders && context.isNewEntry) blockers.push('NEW_ORDERS_PAUSED');
  if (!context.accountVerified) blockers.push('ACCOUNT_NOT_VERIFIED');
  if (!context.optionsCapabilityVerified) blockers.push('OPTIONS_CAPABILITY_NOT_VERIFIED');
  if (!context.intentPersisted) blockers.push('INTENT_NOT_PERSISTED');
  if (!['ALLOW_FULL', 'ALLOW_REDUCED'].includes(context.aegisState)) blockers.push('AEGIS_NOT_APPROVED');
  if (!Number.isInteger(context.quantity) || context.quantity <= 0) blockers.push('QUANTITY_NOT_POSITIVE_INTEGER');
  if (!context.quoteFresh) blockers.push('QUOTE_NOT_FRESH');
  if (Date.parse(context.decisionExpiresAt) <= Date.parse(context.now)) blockers.push('DECISION_EXPIRED');
  if (context.clientOrderId.trim().length === 0) blockers.push('CLIENT_ORDER_ID_MISSING');
  return { allowed: blockers.length === 0, blockers };
}

export function authorizeBrokerMutation(control: PaperExecutionControl, context: ExecutionGateContext): BrokerMutationAuthorization {
  const result = evaluateExecutionGate(control, context);
  if (!result.allowed) throw new Error(`Paper order blocked: ${result.blockers.join(',')}`);
  const permit = Object.freeze({ authorizedAt: context.now, clientOrderId: context.clientOrderId, quantity: context.quantity });
  issuedPermits.add(permit);
  return permit;
}

export function assertBrokerMutationAuthorized(permit: BrokerMutationAuthorization, clientOrderId?: string, quantity?: number): void {
  if (!issuedPermits.has(permit)) throw new Error('Broker mutation requires a valid execution-gate permit.');
  if (clientOrderId !== undefined && permit.clientOrderId !== clientOrderId) throw new Error('Execution-gate permit does not match client_order_id.');
  if (quantity !== undefined && permit.quantity !== quantity) throw new Error('Execution-gate permit does not match quantity.');
}

export const executionMode = (control: PaperExecutionControl, kind: 'MASTER_API_KEY' | 'FOLLOWER_OAUTH'): 'LOCKED' | 'READY' | 'ACTIVE' => {
  const enabled = kind === 'MASTER_API_KEY' ? control.masterEnabled : control.followerEnabled;
  if (!enabled) return 'LOCKED';
  return control.pauseNewOrders ? 'READY' : 'ACTIVE';
};
