export const earningsVolatilityReplicationVersion = 'theta-earnings-volatility-replication-v1' as const;

export interface EarningsVolatilityPolicy {
  readonly version: string;
  /** (back IV - front IV) / calendar-day gap. More negative is stronger front-month backwardation. */
  readonly maximumTermSlopePerDay: number | null;
  readonly minimumAverageDailyVolume30d: number | null;
  readonly minimumIv30ToRv30: number | null;
}

export interface TwoSidedQuote {
  readonly bid: number;
  readonly ask: number;
}

export interface EarningsVolatilityObservation {
  readonly eventId: string;
  readonly symbol: string;
  readonly decisionAt: string;
  readonly providerKnownAt: string;
  readonly eventAt: string;
  readonly exitAt: string;
  readonly spotBefore: number;
  readonly spotAfter: number;
  readonly atmStrike: number;
  readonly multiplier: number;
  readonly frontExpiration: string;
  readonly backExpiration: string;
  readonly frontIv: number;
  readonly backIv: number;
  readonly iv30: number;
  readonly rv30: number;
  readonly averageDailyVolume30d: number;
  readonly entryFrontCall: TwoSidedQuote;
  readonly entryFrontPut: TwoSidedQuote;
  readonly exitFrontCall: TwoSidedQuote;
  readonly exitFrontPut: TwoSidedQuote;
  /** Same option type and strike for the front/back calendar. */
  readonly entryBackOption: TwoSidedQuote;
  readonly exitBackOption: TwoSidedQuote;
  readonly entryFrontCalendarOption: TwoSidedQuote;
  readonly exitFrontCalendarOption: TwoSidedQuote;
  readonly totalStraddleCostsUsd: number | null;
  readonly totalCalendarCostsUsd: number | null;
}

export type EarningsObservationState = 'QUALIFIED' | 'FILTERED_OUT' | 'INVALID' | 'PIT_UNSAFE' | 'BLOCKED_MISSING_POLICY';

export interface EarningsVolatilityEpisode {
  readonly eventId: string;
  readonly symbol: string;
  readonly state: EarningsObservationState;
  readonly reasons: readonly string[];
  readonly termSlopePerDay: number | null;
  readonly iv30ToRv30: number | null;
  readonly eventGapPct: number | null;
  readonly impliedMovePct: number | null;
  readonly absoluteExpectedMoveErrorPct: number | null;
  readonly straddleGrossPnlUsd: number | null;
  readonly straddleNetPnlUsd: number | null;
  readonly calendarGrossPnlUsd: number | null;
  readonly calendarNetPnlUsd: number | null;
}

export interface DistributionMetrics {
  readonly n: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number | null;
  readonly averagePnlUsd: number | null;
  readonly medianPnlUsd: number | null;
  readonly profitFactor: number | null;
  readonly maxDrawdownUsd: number | null;
  readonly expectedShortfall5PctUsd: number | null;
  readonly worstOnePctUsd: number | null;
  readonly cumulativePnlUsd: number;
}

export interface EarningsVolatilityReplicationReceipt {
  readonly version: typeof earningsVolatilityReplicationVersion;
  readonly policyVersion: string;
  readonly sourceClaim: 'OWNER_CURATED_SOURCE_CLAIM';
  readonly authority: 'RESEARCH_ONLY';
  readonly executionAuthorized: false;
  readonly eventCount: number;
  readonly qualifiedCount: number;
  readonly filterRate: number | null;
  readonly stateCounts: Readonly<Record<EarningsObservationState, number>>;
  readonly episodes: readonly EarningsVolatilityEpisode[];
  readonly shortAtmStraddle: { readonly gross: DistributionMetrics; readonly net: DistributionMetrics | null };
  readonly longCalendar: { readonly gross: DistributionMetrics; readonly net: DistributionMetrics | null };
  readonly eventGap: {
    readonly meanAbsoluteGapPct: number | null;
    readonly meanImpliedMovePct: number | null;
    readonly meanAbsoluteExpectedMoveErrorPct: number | null;
    readonly realizedMoveBelowImpliedRate: number | null;
  };
  readonly profitabilityStatus: 'EMPIRICALLY_UNPROVEN';
}

