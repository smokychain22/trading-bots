// StorageGovernor + StoragePressureGate: capacity bands over the provider allocation, predictive control (next session, 5 and 20 sessions), archive backpressure and
// the pre-session gates. Pure and deterministic. Priority rule (spec 53): storage work is ALWAYS lower priority than risk management, position management, broker
// reconciliation and order-state truth. The gates here can restrict or lock NEW RISK and research persistence; they have no input or output that can touch closing,
// management, reconciliation or order truth (`managementAllowed` is the literal true).

export type CapacityState = 'NORMAL' | 'ARCHIVE_PRESSURE' | 'RESEARCH_THROTTLED' | 'NEW_RISK_RESTRICTED' | 'STORAGE_CRITICAL';
export type NewRiskGate = 'OPEN' | 'RESTRICTED' | 'LOCKED';
export type ResearchGate = 'ALLOW' | 'THROTTLE' | 'SKIP_LOW_PRIORITY';

export interface CapacityBands {
  /** fractions of the provider allocation */
  readonly archivePressureAt: number;
  readonly researchThrottledAt: number;
  readonly newRiskRestrictedAt: number;
  readonly criticalAt: number;
}

export const defaultCapacityBands: CapacityBands = { archivePressureAt: 0.4, researchThrottledAt: 0.55, newRiskRestrictedAt: 0.7, criticalAt: 0.825 };

export interface ArchiveQueueState {
  readonly queueBytes: number;
  readonly queuePartitions: number;
  /** sessions between the oldest unarchived closed partition and now */
  readonly lagSessions: number;
}

export interface ArchiveQueueLimits { readonly maxQueueBytes: number; readonly maxQueuePartitions: number; readonly maxLagSessions: number }
export const defaultArchiveQueueLimits: ArchiveQueueLimits = { maxQueueBytes: 1.5 * 1024 ** 3, maxQueuePartitions: 6, maxLagSessions: 3 };

export interface GovernorInput {
  readonly currentBytes: number;
  readonly planBytes: number;
  /** HOT growth of recent sessions, bytes added during the session (oldest first); a rolling window of at least 5 is expected, fewer lowers confidence */
  readonly recentSessionGrowthBytes: readonly number[];
  /** bytes the archive pipeline can retire per session when healthy (measured), 0 when the backend is unavailable */
  readonly archiveRetireBytesPerSession: number;
  /** bytes currently eligible to be retired (verified archives past their hot window) */
  readonly retirableBytesNow: number;
  readonly queue: ArchiveQueueState;
  /** multiplier for an unusually large expected session (for example a 10,000 contract chain), 1 = typical */
  readonly expectedVolumeFactor?: number;
}

export interface HorizonForecast { readonly sessions: number; readonly peakBytes: number; readonly peakUtilization: number; readonly postArchiveBytes: number; readonly postArchiveUtilization: number }

export interface GovernorAssessment {
  readonly utilization: number;
  readonly state: CapacityState;
  readonly forecasts: { readonly next: HorizonForecast; readonly five: HorizonForecast; readonly twenty: HorizonForecast };
  readonly growthPerSessionBytes: number;
  readonly growthConfidence: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly newRiskGate: NewRiskGate;
  readonly researchGate: ResearchGate;
  readonly archiveBeforeSession: boolean;
  readonly backpressure: { readonly engaged: boolean; readonly reasons: readonly string[] };
  readonly managementAllowed: true;
  readonly reasons: readonly string[];
}

const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
};

export function stateFor(utilization: number, bands: CapacityBands = defaultCapacityBands): CapacityState {
  return utilization >= bands.criticalAt ? 'STORAGE_CRITICAL' : utilization >= bands.newRiskRestrictedAt ? 'NEW_RISK_RESTRICTED'
    : utilization >= bands.researchThrottledAt ? 'RESEARCH_THROTTLED' : utilization >= bands.archivePressureAt ? 'ARCHIVE_PRESSURE' : 'NORMAL';
}

export function validateBands(bands: CapacityBands): boolean {
  return bands.archivePressureAt > 0 && bands.archivePressureAt < bands.researchThrottledAt && bands.researchThrottledAt < bands.newRiskRestrictedAt && bands.newRiskRestrictedAt < bands.criticalAt && bands.criticalAt < 0.95;
}

