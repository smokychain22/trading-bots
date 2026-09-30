/**
 * COMMAND 5C-7 item 51: real-data-arrival test harness. Accepts an
 * observation bundle (the shape Codex's
 * THETA-CONTRACT-PATH-RUNTIME-OBSERVATION-PRODUCER handoff specifies) and
 * runs the full pipeline -- schema validation -> PIT validation -> dataset
 * build -> unknown audit -> label-state update -> session report -- so
 * that when Codex's FIRST real observation bundle arrives, zero new
 * research code is required to consume it. Exercised here only against a
 * fixture bundle (COMMAND 5C-7's own discipline: no real bundle exists
 * yet).
 */
import {
  buildContractPathOutcomeRow, type ContractPathOutcomeRow, type PathCheckpoint, type PathObservation,
} from './contract-path-outcome-dataset.js';
import { classifyUnknown, type UnknownReasonCode } from './unknown-value-taxonomy.js';
import { buildSessionExperienceFromEvidence, type CycleEvidenceRecord } from './session-experience-builder.js';
import { adaptCommand5aObservation, projectToRawObservationBundleRow, type Command5aAdapterSubjectContext } from './command5a-canonical-adapter.js';
import type { ContractPathObservationReceipt } from './contract-path-observation-runtime.js';
import type { LegIdentityForMark } from './command5a-mark-semantics.js';

export const realDataArrivalHarnessVersion = 'theta-real-data-arrival-harness-v1' as const;

/** The exact schema Codex's observation-producer handoff specifies
 * (`docs/research/THETA_CODEX_INTEGRATION_QUEUE.md`). */
export interface RawObservationBundleRow {
  readonly subjectId: string;
  readonly checkpoint: string;
  readonly observedAt: string;
  readonly marketMarkPrice: number | null;
  readonly impliedVolatility: number | null;
  readonly underlyingPrice: number | null;
  readonly sourceSha: string;
  readonly workerSha: string | null;
  readonly provenance: 'REAL_SCHEDULED_OBSERVATION' | 'RECONSTRUCTED';
}

export interface ObservationBundle {
  readonly bundleId: string;
  readonly decisionAt: string;
  readonly subjectId: string;
  readonly wasSelected: boolean;
  readonly wasShadowOnly: boolean;
  readonly rows: readonly RawObservationBundleRow[];
}

const VALID_CHECKPOINTS: ReadonlySet<string> = new Set(['15M', '1H', 'EOD', '1D', '3D', '5D', 'EXPIRATION', 'COMMON_HORIZON']);
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface SchemaValidationFailure {
  readonly rowIndex: number;
  readonly field: string;
  readonly reason: string;
}

/** Step 1: schema validation. Returns every real, machine-readable
 * failure -- never throws on the first one, since a real arriving bundle
 * may have multiple malformed rows worth reporting together. */
const VALID_PROVENANCE: ReadonlySet<string> = new Set(['REAL_SCHEDULED_OBSERVATION', 'RECONSTRUCTED']);

export function validateBundleSchema(bundle: ObservationBundle): readonly SchemaValidationFailure[] {
  const failures: SchemaValidationFailure[] = [];
  if (bundle === null || typeof bundle !== 'object' || !Array.isArray(bundle.rows)) {
    return [{ rowIndex: -1, field: 'bundle', reason: 'bundle object and rows array required' }];
  }
  for (const key of ['wasSelected', 'wasShadowOnly'] as const) if (typeof bundle[key] !== 'boolean') {
    failures.push({ rowIndex: -1, field: key, reason: 'boolean required' });
  }
  if (typeof bundle.bundleId !== 'string' || !bundle.bundleId.trim()) failures.push({ rowIndex: -1, field: 'bundleId', reason: 'nonempty identity required' });
  const seenCheckpoints = new Set<string>();
  bundle.rows.forEach((row, index) => {
    if (row === null || typeof row !== 'object') { failures.push({ rowIndex: index, field: 'row', reason: 'object required' }); return; }
    if (row.subjectId !== bundle.subjectId) failures.push({ rowIndex: index, field: 'subjectId', reason: 'row identity differs from bundle' });
    for (const key of ['marketMarkPrice', 'impliedVolatility', 'underlyingPrice'] as const) {
      if (row[key] !== null && (!Number.isFinite(row[key]) || row[key] < 0 || (key === 'underlyingPrice' && row[key] === 0))) {
        failures.push({ rowIndex: index, field: key, reason: 'finite valid market value or null required' });
      }
    }
    if (!VALID_CHECKPOINTS.has(row.checkpoint)) failures.push({ rowIndex: index, field: 'checkpoint', reason: `unknown checkpoint: ${row.checkpoint}` });
    if (!Number.isFinite(Date.parse(row.observedAt))) failures.push({ rowIndex: index, field: 'observedAt', reason: 'not a valid timestamp' });
    if (!SHA_PATTERN.test(row.sourceSha)) failures.push({ rowIndex: index, field: 'sourceSha', reason: 'not a 40-hex sha' });
    if (row.workerSha !== null && !SHA_PATTERN.test(row.workerSha)) failures.push({ rowIndex: index, field: 'workerSha', reason: 'not a 40-hex sha' });
    if (!VALID_PROVENANCE.has(row.provenance)) failures.push({ rowIndex: index, field: 'provenance', reason: `unknown provenance enum: ${row.provenance}` });
    // ADVERSARIAL (directive §15): the same horizon observed twice for the
    // same subject is a duplicate-observation corruption, not a real second
    // reading -- reject rather than silently keeping the last one.
    if (seenCheckpoints.has(row.checkpoint)) {
      failures.push({ rowIndex: index, field: 'checkpoint', reason: `duplicate observation for checkpoint ${row.checkpoint} -- a real bundle reports each horizon at most once per subject` });
    }
    seenCheckpoints.add(row.checkpoint);
  });
  if (!Number.isFinite(Date.parse(bundle.decisionAt))) {
    failures.push({ rowIndex: -1, field: 'bundle.decisionAt', reason: 'not a valid timestamp' });
  }
  if (typeof bundle.subjectId !== 'string' || bundle.subjectId.trim().length === 0) failures.push({ rowIndex: -1, field: 'bundle.subjectId', reason: 'empty subjectId' });
  return failures;
}

