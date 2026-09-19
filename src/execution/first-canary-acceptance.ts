import { createHash } from 'node:crypto';
import type { Evidence } from '../theta/first-paper-order-readiness.js';

export const firstCanaryAcceptanceVersion = 'theta-first-canary-acceptance-v1' as const;

export type CanaryBrokerState = 'ACKNOWLEDGED' | 'WORKING' | 'PARTIAL' | 'FILLED' | 'REJECTED' | 'CANCELED' | 'EXPIRED';

export interface FirstCanaryAcceptanceInput {
  readonly asOf: string;
  readonly expected: {
    readonly executionAccountId: string;
    readonly occContract: string;
    readonly side: 'sell';
    readonly positionIntent: 'sell_to_open';
    readonly quantity: number;
    readonly clientOrderId: string;
  };
  readonly persistence: {
    readonly decisionPersisted: Evidence<boolean>;
    readonly orderIntentPersisted: Evidence<boolean>;
    readonly idempotencyReserved: Evidence<boolean>;
    readonly deterministicClientOrderId: Evidence<boolean>;
  };
  readonly broker: {
    readonly executionAccountId: Evidence<string>;
    readonly occContract: Evidence<string>;
    readonly side: Evidence<string>;
    readonly positionIntent: Evidence<string>;
    readonly requestedQuantity: Evidence<number>;
    readonly filledQuantity: Evidence<number>;
    readonly clientOrderId: Evidence<string>;
    readonly orderState: Evidence<CanaryBrokerState>;
    readonly acknowledgementObserved: Evidence<boolean>;
    readonly duplicateEconomicExposureCount: Evidence<number>;
  };
  readonly evidence: {
    readonly reconciliationComplete: Evidence<boolean>;
    readonly tcaPersisted: Evidence<boolean>;
    readonly lifecycleApplied: Evidence<boolean>;
    readonly newRiskRelocked: Evidence<boolean>;
    readonly managementEnabled: Evidence<boolean>;
    readonly followerMutationCount: Evidence<number>;
    readonly liveMutationCount: Evidence<number>;
  };
}

export interface FirstCanaryAcceptanceReceipt extends FirstCanaryAcceptanceInput {
  readonly receiptVersion: typeof firstCanaryAcceptanceVersion;
  readonly status: 'IN_PROGRESS' | 'ACCEPTED' | 'FAILED';
  readonly blockers: readonly string[];
  readonly pending: readonly string[];
  readonly contentHash: string;
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
    : item);

function good<T>(evidence: Evidence<T>, code: string, blockers: string[]): T | null {
  if (evidence.state !== 'GOOD' || evidence.value === null) {
    blockers.push(`${code}_${evidence.state}`);
    return null;
  }
  return evidence.value;
}

function requireTrue(evidence: Evidence<boolean>, code: string, blockers: string[]): void {
  const value = good(evidence, code, blockers);
  if (value === false) blockers.push(`${code}_FALSE`);
}

