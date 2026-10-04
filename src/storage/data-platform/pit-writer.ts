// The rollout-aware writer of point-in-time evidence. It sits between the cycle store and the two physical homes:
//   OFF                  legacy table only (today)
//   SHADOW               legacy only is written; the normalized form is built in memory, validated and measured (no dp writes)
//   DUAL_WRITE_VALIDATE  both are written in the SAME transaction and the rebuilt rows are compared with the legacy rows by the database (jsonb equality); bounded by a deadline
//   AUTHORITATIVE        normalized only; the large legacy writer is disabled. Allowed only after the ledger records a parity-proven cutover.
// The requested mode (environment) can never exceed what the ledger allows, an expired dual-write window degrades to the legacy writer, and dp errors in the
// validation phase never take the decision transaction down.
import type { Pool, PoolClient } from 'pg';
import { canonicalJson } from './archive-manifest.js';
import { buildHistogram, classifyCandidates, type CandidateTier, type TierableCandidate } from './candidate-tiering.js';
import { gateWrite, type PressureProvider } from './pressure-state.js';
import { PIT_ARRAY_COLUMNS, PIT_JSON_COLUMNS, PIT_OBJECT_COLUMNS, PIT_SCALAR_COLUMNS, normalizePitRows, decisionContextId, type PitEvidenceRow } from './pit-storage.js';

export const PIT_DATASET = 'candidate-point-in-time-evidence';
export const PIT_LEGACY_TABLE = 'trade.candidate_point_in_time_evidence';
export const PIT_LEGACY_RENAMED_TABLE = 'trade.candidate_point_in_time_evidence_legacy';

/** After the compatibility swap (070) the plain name is a view and the real legacy table was renamed: the legacy writer and the parity checks must target the table, not the view. */
export async function resolveLegacyPitTable(db: Pool | PoolClient): Promise<string> {
  const swapped = (await db.query('SELECT to_regclass($1) IS NOT NULL AS ok', [PIT_LEGACY_RENAMED_TABLE])).rows[0].ok === true;
  return swapped ? PIT_LEGACY_RENAMED_TABLE : PIT_LEGACY_TABLE;
}
export const PIT_MODES = ['OFF', 'SHADOW', 'DUAL_WRITE_VALIDATE', 'AUTHORITATIVE'] as const;
export type PitStorageMode = (typeof PIT_MODES)[number];

export const pitModeFromEnvironment = (environment: Readonly<Record<string, string | undefined>> = process.env): PitStorageMode => {
  const requested = environment.THETA_PIT_STORAGE_MODE;
  return (PIT_MODES as readonly string[]).includes(requested ?? '') ? (requested as PitStorageMode) : 'OFF';
};

export interface PitWriterConfig {
  readonly mode: PitStorageMode;
  /** consulted for every non-P0 write; absent means the conservative unknown state is NOT assumed here, the cycle store injects the real provider */
  readonly pressure?: PressureProvider;
  /** AUTHORITATIVE only: ordinary rejected candidates keep identity, reason and hash hot and nothing else (the complete row is in the cold cycle archive) */
  readonly compactOrdinaryRejected?: boolean;
  readonly now?: () => Date;
  readonly onEvent?: (event: PitWriterEvent) => void;
}
export type PitWriterEvent =
  | { readonly kind: 'SHADOW_MEASURED'; readonly decisionId: string | null; readonly rows: number; readonly originalBytes: number; readonly normalizedBytes: number; readonly roundTripExact: boolean }
  | { readonly kind: 'MODE_DEGRADED'; readonly requested: PitStorageMode; readonly effective: PitStorageMode; readonly reason: string }
  | { readonly kind: 'DUAL_WRITE_PARITY'; readonly rows: number; readonly mismatches: number }
  | { readonly kind: 'DUAL_WRITE_FAILED'; readonly error: string }
  | { readonly kind: 'EVIDENCE_QUEUED_FOR_ARCHIVE_ONLY'; readonly scope: string; readonly rows: number; readonly state: string };

