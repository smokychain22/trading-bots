import type { BrokerOrderSnapshot } from './broker.js';
import type { PaperOrderGate, PrepareIntentInput } from './paper-order-coordinator.js';
import { PaperOrderCoordinator } from './paper-order-coordinator.js';
import type { ThetaOrderAction } from './order-construction.js';

export interface MasterPaperExecutionCommand extends PrepareIntentInput {
  readonly action: ThetaOrderAction;
  readonly gate: PaperOrderGate;
}

export interface MasterPaperExecutionResult {
  readonly orderIntentId: string;
  readonly state: 'BLOCKED_UNRESOLVED_ORDER' | 'PERSISTED' | 'SUBMITTED' | 'WORKING' | 'PARTIAL' | 'FILLED' | 'TERMINAL';
  readonly brokerOrder: BrokerOrderSnapshot | null;
  readonly submittedNow: boolean;
}

export interface MasterPaperRollResult {
  readonly state: 'CLOSE_WORKING' | 'CLOSE_TERMINAL_WITHOUT_FILL' | 'OPEN_WORKING' | 'COMPLETE';
  readonly close: MasterPaperExecutionResult;
  readonly open: MasterPaperExecutionResult | null;
}

const terminalWithoutFill = new Set(['CANCELED', 'REJECTED', 'EXPIRED']);

/**
 * Connects a fully approved THETA command to the persisted coordinator. It
 * never selects a contract, quantity, or price. Those remain strategy and
 * AEGIS responsibilities. Every cycle reconciles ambiguous prior POSTs before
 * considering a new broker mutation.
 */
export class MasterPaperExecutionOrchestrator {
  constructor(private readonly coordinator: PaperOrderCoordinator) {}

  async execute(command: MasterPaperExecutionCommand): Promise<MasterPaperExecutionResult> {
    const recovery = await this.coordinator.recoverAfterRestart();
    if (recovery.some((item) => !item.resolved)) {
      return { orderIntentId: command.orderIntentId, state: 'BLOCKED_UNRESOLVED_ORDER', brokerOrder: null, submittedNow: false };
    }
    const intent = await this.coordinator.prepare(command);
    if (intent.status === 'READY') {
      const brokerOrder = await this.coordinator.submit(command.orderIntentId, command.gate);
      return { orderIntentId: command.orderIntentId, state: brokerOrder === null ? 'PERSISTED' : stateOf(brokerOrder), brokerOrder, submittedNow: brokerOrder !== null };
    }
    const brokerOrder = await this.coordinator.reconcileIntent(command.orderIntentId);
    return { orderIntentId: command.orderIntentId, state: brokerOrder === null ? 'PERSISTED' : stateOf(brokerOrder), brokerOrder, submittedNow: false };
  }

  async executeRoll(close: MasterPaperExecutionCommand, open: MasterPaperExecutionCommand): Promise<MasterPaperRollResult> {
    const validPair = (close.action === 'ROLL_CSP_CLOSE' && open.action === 'ROLL_CSP_OPEN')
      || (close.action === 'ROLL_CC_CLOSE' && open.action === 'ROLL_CC_OPEN');
    if (!validPair) throw new Error('ROLL_ACTION_PAIR_INVALID');
    if (close.request.client_order_id === open.request.client_order_id) throw new Error('ROLL_CLIENT_ORDER_ID_COLLISION');
    const closeResult = await this.execute(close);
    if (closeResult.brokerOrder === null || closeResult.brokerOrder.filledQty < close.request.qty
      || closeResult.brokerOrder.status.toLowerCase() !== 'filled') {
      return { state: terminalWithoutFill.has(statusOf(closeResult)) ? 'CLOSE_TERMINAL_WITHOUT_FILL' : 'CLOSE_WORKING', close: closeResult, open: null };
    }
    if (open.request.qty > closeResult.brokerOrder.filledQty) throw new Error('ROLL_OPEN_QUANTITY_EXCEEDS_CONFIRMED_CLOSE');
    const openResult = await this.execute(open);
    return { state: openResult.state === 'FILLED' ? 'COMPLETE' : 'OPEN_WORKING', close: closeResult, open: openResult };
  }
}

const statusOf = (result: MasterPaperExecutionResult): string => {
  const status = result.brokerOrder?.status.toUpperCase();
  return status ?? result.state;
};

const stateOf = (order: BrokerOrderSnapshot): MasterPaperExecutionResult['state'] => {
  const status = order.status.toLowerCase();
  if (order.filledQty >= order.qty && order.qty > 0) return 'FILLED';
  if (order.filledQty > 0) return 'PARTIAL';
  if (['accepted', 'new', 'pending_new', 'pending_cancel', 'pending_replace'].includes(status)) return 'WORKING';
  if (['canceled', 'rejected', 'expired', 'replaced'].includes(status)) return 'TERMINAL';
  return 'SUBMITTED';
};
