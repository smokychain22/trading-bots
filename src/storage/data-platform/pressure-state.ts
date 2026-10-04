// The storage pressure state as the WRITERS see it. The control plane persists one row (dp.storage_pressure_state); every bulk writer asks this module before it writes.
// An absent, stale or malformed row is STORAGE_PRESSURE_UNKNOWN, never "unlimited capacity": a dead governor must not recreate the uncontrolled-growth problem.
// P0 operational truth is structurally exempt: scopes in P0_OPERATIONAL_SCOPES can not be demoted and the pressure state is not even read for them.
import { defaultArchiveQueueLimits, decideWrite, stateFor, type ArchiveQueueLimits, type CapacityState, type NewRiskGate, type ResearchGate, type WriteDecision, type WritePriority } from './storage-governor.js';

export const PRESSURE_MAX_AGE_MS = 36 * 3_600_000;
export const PRESSURE_UNKNOWN_LOCK_AFTER_MS = 72 * 3_600_000;

/** Operational truth. Storage pressure can never suppress these writes. */
export const P0_OPERATIONAL_SCOPES = ['orders', 'fills', 'broker-reconciliation', 'execution-state', 'positions', 'inventory', 'risk', 'management', 'safety-events', 'action-plan-lineage', 'order-intents', 'lifecycle'] as const;
export type P0Scope = (typeof P0_OPERATIONAL_SCOPES)[number];
export const isP0Scope = (scope: string): boolean => (P0_OPERATIONAL_SCOPES as readonly string[]).includes(scope);

/** Bulk research and history writers and their priority (everything not listed here is treated as P2 so a new writer starts conservative, not exempt). */
export const BULK_WRITER_PRIORITIES: Readonly<Record<string, WritePriority>> = {
  'pit-selected-finalist': 'P1_SELECTED_AND_FINALIST_EVIDENCE',
  'cycle-evidence-blob': 'P1_SELECTED_AND_FINALIST_EVIDENCE',
  'pit-candidate-research': 'P2_FULL_RESEARCH',
  'canonical-candidate-research': 'P2_FULL_RESEARCH',
  'shadow-research-history': 'P2_FULL_RESEARCH',
  'command-5a-historical-marks': 'P2_FULL_RESEARCH',
  'optionomics-research-history': 'P2_FULL_RESEARCH',
  'raw-provider-history': 'P3_RAW_PROVIDER_PAYLOAD',
  'chain-research-evidence': 'P3_RAW_PROVIDER_PAYLOAD',
};

export interface PressureRow {
  readonly band?: unknown; readonly database_bytes?: unknown; readonly plan_bytes?: unknown; readonly archive_queue_bytes?: unknown; readonly archive_lag_sessions?: unknown;
  readonly archive_backend_healthy?: unknown; readonly projected_sessions_to_critical?: unknown; readonly evaluated_at?: unknown;
}

export interface KnownPressure {
  readonly kind: 'KNOWN';
  readonly state: CapacityState;
  readonly researchGate: ResearchGate;
  readonly newRiskGate: NewRiskGate;
  readonly evaluatedAt: string;
  readonly backpressure: readonly string[];
  readonly archiveBackendHealthy: boolean;
  readonly projectedSessionsToCritical: number | null;
}
export interface UnknownPressure { readonly kind: 'UNKNOWN'; readonly reason: 'MISSING' | 'STALE' | 'MALFORMED' | 'READ_ERROR'; readonly ageMs: number | null; readonly newRiskGate: NewRiskGate; readonly researchGate: ResearchGate; readonly state: 'STORAGE_PRESSURE_UNKNOWN' }
export type PressureSnapshot = KnownPressure | UnknownPressure;

const BANDS: readonly CapacityState[] = ['NORMAL', 'ARCHIVE_PRESSURE', 'RESEARCH_THROTTLED', 'NEW_RISK_RESTRICTED', 'STORAGE_CRITICAL'];