export interface PitLedgerRow {
  readonly dataset: string; readonly mode: PitStorageMode; readonly dualWriteStartedAt: string | null; readonly dualWriteDeadline: string | null;
  readonly parityDecisions: number; readonly parityRows: number; readonly mismatchCount: number; readonly cutoverAt: string | null; readonly legacyWriterDisabled: boolean;
}

const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : typeof value === 'string' ? new Date(value).toISOString() : null);

export async function readLedger(db: Pool | PoolClient, dataset = PIT_DATASET): Promise<PitLedgerRow | null> {
  try {
    const result = await db.query('SELECT * FROM dp.dual_write_ledger WHERE dataset = $1', [dataset]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return { dataset, mode: row.mode as PitStorageMode, dualWriteStartedAt: iso(row.dual_write_started_at), dualWriteDeadline: iso(row.dual_write_deadline), parityDecisions: Number(row.parity_decisions), parityRows: Number(row.parity_rows),
      mismatchCount: Number(row.mismatch_count), cutoverAt: iso(row.cutover_at), legacyWriterDisabled: row.legacy_writer_disabled === true };
  } catch { return null; }
}

/** The mode that actually runs: the requested one, capped by the ledger. Pure so it is exhaustively testable. */
export function effectivePitMode(requested: PitStorageMode, ledger: PitLedgerRow | null, now: Date): { readonly mode: PitStorageMode; readonly reason: string | null } {
  if (requested === 'OFF' || requested === 'SHADOW') return { mode: requested, reason: null };
  if (ledger === null) return { mode: 'OFF', reason: 'LEDGER_ABSENT' };
  if (requested === 'AUTHORITATIVE') {
    if (ledger.mode === 'AUTHORITATIVE' && ledger.cutoverAt !== null && ledger.legacyWriterDisabled && ledger.mismatchCount === 0) return { mode: 'AUTHORITATIVE', reason: null };
    if (ledger.mode !== 'DUAL_WRITE_VALIDATE') return { mode: 'OFF', reason: 'CUTOVER_NOT_RECORDED' };
  }
  // DUAL_WRITE_VALIDATE (requested, or the safe fallback of an unrecorded authoritative request)
  if (ledger.mode !== 'DUAL_WRITE_VALIDATE') return { mode: 'OFF', reason: `LEDGER_MODE_${ledger.mode}` };
  if (ledger.dualWriteDeadline === null || Date.parse(ledger.dualWriteDeadline) <= now.getTime()) return { mode: 'OFF', reason: 'DUAL_WRITE_WINDOW_EXPIRED' };
  return { mode: 'DUAL_WRITE_VALIDATE', reason: requested === 'AUTHORITATIVE' ? 'CUTOVER_NOT_RECORDED' : null };
}

// ---- tiers -------------------------------------------------------------------------------------------------------------------------------------------------

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : canonicalJson(item))) : []);

export function tierPitRows(rows: readonly PitEvidenceRow[]): ReadonlyMap<string, CandidateTier> {
  const candidates: TierableCandidate[] = rows.map((row) => ({ candidateId: String(row.candidate_id), branch: String(row.branch), hardBlockers: asStrings(row.hard_blockers_json), paretoRank: typeof row.rank_at_decision === 'number' ? row.rank_at_decision : null }));
  const byBranch = new Map<string, TierableCandidate[]>();
  for (const candidate of candidates) byBranch.set(candidate.branch, [...(byBranch.get(candidate.branch) ?? []), candidate]);
  const rank = (candidate: TierableCandidate): number => candidate.paretoRank ?? Number.MAX_SAFE_INTEGER;
  const contexts = [...byBranch.entries()].map(([branch, list]) => {
    const feasible = list.filter((candidate) => candidate.hardBlockers.length === 0).sort((a, b) => rank(a) - rank(b) || a.candidateId.localeCompare(b.candidateId));
    const rejected = list.filter((candidate) => candidate.hardBlockers.length > 0).sort((a, b) => rank(a) - rank(b) || a.candidateId.localeCompare(b.candidateId));
    return { branch, bestCandidateId: feasible[0]?.candidateId ?? null, secondBestCandidateId: feasible[1]?.candidateId ?? null, bestRejectedCandidateId: rejected[0]?.candidateId ?? null };
  });
  const selected = rows.find((row) => row.selected === true);
  const tiers = new Map(classifyCandidates(candidates, contexts, selected === undefined ? null : String(selected.candidate_id)));
  // a row flagged selected is always SELECTED, whatever the branch context says
  for (const row of rows) if (row.selected === true) tiers.set(String(row.candidate_id), 'SELECTED');
  return tiers;
}

