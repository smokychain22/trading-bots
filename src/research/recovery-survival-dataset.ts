/**
 * COMMAND 4 item 21 (COMMAND 3 §13/§22). Recovery-duration survival
 * research contract. Research-only, `brokerAuthority: false`. Event time
 * runs from assignment timestamp to terminal stock disposition. Calendar
 * days, trading days, and capital-days are tracked as three SEPARATE
 * quantities, never conflated. Open recovery episodes are right-censored
 * and retained -- never discarded.
 */
import { capitalDaysFromDailySeries, type DailyCapitalObservation } from './capital-days-definition.js';

export const recoverySurvivalDatasetVersion = 'theta-recovery-survival-dataset-v1' as const;

export type RecoverySurvivalStatus = 'RESOLVED' | 'RIGHT_CENSORED';

export interface RecoverySurvivalRow {
  readonly contractVersion: typeof recoverySurvivalDatasetVersion;
  readonly recoveryEpisodeId: string;
  readonly assignmentAt: string;
  readonly terminalDispositionAt: string | null;
  readonly status: RecoverySurvivalStatus;
  readonly calendarDays: number;
  readonly tradingDays: number | null;
  readonly capitalDays: number | null;
}

export function buildRecoverySurvivalRow(input: {
  readonly recoveryEpisodeId: string;
  readonly assignmentAt: string;
  readonly terminalDispositionAt: string | null;
  readonly observationCutoffAt: string;
  readonly tradingDays: number | null;
  readonly dailyCapital: readonly DailyCapitalObservation[];
}): RecoverySurvivalRow {
  if (!Number.isFinite(Date.parse(input.assignmentAt))) throw new Error('RECOVERY_SURVIVAL_INVALID_ASSIGNMENT_AT');
  if (input.terminalDispositionAt !== null && Date.parse(input.terminalDispositionAt) < Date.parse(input.assignmentAt)) {
    throw new Error('RECOVERY_SURVIVAL_TERMINAL_BEFORE_ASSIGNMENT');
  }
  const endAt = input.terminalDispositionAt ?? input.observationCutoffAt;
  const calendarDays = Math.max(0, (Date.parse(endAt) - Date.parse(input.assignmentAt)) / 86_400_000);
  return {
    contractVersion: recoverySurvivalDatasetVersion, recoveryEpisodeId: input.recoveryEpisodeId,
    assignmentAt: input.assignmentAt, terminalDispositionAt: input.terminalDispositionAt,
    status: input.terminalDispositionAt !== null ? 'RESOLVED' : 'RIGHT_CENSORED',
    calendarDays, tradingDays: input.tradingDays,
    capitalDays: input.dailyCapital.length === 0 ? null : capitalDaysFromDailySeries(input.dailyCapital),
  };
}
