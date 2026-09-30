export type EventEvidenceSource = 'OPTIONOMICS' | 'ALPACA_CORPORATE_ACTION';
export type EventVerificationState = 'VERIFIED' | 'UNVERIFIED' | 'CONFLICT' | 'INVALID';

export interface RawEventEvidence {
  readonly source: EventEvidenceSource;
  readonly providerEventId: string;
  readonly underlying: string;
  readonly eventType: string;
  readonly eventTime: string | null;
  readonly knownAt: string;
  readonly observedAt: string;
  readonly payloadHash: string;
  readonly applicable: boolean;
}

export interface NormalizedEventEvidence extends RawEventEvidence {
  readonly identityKey: string;
  readonly verificationState: EventVerificationState;
  readonly reasons: readonly string[];
}

function validInstant(value: string | null): boolean {
  return value !== null && Number.isFinite(Date.parse(value));
}

export function normalizeEventEvidence(raw: RawEventEvidence, decisionAsOf: string): NormalizedEventEvidence {
  const reasons: string[] = [];
  if (!raw.providerEventId || !raw.underlying || !raw.eventType || !raw.payloadHash) reasons.push('IDENTITY_INCOMPLETE');
  if (!validInstant(raw.knownAt) || !validInstant(raw.observedAt) || !validInstant(decisionAsOf)) reasons.push('INVALID_TIMESTAMP');
  if (validInstant(raw.knownAt) && validInstant(raw.observedAt) && Date.parse(raw.knownAt) > Date.parse(raw.observedAt)) {
    reasons.push('KNOWN_AFTER_OBSERVATION');
  }
  if (validInstant(raw.knownAt) && validInstant(decisionAsOf) && Date.parse(raw.knownAt) > Date.parse(decisionAsOf)) {
    reasons.push('NOT_KNOWN_AT_DECISION');
  }
  if (validInstant(raw.observedAt) && validInstant(decisionAsOf) && Date.parse(raw.observedAt) > Date.parse(decisionAsOf)) {
    reasons.push('NOT_OBSERVED_AT_DECISION');
  }
  if (raw.eventTime !== null && !validInstant(raw.eventTime)) reasons.push('INVALID_EVENT_TIME');
  return {
    ...raw,
    identityKey: `${raw.source}:${raw.providerEventId}`,
    verificationState: reasons.length > 0 ? 'INVALID' : 'VERIFIED',
    reasons,
  };
}

export function reconcileEventEvidence(events: readonly NormalizedEventEvidence[]): readonly NormalizedEventEvidence[] {
  const groups = new Map<string, NormalizedEventEvidence[]>();
  for (const event of events) {
    const group = groups.get(event.identityKey);
    if (group) group.push(event);
    else groups.set(event.identityKey, [event]);
  }
  return [...groups.values()].flatMap((group) => {
    // A provider may revise an event while retaining its ID. Even when the
    // headline identity and scheduled time are unchanged, a changed payload
    // must remain visible for review rather than being silently discarded.
    // Timing and validation are evidence too. An invalid future observation
    // must not disappear behind a valid copy merely because it arrived second.
    const signatures = new Set(group.map((item) => JSON.stringify([
      item.underlying, item.eventType, item.eventTime, item.payloadHash, item.applicable,
      item.knownAt, item.verificationState, [...item.reasons].sort(),
    ])));
    if (signatures.size <= 1) {
      // Repeated, consistent observations retain the earliest observation.
      // Provider page order cannot move first-observed evidence forward.
      return [[...group].sort((a, b) => (Date.parse(a.observedAt) - Date.parse(b.observedAt))
        || a.observedAt.localeCompare(b.observedAt))[0] as NormalizedEventEvidence];
    }
    return group.map((item) => ({
      ...item,
      verificationState: 'CONFLICT' as const,
      reasons: [...new Set([...item.reasons, 'CONFLICTING_PROVIDER_EVENT'])].sort(),
    }));
  }).sort((a, b) => a.identityKey.localeCompare(b.identityKey) || a.payloadHash.localeCompare(b.payloadHash)
    || a.knownAt.localeCompare(b.knownAt) || a.observedAt.localeCompare(b.observedAt)
    || a.verificationState.localeCompare(b.verificationState));
}