function forecast(sessions: number, input: GovernorInput, perSession: number, volumeFactor: number): HorizonForecast {
  // HOT grows by perSession each session; between sessions the archive can retire up to archiveRetireBytesPerSession of retirable data
  let size = input.currentBytes;
  let retirable = input.retirableBytesNow;
  let peak = size;
  for (let index = 0; index < sessions; index += 1) {
    const factor = index === 0 ? volumeFactor : 1;
    size += perSession * factor;
    peak = Math.max(peak, size);
    const retired = Math.min(retirable, input.archiveRetireBytesPerSession);
    size -= retired;
    retirable -= retired;
    retirable += perSession; // today's growth becomes retirable once its hot window passes (steady-state approximation)
  }
  return { sessions, peakBytes: peak, peakUtilization: peak / input.planBytes, postArchiveBytes: size, postArchiveUtilization: size / input.planBytes };
}

export function assessCapacity(input: GovernorInput, bands: CapacityBands = defaultCapacityBands, limits: ArchiveQueueLimits = defaultArchiveQueueLimits): GovernorAssessment {
  if (!validateBands(bands) || !(input.planBytes > 0) || input.currentBytes < 0 || input.recentSessionGrowthBytes.some((value) => !Number.isFinite(value))) throw new Error('INVALID_GOVERNOR_INPUT');
  const reasons: string[] = [];
  const utilization = input.currentBytes / input.planBytes;
  const growth = input.recentSessionGrowthBytes;
  const perSession = Math.max(0, growth.length === 0 ? 0 : Math.max(percentile(growth, 0.95), growth.reduce((a, b) => a + b, 0) / growth.length));
  const confidence: GovernorAssessment['growthConfidence'] = growth.length >= 10 ? 'HIGH' : growth.length >= 5 ? 'MEDIUM' : 'LOW';
  const volumeFactor = input.expectedVolumeFactor ?? 1;
  const forecasts = { next: forecast(1, input, perSession, volumeFactor), five: forecast(5, input, perSession, volumeFactor), twenty: forecast(20, input, perSession, volumeFactor) };
  const state = stateFor(utilization, bands);

  const queueReasons: string[] = [];
  if (input.queue.queueBytes > limits.maxQueueBytes) queueReasons.push('ARCHIVE_QUEUE_BYTES_EXCEEDED');
  if (input.queue.queuePartitions > limits.maxQueuePartitions) queueReasons.push('ARCHIVE_QUEUE_PARTITIONS_EXCEEDED');
  if (input.queue.lagSessions > limits.maxLagSessions) queueReasons.push('ARCHIVE_LAG_EXCEEDED');
  const backpressure = { engaged: queueReasons.length > 0, reasons: queueReasons };

  // predictive control: if the NEXT session's predicted PEAK would cross a band, act before the session
  const predictedState = stateFor(forecasts.next.peakUtilization, bands);
  const archiveBeforeSession = state !== 'NORMAL' || forecasts.next.peakUtilization >= bands.archivePressureAt;
  if (archiveBeforeSession) reasons.push(`ARCHIVE_BEFORE_SESSION:state=${state},predictedPeak=${predictedState}`);

  let newRiskGate: NewRiskGate = 'OPEN';
  if (state === 'STORAGE_CRITICAL') newRiskGate = 'LOCKED';
  else if (state === 'NEW_RISK_RESTRICTED') newRiskGate = 'RESTRICTED';
  // if even after the archive that can run before the session the predicted peak is still critical, lock new risk; if it would only reach the restricted band, restrict
  const archiveCanRunBeforeSession = input.archiveRetireBytesPerSession > 0;
  const peakAfterPreSessionArchive = (forecasts.next.peakBytes - (archiveCanRunBeforeSession ? Math.min(input.retirableBytesNow, input.archiveRetireBytesPerSession) : 0)) / input.planBytes;
  if (peakAfterPreSessionArchive >= bands.criticalAt) newRiskGate = 'LOCKED';
  else if (peakAfterPreSessionArchive >= bands.newRiskRestrictedAt && newRiskGate === 'OPEN') newRiskGate = 'RESTRICTED';
  if (newRiskGate !== 'OPEN') reasons.push(`NEW_RISK_${newRiskGate}:peakAfterArchive=${peakAfterPreSessionArchive.toFixed(3)}`);

  let researchGate: ResearchGate = state === 'NORMAL' || state === 'ARCHIVE_PRESSURE' ? 'ALLOW' : 'THROTTLE';
  if (backpressure.engaged) researchGate = state === 'NORMAL' || state === 'ARCHIVE_PRESSURE' ? 'THROTTLE' : 'SKIP_LOW_PRIORITY';
  if (state === 'NEW_RISK_RESTRICTED' || state === 'STORAGE_CRITICAL') researchGate = 'SKIP_LOW_PRIORITY';
  if (backpressure.engaged) reasons.push(`BACKPRESSURE:${queueReasons.join(',')}`);
  if (growth.length < 5) reasons.push('GROWTH_HISTORY_SHORT');
  return { utilization, state, forecasts, growthPerSessionBytes: perSession, growthConfidence: confidence, newRiskGate, researchGate, archiveBeforeSession, backpressure, managementAllowed: true, reasons };
}

