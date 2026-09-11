import type { BrokerActivity } from './broker.js';
import type { PositionEvidence } from './lifecycle-reconciliation.js';
import { assertValidLifecycleTransition, type ThetaLifecycleState } from '../theta/runtime-state.js';

export type ManagedOptionLegKind = 'SHORT_PUT' | 'COVERED_CALL';
export interface ManagedOptionLifecycleInput {
  readonly chainId: string;
  readonly currentState: 'CSP_OPEN' | 'CC_OPEN';
  readonly legKind: ManagedOptionLegKind;
  readonly optionSymbol: string;
  readonly underlyingSymbol: string;
  readonly contracts: number;
  readonly multiplier: number | null;
  readonly previousPositions: readonly PositionEvidence[];
  readonly currentPositions: readonly PositionEvidence[];
  readonly activities: readonly BrokerActivity[];
  readonly observedAt: string;
}

export interface BrokerConfirmedLifecycleResult {
  readonly state: 'CONFIRMED' | 'UNKNOWN' | 'INVALID';
  readonly brokerActivityId: string | null;
  readonly transitionPath: readonly ThetaLifecycleState[];
  readonly reasonCode: string;
}

const quantity = (positions: readonly PositionEvidence[], symbol: string): number =>
  positions.find((position) => position.symbol === symbol)?.quantity ?? 0;

const matchingActivity = (input: ManagedOptionLifecycleInput, types: readonly string[]): BrokerActivity | undefined =>
  input.activities.find((activity) => types.includes(activity.activityType) && activity.symbol === input.optionSymbol);

function confirmed(input: ManagedOptionLifecycleInput, activity: BrokerActivity, path: readonly ThetaLifecycleState[], reasonCode: string): BrokerConfirmedLifecycleResult {
  let from: ThetaLifecycleState = input.currentState;
  for (const to of path) {
    assertValidLifecycleTransition(from, to);
    from = to;
  }
  return { state: 'CONFIRMED', brokerActivityId: activity.id, transitionPath: path, reasonCode };
}

/**
 * Classifies only broker-confirmed terminal option events. Moneyness and a
 * disappeared option position are never sufficient. They can prompt another
 * broker read, but cannot mutate a THETA economic chain.
 */
export function reconcileManagedOptionLifecycle(input: ManagedOptionLifecycleInput): BrokerConfirmedLifecycleResult {
  if (!Number.isInteger(input.contracts) || input.contracts <= 0 || input.multiplier === null
    || !Number.isInteger(input.multiplier) || input.multiplier <= 0) {
    return { state: 'INVALID', brokerActivityId: null, transitionPath: [], reasonCode: 'CONTRACT_ECONOMICS_INVALID' };
  }
  if ((input.legKind === 'SHORT_PUT' && input.currentState !== 'CSP_OPEN')
    || (input.legKind === 'COVERED_CALL' && input.currentState !== 'CC_OPEN')) {
    return { state: 'INVALID', brokerActivityId: null, transitionPath: [], reasonCode: 'LEG_STATE_MISMATCH' };
  }
  const expectedShares = input.contracts * input.multiplier;
  const previousOption = quantity(input.previousPositions, input.optionSymbol);
  const currentOption = quantity(input.currentPositions, input.optionSymbol);
  if (previousOption >= 0 || currentOption !== 0) {
    return { state: 'UNKNOWN', brokerActivityId: null, transitionPath: [], reasonCode: 'OPTION_TERMINAL_STATE_NOT_CONFIRMED' };
  }

  const expiration = matchingActivity(input, ['OPEXP']);
  if (expiration !== undefined) {
    if (input.legKind === 'SHORT_PUT') {
      return confirmed(input, expiration, ['EXPIRE_OTM', 'REDEPLOY'], 'BROKER_CONFIRMED_SHORT_PUT_EXPIRY');
    }
    const sharesStillOwned = quantity(input.currentPositions, input.underlyingSymbol) >= expectedShares;
    if (!sharesStillOwned) {
      return { state: 'UNKNOWN', brokerActivityId: expiration.id, transitionPath: [], reasonCode: 'CC_EXPIRY_STOCK_COVERAGE_NOT_CONFIRMED' };
    }
    return confirmed(input, expiration, ['EXPIRE_OTM', 'RECOVERY_WAIT'], 'BROKER_CONFIRMED_COVERED_CALL_EXPIRY');
  }

  const assignment = matchingActivity(input, ['OPASN']);
  if (assignment === undefined || assignment.quantity === null || Math.abs(assignment.quantity) !== input.contracts) {
    return { state: 'UNKNOWN', brokerActivityId: assignment?.id ?? null, transitionPath: [], reasonCode: 'BROKER_TERMINAL_ACTIVITY_NOT_CONFIRMED' };
  }
  const priorShares = quantity(input.previousPositions, input.underlyingSymbol);
  const currentShares = quantity(input.currentPositions, input.underlyingSymbol);
  if (input.legKind === 'SHORT_PUT') {
    if (currentShares - priorShares < expectedShares) {
      return { state: 'UNKNOWN', brokerActivityId: assignment.id, transitionPath: [], reasonCode: 'ASSIGNED_STOCK_POSITION_NOT_CONFIRMED' };
    }
    return confirmed(input, assignment, ['ASSIGNED', 'STOCK_HELD', 'RECOVERY_WAIT'], 'BROKER_CONFIRMED_SHORT_PUT_ASSIGNMENT');
  }
  if (priorShares - currentShares < expectedShares) {
    return { state: 'UNKNOWN', brokerActivityId: assignment.id, transitionPath: [], reasonCode: 'CALL_AWAY_STOCK_REDUCTION_NOT_CONFIRMED' };
  }
  return confirmed(input, assignment, ['CALL_AWAY', 'CLOSED'], 'BROKER_CONFIRMED_COVERED_CALL_ASSIGNMENT');
}
