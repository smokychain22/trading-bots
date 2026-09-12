import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ThetaShadowCycleResult } from '../theta/theta-shadow-cycle.js';
import type { UnderlyingCandidateInput } from '../theta/universe-policy.js';
import { canonicalJson } from './point-in-time-evidence.js';

export const shadowRuntimeMode = 'THETA_SHADOW_ONLY' as const;
export const shadowScanContractVersion = 'theta-cross-symbol-shadow-scan-v1' as const;
export const executionObservationHorizonVersion = 'theta-execution-observation-horizons-v1' as const;

export type ScanCompleteness = 'COMPLETE' | 'PARTIAL' | 'INTERRUPTED' | 'PROVIDER_LIMITED' | 'DATA_INSUFFICIENT';
export type ShadowBranch = 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_RECOVERY' | 'THETA_CC' | 'THETA_DEFINED_RISK';
export type ShadowSessionDecision='RUN'|'MARKET_CLOSED'|'SESSION_UNCONFIRMED';
export function shadowSessionDecision(marketOpen:boolean|null,calendarConfirmed:boolean):ShadowSessionDecision{
  if(marketOpen===false)return 'MARKET_CLOSED';
  return marketOpen===true&&calendarConfirmed?'RUN':'SESSION_UNCONFIRMED';
}

export interface ShadowScanBoundary {
  readonly universeVersion: string;
  readonly latticeVersion: string;
  readonly strategyVersion: string;
  readonly eligibleUnderlyings: readonly UnderlyingCandidateInput[];
  readonly branches: readonly ShadowBranch[];
  readonly maxUnderlyings: number;
}

export interface ShadowSymbolScanResult {
  readonly symbol: string;
  readonly ordinal: number;
  readonly status: 'COMPLETED' | 'FAILED';
  readonly cycle: ThetaShadowCycleResult | null;
  readonly errorCode: string | null;
}

export interface CrossSymbolShadowScanResult {
  readonly scanId: string;
  readonly mode: typeof shadowRuntimeMode;
  readonly contractVersion: typeof shadowScanContractVersion;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly boundary: Omit<ShadowScanBoundary, 'eligibleUnderlyings'> & { readonly eligibleSymbols: readonly string[] };
  readonly completeness: ScanCompleteness;
  readonly missingScope: readonly string[];
  readonly symbolsAttempted: number;
  readonly symbolsCompleted: number;
  readonly candidateCount: number;
  readonly results: readonly ShadowSymbolScanResult[];
}

const safeErrorCode = (error: unknown): string => error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
  ? error.message : 'SHADOW_SYMBOL_SCAN_FAILED';