const COMPACT_KEEP = new Set<string>(['contract_json', 'hard_blockers_json']);

// ---- the plan ------------------------------------------------------------------------------------------------------------------------------------------------

export interface PitWritePlan {
  readonly contextId: string;
  readonly contextHash: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly rows: readonly { readonly scalars: Readonly<Record<string, unknown>>; readonly inline: Readonly<Record<string, unknown>>; readonly tier: CandidateTier; readonly compact: boolean }[];
  readonly histogram: ReturnType<typeof buildHistogram>;
  readonly stats: { readonly originalBytes: number; readonly normalizedBytes: number; readonly compactRows: number };
}

/** The database receives JSON text, so the normalized form is built from exactly what JSON.stringify keeps (undefined keys vanish, NaN becomes null), the same as the legacy insert. */
const asStored = (rows: readonly PitEvidenceRow[]): PitEvidenceRow[] => rows.map((row) => JSON.parse(JSON.stringify(row)) as PitEvidenceRow);

export function planPitWrite(fusionSnapshotId: string, sourceRows: readonly PitEvidenceRow[], options: { readonly compactOrdinaryRejected: boolean }): PitWritePlan {
  const rows = asStored(sourceRows);
  const tiers = tierPitRows(rows);
  const compactIds = new Set(options.compactOrdinaryRejected ? rows.filter((row) => (tiers.get(String(row.candidate_id)) ?? 'ORDINARY_REJECTED') === 'ORDINARY_REJECTED' && row.selected !== true).map((row) => String(row.candidate_id)) : []);
  const full = rows.filter((row) => !compactIds.has(String(row.candidate_id)));
  const normalized = normalizePitRows(full);
  const fullInline = new Map(full.map((row, index) => [String(row.candidate_id), normalized.rows[index]?.inline ?? {}] as const));
  const planned = rows.map((row) => {
    const id = String(row.candidate_id);
    const compact = compactIds.has(id);
    const scalars = Object.fromEntries(PIT_SCALAR_COLUMNS.map((column) => [column, row[column]]));
    const inline = compact ? Object.fromEntries(PIT_JSON_COLUMNS.filter((column) => COMPACT_KEEP.has(column)).map((column) => [column, row[column]])) : fullInline.get(id) ?? {};
    return { scalars, inline, tier: tiers.get(id) ?? 'ORDINARY_REJECTED', compact };
  });
  const tierable: TierableCandidate[] = rows.map((row) => ({ candidateId: String(row.candidate_id), branch: String(row.branch), hardBlockers: asStrings(row.hard_blockers_json), paretoRank: typeof row.rank_at_decision === 'number' ? row.rank_at_decision : null, contentHash: row.content_hash }));
  const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
  const contextId = decisionContextId(fusionSnapshotId, normalized.contextHash);
  return { contextId, contextHash: normalized.contextHash, context: normalized.context, rows: planned, histogram: buildHistogram(tierable, tiers),
    stats: { originalBytes: rows.reduce((sum, row) => sum + bytes(row), 0), normalizedBytes: bytes(normalized.context) + planned.reduce((sum, row) => sum + bytes(row.scalars) + bytes(row.inline), 0), compactRows: compactIds.size } };
}

// ---- the SQL ---------------------------------------------------------------------------------------------------------------------------------------------------