const finite = (value: number): boolean => Number.isFinite(value);
const validQuote = (quote: TwoSidedQuote): boolean => finite(quote.bid) && finite(quote.ask) && quote.bid >= 0 && quote.ask >= quote.bid;
const dateMs = (value: string): number => Date.parse(value);
const average = (values: readonly number[]): number | null => values.length === 0 ? null
  : values.reduce((sum, value) => sum + value, 0) / values.length;
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

function validate(observation: EarningsVolatilityObservation): string[] {
  const reasons: string[] = [];
  const timestamps = [observation.decisionAt, observation.providerKnownAt, observation.eventAt, observation.exitAt].map(dateMs);
  if (timestamps.some((value) => !finite(value))) reasons.push('INVALID_TIMESTAMP');
  if (finite(timestamps[0] as number) && finite(timestamps[1] as number)
    && (timestamps[1] as number) > (timestamps[0] as number)) reasons.push('PROVIDER_EVIDENCE_KNOWN_AFTER_DECISION');
  if (finite(timestamps[0] as number) && finite(timestamps[2] as number)
    && (timestamps[0] as number) >= (timestamps[2] as number)) reasons.push('DECISION_NOT_BEFORE_EVENT');
  if (finite(timestamps[2] as number) && finite(timestamps[3] as number)
    && (timestamps[3] as number) <= (timestamps[2] as number)) reasons.push('EXIT_NOT_AFTER_EVENT');
  if (![observation.spotBefore, observation.spotAfter, observation.atmStrike, observation.frontIv, observation.backIv,
    observation.iv30, observation.rv30, observation.averageDailyVolume30d].every(finite)
    || observation.spotBefore <= 0 || observation.spotAfter <= 0 || observation.atmStrike <= 0
    || observation.frontIv <= 0 || observation.backIv <= 0 || observation.iv30 <= 0 || observation.rv30 <= 0
    || observation.averageDailyVolume30d < 0) reasons.push('INVALID_MARKET_EVIDENCE');
  if (!Number.isInteger(observation.multiplier) || observation.multiplier <= 0) reasons.push('INVALID_MULTIPLIER');
  const front = dateMs(`${observation.frontExpiration}T00:00:00Z`);
  const back = dateMs(`${observation.backExpiration}T00:00:00Z`);
  if (!finite(front) || !finite(back) || back <= front) reasons.push('INVALID_EXPIRATION_ORDER');
  if (![observation.entryFrontCall, observation.entryFrontPut, observation.exitFrontCall, observation.exitFrontPut,
    observation.entryBackOption, observation.exitBackOption, observation.entryFrontCalendarOption,
    observation.exitFrontCalendarOption].every(validQuote)) reasons.push('INVALID_TWO_SIDED_QUOTE');
  if (observation.totalStraddleCostsUsd !== null
    && (!finite(observation.totalStraddleCostsUsd) || observation.totalStraddleCostsUsd < 0)) reasons.push('INVALID_STRADDLE_COST');
  if (observation.totalCalendarCostsUsd !== null
    && (!finite(observation.totalCalendarCostsUsd) || observation.totalCalendarCostsUsd < 0)) reasons.push('INVALID_CALENDAR_COST');
  return [...new Set(reasons)].sort();
}

const missingPolicy = (policy: EarningsVolatilityPolicy): string[] => [
  ['MAXIMUM_TERM_SLOPE_PER_DAY', policy.maximumTermSlopePerDay],
  ['MINIMUM_AVERAGE_DAILY_VOLUME_30D', policy.minimumAverageDailyVolume30d],
  ['MINIMUM_IV30_TO_RV30', policy.minimumIv30ToRv30],
].filter(([, value]) => value === null || !finite(value as number)).map(([name]) => `MISSING_POLICY:${name as string}`);