/** Runs every symbol inside a versioned, bounded opportunity set. */
export async function runCrossSymbolShadowScan(
  boundary: ShadowScanBoundary,
  evaluate: (underlying: UnderlyingCandidateInput) => Promise<ThetaShadowCycleResult>,
  now: () => string = () => new Date().toISOString(),
): Promise<CrossSymbolShadowScanResult> {
  if (!Number.isInteger(boundary.maxUnderlyings) || boundary.maxUnderlyings <= 0) throw new Error('SHADOW_SCAN_BOUND_INVALID');
  if (boundary.branches.length === 0) throw new Error('SHADOW_SCAN_BRANCH_SET_EMPTY');
  const startedAt = now();
  const ordered = [...boundary.eligibleUnderlyings].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const scope = ordered.slice(0, boundary.maxUnderlyings);
  const missingScope: string[] = [];
  if (scope.length < ordered.length) missingScope.push('UNDERLYING_BOUND_REACHED');
  const results: ShadowSymbolScanResult[] = [];
  for (const [index, underlying] of scope.entries()) {
    try {
      const cycle = await evaluate(underlying);
      results.push({ symbol: underlying.symbol, ordinal: index + 1, status: 'COMPLETED', cycle, errorCode: null });
      if (cycle.optionContractsComplete !== true) missingScope.push(`${underlying.symbol}:CONTRACT_ENUMERATION_INCOMPLETE`);
      if (cycle.optionChainComplete !== true) missingScope.push(`${underlying.symbol}:QUOTE_ENUMERATION_INCOMPLETE`);
      if (cycle.orchestration === null) missingScope.push(`${underlying.symbol}:STRATEGY_EVALUATION_INCOMPLETE`);
    } catch (error) {
      results.push({ symbol: underlying.symbol, ordinal: index + 1, status: 'FAILED', cycle: null, errorCode: safeErrorCode(error) });
      missingScope.push(`${underlying.symbol}:SCAN_FAILED`);
    }
  }
  const candidateCount = results.reduce((sum, result) => sum + (result.cycle?.orchestration?.thetaQ?.candidates.length ?? 0), 0);
  const failed = results.some((result) => result.status === 'FAILED');
  const providerLimited = scope.length < ordered.length;
  const partial = missingScope.some((reason) => reason.includes('INCOMPLETE'));
  const completeness: ScanCompleteness = providerLimited ? 'PROVIDER_LIMITED'
    : failed && results.some((result) => result.status === 'COMPLETED') ? 'INTERRUPTED'
      : failed || partial ? 'PARTIAL'
        : 'COMPLETE';
  return {
    scanId: randomUUID(), mode: shadowRuntimeMode, contractVersion: shadowScanContractVersion,
    startedAt, finishedAt: now(),
    boundary: {
      universeVersion: boundary.universeVersion, latticeVersion: boundary.latticeVersion,
      strategyVersion: boundary.strategyVersion, branches: [...boundary.branches], maxUnderlyings: boundary.maxUnderlyings,
      eligibleSymbols: ordered.map((item) => item.symbol),
    },
    completeness, missingScope: [...new Set(missingScope)].sort(), symbolsAttempted: scope.length,
    symbolsCompleted: results.filter((result) => result.status === 'COMPLETED').length,
    candidateCount, results,
  };
}

export interface ObservationHorizon { readonly code: '1M' | '5M' | '30M' | 'EOD'; readonly offsetMs: number | null; }
export const defaultObservationHorizons: readonly ObservationHorizon[] = [
  { code: '1M', offsetMs: 60_000 }, { code: '5M', offsetMs: 300_000 },
  { code: '30M', offsetMs: 1_800_000 }, { code: 'EOD', offsetMs: null },
];

export interface ScheduledObservation {
  readonly observationJobId: string;
  readonly candidateId: string;
  readonly contractSymbol: string;
  readonly horizonCode: ObservationHorizon['code'];
  readonly horizonVersion: typeof executionObservationHorizonVersion;
  readonly targetAt: string;
}

export function buildObservationSchedule(input: {
  candidateId: string; contractSymbol: string; decisionTime: string; marketClose: string;
  horizons?: readonly ObservationHorizon[];
}): readonly ScheduledObservation[] {
  const decisionMs = Date.parse(input.decisionTime), closeMs = Date.parse(input.marketClose);
  if (!Number.isFinite(decisionMs) || !Number.isFinite(closeMs)) throw new Error('OBSERVATION_SCHEDULE_TIMESTAMP_INVALID');
  return (input.horizons ?? defaultObservationHorizons).map((horizon) => {
    const targetMs = horizon.offsetMs === null ? closeMs : decisionMs + horizon.offsetMs;
    const identity = `${input.candidateId}:${executionObservationHorizonVersion}:${horizon.code}:${targetMs}`;
    return { observationJobId: deterministicUuid(identity), candidateId: input.candidateId,
      contractSymbol: input.contractSymbol, horizonCode: horizon.code,
      horizonVersion: executionObservationHorizonVersion, targetAt: new Date(targetMs).toISOString() };
  });
}

export type CounterfactualFillState = 'BLOCKED_ON_DATA' | 'LIMIT_TOUCHED' | 'NOT_TOUCHED';
export function classifyObservedLimitTouch(input: { side: 'BUY' | 'SELL'; limit: number | null; bid: number | null; ask: number | null }): CounterfactualFillState {
  if (input.limit === null || input.bid === null || input.ask === null) return 'BLOCKED_ON_DATA';
  if (input.bid > input.ask) throw new Error('CROSSED_BBO_INVALID');
  return input.side === 'SELL'
    ? input.bid >= input.limit ? 'LIMIT_TOUCHED' : 'NOT_TOUCHED'
    : input.ask <= input.limit ? 'LIMIT_TOUCHED' : 'NOT_TOUCHED';
}

