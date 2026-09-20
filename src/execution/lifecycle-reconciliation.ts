import { createHash } from 'node:crypto';
import type { BrokerActivity } from './broker.js';

export interface PositionEvidence {
  readonly symbol: string;
  readonly quantity: number | null;
}
export interface AssignmentCandidate {
  readonly executionAccountId: string;
  readonly chainId: string;
  readonly optionSymbol: string;
  readonly underlyingSymbol: string;
  readonly contracts: number;
  readonly multiplier: number;
  readonly occurrenceDate: string;
}

export interface ReconciledAssignment {
  readonly reconciliationKey: string;
  readonly state: 'PROVISIONAL' | 'CONFIRMED';
  readonly stockQuantity: number;
  readonly providerActivityId: string | null;
}

const assignmentKey = (input: AssignmentCandidate): string => createHash('sha256')
  .update([input.executionAccountId, input.chainId, input.optionSymbol, input.occurrenceDate].join('\u001f'))
  .digest('hex');

export function detectAssignment(input: AssignmentCandidate, previous: readonly PositionEvidence[], current: readonly PositionEvidence[], activities: readonly BrokerActivity[]): ReconciledAssignment | null {
  const previousOption = previous.find((position) => position.symbol === input.optionSymbol);
  const optionWasShort = previousOption !== undefined && previousOption.quantity !== null && previousOption.quantity < 0;
  const optionNowAbsent = !current.some((position) => position.symbol === input.optionSymbol && position.quantity !== 0);
  const expectedShares = input.contracts * input.multiplier;
  const priorPosition = previous.find((position) => position.symbol === input.underlyingSymbol);
  const currentPosition = current.find((position) => position.symbol === input.underlyingSymbol);
  const priorShares = priorPosition === undefined ? 0 : priorPosition.quantity;
  const currentShares = currentPosition === undefined ? 0 : currentPosition.quantity;
  const stockAppeared = priorShares !== null && currentShares !== null && currentShares - priorShares >= expectedShares;
  const activity = activities.find((item) => item.activityType === 'OPASN' && item.symbol === input.optionSymbol);
  if (activity !== undefined) {
    return { reconciliationKey: assignmentKey(input), state: 'CONFIRMED', stockQuantity: expectedShares, providerActivityId: activity.id };
  }
  if (optionWasShort && optionNowAbsent && stockAppeared) {
    return { reconciliationKey: assignmentKey(input), state: 'PROVISIONAL', stockQuantity: expectedShares, providerActivityId: null };
  }
  return null;
}

export class AssignmentRegistry {
  private readonly assignments = new Map<string, ReconciledAssignment>();
  upsert(assignment: ReconciledAssignment): ReconciledAssignment {
    const existing = this.assignments.get(assignment.reconciliationKey);
    if (existing?.state === 'CONFIRMED') return existing;
    const result = existing === undefined ? assignment : { ...existing, ...assignment };
    this.assignments.set(assignment.reconciliationKey, result);
    return result;
  }
  get size(): number { return this.assignments.size; }
}