export interface PitValidationFailure {
  readonly rowIndex: number;
  readonly reason: string;
}

/** These are future outcome observations, never decision inputs. Every
 * checkpoint must be on or after T0, including expiration and long horizons. */
export function validateBundlePit(bundle: ObservationBundle): readonly PitValidationFailure[] {
  const failures: PitValidationFailure[] = [];
  const decisionMs = Date.parse(bundle.decisionAt);
  bundle.rows.forEach((row, index) => {
    if (!Number.isFinite(decisionMs) || !Number.isFinite(Date.parse(row.observedAt)) || Date.parse(row.observedAt) < decisionMs) {
      failures.push({ rowIndex: index, reason: `${row.checkpoint} observation timestamped before decisionAt -- structurally impossible for a same/next-session checkpoint` });
    }
  });
  return failures;
}

/** Step 3: dataset build -- reuses the real, already-tested
 * `buildContractPathOutcomeRow`, never reimplements its invariant. */
export function buildDatasetFromBundle(bundle: ObservationBundle): ContractPathOutcomeRow {
  if (validateBundleSchema(bundle).length > 0 || validateBundlePit(bundle).length > 0) throw new Error('OBSERVATION_BUNDLE_INVALID');
  const path: PathObservation[] = bundle.rows.map((row) => ({
    checkpoint: row.checkpoint as PathCheckpoint, observedAt: row.observedAt,
    marketMarkPath: row.marketMarkPrice, modeledAfterCostPath: null,
  }));
  return buildContractPathOutcomeRow({
    subjectId: bundle.subjectId, decisionAt: bundle.decisionAt, wasSelected: bundle.wasSelected,
    wasShadowOnly: bundle.wasShadowOnly,
    // Selection and market marks do not prove execution or a resolved episode.
    // This bundle has no broker fills, whole-chain costs or terminal ledger.
    identifiabilityStatus: 'NOT_IDENTIFIABLE',
    path,
    statistics: {
      maximumAdverseExcursion: null, maximumFavorableExcursion: null, peakProfit: null, worstProfit: null,
      giveback: null, timeToPeakSeconds: null, capitalDays: null, assignmentState: null, recoveryState: null,
      terminalState: null,
    },
  });
}

export interface UnknownAuditEntry {
  readonly rowIndex: number;
  readonly field: string;
  readonly reason: UnknownReasonCode;
}

/** Step 4: unknown audit -- every null market field gets a real,
 * classified reason rather than being silently absent from any report. */
export function auditBundleUnknowns(bundle: ObservationBundle): readonly UnknownAuditEntry[] {
  const entries: UnknownAuditEntry[] = [];
  bundle.rows.forEach((row, index) => {
    if (row.marketMarkPrice === null) entries.push({ rowIndex: index, field: 'marketMarkPrice', reason: row.provenance === 'RECONSTRUCTED' ? 'RUNTIME_INPUT_PENDING' : 'PROVIDER_FAILURE' });
    if (row.impliedVolatility === null) entries.push({ rowIndex: index, field: 'impliedVolatility', reason: 'PROVIDER_FIELD_ABSENT' });
    if (row.underlyingPrice === null) entries.push({ rowIndex: index, field: 'underlyingPrice', reason: 'PROVIDER_FAILURE' });
  });
  return entries;
}