export class PostgresShadowEvidenceRuntimeStore {
  constructor(private readonly pool: Pool) {}

  async saveScan(scan: CrossSymbolShadowScanResult, persisted: ReadonlyMap<string, { fusionSnapshotId: string | null; candidateSetId: string | null }>): Promise<void> {
    const payload = { ...scan, results: scan.results.map((item) => ({ symbol: item.symbol, ordinal: item.ordinal, status: item.status, errorCode: item.errorCode })) };
    const hash = createHash('sha256').update(canonicalJson(payload)).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO research.theta_shadow_scan_run(scan_id,mode,contract_version,started_at,finished_at,
        universe_version,lattice_version,strategy_version,branches_json,eligible_symbols_json,max_underlyings,
        symbols_attempted,symbols_completed,candidate_count,completeness_state,missing_scope_json,content_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16::jsonb,$17)
        ON CONFLICT(scan_id) DO NOTHING`, [scan.scanId, scan.mode, scan.contractVersion, scan.startedAt, scan.finishedAt,
        scan.boundary.universeVersion, scan.boundary.latticeVersion, scan.boundary.strategyVersion,
        JSON.stringify(scan.boundary.branches), JSON.stringify(scan.boundary.eligibleSymbols), scan.boundary.maxUnderlyings,
        scan.symbolsAttempted, scan.symbolsCompleted, scan.candidateCount, scan.completeness,
        JSON.stringify(scan.missingScope), hash]);
      for (const member of scan.results) {
        const refs = persisted.get(member.symbol);
        await client.query(`INSERT INTO research.theta_shadow_scan_member(scan_id,symbol,ordinal,status,error_code,
          fusion_snapshot_id,candidate_set_id,candidate_count,contracts_complete,quotes_complete)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(scan_id,symbol) DO NOTHING`, [scan.scanId,
          member.symbol, member.ordinal, member.status, member.errorCode, refs?.fusionSnapshotId ?? null,
          refs?.candidateSetId ?? null, member.cycle?.orchestration?.thetaQ?.candidates.length ?? 0,
          member.cycle?.optionContractsComplete ?? null, member.cycle?.optionChainComplete ?? null]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async scheduleObservations(rows: readonly ScheduledObservation[]): Promise<number> {
    let inserted = 0;
    for (const row of rows) {
      const result = await this.pool.query(`INSERT INTO research.theta_execution_observation_job(
        observation_job_id,candidate_id,contract_symbol,horizon_code,horizon_version,target_at,status)
        VALUES($1,$2,$3,$4,$5,$6,'PENDING') ON CONFLICT(candidate_id,horizon_version,horizon_code) DO NOTHING`,
      [row.observationJobId,row.candidateId,row.contractSymbol,row.horizonCode,row.horizonVersion,row.targetAt]);
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  }

  async markMissedDueObservations(asOf: string, reason: string): Promise<number> {
    const result = await this.pool.query(`UPDATE research.theta_execution_observation_job SET status='MISSED',
      resolved_at=$1,missing_reason=$2 WHERE status='PENDING' AND target_at <= $1`, [asOf, reason]);
    return result.rowCount ?? 0;
  }

  async markObservationObserved(jobId:string,quoteObservationId:string,resolvedAt:string):Promise<boolean>{
    const result=await this.pool.query(`UPDATE research.theta_execution_observation_job SET status='OBSERVED',
      resolved_at=$2,quote_observation_id=$3 WHERE observation_job_id=$1 AND status='PENDING'`,[jobId,resolvedAt,quoteObservationId]);
    return result.rowCount===1;
  }

  async markObservationMissed(jobId:string,resolvedAt:string,reason:string):Promise<boolean>{
    const result=await this.pool.query(`UPDATE research.theta_execution_observation_job SET status='MISSED',
      resolved_at=$2,missing_reason=$3 WHERE observation_job_id=$1 AND status='PENDING'`,[jobId,resolvedAt,reason]);
    return result.rowCount===1;
  }
}

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(createHash('sha256').update(value).digest('hex').slice(0, 32), 'hex');
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