export function buildFirstCanaryAcceptanceReceipt(input: FirstCanaryAcceptanceInput): FirstCanaryAcceptanceReceipt {
  const blockers: string[] = [];
  const pending: string[] = [];
  if (!Number.isFinite(Date.parse(input.asOf))) blockers.push('AS_OF_INVALID');
  if (!Number.isInteger(input.expected.quantity) || input.expected.quantity <= 0) blockers.push('EXPECTED_QUANTITY_INVALID');

  requireTrue(input.persistence.decisionPersisted, 'DECISION_PERSISTED', blockers);
  requireTrue(input.persistence.orderIntentPersisted, 'ORDER_INTENT_PERSISTED', blockers);
  requireTrue(input.persistence.idempotencyReserved, 'IDEMPOTENCY_RESERVED', blockers);
  requireTrue(input.persistence.deterministicClientOrderId, 'CLIENT_ORDER_ID_DETERMINISTIC', blockers);

  const account = good(input.broker.executionAccountId, 'BROKER_ACCOUNT', blockers);
  const contract = good(input.broker.occContract, 'BROKER_CONTRACT', blockers);
  const side = good(input.broker.side, 'BROKER_SIDE', blockers);
  const positionIntent = good(input.broker.positionIntent, 'BROKER_POSITION_INTENT', blockers);
  const requestedQuantity = good(input.broker.requestedQuantity, 'BROKER_REQUESTED_QUANTITY', blockers);
  const filledQuantity = good(input.broker.filledQuantity, 'BROKER_FILLED_QUANTITY', blockers);
  const clientOrderId = good(input.broker.clientOrderId, 'BROKER_CLIENT_ORDER_ID', blockers);
  const state = good(input.broker.orderState, 'BROKER_ORDER_STATE', blockers);
  requireTrue(input.broker.acknowledgementObserved, 'BROKER_ACKNOWLEDGEMENT', blockers);
  const duplicateCount = good(input.broker.duplicateEconomicExposureCount, 'DUPLICATE_EXPOSURE_COUNT', blockers);

  if (account !== null && account !== input.expected.executionAccountId) blockers.push('BROKER_ACCOUNT_MISMATCH');
  if (contract !== null && contract !== input.expected.occContract) blockers.push('BROKER_CONTRACT_MISMATCH');
  if (side !== null && side !== input.expected.side) blockers.push('BROKER_SIDE_MISMATCH');
  if (positionIntent !== null && positionIntent !== input.expected.positionIntent) blockers.push('BROKER_POSITION_INTENT_MISMATCH');
  if (requestedQuantity !== null && requestedQuantity !== input.expected.quantity) blockers.push('BROKER_REQUESTED_QUANTITY_MISMATCH');
  if (filledQuantity !== null && (!Number.isInteger(filledQuantity) || filledQuantity < 0 || filledQuantity > input.expected.quantity)) {
    blockers.push('BROKER_FILLED_QUANTITY_INVALID');
  }
  if (clientOrderId !== null && clientOrderId !== input.expected.clientOrderId) blockers.push('BROKER_CLIENT_ORDER_ID_MISMATCH');
  if (duplicateCount !== null && duplicateCount !== 1) blockers.push('DUPLICATE_ECONOMIC_EXPOSURE');

  requireTrue(input.evidence.reconciliationComplete, 'RECONCILIATION_COMPLETE', blockers);
  requireTrue(input.evidence.newRiskRelocked, 'NEW_RISK_RELOCKED', blockers);
  requireTrue(input.evidence.managementEnabled, 'MANAGEMENT_ENABLED', blockers);
  const followerMutations = good(input.evidence.followerMutationCount, 'FOLLOWER_MUTATION_COUNT', blockers);
  const liveMutations = good(input.evidence.liveMutationCount, 'LIVE_MUTATION_COUNT', blockers);
  if (followerMutations !== null && followerMutations !== 0) blockers.push('FOLLOWER_MUTATION_DETECTED');
  if (liveMutations !== null && liveMutations !== 0) blockers.push('LIVE_MUTATION_DETECTED');

  if (state === 'FILLED') {
    if (filledQuantity !== input.expected.quantity) blockers.push('FILLED_QUANTITY_NOT_COMPLETE');
    requireTrue(input.evidence.tcaPersisted, 'TCA_PERSISTED', blockers);
    requireTrue(input.evidence.lifecycleApplied, 'LIFECYCLE_APPLIED', blockers);
  } else if (state === 'REJECTED') {
    if (filledQuantity !== 0) blockers.push('REJECTED_ORDER_HAS_FILL');
  } else if (state !== null) {
    pending.push(`BROKER_ORDER_${state}`);
  }

  const terminal = state === 'FILLED' || state === 'REJECTED';
  const status: FirstCanaryAcceptanceReceipt['status'] = blockers.length > 0 ? 'FAILED' : terminal ? 'ACCEPTED' : 'IN_PROGRESS';
  const unsigned = { ...input, receiptVersion: firstCanaryAcceptanceVersion, status, blockers, pending };
  return { ...unsigned, contentHash: createHash('sha256').update(canonical(unsigned)).digest('hex') };
}
