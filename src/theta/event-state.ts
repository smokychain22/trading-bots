// R1 Phase 2 item D: honest event-state assembly.
//
// Per docs/quant/phase6_router/DATA_GAP_REGISTER.md, Alpaca's real
// /v1/corporate-actions response is confirmed REACHABLE (real HTTP 200)
// but its field-level shape was never inspected before this module was
// written -- this is an acknowledged, documented gap, not an invented
// one. Rather than guess field names and risk a wrong date silently
// looking confident, this module is deliberately conservative: anything
// not confidently recognized becomes UNKNOWN, never NONE_CONFIRMED and
// never a fabricated date. "NONE_CONFIRMED" requires ACTUAL evidence that
// no event is near -- it is never the default when a provider fetch
// simply found nothing recognizable.
//
// Optionomics's documented /api/v1/events endpoint is NOT wired into this
// module -- its probe in src/providers/readiness.ts does not pass a
// per-symbol parameter, suggesting it may be a general/global feed rather
// than a per-underlying query, and its response shape is equally
// unverified. Wiring it is deferred rather than guessed.

export type EventCategory = 'EARNINGS' | 'EX_DIVIDEND' | 'CORPORATE_ACTION';
export type EventRiskState = 'NONE_CONFIRMED' | 'EVENT_NEAR' | 'EVENT_ACTIVE' | 'UNKNOWN';

export interface KnownOrUnknownDate {
  readonly known: boolean;
  readonly date: string | null; // YYYY-MM-DD, only meaningful when known === true
  readonly distanceDays: number | null; // signed: negative = already happened, 0 = today, positive = upcoming
  readonly provenance: 'ALPACA' | 'OPTIONOMICS' | 'UNKNOWN';
  readonly dataQuality: 'GOOD' | 'UNKNOWN' | 'UNRECOGNIZED_RESPONSE_SHAPE';
}

export interface CorporateEventState {
  readonly known: boolean;
  readonly category: string | null; // e.g. 'forward_split', 'merger' -- passed through from the provider, never invented
  readonly effectiveDate: string | null;
  readonly provenance: 'ALPACA' | 'UNKNOWN';
}

export interface EventStateAssessment {
  readonly asOfDate: string; // YYYY-MM-DD, the date this assessment is relative to -- point-in-time, no future leakage
  readonly earnings: KnownOrUnknownDate;
  readonly exDividend: KnownOrUnknownDate;
  readonly corporateEvent: CorporateEventState;
  readonly eventRiskState: EventRiskState;
  readonly policyVersion: string;
}

export interface EventStatePolicy {
  readonly policyVersion: string;
  readonly nearWindowDays: number; // a known event within this many days (before or after asOfDate) counts as EVENT_NEAR
  readonly activeWindowDays: number; // a known event within this many days is EVENT_ACTIVE (must be <= nearWindowDays)
}

export const DEFAULT_EVENT_STATE_POLICY: EventStatePolicy = {
  policyVersion: 'event-state-v1', nearWindowDays: 10, activeWindowDays: 1,
};

const daysBetween = (asOfDate: string, targetDate: string): number | null => {
  const asOf = new Date(`${asOfDate}T00:00:00Z`).getTime();
  const target = new Date(`${targetDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(asOf) || !Number.isFinite(target)) return null;
  return Math.round((target - asOf) / 86_400_000);
};

export function knownDate(date: string, asOfDate: string, provenance: KnownOrUnknownDate['provenance']): KnownOrUnknownDate {
  return { known: true, date, distanceDays: daysBetween(asOfDate, date), provenance, dataQuality: 'GOOD' };
}

export function unknownDate(reason: KnownOrUnknownDate['dataQuality'] = 'UNKNOWN'): KnownOrUnknownDate {
  return { known: false, date: null, distanceDays: null, provenance: 'UNKNOWN', dataQuality: reason };
}

/**
 * Assembles the final EventStateAssessment from already-fetched/parsed
 * per-fact inputs (earnings/exDividend/corporateEvent). Pure, no network
 * I/O, fully testable without live credentials. eventRiskState is derived
 * ONLY from known facts -- NONE_CONFIRMED requires at least one fact to be
 * genuinely known and none of the known facts to fall within
 * nearWindowDays; if every fact is UNKNOWN, eventRiskState is UNKNOWN
 * (never silently treated as safe).
 */
export function assembleEventState(
  asOfDate: string,
  earnings: KnownOrUnknownDate,
  exDividend: KnownOrUnknownDate,
  corporateEvent: CorporateEventState,
  policy: EventStatePolicy = DEFAULT_EVENT_STATE_POLICY,
): EventStateAssessment {
  const knownDistances = [earnings, exDividend]
    .filter((d) => d.known && d.distanceDays !== null)
    .map((d) => d.distanceDays as number);
  const corporateEventDistance = corporateEvent.known && corporateEvent.effectiveDate !== null
    ? daysBetween(asOfDate, corporateEvent.effectiveDate)
    : null;
  if (corporateEventDistance !== null) knownDistances.push(corporateEventDistance);

  const anyFactKnown = earnings.known || exDividend.known || corporateEvent.known;

  let eventRiskState: EventRiskState;
  if (!anyFactKnown) {
    eventRiskState = 'UNKNOWN';
  } else if (knownDistances.some((d) => Math.abs(d) <= policy.activeWindowDays)) {
    eventRiskState = 'EVENT_ACTIVE';
  } else if (knownDistances.some((d) => Math.abs(d) <= policy.nearWindowDays)) {
    eventRiskState = 'EVENT_NEAR';
  } else {
    eventRiskState = 'NONE_CONFIRMED';
  }

  return { asOfDate, earnings, exDividend, corporateEvent, eventRiskState, policyVersion: policy.policyVersion };
}