export async function writePlan(client: PoolClient, plan: PitWritePlan, input: { readonly fusionSnapshotId: string; readonly decisionTimeUtc: string; readonly sessionDate: string; readonly decisionId: string | null }): Promise<void> {
  await client.query(`INSERT INTO dp.decision_context(decision_context_id, session_date, fusion_snapshot_id, content_hash, decided_at, context_json)
    VALUES ($1, $2::date, $3, $4, $5::timestamptz, $6::jsonb) ON CONFLICT (decision_context_id, session_date) DO NOTHING`, [plan.contextId, input.sessionDate, input.fusionSnapshotId, plan.contextHash, input.decisionTimeUtc, JSON.stringify(plan.context)]);
  if (plan.rows.length > 0) {
    await client.query(`INSERT INTO dp.pit_candidate(candidate_id, session_date, decision_context_id, decision_id, fusion_snapshot_id, decision_time, branch, rank_at_decision, selected, hard_status, soft_status, rejection_reason,
        strategy_version, risk_version, feature_version, cost_model_version, regime_version, execution_model_version, content_hash, inline_json, tier, compact)
      SELECT x.candidate_id::uuid, $2::date, $3::uuid, x.decision_id::uuid, x.fusion_snapshot_id::uuid, x.decision_time::timestamptz, x.branch, x.rank_at_decision, x.selected, x.hard_status, x.soft_status, x.rejection_reason,
        x.strategy_version, x.risk_version, x.feature_version, x.cost_model_version, x.regime_version, x.execution_model_version, x.content_hash, x.inline_json, x.tier, x.compact
      FROM jsonb_to_recordset($1::jsonb) AS x(candidate_id text, decision_id text, fusion_snapshot_id text, decision_time text, branch text, rank_at_decision integer, selected boolean, hard_status text, soft_status text, rejection_reason text,
        strategy_version text, risk_version text, feature_version text, cost_model_version text, regime_version text, execution_model_version text, content_hash char(64), inline_json jsonb, tier text, compact boolean)
      ON CONFLICT (candidate_id, session_date) DO NOTHING`, [JSON.stringify(plan.rows.map((row) => ({ ...row.scalars, inline_json: row.inline, tier: row.tier, compact: row.compact }))), input.sessionDate, plan.contextId]);
  }
  if (input.decisionId !== null) {
    await client.query(`INSERT INTO dp.rejection_histogram(decision_id, session_date, total_candidates, reason_counts, candidate_list_hash)
      VALUES ($1::uuid, $2::date, $3, $4::jsonb, $5) ON CONFLICT (decision_id, session_date) DO NOTHING`,
    [input.decisionId, input.sessionDate, plan.histogram.totalCandidates, JSON.stringify({ reasons: plan.histogram.reasonCounts, tiers: plan.histogram.tierCounts }), plan.histogram.candidateListHash]);
  }
}

const SCALARS_FOR_COMPARE = PIT_SCALAR_COLUMNS;
export const parityJsonSql = (legacyTable: string): string => `SELECT count(*)::int AS legacy_rows,
    count(v.candidate_id)::int AS rebuilt_rows,
    count(*) FILTER (WHERE v.candidate_id IS NOT NULL AND (${[...SCALARS_FOR_COMPARE, ...PIT_JSON_COLUMNS].map((column) => `l.${column} IS DISTINCT FROM v.${column}`).join(' OR ')}))::int AS differing_rows
  FROM ${legacyTable} l
  LEFT JOIN dp.candidate_point_in_time_evidence_v v ON v.candidate_id = l.candidate_id
  WHERE l.candidate_id = ANY($1::uuid[])`;

export interface ParityResult { readonly legacyRows: number; readonly rebuiltRows: number; readonly differingRows: number; readonly mismatches: number }
export async function checkParity(db: Pool | PoolClient, candidateIds: readonly string[]): Promise<ParityResult> {
  const result = await db.query(parityJsonSql(await resolveLegacyPitTable(db)), [candidateIds]);
  const row = result.rows[0] as { legacy_rows: number; rebuilt_rows: number; differing_rows: number };
  return { legacyRows: row.legacy_rows, rebuiltRows: row.rebuilt_rows, differingRows: row.differing_rows, mismatches: Math.abs(row.legacy_rows - row.rebuilt_rows) + row.differing_rows };
}

