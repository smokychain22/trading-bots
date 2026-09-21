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
 *    else runs;
 *  - a DATA export (rows: HistoricalIvObservationRow[] for the IV study,
 *    or HistoricalBboObservationRow[] for the spread study).
 */
import type { OptionomicsCapabilityObservation } from '../theta/optionomics-capability-contract.js';
import {
  assessHistoricalIvBackfillFeasibility, buildIvEffectiveCoverageReport, buildSpreadEffectiveCoverageReport,
  computeIvShockResearch, computeSpreadStressResearch,
  type HistoricalBboObservationRow, type HistoricalIvObservationRow,
  type IvEffectiveCoverageReport, type IvShockResearchResult,
  type SpreadEffectiveCoverageReport, type SpreadStressResearchResult,
} from './historical-iv-spread-feasibility.js';
import { loadRealDataExport, type EvidenceLineage } from './real-data-export-contract.js';

export const ivSpreadRealDataRunnerVersion = 'theta-iv-spread-real-data-runner-v1' as const;
export const OPTIONOMICS_CAPABILITY_EXPORT_CONTRACT_VERSION = 'theta-optionomics-capability-export-v1' as const;
export const IV_OBSERVATION_EXPORT_CONTRACT_VERSION = 'theta-historical-iv-export-v1' as const;
export const BBO_OBSERVATION_EXPORT_CONTRACT_VERSION = 'theta-historical-bbo-export-v1' as const;

export type IvRealDataStudyStatus =
  | 'AWAITING_CAPABILITY_EXPORT' | 'AWAITING_DATA_EXPORT' | 'EXPORT_CONTRACT_INVALID'
  | 'EXPORT_ROW_COUNT_MISMATCH' | 'BACKFILL_NOT_SAFE' | 'COMPLETED';

function mapLoadStatus(
  status: 'AWAITING_REAL_EXPORT' | 'EXPORT_CONTRACT_INVALID' | 'EXPORT_ROW_COUNT_MISMATCH' | 'LOADED',
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
): IvRealDataStudyResult {
  const capabilityLoaded = loadRealDataExport<OptionomicsCapabilityObservation>(
    rawCapabilityExport, OPTIONOMICS_CAPABILITY_EXPORT_CONTRACT_VERSION);
  if (capabilityLoaded.status !== 'LOADED' || capabilityLoaded.envelope === null) {
    return {
      status: mapLoadStatus(capabilityLoaded.status, 'AWAITING_CAPABILITY_EXPORT'),
      reason: capabilityLoaded.reason, evidenceLineage: null, coverage: null, shockByCohort: null,
    };
  }
  const feasibility = assessHistoricalIvBackfillFeasibility(capabilityLoaded.envelope.rows);
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
  const shockByCohort = [...byCohort.entries()].map(([cohort, sessions]) => computeIvShockResearch(cohort, sessions));
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
  rawCapabilityExport: unknown, rawBboExport: unknown, cohortAssignment: (row: HistoricalBboObservationRow) => string,
): SpreadRealDataStudyResult {
  const capabilityLoaded = loadRealDataExport<OptionomicsCapabilityObservation>(
    rawCapabilityExport, OPTIONOMICS_CAPABILITY_EXPORT_CONTRACT_VERSION);
  if (capabilityLoaded.status !== 'LOADED' || capabilityLoaded.envelope === null) {
    return {
      status: mapLoadStatus(capabilityLoaded.status, 'AWAITING_CAPABILITY_EXPORT'),
      reason: capabilityLoaded.reason, evidenceLineage: null, coverage: null, stressByCohort: null,
    };
  }
  const feasibility = assessHistoricalIvBackfillFeasibility(capabilityLoaded.envelope.rows);
  if (feasibility.feasibility !== 'HISTORICAL_IV_BACKFILL_SAFE') {
    return {
      status: 'BACKFILL_NOT_SAFE', reason: feasibility.reasons.join(','), evidenceLineage: 'REAL_EXPORT',
      coverage: null, stressByCohort: null,
    };
  }

  const dataLoaded = loadRealDataExport<HistoricalBboObservationRow>(rawBboExport, BBO_OBSERVATION_EXPORT_CONTRACT_VERSION);
  if (dataLoaded.status !== 'LOADED' || dataLoaded.envelope === null) {
    return {
      status: mapLoadStatus(dataLoaded.status, 'AWAITING_DATA_EXPORT'),
      reason: dataLoaded.reason, evidenceLineage: null, coverage: null, stressByCohort: null,
    };
  }
  const rows = dataLoaded.envelope.rows;
  const coverage = buildSpreadEffectiveCoverageReport(rows);
  const byCohort = new Map<string, HistoricalBboObservationRow[]>();
  for (const row of rows) {
    const cohort = cohortAssignment(row);
    const list = byCohort.get(cohort) ?? [];
    list.push(row);
    byCohort.set(cohort, list);
  }
  const stressByCohort = [...byCohort.entries()].map(([cohort, cohortRows]) => computeSpreadStressResearch(cohort, cohortRows));
  return { status: 'COMPLETED', reason: null, evidenceLineage: 'REAL_EXPORT', coverage, stressByCohort };
}