/** Unknown storage state: research is throttled (bulk P2/P3 queue for the archive, selected/finalist evidence still writes), new risk is restricted and, once the state stays unknown for days, locked. Management is never affected. */
export function unknownPressure(reason: UnknownPressure['reason'], ageMs: number | null, lockAfterMs = PRESSURE_UNKNOWN_LOCK_AFTER_MS): UnknownPressure {
  const lock = reason === 'STALE' && ageMs !== null && ageMs >= lockAfterMs;
  return { kind: 'UNKNOWN', reason, ageMs, state: 'STORAGE_PRESSURE_UNKNOWN', researchGate: 'THROTTLE', newRiskGate: lock ? 'LOCKED' : 'RESTRICTED' };
}

const finite = (value: unknown): number | null => { const parsed = typeof value === 'string' ? Number(value) : value; return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null; };

export function interpretPressureRow(row: PressureRow | null | undefined, now: Date, options: { readonly maxAgeMs?: number; readonly limits?: ArchiveQueueLimits; readonly lockAfterMs?: number } = {}): PressureSnapshot {
  if (row === null || row === undefined) return unknownPressure('MISSING', null, options.lockAfterMs);
  const band = typeof row.band === 'string' && (BANDS as readonly string[]).includes(row.band) ? (row.band as CapacityState) : null;
  const evaluated = row.evaluated_at instanceof Date ? row.evaluated_at.getTime() : typeof row.evaluated_at === 'string' ? Date.parse(row.evaluated_at) : Number.NaN;
  const database = finite(row.database_bytes); const plan = finite(row.plan_bytes);
  const queueBytes = finite(row.archive_queue_bytes) ?? 0; const lag = finite(row.archive_lag_sessions) ?? 0;
  if (band === null || !Number.isFinite(evaluated) || database === null || plan === null || plan <= 0 || database < 0 || typeof row.archive_backend_healthy !== 'boolean') return unknownPressure('MALFORMED', null, options.lockAfterMs);
  // the band must agree with the bytes it was computed from (a row that says NORMAL at 90% is corrupt, not healthy)
  if (BANDS.indexOf(stateFor(database / plan)) > BANDS.indexOf(band)) return unknownPressure('MALFORMED', null, options.lockAfterMs);
  const ageMs = now.getTime() - evaluated;
  if (ageMs > (options.maxAgeMs ?? PRESSURE_MAX_AGE_MS) || ageMs < -300_000) return unknownPressure('STALE', Math.max(0, ageMs), options.lockAfterMs);
  const limits = options.limits ?? defaultArchiveQueueLimits;
  const backpressure: string[] = [];
  if (queueBytes > limits.maxQueueBytes) backpressure.push('ARCHIVE_QUEUE_BYTES_EXCEEDED');
  if (lag > limits.maxLagSessions) backpressure.push('ARCHIVE_LAG_EXCEEDED');
  if (!row.archive_backend_healthy) backpressure.push('ARCHIVE_BACKEND_UNHEALTHY');
  const projected = finite(row.projected_sessions_to_critical);
  if (projected !== null && projected < 3) backpressure.push('PROJECTED_SESSIONS_TO_CRITICAL_LOW');
  const pressured = band === 'RESEARCH_THROTTLED' || band === 'NEW_RISK_RESTRICTED' || band === 'STORAGE_CRITICAL';
  let researchGate: ResearchGate = band === 'NORMAL' || band === 'ARCHIVE_PRESSURE' ? 'ALLOW' : 'THROTTLE';
  if (band === 'NEW_RISK_RESTRICTED' || band === 'STORAGE_CRITICAL') researchGate = 'SKIP_LOW_PRIORITY';
  else if (backpressure.length > 0) researchGate = pressured ? 'SKIP_LOW_PRIORITY' : 'THROTTLE';
  let newRiskGate: NewRiskGate = band === 'STORAGE_CRITICAL' ? 'LOCKED' : band === 'NEW_RISK_RESTRICTED' ? 'RESTRICTED' : 'OPEN';
  if (!row.archive_backend_healthy && pressured && newRiskGate === 'OPEN') newRiskGate = 'RESTRICTED';
  return { kind: 'KNOWN', state: band, researchGate, newRiskGate, evaluatedAt: new Date(evaluated).toISOString(), backpressure, archiveBackendHealthy: row.archive_backend_healthy, projectedSessionsToCritical: projected };
}