export interface PitWriteInput {
  readonly rows: readonly PitEvidenceRow[];
  readonly fusionSnapshotId: string;
  readonly decisionTimeUtc: string;
  readonly sessionDate: string;
  readonly decisionId: string | null;
  /** the existing large legacy insert, unchanged */
  readonly legacyInsert: (rows: readonly PitEvidenceRow[]) => Promise<void>;
}

/** Applies the pressure gate: selected and finalist evidence is P1, everything else bulk research P2. Skipped rows stay complete in the cycle archive. */
async function gateRows(rows: readonly PitEvidenceRow[], provider: PressureProvider | undefined, now: Date, emit: (event: PitWriterEvent) => void): Promise<readonly PitEvidenceRow[]> {
  if (provider === undefined) return rows;
  const tiers = tierPitRows(rows);
  const important = rows.filter((row) => row.selected === true || ['SELECTED', 'FINALIST'].includes(tiers.get(String(row.candidate_id)) ?? ''));
  const rest = rows.filter((row) => !important.includes(row));
  const kept = [...important];
  if (rest.length > 0) {
    const gated = await gateWrite(provider, 'pit-candidate-research', undefined, now);
    if (gated.decision.allow) kept.push(...rest);
    else emit({ kind: 'EVIDENCE_QUEUED_FOR_ARCHIVE_ONLY', scope: 'pit-candidate-research', rows: rest.length, state: gated.snapshot?.state ?? 'UNKNOWN' });
  }
  if (important.length > 0) {
    const gated = await gateWrite(provider, 'pit-selected-finalist', undefined, now);
    if (!gated.decision.allow) { emit({ kind: 'EVIDENCE_QUEUED_FOR_ARCHIVE_ONLY', scope: 'pit-selected-finalist', rows: important.length, state: gated.snapshot?.state ?? 'UNKNOWN' }); return kept.filter((row) => !important.includes(row)); }
  }
  return rows.filter((row) => kept.includes(row));
}

export async function writePitEvidence(client: PoolClient, input: PitWriteInput, config: PitWriterConfig): Promise<{ readonly effectiveMode: PitStorageMode; readonly rowsWritten: number }> {
  const now = (config.now ?? (() => new Date()))();
  const emit = config.onEvent ?? (() => undefined);
  const ledger = config.mode === 'OFF' || config.mode === 'SHADOW' ? null : await readLedger(client);
  const effective = effectivePitMode(config.mode, ledger, now);
  if (effective.reason !== null) emit({ kind: 'MODE_DEGRADED', requested: config.mode, effective: effective.mode, reason: effective.reason });
  const rows = await gateRows(input.rows, config.pressure, now, emit);
  if (rows.length === 0) return { effectiveMode: effective.mode, rowsWritten: 0 };
  const dpInput = { fusionSnapshotId: input.fusionSnapshotId, decisionTimeUtc: input.decisionTimeUtc, sessionDate: input.sessionDate, decisionId: input.decisionId };

  if (effective.mode === 'AUTHORITATIVE') {
    await writePlan(client, planPitWrite(input.fusionSnapshotId, rows, { compactOrdinaryRejected: config.compactOrdinaryRejected === true }), dpInput);
    return { effectiveMode: 'AUTHORITATIVE', rowsWritten: rows.length };
  }
  await input.legacyInsert(rows);
  if (effective.mode === 'SHADOW' || config.mode === 'SHADOW') {
    const plan = planPitWrite(input.fusionSnapshotId, rows, { compactOrdinaryRejected: false });
    const rebuilt = reconstructForCheck(plan);
    emit({ kind: 'SHADOW_MEASURED', decisionId: input.decisionId, rows: rows.length, originalBytes: plan.stats.originalBytes, normalizedBytes: plan.stats.normalizedBytes, roundTripExact: rows.every((row, index) => canonicalJson(rebuilt[index]) === canonicalJson(row)) });
  } else if (effective.mode === 'DUAL_WRITE_VALIDATE') {
    await client.query('SAVEPOINT pit_dual_write');
    try {
      await writePlan(client, planPitWrite(input.fusionSnapshotId, rows, { compactOrdinaryRejected: false }), dpInput);
      const parity = await checkParity(client, rows.map((row) => String(row.candidate_id)));
      await client.query(`UPDATE dp.dual_write_ledger SET parity_decisions = parity_decisions + 1, parity_rows = parity_rows + $2, mismatch_count = mismatch_count + $3, updated_at = now() WHERE dataset = $1`, [PIT_DATASET, parity.rebuiltRows, parity.mismatches]);
      emit({ kind: 'DUAL_WRITE_PARITY', rows: parity.legacyRows, mismatches: parity.mismatches });
      await client.query('RELEASE SAVEPOINT pit_dual_write');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT pit_dual_write');
      await client.query('RELEASE SAVEPOINT pit_dual_write');
      emit({ kind: 'DUAL_WRITE_FAILED', error: error instanceof Error ? error.message.slice(0, 200) : 'UNKNOWN' });
    }
  }
  return { effectiveMode: effective.mode, rowsWritten: rows.length };
}

