import type {
  BrokerActivity,
  BrokerCalendarSession,
  BrokerMarketClock,
  BrokerOrderSnapshot,
  PaperBrokerAdapter,
} from './broker.js';

/**
 * Broker surface allowed inside THETA_SHADOW_ONLY. Mutation methods are
 * absent from the type and absent from the returned object at runtime.
 */
export interface ReadOnlyPaperBroker {
  readonly accountKind: PaperBrokerAdapter['accountKind'];
  readonly environment: 'PAPER';
  getAccount(): Promise<unknown>;
  getPositions(): Promise<readonly unknown[]>;
  getOrders(status?: 'open' | 'closed' | 'all'): Promise<readonly BrokerOrderSnapshot[]>;
  getOrder(providerOrderId: string): Promise<BrokerOrderSnapshot | null>;
  getOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrderSnapshot | null>;
  getActivities(activityTypes?: readonly string[]): Promise<readonly BrokerActivity[]>;
  getClock(): Promise<BrokerMarketClock>;
  getCalendar(start: string, end: string): Promise<readonly BrokerCalendarSession[]>;
}

export function asReadOnlyPaperBroker(broker: PaperBrokerAdapter): ReadOnlyPaperBroker {
  if (broker.environment !== 'PAPER') throw new Error('SHADOW_RUNTIME_PAPER_BROKER_REQUIRED');
  if (broker.getClock === undefined || broker.getCalendar === undefined) {
    throw new Error('SHADOW_RUNTIME_MARKET_SESSION_CAPABILITY_REQUIRED');
  }
  return Object.freeze({
    accountKind: broker.accountKind,
    environment: broker.environment,
    getAccount: broker.getAccount.bind(broker),
    getPositions: broker.getPositions.bind(broker),
    getOrders: broker.getOrders.bind(broker),
    getOrder: broker.getOrder.bind(broker),
    getOrderByClientOrderId: broker.getOrderByClientOrderId.bind(broker),
    getActivities: broker.getActivities.bind(broker),
    getClock: broker.getClock.bind(broker),
    getCalendar: broker.getCalendar.bind(broker),
  });
}

export function assertShadowBrokerHasNoMutationSurface(broker: ReadOnlyPaperBroker): void {
  const object = broker as unknown as Record<string, unknown>;
  for (const method of ['submitOrder', 'replaceOrder', 'cancelOrder', 'exercise', 'doNotExercise']) {
    if (typeof object[method] === 'function') throw new Error(`SHADOW_BROKER_MUTATION_SURFACE_PRESENT:${method}`);
  }
}
