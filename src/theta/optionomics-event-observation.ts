import { createHash } from 'node:crypto';

export interface OptionomicsEventRevision {
  readonly providerEventId: string;
  readonly payloadHash: string;
  readonly eventKind: string | null;
  readonly ticker: string | null;
  readonly eventDate: string | null;
  readonly scheduledAt: string | null;
  readonly providerKnownAt: string | null;
  readonly firstObservedAt: string;
  readonly pitTimingState: 'TIMING_VALID' | 'KNOWN_AT_UNKNOWN' | 'KNOWN_AFTER_OBSERVATION';
  readonly providerPayload: Readonly<Record<string, unknown>>;
}

function instant(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function date(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}

/** Repeated payloads have one immutable first observation; a revised payload has a distinct hash. */
export function optionomicsEventRevisions(payload: unknown, retrievedAt: string): readonly OptionomicsEventRevision[] {
  const envelope = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown> : null;
  if (envelope === null || !Array.isArray(envelope.events) || instant(retrievedAt) === null) return [];
  return envelope.events.flatMap((value): OptionomicsEventRevision[] => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || row.id.trim() === '') return [];
    const knownAt = instant(row.known_at);
    const firstObservedAt = instant(retrievedAt) as string;
    return [{
      providerEventId: row.id,
      payloadHash: createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex'),
      eventKind: typeof row.kind === 'string' ? row.kind : null,
      ticker: typeof row.ticker === 'string' ? row.ticker : null,
      eventDate: date(row.date),
      scheduledAt: instant(row.scheduled_at),
      providerKnownAt: knownAt,
      firstObservedAt,
      pitTimingState: knownAt === null ? 'KNOWN_AT_UNKNOWN'
        : knownAt > firstObservedAt ? 'KNOWN_AFTER_OBSERVATION' : 'TIMING_VALID',
      providerPayload: row,
    }];
  });
}