export function evaluateEarningsVolatilityObservation(observation: EarningsVolatilityObservation,
  policy: EarningsVolatilityPolicy): EarningsVolatilityEpisode {
  const invalid = validate(observation);
  const pit = invalid.filter((reason) => ['PROVIDER_EVIDENCE_KNOWN_AFTER_DECISION', 'DECISION_NOT_BEFORE_EVENT',
    'EXIT_NOT_AFTER_EVENT'].includes(reason));
  const policyMissing = missingPolicy(policy);
  const front = dateMs(`${observation.frontExpiration}T00:00:00Z`);
  const back = dateMs(`${observation.backExpiration}T00:00:00Z`);
  const gapDays = finite(front) && finite(back) ? (back - front) / 86_400_000 : null;
  const termSlopePerDay = gapDays !== null && gapDays > 0 ? (observation.backIv - observation.frontIv) / gapDays : null;
  const iv30ToRv30 = observation.rv30 > 0 ? observation.iv30 / observation.rv30 : null;
  const eventGapPct = observation.spotBefore > 0 ? Math.abs(observation.spotAfter / observation.spotBefore - 1) : null;
  const entryStraddleCredit = (observation.entryFrontCall.bid + observation.entryFrontPut.bid) * observation.multiplier;
  const exitStraddleDebit = (observation.exitFrontCall.ask + observation.exitFrontPut.ask) * observation.multiplier;
  const straddleGrossPnlUsd = money(entryStraddleCredit - exitStraddleDebit);
  const impliedMovePct = observation.spotBefore > 0 ? entryStraddleCredit / observation.multiplier / observation.spotBefore : null;
  const entryCalendarDebit = (observation.entryBackOption.ask - observation.entryFrontCalendarOption.bid) * observation.multiplier;
  const exitCalendarCredit = (observation.exitBackOption.bid - observation.exitFrontCalendarOption.ask) * observation.multiplier;
  const calendarGrossPnlUsd = money(exitCalendarCredit - entryCalendarDebit);
  const structuralInvalid = invalid.filter((reason) => !pit.includes(reason));
  const filterReasons: string[] = [];
  if (termSlopePerDay !== null && policy.maximumTermSlopePerDay !== null
    && termSlopePerDay > policy.maximumTermSlopePerDay) filterReasons.push('TERM_SLOPE_NOT_NEGATIVE_ENOUGH');
  if (policy.minimumAverageDailyVolume30d !== null
    && observation.averageDailyVolume30d < policy.minimumAverageDailyVolume30d) filterReasons.push('VOLUME_BELOW_POLICY');
  if (iv30ToRv30 !== null && policy.minimumIv30ToRv30 !== null
    && iv30ToRv30 < policy.minimumIv30ToRv30) filterReasons.push('IV30_RV30_BELOW_POLICY');
  const state: EarningsObservationState = pit.length > 0 ? 'PIT_UNSAFE'
    : structuralInvalid.length > 0 ? 'INVALID'
      : policyMissing.length > 0 ? 'BLOCKED_MISSING_POLICY'
        : filterReasons.length > 0 ? 'FILTERED_OUT' : 'QUALIFIED';
  const reasons = state === 'PIT_UNSAFE' ? pit : state === 'INVALID' ? structuralInvalid
    : state === 'BLOCKED_MISSING_POLICY' ? policyMissing : filterReasons;
  const qualified = state === 'QUALIFIED';
  return {
    eventId: observation.eventId, symbol: observation.symbol, state, reasons,
    termSlopePerDay, iv30ToRv30, eventGapPct, impliedMovePct,
    absoluteExpectedMoveErrorPct: eventGapPct === null || impliedMovePct === null ? null : Math.abs(eventGapPct - impliedMovePct),
    straddleGrossPnlUsd: qualified ? straddleGrossPnlUsd : null,
    straddleNetPnlUsd: qualified && observation.totalStraddleCostsUsd !== null
      ? money(straddleGrossPnlUsd - observation.totalStraddleCostsUsd) : null,
    calendarGrossPnlUsd: qualified ? calendarGrossPnlUsd : null,
    calendarNetPnlUsd: qualified && observation.totalCalendarCostsUsd !== null
      ? money(calendarGrossPnlUsd - observation.totalCalendarCostsUsd) : null,
  };
}