/** in-memory rebuild of a full-fidelity plan (SHADOW validation); mirrors the SQL view */
function reconstructForCheck(plan: PitWritePlan): Record<string, unknown>[] {
  const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  return plan.rows.map((row) => {
    const out: Record<string, unknown> = { ...row.scalars };
    for (const column of PIT_OBJECT_COLUMNS) {
      const shared = plan.context[column]; const own = row.inline[column];
      out[column] = { ...(isObject(shared) ? shared : {}), ...(isObject(own) ? own : {}) };
    }
    for (const column of PIT_ARRAY_COLUMNS) out[column] = row.inline[column] ?? plan.context[column] ?? [];
    return out;
  });
}

// ---- ledger transitions (the bounded dual-write protocol) ------------------------------------------------------------------------------------------------

export const DUAL_WRITE_WINDOW_DAYS = 14;
export interface ExitCriteria { readonly minimumDecisions: number; readonly minimumRows: number }
export const defaultExitCriteria: ExitCriteria = { minimumDecisions: 200, minimumRows: 1000 };

export async function startDualWrite(pool: Pool, windowDays = DUAL_WRITE_WINDOW_DAYS, now = new Date()): Promise<PitLedgerRow | null> {
  if (!(windowDays > 0 && windowDays <= 30)) throw new Error('DUAL_WRITE_WINDOW_MUST_BE_BOUNDED_1_TO_30_DAYS');
  await pool.query(`INSERT INTO dp.dual_write_ledger(dataset, mode, dual_write_started_at, dual_write_deadline) VALUES ($1, 'DUAL_WRITE_VALIDATE', $2::timestamptz, $2::timestamptz + make_interval(days => $3))
    ON CONFLICT (dataset) DO UPDATE SET mode = 'DUAL_WRITE_VALIDATE', dual_write_started_at = EXCLUDED.dual_write_started_at, dual_write_deadline = EXCLUDED.dual_write_deadline, parity_decisions = 0, parity_rows = 0, mismatch_count = 0, cutover_at = NULL, legacy_writer_disabled = false, updated_at = now()`, [PIT_DATASET, now.toISOString(), windowDays]);
  return readLedger(pool);
}

export interface ExitEvaluation { readonly ok: boolean; readonly failures: readonly string[]; readonly ledger: PitLedgerRow | null; readonly sweep: { readonly decisions: number; readonly legacyRows: number; readonly rebuiltRows: number; readonly differingRows: number; readonly duplicateRows: number; readonly idMismatch: number } }

