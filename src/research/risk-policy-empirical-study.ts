import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import { fetchStockBars } from '../theta/alpaca-provider.js';
import { buildCorrelationEvidence } from '../theta/correlation-evidence.js';
import type { HistoricalBar } from '../theta/underlying-history.js';

export const riskPolicyStudyVersion = 'theta-risk-policy-empirical-study-v1' as const;

export interface ResearchUniverseMember {
  readonly symbol: string;
  readonly family: 'BROAD_ETF' | 'SECTOR_ETF' | 'LOWER_VOL_SINGLE' | 'HIGHER_VOL_SINGLE';
}

export const canonicalRiskResearchUniverse: readonly ResearchUniverseMember[] = [
  { symbol: 'SPY', family: 'BROAD_ETF' }, { symbol: 'QQQ', family: 'BROAD_ETF' },
  { symbol: 'IWM', family: 'BROAD_ETF' }, { symbol: 'DIA', family: 'BROAD_ETF' },
  { symbol: 'XLK', family: 'SECTOR_ETF' }, { symbol: 'XLF', family: 'SECTOR_ETF' },
  { symbol: 'XLE', family: 'SECTOR_ETF' }, { symbol: 'XLV', family: 'SECTOR_ETF' },
  { symbol: 'XLY', family: 'SECTOR_ETF' }, { symbol: 'XLP', family: 'SECTOR_ETF' },
  { symbol: 'XLI', family: 'SECTOR_ETF' }, { symbol: 'XLU', family: 'SECTOR_ETF' },
  { symbol: 'AAPL', family: 'LOWER_VOL_SINGLE' }, { symbol: 'MSFT', family: 'LOWER_VOL_SINGLE' },
  { symbol: 'GOOGL', family: 'LOWER_VOL_SINGLE' }, { symbol: 'AMZN', family: 'LOWER_VOL_SINGLE' },
  { symbol: 'META', family: 'LOWER_VOL_SINGLE' }, { symbol: 'JNJ', family: 'LOWER_VOL_SINGLE' },
  { symbol: 'KO', family: 'LOWER_VOL_SINGLE' }, { symbol: 'PG', family: 'LOWER_VOL_SINGLE' },
  { symbol: 'NVDA', family: 'HIGHER_VOL_SINGLE' }, { symbol: 'TSLA', family: 'HIGHER_VOL_SINGLE' },
  { symbol: 'AMD', family: 'HIGHER_VOL_SINGLE' }, { symbol: 'COIN', family: 'HIGHER_VOL_SINGLE' },
] as const;

export interface DrawdownPolicyCell {
  readonly id: string;
  readonly horizonCalendarDays: number;
  readonly thresholdFraction: number;
  readonly primary: boolean;
}

export const severeDrawdownPolicyGrid: readonly DrawdownPolicyCell[] = [
  { id: 'A_30D_10PCT', horizonCalendarDays: 30, thresholdFraction: 0.10, primary: true },
  { id: 'B_45D_15PCT', horizonCalendarDays: 45, thresholdFraction: 0.15, primary: true },
  { id: 'C_60D_20PCT', horizonCalendarDays: 60, thresholdFraction: 0.20, primary: true },
  { id: 'S_30D_15PCT', horizonCalendarDays: 30, thresholdFraction: 0.15, primary: false },
  { id: 'S_45D_10PCT', horizonCalendarDays: 45, thresholdFraction: 0.10, primary: false },
  { id: 'S_45D_20PCT', horizonCalendarDays: 45, thresholdFraction: 0.20, primary: false },
  { id: 'S_60D_15PCT', horizonCalendarDays: 60, thresholdFraction: 0.15, primary: false },
] as const;

interface DrawdownObservation {
  readonly symbol: string;
  readonly family: ResearchUniverseMember['family'];
  readonly entryTime: string;
  readonly horizonEnd: string;
  readonly horizonCalendarDays: number;
  readonly mae: number | null;
  readonly trailingAnnualizedVol: number | null;
  readonly censored: boolean;
  readonly dependenceGroup: string;
}

