import type { OptionomicsMacroEventCoverage } from './optionomics-provider.js';

export const paperBootstrapMacroEventPolicy = {
  policyVersion: 'theta-macro-event-paper-bootstrap-v1',
  authority: 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL',
  effectiveAt: '2026-09-23T00:00:00.000Z',
  nearHorizonCalendarDays: 3,
  eventFamilies: ['macro', 'fed'] as const,
} as const;

export interface MacroRiskEvidence {
  readonly policyVersion: typeof paperBootstrapMacroEventPolicy.policyVersion;
  readonly authority: typeof paperBootstrapMacroEventPolicy.authority;
  readonly state: 'KNOWN_TRUE' | 'KNOWN_FALSE' | 'UNKNOWN' | 'INVALID';
  readonly macroRiskFlag: boolean | null;
  readonly decisionAsOf: string;
  readonly validThrough: string | null;
  readonly eventCount: number | null;
  readonly nearEventCount: number | null;
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function normalizedRows(coverage: OptionomicsMacroEventCoverage): readonly Record<string, unknown>[] {
  return coverage.observations.flatMap((observation) => {
    const rows = observation.normalized.rows;
    return Array.isArray(rows) ? rows.flatMap((row) => {
      const parsed = object(row);
      return parsed === null ? [] : [parsed];
    }) : [];
  });
}

export function deriveMacroRiskEvidence(input: {
  readonly coverage: OptionomicsMacroEventCoverage | null;
  readonly decisionAsOf: string;
}): MacroRiskEvidence {
  const decisionMs = Date.parse(input.decisionAsOf);
  const effectiveMs = Date.parse(paperBootstrapMacroEventPolicy.effectiveAt);
  const base = {
    policyVersion: paperBootstrapMacroEventPolicy.policyVersion,
    authority: paperBootstrapMacroEventPolicy.authority,
    decisionAsOf: input.decisionAsOf,
  };
  if (!Number.isFinite(decisionMs) || !Number.isFinite(effectiveMs) || effectiveMs > decisionMs) return {
    ...base, state: 'INVALID', macroRiskFlag: null, validThrough: null, eventCount: null,
    nearEventCount: null, evidenceIds: [], reason: 'MACRO_EVENT_POLICY_OR_DECISION_TIME_INVALID',
  };
  if (input.coverage === null) return {
    ...base, state: 'UNKNOWN', macroRiskFlag: null, validThrough: null, eventCount: null,
    nearEventCount: null, evidenceIds: [], reason: 'MACRO_EVENT_COVERAGE_NOT_OBSERVED',
  };
  const evidenceIds = [...new Set(input.coverage.observations.map((observation) => observation.responseHash))].sort();
  if (input.coverage.state !== 'COMPLETE') return {
    ...base, state: 'UNKNOWN', macroRiskFlag: null, validThrough: input.coverage.to,
    eventCount: input.coverage.providerEventCount, nearEventCount: null, evidenceIds,
    reason: `MACRO_EVENT_COVERAGE_INCOMPLETE:${input.coverage.reason ?? 'UNKNOWN'}`,
  };
  const horizonMs = decisionMs + paperBootstrapMacroEventPolicy.nearHorizonCalendarDays * 86_400_000;
  const rows = normalizedRows(input.coverage);
  const scheduledTimes: number[] = [];
  for (const row of rows) {
    const family = row.type;
    if (family !== 'macro' && family !== 'fed') return {
      ...base, state: 'INVALID', macroRiskFlag: null, validThrough: input.coverage.to,
      eventCount: input.coverage.providerEventCount, nearEventCount: null, evidenceIds,
      reason: 'MACRO_EVENT_FAMILY_MISMATCH',
    };
    const scheduledAt = typeof row.scheduledAt === 'string' ? Date.parse(row.scheduledAt) : Number.NaN;
    if (!Number.isFinite(scheduledAt)) return {
      ...base, state: 'UNKNOWN', macroRiskFlag: null, validThrough: input.coverage.to,
      eventCount: input.coverage.providerEventCount, nearEventCount: null, evidenceIds,
      reason: 'MACRO_EVENT_SCHEDULE_TIME_UNKNOWN',
    };
    const knownAt = typeof row.knownAt === 'string' ? Date.parse(row.knownAt) : null;
    if (knownAt !== null && (!Number.isFinite(knownAt) || knownAt > decisionMs)) return {
      ...base, state: 'INVALID', macroRiskFlag: null, validThrough: input.coverage.to,
      eventCount: input.coverage.providerEventCount, nearEventCount: null, evidenceIds,
      reason: 'MACRO_EVENT_PIT_TIME_INVALID',
    };
    scheduledTimes.push(scheduledAt);
  }
  if (scheduledTimes.length !== input.coverage.providerEventCount) return {
    ...base, state: 'INVALID', macroRiskFlag: null, validThrough: input.coverage.to,
    eventCount: input.coverage.providerEventCount, nearEventCount: null, evidenceIds,
    reason: 'MACRO_EVENT_COUNT_MISMATCH',
  };
  const nearEventCount = scheduledTimes.filter((time) => time >= decisionMs && time <= horizonMs).length;
  return {
    ...base,
    state: nearEventCount > 0 ? 'KNOWN_TRUE' : 'KNOWN_FALSE',
    macroRiskFlag: nearEventCount > 0,
    validThrough: input.coverage.to,
    eventCount: input.coverage.providerEventCount,
    nearEventCount,
    evidenceIds,
    reason: nearEventCount > 0 ? 'SCHEDULED_MACRO_OR_FED_EVENT_WITHIN_POLICY_HORIZON'
      : 'COMPLETE_BOUNDED_COVERAGE_HAS_NO_EVENT_WITHIN_POLICY_HORIZON',
  };
}