/** Re-verifies the ledger AND sweeps the recent decisions that exist in both homes (counts, ids, canonical content, scalars, no missing, no duplicates). */
export async function evaluateDualWriteExit(pool: Pool, criteria: ExitCriteria = defaultExitCriteria, sweepDecisions = 500): Promise<ExitEvaluation> {
  const ledger = await readLedger(pool);
  const failures: string[] = [];
  const legacyTable = await resolveLegacyPitTable(pool);
  if ((await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [legacyTable])).rows[0].ok !== true) return { ok: false, failures: ['LEGACY_TABLE_ABSENT'], ledger, sweep: { decisions: 0, legacyRows: 0, rebuiltRows: 0, differingRows: 0, duplicateRows: 0, idMismatch: 0 } };
  const sweepRows = await pool.query(`WITH recent AS (SELECT DISTINCT decision_id FROM dp.pit_candidate WHERE decision_id IS NOT NULL ORDER BY decision_id LIMIT $1)
    SELECT (SELECT count(*) FROM recent)::int AS decisions,
      count(l.candidate_id)::int AS legacy_rows,
      count(v.candidate_id)::int AS rebuilt_rows,
      count(*) FILTER (WHERE v.candidate_id IS NOT NULL AND l.candidate_id IS NOT NULL AND (${[...SCALARS_FOR_COMPARE, ...PIT_JSON_COLUMNS].map((column) => `l.${column} IS DISTINCT FROM v.${column}`).join(' OR ')}))::int AS differing_rows,
      count(*) FILTER (WHERE (l.candidate_id IS NULL) <> (v.candidate_id IS NULL))::int AS id_mismatch
    FROM (SELECT c.* FROM ${legacyTable} c WHERE c.decision_id IN (SELECT decision_id FROM recent)) l
    FULL JOIN (SELECT * FROM dp.candidate_point_in_time_evidence_v WHERE decision_id IN (SELECT decision_id FROM recent)) v ON v.candidate_id = l.candidate_id`, [sweepDecisions]);
  const dup = await pool.query('SELECT count(*)::int AS n FROM (SELECT candidate_id FROM dp.pit_candidate GROUP BY candidate_id HAVING count(*) > 1) d');
  const s = sweepRows.rows[0] as { decisions: number; legacy_rows: number; rebuilt_rows: number; differing_rows: number; id_mismatch: number };
  const sweep = { decisions: s.decisions, legacyRows: s.legacy_rows, rebuiltRows: s.rebuilt_rows, differingRows: s.differing_rows, duplicateRows: Number((dup.rows[0] as { n: number }).n), idMismatch: s.id_mismatch };
  if (ledger === null || ledger.mode !== 'DUAL_WRITE_VALIDATE') failures.push('LEDGER_NOT_IN_DUAL_WRITE_VALIDATE');
  if (ledger !== null && ledger.mismatchCount > 0) failures.push(`LEDGER_MISMATCHES:${ledger.mismatchCount}`);
  if (ledger !== null && ledger.parityDecisions < criteria.minimumDecisions) failures.push(`PARITY_DECISIONS_BELOW_MINIMUM:${ledger.parityDecisions}<${criteria.minimumDecisions}`);
  if (ledger !== null && ledger.parityRows < criteria.minimumRows) failures.push(`PARITY_ROWS_BELOW_MINIMUM:${ledger.parityRows}<${criteria.minimumRows}`);
  if (sweep.legacyRows !== sweep.rebuiltRows) failures.push('SWEEP_ROW_COUNT_DIFFERS');
  if (sweep.idMismatch > 0) failures.push('SWEEP_CANDIDATE_IDS_DIFFER');
  if (sweep.differingRows > 0) failures.push('SWEEP_CONTENT_DIFFERS');
  if (sweep.duplicateRows > 0) failures.push('SWEEP_DUPLICATE_ROWS');
  if (sweep.legacyRows === 0) failures.push('SWEEP_EMPTY');
  return { ok: failures.length === 0, failures, ledger, sweep };
}

/** Cutover: only when the exit criteria hold. Records CUTOVER_AT and LEGACY_WRITER_DISABLED; the legacy large writer stops at the next decision. */
export async function cutoverToNormalized(pool: Pool, criteria: ExitCriteria = defaultExitCriteria): Promise<{ readonly cutover: boolean; readonly evaluation: ExitEvaluation }> {
  const evaluation = await evaluateDualWriteExit(pool, criteria);
  if (!evaluation.ok) return { cutover: false, evaluation };
  await pool.query(`UPDATE dp.dual_write_ledger SET mode = 'AUTHORITATIVE', cutover_at = now(), legacy_writer_disabled = true, updated_at = now() WHERE dataset = $1 AND mode = 'DUAL_WRITE_VALIDATE'`, [PIT_DATASET]);
  return { cutover: true, evaluation: { ...evaluation, ledger: await readLedger(pool) } };
}