// ---- research write priorities and explicit loss records -----------------------------------------------------------------------------------------------------

export type WritePriority = 'P0_OPERATIONAL' | 'P1_SELECTED_AND_FINALIST_EVIDENCE' | 'P2_FULL_RESEARCH' | 'P3_RAW_PROVIDER_PAYLOAD';

export interface WriteDecision { readonly allow: boolean; readonly disposition: 'WRITE' | 'QUEUE_FOR_ARCHIVE_ONLY' | 'SKIP_WITH_RECORD'; readonly record: EvidenceSkippedRecord | null }
export interface EvidenceSkippedRecord { readonly kind: 'EVIDENCE_SKIPPED_DUE_TO_STORAGE_PRESSURE'; readonly priority: WritePriority; readonly scope: string; readonly state: CapacityState | 'STORAGE_PRESSURE_UNKNOWN'; readonly observedAt: string }

/** P0 operational writes are ALWAYS written. Lower priorities degrade in order P3, P2, P1 and a skip is always recorded with its exact scope. */
export function decideWrite(assessment: Pick<GovernorAssessment, 'state' | 'researchGate'>, priority: WritePriority, scope: string, observedAt: string): WriteDecision {
  if (priority === 'P0_OPERATIONAL') return { allow: true, disposition: 'WRITE', record: null };
  const skip = (): WriteDecision => ({ allow: false, disposition: 'SKIP_WITH_RECORD', record: { kind: 'EVIDENCE_SKIPPED_DUE_TO_STORAGE_PRESSURE', priority, scope, state: assessment.state, observedAt } });
  if (assessment.researchGate === 'ALLOW') return { allow: true, disposition: 'WRITE', record: null };
  if (assessment.researchGate === 'THROTTLE') return priority === 'P3_RAW_PROVIDER_PAYLOAD' || priority === 'P2_FULL_RESEARCH' ? { allow: false, disposition: 'QUEUE_FOR_ARCHIVE_ONLY', record: null } : { allow: true, disposition: 'WRITE', record: null };
  // SKIP_LOW_PRIORITY: P1 selected/finalist evidence is still written unless the database is critical
  if (priority === 'P1_SELECTED_AND_FINALIST_EVIDENCE') return assessment.state === 'STORAGE_CRITICAL' ? skip() : { allow: true, disposition: 'WRITE', record: null };
  return skip();
}

/** Pre-session gate (spec 40): new-risk operation may begin only if storage cannot endanger durable execution truth. Never blocks management of existing positions. */
export interface PreSessionChecks {
  readonly archiveHealthy: boolean;
  readonly previousMaintenanceCompleted: boolean;
  readonly transactionalReserveBytes: number;
  readonly requiredTransactionalReserveBytes: number;
}

export function preSessionGate(assessment: GovernorAssessment, checks: PreSessionChecks): { readonly newRisk: NewRiskGate; readonly managementAllowed: true; readonly reasons: readonly string[] } {
  const reasons: string[] = [...assessment.reasons];
  let gate = assessment.newRiskGate;
  if (checks.transactionalReserveBytes < checks.requiredTransactionalReserveBytes) { gate = 'LOCKED'; reasons.push('TRANSACTIONAL_RESERVE_BELOW_REQUIRED'); }
  if (!checks.archiveHealthy && (assessment.state === 'RESEARCH_THROTTLED' || assessment.state === 'NEW_RISK_RESTRICTED' || assessment.state === 'STORAGE_CRITICAL')) { gate = gate === 'LOCKED' ? 'LOCKED' : 'RESTRICTED'; reasons.push('ARCHIVE_UNHEALTHY_UNDER_PRESSURE'); }
  if (!checks.previousMaintenanceCompleted && (assessment.state === 'NEW_RISK_RESTRICTED' || assessment.state === 'STORAGE_CRITICAL')) { gate = 'LOCKED'; reasons.push('MAINTENANCE_INCOMPLETE_UNDER_PRESSURE'); }
  return { newRisk: gate, managementAllowed: true, reasons };
}