export interface PressureProvider { read(now?: Date): Promise<PressureSnapshot> }

interface Queryable { query(text: string, values?: unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }> }

/** Reads dp.storage_pressure_state with a short cache. Any read failure is UNKNOWN (READ_ERROR), never a throw into a writer. */
export class PostgresPressureProvider implements PressureProvider {
  private cached: { readonly at: number; readonly snapshot: PressureSnapshot } | null = null;
  constructor(private readonly pool: Queryable, private readonly options: { readonly cacheMs?: number; readonly maxAgeMs?: number; readonly limits?: ArchiveQueueLimits } = {}) {}
  async read(now: Date = new Date()): Promise<PressureSnapshot> {
    const ttl = this.options.cacheMs ?? 5_000;
    if (this.cached !== null && now.getTime() - this.cached.at < ttl && now.getTime() >= this.cached.at) return this.cached.snapshot;
    let snapshot: PressureSnapshot;
    try {
      const result = await this.pool.query('SELECT band, database_bytes, plan_bytes, archive_queue_bytes, archive_lag_sessions, archive_backend_healthy, projected_sessions_to_critical, evaluated_at FROM dp.storage_pressure_state WHERE singleton');
      snapshot = interpretPressureRow(result.rows[0] ?? null, now, { ...(this.options.maxAgeMs === undefined ? {} : { maxAgeMs: this.options.maxAgeMs }), ...(this.options.limits === undefined ? {} : { limits: this.options.limits }) });
    } catch { snapshot = unknownPressure('READ_ERROR', null); }
    this.cached = { at: now.getTime(), snapshot };
    return snapshot;
  }
}

export class StaticPressureProvider implements PressureProvider { constructor(private readonly snapshot: PressureSnapshot) {} async read(): Promise<PressureSnapshot> { return this.snapshot; } }

export interface GatedWrite { readonly decision: WriteDecision; readonly priority: WritePriority; readonly snapshot: PressureSnapshot | null }

/**
 * The single entry point every bulk writer calls. P0 scopes return WRITE without reading anything; a P0 scope can not be demoted by passing a lower priority.
 * `requested` is the priority the caller asks for; an unregistered bulk scope defaults to P2 (conservative) and can never claim P0.
 */
export async function gateWrite(provider: PressureProvider, scope: string, requested?: WritePriority, now: Date = new Date()): Promise<GatedWrite> {
  if (isP0Scope(scope)) return { decision: { allow: true, disposition: 'WRITE', record: null }, priority: 'P0_OPERATIONAL', snapshot: null };
  const registered = BULK_WRITER_PRIORITIES[scope];
  const priority: WritePriority = registered ?? (requested !== undefined && requested !== 'P0_OPERATIONAL' ? requested : 'P2_FULL_RESEARCH');
  const snapshot = await provider.read(now);
  const state: CapacityState = snapshot.kind === 'KNOWN' ? snapshot.state : 'RESEARCH_THROTTLED';
  return { decision: decideWrite({ state, researchGate: snapshot.researchGate }, priority, scope, now.toISOString()), priority, snapshot };
}

/** New-risk entry gate for the Paper entry path: management, closing, rolling-out and reconciliation never consult this. */
export async function newRiskGateFor(provider: PressureProvider, now: Date = new Date()): Promise<{ readonly gate: NewRiskGate; readonly managementAllowed: true; readonly reason: string }> {
  const snapshot = await provider.read(now);
  return { gate: snapshot.newRiskGate, managementAllowed: true, reason: snapshot.kind === 'KNOWN' ? `STORAGE_${snapshot.state}` : `STORAGE_PRESSURE_UNKNOWN:${snapshot.reason}` };
}