export async function rollbackToLegacy(pool: Pool): Promise<void> {
  await pool.query(`UPDATE dp.dual_write_ledger SET mode = 'OFF', cutover_at = NULL, legacy_writer_disabled = false, updated_at = now() WHERE dataset = $1`, [PIT_DATASET]);
}

const LEGACY_COLUMNS = [...PIT_SCALAR_COLUMNS, ...PIT_JSON_COLUMNS, 'created_at'] as const;

/**
 * Full rollback of AUTHORITATIVE mode and the compatibility swap, WITHOUT losing the rows written while authoritative: they are copied back into the legacy table (rebuilt exactly by the view),
 * the view is dropped, the table gets its name and index names back, and the ledger returns to OFF. Compact (tiered) rows come back as their compact form (identity, reason, hash): their full
 * evidence is in the cycle archive, and the count is reported so the owner can see it.
 */
export async function rollbackAuthoritativeAndSwap(pool: Pool): Promise<{ readonly backfilledRows: number; readonly compactRows: number; readonly swapReverted: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '10s'`);
    const swapped = (await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [PIT_LEGACY_RENAMED_TABLE])).rows[0].ok === true;
    let backfilled = 0; let compact = 0;
    if (swapped) {
      const columns = LEGACY_COLUMNS.join(', ');
      compact = Number((await client.query(`SELECT count(*)::int AS n FROM dp.pit_candidate WHERE compact AND candidate_id NOT IN (SELECT candidate_id FROM ${PIT_LEGACY_RENAMED_TABLE})`)).rows[0].n);
      backfilled = (await client.query(`INSERT INTO ${PIT_LEGACY_RENAMED_TABLE}(${columns}) SELECT ${LEGACY_COLUMNS.map((column) => `v.${column}`).join(', ')} FROM dp.candidate_point_in_time_evidence_v v WHERE NOT EXISTS (SELECT 1 FROM ${PIT_LEGACY_RENAMED_TABLE} l WHERE l.candidate_id = v.candidate_id)`)).rowCount ?? 0;
      // views over the compat view (production: research.option_contract_risk_history) follow it by OID: capture their definitions, move the compat view out of the way, give the table its name
      // back, re-point the dependents at the plain table, and only then drop the compat view (no CASCADE: nothing is dropped that is not re-created)
      const dependents = (await client.query(`SELECT DISTINCT n.nspname AS schema_name, c.relname AS view_name, pg_get_viewdef(c.oid, true) AS definition FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class c ON c.oid = r.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE d.refobjid = $1::regclass AND d.classid = 'pg_rewrite'::regclass AND c.oid <> d.refobjid AND c.relkind = 'v'`, [PIT_LEGACY_TABLE])).rows as Array<{ schema_name: string; view_name: string; definition: string }>;
      await client.query(`ALTER VIEW ${PIT_LEGACY_TABLE} RENAME TO candidate_point_in_time_evidence_compat_retired`);
      await client.query(`ALTER TABLE ${PIT_LEGACY_RENAMED_TABLE} RENAME TO candidate_point_in_time_evidence`);
      await client.query('ALTER INDEX IF EXISTS trade.ix_candidate_pit_decision_legacy RENAME TO ix_candidate_pit_decision');
      for (const view of dependents) {
        if (!/^[a-z_][a-z0-9_]*$/.test(view.schema_name) || !/^[a-z_][a-z0-9_]*$/.test(view.view_name)) throw new Error('INVALID_DEPENDENT_VIEW_IDENTIFIER');
        await client.query(`CREATE OR REPLACE VIEW ${view.schema_name}.${view.view_name} AS ${view.definition}`);
      }
      await client.query('DROP VIEW trade.candidate_point_in_time_evidence_compat_retired');
    }
    await client.query(`UPDATE dp.dual_write_ledger SET mode = 'OFF', cutover_at = NULL, legacy_writer_disabled = false, updated_at = now() WHERE dataset = $1`, [PIT_DATASET]);
    await client.query('COMMIT');
    return { backfilledRows: backfilled, compactRows: compact, swapReverted: swapped };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; } finally { client.release(); }
}