export interface RealDataArrivalResult {
  readonly contractVersion: typeof realDataArrivalHarnessVersion;
  readonly schemaValid: boolean;
  readonly schemaFailures: readonly SchemaValidationFailure[];
  readonly pitValid: boolean;
  readonly pitFailures: readonly PitValidationFailure[];
  readonly dataset: ContractPathOutcomeRow | null;
  readonly unknownAudit: readonly UnknownAuditEntry[];
  readonly sessionReportCycleCount: number;
  readonly sessionOutcomeState?: { readonly futureObservationRecorded: boolean; readonly outcomeMatured: false; readonly outcomePending: true };
}

/** The full pipeline, step by step, stopping early and reporting exactly
 * why if schema/PIT validation fails -- this is the "accept the first
 * real Codex-produced observation bundle and run everything with zero
 * new implementation" proof. */
export function runRealDataArrivalPipeline(bundle: ObservationBundle): RealDataArrivalResult {
  const schemaFailures = validateBundleSchema(bundle);
  if (schemaFailures.length > 0) {
    return { contractVersion: realDataArrivalHarnessVersion, schemaValid: false, schemaFailures, pitValid: false, pitFailures: [], dataset: null, unknownAudit: [], sessionReportCycleCount: 0 };
  }
  const pitFailures = validateBundlePit(bundle);
  if (pitFailures.length > 0) {
    return { contractVersion: realDataArrivalHarnessVersion, schemaValid: true, schemaFailures: [], pitValid: false, pitFailures, dataset: null, unknownAudit: [], sessionReportCycleCount: 0 };
  }
  const dataset = buildDatasetFromBundle(bundle);
  const unknownAudit = auditBundleUnknowns(bundle);
  const cycleRecord: CycleEvidenceRecord = {
    cycleId: bundle.bundleId, observedAt: bundle.decisionAt,
    subjectsBySubjectKind: { CONTRACT: 1, Q: 0, H: 0, D: 0, RECOVERY_CC: 0 },
    wasWait: !bundle.wasSelected, futureObservationRecorded: bundle.rows.length > 0, outcomeMatured: false,
    outcomePending: true, observationMissed: false, providerFailed: false,
    identifiable: dataset.identifiabilityStatus !== 'NOT_IDENTIFIABLE', flowCohort: null,
    wasAssignmentEvent: false, wasRecoveryEvent: false, strategyComparisonPerformed: false, newCalibrationSample: false,
    unresolvedFields: unknownAudit.map((u) => ({ field: u.field, reason: u.reason })),
  };
  const sessionResult = buildSessionExperienceFromEvidence({ sessionDate: bundle.decisionAt.slice(0, 10), generatedAt: bundle.decisionAt, records: [cycleRecord] });
  return {
    contractVersion: realDataArrivalHarnessVersion, schemaValid: true, schemaFailures: [], pitValid: true, pitFailures: [],
    dataset, unknownAudit, sessionReportCycleCount: sessionResult.cyclesProcessed,
    sessionOutcomeState: { futureObservationRecorded: bundle.rows.length > 0, outcomeMatured: false, outcomePending: true },
  };
}

// classifyUnknown re-exported so a caller can further inspect audit entries without a second import path.
export { classifyUnknown };

/**
 * UNIFIED TAKEOVER GAP 5/12: real entry point for Codex's ACTUAL Command
 * 5A producer shape (`ContractPathObservationReceipt`), not the earlier
 * hand-specified `RawObservationBundleRow` fixture shape alone. Calls the
 * SAME canonical adapter (`command5a-canonical-adapter.ts`) any other
 * consumer must use -- this is not a second, parallel glue path. Any real
 * runtime export whose shape diverges from what
 * `adaptCommand5aObservation`/`projectToRawObservationBundleRow` expect
 * will fail here with a named error (checkpoint mapping is exhaustive,
 * `DATASET_INCOMPLETE` from the economic-completeness gate throws) rather
 * than silently producing an economically-empty bundle.
 */
export function runRealDataArrivalPipelineFromCommand5A(input: {
  readonly bundleId: string;
  readonly decisionAt: string;
  readonly subject: Command5aAdapterSubjectContext;
  readonly observations: readonly {
    readonly receipt: ContractPathObservationReceipt;
    readonly legIdentities: readonly LegIdentityForMark[];
  }[];
}): RealDataArrivalResult {
  const rows = input.observations.map(({ receipt, legIdentities }) => {
    const adapted = adaptCommand5aObservation({ receipt, legIdentities, subject: input.subject });
    return projectToRawObservationBundleRow(adapted);
  });
  const bundle: ObservationBundle = {
    bundleId: input.bundleId, decisionAt: input.decisionAt, subjectId: input.subject.subjectId,
    wasSelected: input.subject.wasSelected, wasShadowOnly: input.subject.wasShadowOnly, rows,
  };
  return runRealDataArrivalPipeline(bundle);
}
