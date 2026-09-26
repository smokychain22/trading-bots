import { createHash } from 'node:crypto';

export const strategyLearningHorizonPolicyVersion = 'theta-strategy-learning-horizons-v1' as const;

export type StrategyLearningHorizonCode =
  | '15M' | '1H' | 'EOD' | '1_TRADING_DAY' | '3_TRADING_DAYS' | '5_TRADING_DAYS'
  | 'EXPIRATION' | 'PRIMARY_COMMON_HORIZON';

export interface StrategyLearningSession {
  readonly date: string;
  readonly openAt: string;
  readonly closeAt: string;
  readonly source: 'ALPACA_CALENDAR';
}

export interface StrategyLearningHorizonPolicy {
  readonly version: typeof strategyLearningHorizonPolicyVersion;
  readonly primaryCommonHorizon: Exclude<StrategyLearningHorizonCode, 'PRIMARY_COMMON_HORIZON'>;
  readonly tradingDayTarget: 'SESSION_CLOSE';
}

export interface StrategyLearningObservationJob {
  readonly observationJobId: string;
  readonly subjectId: string;
  readonly horizonPolicyVersion: typeof strategyLearningHorizonPolicyVersion;
  readonly horizonCode: StrategyLearningHorizonCode;
  readonly targetAt: string | null;
  readonly targetSessionDate: string | null;
  readonly targetState: 'SCHEDULED' | 'UNSCHEDULED_CALENDAR_INCOMPLETE' | 'UNSCHEDULED_EXPIRATION_SESSION_MISSING';
  readonly derivedFromHorizonCode: Exclude<StrategyLearningHorizonCode, 'PRIMARY_COMMON_HORIZON'> | null;
  readonly brokerAuthority: false;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const primaryHorizonCodes = new Set<string>([
  '15M', '1H', 'EOD', '1_TRADING_DAY', '3_TRADING_DAYS', '5_TRADING_DAYS', 'EXPIRATION',
]);

function validateSessions(sessions: readonly StrategyLearningSession[]): readonly StrategyLearningSession[] {
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const dates = new Set<string>();
  for (const session of ordered) {
    const open = Date.parse(session.openAt), close = Date.parse(session.closeAt);
    if (!DATE.test(session.date) || !Number.isFinite(open) || !Number.isFinite(close) || close <= open) {
      throw new Error('STRATEGY_HORIZON_CALENDAR_SESSION_INVALID');
    }
    if (dates.has(session.date)) throw new Error('STRATEGY_HORIZON_CALENDAR_SESSION_DUPLICATE');
    dates.add(session.date);
  }
  return ordered;
}

function target(
  subjectId: string,
  policy: StrategyLearningHorizonPolicy,
  horizonCode: StrategyLearningHorizonCode,
  targetAt: string | null,
  targetSessionDate: string | null,
  targetState: StrategyLearningObservationJob['targetState'],
  derivedFromHorizonCode: StrategyLearningObservationJob['derivedFromHorizonCode'] = null,
): StrategyLearningObservationJob {
  const identity = `${subjectId}:${policy.version}:${horizonCode}:${targetAt ?? targetState}`;
  return {
    observationJobId: hash(identity), subjectId, horizonPolicyVersion: policy.version,
    horizonCode, targetAt, targetSessionDate, targetState, derivedFromHorizonCode,
    brokerAuthority: false,
  };
}

function scheduledSessionTarget(
  subjectId: string,
  policy: StrategyLearningHorizonPolicy,
  horizonCode: StrategyLearningHorizonCode,
  session: StrategyLearningSession | undefined,
  missingState: StrategyLearningObservationJob['targetState'] = 'UNSCHEDULED_CALENDAR_INCOMPLETE',
): StrategyLearningObservationJob {
  return session === undefined
    ? target(subjectId, policy, horizonCode, null, null, missingState)
    : target(subjectId, policy, horizonCode, new Date(session.closeAt).toISOString(), session.date, 'SCHEDULED');
}

/**
 * Builds the strategy-learning schedule from explicit exchange sessions.
 * Trading-day offsets always mean actual Alpaca sessions and therefore never
 * turn a Friday decision into a Saturday observation.
 */
export function buildStrategyLearningObservationSchedule(input: {
  readonly subjectId: string;
  readonly decisionAt: string;
  readonly decisionSessionDate: string;
  readonly expirationDate: string | null;
  readonly sessions: readonly StrategyLearningSession[];
  readonly policy: StrategyLearningHorizonPolicy;
}): readonly StrategyLearningObservationJob[] {
  if (!SHA256.test(input.subjectId)) throw new Error('STRATEGY_HORIZON_SUBJECT_ID_INVALID');
  if (input.policy.version !== strategyLearningHorizonPolicyVersion
    || !primaryHorizonCodes.has(input.policy.primaryCommonHorizon)) {
    throw new Error('STRATEGY_HORIZON_POLICY_INVALID');
  }
  const decision = Date.parse(input.decisionAt);
  if (!Number.isFinite(decision) || !DATE.test(input.decisionSessionDate)
    || (input.expirationDate !== null && !DATE.test(input.expirationDate))) {
    throw new Error('STRATEGY_HORIZON_INPUT_INVALID');
  }
  const sessions = validateSessions(input.sessions);
  const decisionIndex = sessions.findIndex((session) => session.date === input.decisionSessionDate);
  const decisionSession = decisionIndex >= 0 ? sessions[decisionIndex] : undefined;
  const expirationSession = input.expirationDate === null
    ? undefined : sessions.find((session) => session.date === input.expirationDate);
  const byCode = new Map<Exclude<StrategyLearningHorizonCode, 'PRIMARY_COMMON_HORIZON'>, StrategyLearningObservationJob>();
  const put = (job: StrategyLearningObservationJob): void => {
    byCode.set(job.horizonCode as Exclude<StrategyLearningHorizonCode, 'PRIMARY_COMMON_HORIZON'>, job);
  };
  put(target(input.subjectId, input.policy, '15M', new Date(decision + 15 * 60_000).toISOString(),
    input.decisionSessionDate, 'SCHEDULED'));
  put(target(input.subjectId, input.policy, '1H', new Date(decision + 60 * 60_000).toISOString(),
    input.decisionSessionDate, 'SCHEDULED'));
  put(scheduledSessionTarget(input.subjectId, input.policy, 'EOD', decisionSession));
  put(scheduledSessionTarget(input.subjectId, input.policy, '1_TRADING_DAY',
    decisionIndex >= 0 ? sessions[decisionIndex + 1] : undefined));
  put(scheduledSessionTarget(input.subjectId, input.policy, '3_TRADING_DAYS',
    decisionIndex >= 0 ? sessions[decisionIndex + 3] : undefined));
  put(scheduledSessionTarget(input.subjectId, input.policy, '5_TRADING_DAYS',
    decisionIndex >= 0 ? sessions[decisionIndex + 5] : undefined));
  put(scheduledSessionTarget(input.subjectId, input.policy, 'EXPIRATION', expirationSession,
    'UNSCHEDULED_EXPIRATION_SESSION_MISSING'));

  const primary = byCode.get(input.policy.primaryCommonHorizon);
  if (primary === undefined) throw new Error('STRATEGY_HORIZON_PRIMARY_TARGET_MISSING');
  const primaryJob = target(input.subjectId, input.policy, 'PRIMARY_COMMON_HORIZON', primary.targetAt,
    primary.targetSessionDate, primary.targetState, input.policy.primaryCommonHorizon);
  return [...byCode.values(), primaryJob];
}
