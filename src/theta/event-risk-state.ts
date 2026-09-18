export const eventRiskStateVersion = 'theta-event-risk-state-v1' as const;

/**
 * A tri-state for any event/dividend/early-exercise risk flag THETA
 * consumes. A boolean collapses "we checked and there is no event" and
 * "we never checked" into the same `false` -- which silently treats
 * UNKNOWN as safe. This type keeps those two facts structurally distinct:
 *
 *   PRESENT          -- a real, known event/ex-date/etc. risk exists.
 *   ABSENT_VERIFIED  -- positively checked and confirmed absent.
 *   UNKNOWN          -- no verification exists either way.
 *
 * `UNKNOWN` must never be treated as equivalent to `ABSENT_VERIFIED` by any
 * consumer -- it may still contribute zero PENALTY (this module never
 * fabricates a magnitude for an unverified risk), but it must always be
 * separately visible as an uncertainty signal, never silently absorbed.
 */
export type EventRiskState = 'PRESENT' | 'ABSENT_VERIFIED' | 'UNKNOWN';

/**
 * The caller-justified penalty contribution for one tri-state risk flag.
 * `PRESENT` applies the caller-supplied penalty (0 is valid -- inert).
 * `ABSENT_VERIFIED` contributes 0 -- a real, checked fact, not an
 * assumption. `UNKNOWN` ALSO contributes 0 to the numeric penalty (this
 * module never invents a magnitude for a risk nobody has verified either
 * way), but callers must consult `isEventRiskUnknown` separately to keep
 * that uncertainty visible rather than reading a 0 contribution as "safe."
 */
export function eventRiskPenaltyContribution(state: EventRiskState, penalty: number): number {
  return state === 'PRESENT' ? penalty : 0;
}

export function isEventRiskUnknown(state: EventRiskState): boolean {
  return state === 'UNKNOWN';
}