export function distributionMetrics(values: readonly number[]): DistributionMetrics {
  if (values.length === 0) return { n: 0, wins: 0, losses: 0, winRate: null, averagePnlUsd: null,
    medianPnlUsd: null, profitFactor: null, maxDrawdownUsd: null, expectedShortfall5PctUsd: null,
    worstOnePctUsd: null, cumulativePnlUsd: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  let cumulative = 0; let peak = 0; let maxDrawdown = 0;
  for (const value of values) { cumulative += value; peak = Math.max(peak, cumulative); maxDrawdown = Math.min(maxDrawdown, cumulative - peak); }
  const esCount = Math.max(1, Math.ceil(values.length * 0.05));
  const onePctIndex = Math.max(0, Math.ceil(values.length * 0.01) - 1);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2 : sorted[middle] as number;
  return {
    n: values.length, wins: wins.length, losses: losses.length, winRate: wins.length / values.length,
    averagePnlUsd: average(values), medianPnlUsd: median,
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss,
    maxDrawdownUsd: maxDrawdown, expectedShortfall5PctUsd: average(sorted.slice(0, esCount)),
    worstOnePctUsd: sorted[onePctIndex] as number, cumulativePnlUsd: cumulative,
  };
}

export function replicateEarningsVolatility(observations: readonly EarningsVolatilityObservation[],
  policy: EarningsVolatilityPolicy): EarningsVolatilityReplicationReceipt {
  const episodes = [...observations].sort((left, right) => left.decisionAt.localeCompare(right.decisionAt)
    || left.eventId.localeCompare(right.eventId)).map((observation) => evaluateEarningsVolatilityObservation(observation, policy));
  const qualified = episodes.filter((episode) => episode.state === 'QUALIFIED');
  const values = (field: 'straddleGrossPnlUsd' | 'straddleNetPnlUsd' | 'calendarGrossPnlUsd' | 'calendarNetPnlUsd') =>
    qualified.map((episode) => episode[field]).filter((value): value is number => value !== null);
  const stateCounts = Object.fromEntries(['QUALIFIED', 'FILTERED_OUT', 'INVALID', 'PIT_UNSAFE', 'BLOCKED_MISSING_POLICY']
    .map((state) => [state, episodes.filter((episode) => episode.state === state).length])) as Record<EarningsObservationState, number>;
  const gaps = qualified.map((episode) => episode.eventGapPct).filter((value): value is number => value !== null);
  const implied = qualified.map((episode) => episode.impliedMovePct).filter((value): value is number => value !== null);
  const errors = qualified.map((episode) => episode.absoluteExpectedMoveErrorPct).filter((value): value is number => value !== null);
  const comparable = qualified.filter((episode) => episode.eventGapPct !== null && episode.impliedMovePct !== null);
  const straddleNet = values('straddleNetPnlUsd'); const calendarNet = values('calendarNetPnlUsd');
  return {
    version: earningsVolatilityReplicationVersion, policyVersion: policy.version,
    sourceClaim: 'OWNER_CURATED_SOURCE_CLAIM', authority: 'RESEARCH_ONLY', executionAuthorized: false,
    eventCount: episodes.length, qualifiedCount: qualified.length,
    filterRate: episodes.length === 0 ? null : 1 - qualified.length / episodes.length, stateCounts, episodes,
    shortAtmStraddle: { gross: distributionMetrics(values('straddleGrossPnlUsd')),
      net: straddleNet.length === qualified.length ? distributionMetrics(straddleNet) : null },
    longCalendar: { gross: distributionMetrics(values('calendarGrossPnlUsd')),
      net: calendarNet.length === qualified.length ? distributionMetrics(calendarNet) : null },
    eventGap: { meanAbsoluteGapPct: average(gaps), meanImpliedMovePct: average(implied),
      meanAbsoluteExpectedMoveErrorPct: average(errors),
      realizedMoveBelowImpliedRate: comparable.length === 0 ? null
        : comparable.filter((episode) => (episode.eventGapPct as number) < (episode.impliedMovePct as number)).length / comparable.length },
    profitabilityStatus: 'EMPIRICALLY_UNPROVEN',
  };
}
