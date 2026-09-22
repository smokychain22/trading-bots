/**
 * Real-data study runner for historical IV/spread research (directive
 * Phase 9C). `brokerAuthority: false`. Never runs an IV shock or spread
 * stress study without FIRST reconfirming, from Codex's own real
 * capability-observation export, that a PIT-valid backfill was proven
 * safe -- a coverage/shock/stress result is meaningless (and potentially
 * a silent-replay bug) if the underlying rows were never proven
 * historical in the first place.
 *
 * EXPORT CONTRACT for Codex: two separate RealDataExportEnvelope exports:
 *  - a CAPABILITY export (rows: OptionomicsCapabilityObservation[]),
 *    checked with assessHistoricalIvBackfillFeasibility before anything
 *    else runs. The export itself carries only the raw provider-observed
 *    capability -- `verifyHistoricalRetrievability` below is a SEPARATE,
 *    explicit caller-supplied judgment about which of those observations
 *    were actually independently confirmed retrievable (never inferred
 *    from the export alone; see historical-iv-spread-feasibility.ts's
 *    `HistoricalCapabilityAttestation` doc comment for why).
 *  - a DATA export (rows: HistoricalIvObservationRow[] for the IV study,
 *    or OptionomicsHistoricalQuoteObservationRow[] for the spread study
 *    -- session-recorded RESEARCH quotes, never broker-executable BBO).
 */
import type { OptionomicsCapabilityObservation } from '../theta/optionomics-capability-contract.js';
import {
  assessHistoricalIvBackfillFeasibility, buildIvEffectiveCoverageReport, buildSpreadEffectiveCoverageReport,
  computeIvShockResearch, computeSpreadStressResearch,
  type HistoricalIvObservationRow, type IvEffectiveCoverageReport, type IvShockResearchResult,
  type OptionomicsHistoricalQuoteObservationRow, type SpreadEffectiveCoverageReport, type SpreadStressResearchResult,
} from './historical-iv-spread-feasibility.js';
import { loadRealDataExport, type EvidenceLineage } from './real-data-export-contract.js';

export const ivSpreadRealDataRunnerVersion = 'theta-iv-spread-real-data-runner-v2' as const;
export const OPTIONOMICS_CAPABILITY_EXPORT_CONTRACT_VERSION = 'theta-optionomics-capability-export-v1' as const;
export const IV_OBSERVATION_EXPORT_CONTRACT_VERSION = 'theta-historical-iv-export-v1' as const;
export const OPTIONOMICS_QUOTE_OBSERVATION_EXPORT_CONTRACT_VERSION = 'theta-optionomics-historical-quote-export-v1' as const;

export type IvRealDataStudyStatus =
  | 'AWAITING_CAPABILITY_EXPORT' | 'AWAITING_DATA_EXPORT' | 'EXPORT_CONTRACT_INVALID'
  | 'EXPORT_ROW_COUNT_MISMATCH' | 'EXPORT_CONTENT_HASH_MISMATCH' | 'BACKFILL_NOT_SAFE' | 'COMPLETED';

function mapLoadStatus(
  status: 'AWAITING_REAL_EXPORT' | 'EXPORT_CONTRACT_INVALID' | 'EXPORT_ROW_COUNT_MISMATCH' | 'EXPORT_CONTENT_HASH_MISMATCH' | 'LOADED',
  awaitingLabel: 'AWAITING_CAPABILITY_EXPORT' | 'AWAITING_DATA_EXPORT',
): IvRealDataStudyStatus {
  if (status === 'AWAITING_REAL_EXPORT') return awaitingLabel;
  if (status === 'LOADED') return 'EXPORT_CONTRACT_INVALID'; // unreachable given loadRealDataExport's own contract
  return status;
}

export interface IvRealDataStudyResult {
  readonly status: IvRealDataStudyStatus;
  readonly reason: string | null;
  readonly evidenceLineage: EvidenceLineage | null;
  readonly coverage: IvEffectiveCoverageReport | null;
  readonly shockByCohort: readonly IvShockResearchResult[] | null;
}