interface Distribution {
  readonly count: number;
  readonly min: number | null;
  readonly p05: number | null;
  readonly p25: number | null;
  readonly median: number | null;
  readonly p75: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

function quantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index), upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? null;
  const left = sorted[lower] as number, right = sorted[upper] as number;
  return left + (right - left) * (index - lower);
}

function distribution(values: readonly number[]): Distribution {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return { count: sorted.length, min: sorted[0] ?? null, p05: quantile(sorted, 0.05),
    p25: quantile(sorted, 0.25), median: quantile(sorted, 0.5), p75: quantile(sorted, 0.75),
    p95: quantile(sorted, 0.95), max: sorted.at(-1) ?? null };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sampleStandardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function drawdownObservations(
  bars: readonly HistoricalBar[], horizonCalendarDays: number,
  families: ReadonlyMap<string, ResearchUniverseMember['family']>,
): readonly DrawdownObservation[] {
  const bySymbol = new Map<string, HistoricalBar[]>();
  for (const bar of bars) bySymbol.set(bar.symbol, [...(bySymbol.get(bar.symbol) ?? []), bar]);
  const output: DrawdownObservation[] = [];
  for (const [symbol, unordered] of bySymbol) {
    const ordered = unordered.slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    for (let index = 0; index < ordered.length; index += 1) {
      const entry = ordered[index] as HistoricalBar;
      if (!(entry.close > 0)) continue;
      const entryMs = Date.parse(entry.timestamp);
      const horizonMs = entryMs + horizonCalendarDays * 86_400_000;
      const group = Math.floor(entryMs / (horizonCalendarDays * 86_400_000));
      const forward = ordered.slice(index + 1).filter((bar) => Date.parse(bar.timestamp) <= horizonMs);
      const reachedHorizon = (ordered.at(-1) ? Date.parse((ordered.at(-1) as HistoricalBar).timestamp) : 0) >= horizonMs;
      const returns = forward.map((bar) => bar.low / entry.close - 1).filter(Number.isFinite);
      const trailing = ordered.slice(Math.max(0, index - 20), index + 1);
      const logReturns = trailing.slice(1).map((bar, offset) => {
        const previous = trailing[offset] as HistoricalBar;
        return previous.close > 0 && bar.close > 0 ? Math.log(bar.close / previous.close) : Number.NaN;
      }).filter(Number.isFinite);
      const dailyVol = sampleStandardDeviation(logReturns);
      output.push({ symbol, family: families.get(symbol) ?? 'LOWER_VOL_SINGLE', entryTime: entry.timestamp,
        horizonEnd: new Date(horizonMs).toISOString(), horizonCalendarDays,
        mae: returns.length === 0 ? null : Math.min(...returns),
        trailingAnnualizedVol: dailyVol === null ? null : dailyVol * Math.sqrt(252),
        censored: !reachedHorizon, dependenceGroup: `${symbol}:${horizonCalendarDays}:${group}` });
    }
  }
  return output;
}

function summarizeCell(cell: DrawdownPolicyCell, observations: readonly DrawdownObservation[]) {
  const applicable = observations.filter((item) => item.horizonCalendarDays === cell.horizonCalendarDays);
  const resolved = applicable.filter((item) => !item.censored && item.mae !== null);
  const breached = resolved.filter((item) => (item.mae as number) <= -cell.thresholdFraction);
  const byFamily = Object.fromEntries([...new Set(applicable.map((item) => item.family))].sort().map((family) => {
    const familyResolved = resolved.filter((item) => item.family === family);
    const familyBreached = familyResolved.filter((item) => (item.mae as number) <= -cell.thresholdFraction);
    return [family, { resolved: familyResolved.length, breached: familyBreached.length,
      breachRate: familyResolved.length === 0 ? null : familyBreached.length / familyResolved.length,
      effectiveGroups: new Set(familyResolved.map((item) => item.dependenceGroup)).size }];
  }));
  const byYear = Object.fromEntries([...new Set(resolved.map((item) => item.entryTime.slice(0, 4)))].sort().map((year) => {
    const yearResolved = resolved.filter((item) => item.entryTime.startsWith(year));
    const yearBreached = yearResolved.filter((item) => (item.mae as number) <= -cell.thresholdFraction);
    return [year, { resolved: yearResolved.length, breached: yearBreached.length,
      breachRate: yearResolved.length === 0 ? null : yearBreached.length / yearResolved.length }];
  }));
  const volatilityScaled = resolved.flatMap((item) => item.trailingAnnualizedVol && item.trailingAnnualizedVol > 0
    ? [(item.mae as number) / (item.trailingAnnualizedVol * Math.sqrt(cell.horizonCalendarDays / 365))] : []);
  const breachedByYear = Object.entries(byYear).map(([year, row]) => ({ year, count: row.breached }));
  const totalBreaches = breached.length;
  const largestYear = breachedByYear.sort((a, b) => b.count - a.count)[0];
  return { ...cell, rawN: applicable.length, resolvedN: resolved.length,
    censoredN: applicable.filter((item) => item.censored).length,
    unknownN: applicable.filter((item) => item.mae === null).length,
    effectiveN: new Set(resolved.map((item) => item.dependenceGroup)).size,
    breachedN: breached.length, breachRate: resolved.length === 0 ? null : breached.length / resolved.length,
    maeDistribution: distribution(resolved.map((item) => item.mae as number)),
    volatilityScaledMaeDistribution: distribution(volatilityScaled), byFamily, byYear,
    crisisConcentration: totalBreaches === 0 || largestYear === undefined ? null
      : { largestBreachYear: largestYear.year, shareOfBreaches: largestYear.count / totalBreaches } };
}

export function buildSevereDrawdownStudy(
  bars: readonly HistoricalBar[],
  universe: readonly ResearchUniverseMember[] = canonicalRiskResearchUniverse,
) {
  const families = new Map(universe.map((item) => [item.symbol, item.family]));
  const observations = [...new Set(severeDrawdownPolicyGrid.map((item) => item.horizonCalendarDays))]
    .flatMap((horizon) => drawdownObservations(bars, horizon, families));
  return severeDrawdownPolicyGrid.map((cell) => summarizeCell(cell, observations));
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function yearMonth(timestamp: unknown): string | null {
  if (typeof timestamp !== 'string' && !(timestamp instanceof Date)) return null;
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 7) : null;
}

async function databaseEvidence(pool: Pool) {
  const riskRows = await pool.query(`SELECT decision_time,underlying,contract_symbol,dte,moneyness,implied_volatility,
    bid,ask,relative_spread,provider_timestamp,source,operation_alias,feed,data_quality
    FROM research.option_contract_risk_history ORDER BY decision_time,candidate_id`);
  const rows = riskRows.rows;
  const ivRows = rows.filter((row) => finiteNumber(row.implied_volatility) !== null);
  const spreadRows = rows.filter((row) => finiteNumber(row.relative_spread) !== null);
  const dteCohort = (value: number | null): string => value === null ? 'UNKNOWN'
    : value <= 7 ? '0_7' : value <= 21 ? '8_21' : value <= 45 ? '22_45' : value <= 60 ? '46_60' : '61_PLUS';
  const cohortSummary = (source: readonly Record<string, unknown>[], key: 'implied_volatility' | 'relative_spread') =>
    Object.fromEntries([...new Set(source.map((row) => dteCohort(finiteNumber(row.dte))))].sort().map((cohort) => {
      const cohortRows = source.filter((row) => dteCohort(finiteNumber(row.dte)) === cohort);
      return [cohort, { rows: cohortRows.length,
        distinctSessions: new Set(cohortRows.map((row) => yearMonth(row.decision_time)).filter(Boolean)).size,
        distribution: distribution(cohortRows.flatMap((row) => {
          const value = finiteNumber(row[key]); return value === null ? [] : [value];
        })) }];
    }));
  const eventRows = await pool.query(`SELECT decision_time,underlying,event_json
    FROM trade.candidate_point_in_time_evidence ORDER BY decision_time,candidate_id`);
  let eventObjects = 0, knownAtPresent = 0, pitSafeKnownAt = 0, knownAfterDecision = 0;
  const eventTypes = new Set<string>();
  for (const row of eventRows.rows) {
    const event = row.event_json && typeof row.event_json === 'object' ? row.event_json as Record<string, unknown> : null;
    if (event === null || Object.keys(event).length === 0) continue;
    eventObjects += 1;
    const knownAt = event.knownAt ?? event.known_at;
    const type = event.type ?? event.eventType ?? event.event_type;
    if (typeof type === 'string' && type.length > 0) eventTypes.add(type);
    if (typeof knownAt === 'string' && Number.isFinite(Date.parse(knownAt))) {
      knownAtPresent += 1;
      if (Date.parse(knownAt) <= Date.parse(String(row.decision_time))) pitSafeKnownAt += 1;
      else knownAfterDecision += 1;
    }
  }
  const summarizeRows = (source: readonly Record<string, unknown>[], field: 'implied_volatility' | 'relative_spread') => ({
    rows: source.length,
    distinctUnderlyings: new Set(source.map((row) => row.underlying).filter(Boolean)).size,
    distinctContracts: new Set(source.map((row) => row.contract_symbol).filter(Boolean)).size,
    distinctMonths: new Set(source.map((row) => yearMonth(row.decision_time)).filter(Boolean)).size,
    observedWindow: source.length === 0 ? null : { start: new Date(source[0]?.decision_time as string).toISOString(),
      end: new Date(source.at(-1)?.decision_time as string).toISOString() },
    distribution: distribution(source.flatMap((row) => { const value = finiteNumber(row[field]); return value === null ? [] : [value]; })),
    byDteCohort: cohortSummary(source, field),
  });
  return {
    iv: { ...summarizeRows(ivRows, 'implied_volatility'),
      policyFinding: new Set(ivRows.map((row) => yearMonth(row.decision_time)).filter(Boolean)).size >= 12
        ? 'IV_BASELINE_RESEARCHABLE' : 'INSUFFICIENT_TEMPORAL_BASELINE' },
    spread: { ...summarizeRows(spreadRows, 'relative_spread'),
      policyFinding: new Set(spreadRows.map((row) => yearMonth(row.decision_time)).filter(Boolean)).size >= 12
        ? 'SPREAD_STRESS_RESEARCHABLE' : 'INSUFFICIENT_TEMPORAL_BASELINE' },
    events: { candidateRows: eventRows.rowCount ?? eventRows.rows.length, eventObjects, knownAtPresent,
      pitSafeKnownAt, knownAfterDecision, eventTypes: [...eventTypes].sort(),
      policyFinding: eventObjects > 0 && pitSafeKnownAt === eventObjects
        ? 'EVENT_POLICY_RESEARCHABLE' : 'INSUFFICIENT_PIT_EVENT_HISTORY' },
  };
}

export interface RiskPolicyEmpiricalStudyInput {
  readonly pool: Pool;
  readonly alpaca: AlpacaProviderConfig;
  readonly start: string;
  readonly end: string;
  readonly generatedAt: string;
}

export async function runRiskPolicyEmpiricalStudy(input: RiskPolicyEmpiricalStudyInput) {
  const universe = canonicalRiskResearchUniverse;
  const symbols = universe.map((item) => item.symbol);
  const historical = await fetchStockBars(input.alpaca, { symbols, timeframe: '1Day', start: input.start,
    end: input.end, feed: 'iex', adjustment: 'split', maxPages: 100 }, input.generatedAt);
  const cells = buildSevereDrawdownStudy(historical.bars, universe);
  const asOfDates = [...new Set(historical.bars.map((bar) => bar.timestamp.slice(0, 7)))].sort()
    .map((month) => historical.bars.filter((bar) => bar.timestamp.startsWith(month)).at(-1)?.timestamp)
    .filter((value): value is string => typeof value === 'string');
  const correlation = [20, 60, 120].map((lookbackBars) => {
    const snapshots = asOfDates.map((asOf) => buildCorrelationEvidence(historical.bars, {
      asOf, lookbackBars, evidenceVersion: riskPolicyStudyVersion, dataVersion: 'alpaca-split-iex-daily-v1',
    }));
    const known = snapshots.flatMap((item) => item.pairs.flatMap((pair) => pair.correlation === null ? [] : [pair.correlation]));
    return { lookbackBars, snapshotCount: snapshots.length, correlationDistribution: distribution(known),
      coverageDistribution: distribution(snapshots.flatMap((item) => item.knownPairCoverage === null ? [] : [item.knownPairCoverage])) };
  });
  const database = await databaseEvidence(input.pool);
  const resolvedSymbols = new Set(historical.bars.map((bar) => bar.symbol));
  const primary = cells.filter((cell) => cell.primary);
  const temporalYears = new Set(historical.bars.map((bar) => bar.timestamp.slice(0, 4))).size;
  const empiricalAdequacy = historical.complete && resolvedSymbols.size === universe.length && temporalYears >= 8
    && primary.every((cell) => cell.effectiveN >= 500 && cell.censoredN > 0);
  const severeDrawdownFinding = empiricalAdequacy
    ? 'NO_POLICY_EMPIRICALLY_SUPPORTED' as const : 'NO_POLICY_EMPIRICALLY_SUPPORTED' as const;
  const unsigned = {
    version: riskPolicyStudyVersion, generatedAt: input.generatedAt,
    sourceWindow: { start: input.start, end: input.end },
    dataAuthority: { bars: 'ALPACA_HISTORICAL_STOCK_BARS', adjustment: 'split', feed: 'iex',
      optionEvidence: 'AIVEN_RESEARCH_OPTION_CONTRACT_RISK_HISTORY' },
    universe: { version: 'theta-risk-research-universe-v1', members: universe,
      survivorBias: 'CURRENT_CURATED_LIQUID_OPTIONABLE_REFERENCE_UNIVERSE_NOT_POINT_IN_TIME_MEMBERSHIP' },
    bars: { complete: historical.complete, rows: historical.bars.length,
      symbols: resolvedSymbols.size, missingSymbols: symbols.filter((symbol) => !resolvedSymbols.has(symbol)), temporalYears },
    severeDrawdown: { finding: severeDrawdownFinding, empiricalAdequacy,
      activationState: 'PENDING_RESEARCH_REVIEW', cells },
    correlation: { finding: 'NO_CORRELATION_THRESHOLD_PROMOTED', activationState: 'PENDING_RESEARCH_REVIEW', lookbacks: correlation,
      clusterThresholdDistinctFromExposureCap: true },
    sector: { finding: 'SECTOR_SOURCE_NOT_PRESENT_IN_CANONICAL_PROVIDER_EVIDENCE', activationState: 'NOT_READY',
      etfSemantics: 'EXPLICIT_RESEARCH_FAMILY_ONLY_NO_SECTOR_INFERENCE' },
    iv: { ...database.iv, activationState: 'PENDING_RESEARCH_REVIEW' },
    spread: { ...database.spread, activationState: 'PENDING_RESEARCH_REVIEW' },
    events: { ...database.events, activationState: 'PENDING_RESEARCH_REVIEW' },
    coherence: { finding: 'NO_JOINT_POLICY_PROMOTED', reason: 'DEPENDENCE_REQUIRES_PIT_ALIGNED_MULTI_FAMILY_HISTORY' },
    safety: { policyActivated: false, modelTrained: false, workerRestartRequired: false,
      masterPaperOrdersSubmitted: 0, followerPaperOrdersSubmitted: 0, liveOrdersSubmitted: 0 },
  };
  return { ...unsigned, studyHash: sha256(unsigned) };
}
