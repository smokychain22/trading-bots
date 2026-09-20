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
  for (const event of events) groups.set(event.identityKey, [...(groups.get(event.identityKey) ?? []), event]);
  return [...groups.values()].flatMap((group) => {
    const signatures = new Set(group.map((item) => `${item.underlying}|${item.eventType}|${item.eventTime ?? 'UNKNOWN'}`));
    if (signatures.size <= 1) return [group[0] as NormalizedEventEvidence];
    return group.map((item) => ({
      ...item,
      verificationState: 'CONFLICT' as const,
      reasons: [...new Set([...item.reasons, 'CONFLICTING_PROVIDER_EVENT'])].sort(),
    }));
  }).sort((a, b) => a.identityKey.localeCompare(b.identityKey) || a.payloadHash.localeCompare(b.payloadHash));
}