export function runIvRealDataStudy(
  rawCapabilityExport: unknown, rawIvExport: unknown, cohortAssignment: (row: HistoricalIvObservationRow) => string,
  verifyHistoricalRetrievability: (observation: OptionomicsCapabilityObservation) => boolean,
  completedSessionsOnlyThrough: string,
): IvRealDataStudyResult {
  const capabilityLoaded = loadRealDataExport<OptionomicsCapabilityObservation>(
    rawCapabilityExport, OPTIONOMICS_CAPABILITY_EXPORT_CONTRACT_VERSION);
  if (capabilityLoaded.status !== 'LOADED' || capabilityLoaded.envelope === null) {
    return {
      status: mapLoadStatus(capabilityLoaded.status, 'AWAITING_CAPABILITY_EXPORT'),
      reason: capabilityLoaded.reason, evidenceLineage: null, coverage: null, shockByCohort: null,
    };
  }
  const attestations = capabilityLoaded.envelope.rows.map((observation) => ({
    observation, verifiedHistoricalRetrievability: verifyHistoricalRetrievability(observation),
  }));
  const feasibility = assessHistoricalIvBackfillFeasibility(attestations);
  if (feasibility.feasibility !== 'HISTORICAL_IV_BACKFILL_SAFE') {
    return {
      status: 'BACKFILL_NOT_SAFE', reason: feasibility.reasons.join(','), evidenceLineage: 'REAL_EXPORT',
      coverage: null, shockByCohort: null,
    };
  }

  const dataLoaded = loadRealDataExport<HistoricalIvObservationRow>(rawIvExport, IV_OBSERVATION_EXPORT_CONTRACT_VERSION);
  if (dataLoaded.status !== 'LOADED' || dataLoaded.envelope === null) {
    return {
      status: mapLoadStatus(dataLoaded.status, 'AWAITING_DATA_EXPORT'),
      reason: dataLoaded.reason, evidenceLineage: null, coverage: null, shockByCohort: null,
    };
  }
  const rows = dataLoaded.envelope.rows;
  const coverage = buildIvEffectiveCoverageReport(rows);
  const byCohort = new Map<string, { readonly sessionDate: string; readonly iv: number | null }[]>();
  for (const row of rows) {
    const cohort = cohortAssignment(row);
    const list = byCohort.get(cohort) ?? [];
    list.push({ sessionDate: row.sessionDate, iv: row.iv });
    byCohort.set(cohort, list);
  }
  const shockByCohort = [...byCohort.entries()].map(([cohort, sessions]) =>
    computeIvShockResearch(cohort, sessions, completedSessionsOnlyThrough));
  return { status: 'COMPLETED', reason: null, evidenceLineage: 'REAL_EXPORT', coverage, shockByCohort };
}

export interface SpreadRealDataStudyResult {
  readonly status: IvRealDataStudyStatus;
  readonly reason: string | null;
  readonly evidenceLineage: EvidenceLineage | null;
  readonly coverage: SpreadEffectiveCoverageReport | null;
  readonly stressByCohort: readonly SpreadStressResearchResult[] | null;
}

export function runSpreadRealDataStudy(
  rawCapabilityExport: unknown, rawQuoteExport: unknown, cohortAssignment: (row: OptionomicsHistoricalQuoteObservationRow) => string,
  verifyHistoricalRetrievability: (observation: OptionomicsCapabilityObservation) => boolean,
  completedSessionsOnlyThrough: string,
): SpreadRealDataStudyResult {
  const capabilityLoaded = loadRealDataExport<OptionomicsCapabilityObservation>(
    rawCapabilityExport, OPTIONOMICS_CAPABILITY_EXPORT_CONTRACT_VERSION);
  if (capabilityLoaded.status !== 'LOADED' || capabilityLoaded.envelope === null) {
    return {
      status: mapLoadStatus(capabilityLoaded.status, 'AWAITING_CAPABILITY_EXPORT'),
      reason: capabilityLoaded.reason, evidenceLineage: null, coverage: null, stressByCohort: null,
    };
  }
  const attestations = capabilityLoaded.envelope.rows.map((observation) => ({
    observation, verifiedHistoricalRetrievability: verifyHistoricalRetrievability(observation),
  }));
  const feasibility = assessHistoricalIvBackfillFeasibility(attestations);
  if (feasibility.feasibility !== 'HISTORICAL_IV_BACKFILL_SAFE') {
    return {
      status: 'BACKFILL_NOT_SAFE', reason: feasibility.reasons.join(','), evidenceLineage: 'REAL_EXPORT',
      coverage: null, stressByCohort: null,
    };
  }

  const dataLoaded = loadRealDataExport<OptionomicsHistoricalQuoteObservationRow>(
    rawQuoteExport, OPTIONOMICS_QUOTE_OBSERVATION_EXPORT_CONTRACT_VERSION);
  if (dataLoaded.status !== 'LOADED' || dataLoaded.envelope === null) {
    return {
      status: mapLoadStatus(dataLoaded.status, 'AWAITING_DATA_EXPORT'),
      reason: dataLoaded.reason, evidenceLineage: null, coverage: null, stressByCohort: null,
    };
  }
  const rows = dataLoaded.envelope.rows;
  const coverage = buildSpreadEffectiveCoverageReport(rows);
  const byCohort = new Map<string, OptionomicsHistoricalQuoteObservationRow[]>();
  for (const row of rows) {
    const cohort = cohortAssignment(row);
    const list = byCohort.get(cohort) ?? [];
    list.push(row);
    byCohort.set(cohort, list);
  }
  const stressByCohort = [...byCohort.entries()].map(([cohort, cohortRows]) =>
    computeSpreadStressResearch(cohort, cohortRows, completedSessionsOnlyThrough));
  return { status: 'COMPLETED', reason: null, evidenceLineage: 'REAL_EXPORT', coverage, stressByCohort };
}
