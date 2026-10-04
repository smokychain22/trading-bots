// Typed data-platform incidents. Each is a named condition with a scope, never a generic SYSTEM ERROR.
export const INCIDENT_KINDS = [
  'UNBOUNDED_POSTGRES_GROWTH', 'ARCHIVE_BACKLOG', 'ARCHIVE_CORRUPTION', 'RETENTION_FAILURE', 'PARTITION_RETIREMENT_FAILURE', 'HOT_WRITE_AMPLIFICATION_REGRESSION', 'DATABASE_CAPACITY_FORECAST_BREACH',
  'DEFAULT_PARTITION_ROWS', 'LATE_WRITE_INTO_RETIRED_PARTITION', 'ARCHIVE_BACKEND_UNHEALTHY', 'PARQUET_VERIFICATION_FAILURE', 'DUAL_WRITE_WINDOW_EXPIRED', 'MAINTENANCE_INCOMPLETE', 'STORAGE_PRESSURE_STATE_UNAVAILABLE',
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export type IncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface PlatformIncident {
  readonly kind: IncidentKind;
  readonly severity: IncidentSeverity;
  readonly scope: { readonly dataset?: string; readonly partition?: string };
  readonly detail: string;
  readonly observedAt: string;
}

export class PlatformError extends Error {
  constructor(readonly code: string, readonly incidentKind: IncidentKind, readonly retryable: boolean, message?: string) {
    super(message ?? code);
    this.name = 'PlatformError';
  }
}

export const incident = (kind: IncidentKind, severity: IncidentSeverity, scope: PlatformIncident['scope'], detail: string, observedAt: string): PlatformIncident => ({ kind, severity, scope, detail, observedAt });

/** Operational (retryable) archive-side errors become a backlog signal; integrity errors become corruption; retirement errors are their own kind. */
export function incidentFromError(error: unknown, scope: PlatformIncident['scope'], observedAt: string): PlatformIncident {
  if (error instanceof PlatformError) return incident(error.incidentKind, error.retryable ? 'WARNING' : 'CRITICAL', scope, error.code, observedAt);
  const message = error instanceof Error ? error.message : String(error);
  if (/ARCHIVE_BACKEND_UNAVAILABLE/.test(message)) return incident('ARCHIVE_BACKLOG', 'WARNING', scope, message, observedAt);
  return incident('RETENTION_FAILURE', 'WARNING', scope, message, observedAt);
}
