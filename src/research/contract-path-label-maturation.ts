export const contractPathLabelMaturationVersion = 'theta-contract-path-label-maturation-v1' as const;

export type ContractPathMaturationState =
  | 'PENDING' | 'PARTIAL' | 'MATURED_MARK_ONLY' | 'MATURED_MODELED' | 'MATURED_FACTUAL'
  | 'RIGHT_CENSORED' | 'NOT_IDENTIFIABLE' | 'INVALID';

export interface ContractPathMarkPoint {
  readonly checkpoint: string;
  readonly targetAt: string;
  readonly actualObservedAt: string;
  readonly providerTimestamp: string | null;
  readonly receivedAt: string;
  readonly markChangeDollars: number | null;
  readonly evidenceClass: 'MARKET_OBSERVED' | 'MODELED_RESEARCH' | 'BROKER_ACTUAL';
  readonly evidenceId: string;
}

export interface ContractPathMaturationReceipt {
  readonly contractVersion: typeof contractPathLabelMaturationVersion;
  readonly subjectId: string;
  readonly decisionAt: string;
  readonly state: ContractPathMaturationState;
  readonly labelAvailableAt: string | null;
  readonly observationCount: number;
  readonly identifiableObservationCount: number;
  readonly requiredCheckpointCount: number;
  readonly observedRequiredCheckpointCount: number;
  readonly mfeDollars: number | null;
  readonly maeDollars: number | null;
  readonly peakObservedAt: string | null;
  readonly worstObservedAt: string | null;
  readonly givebackDollars: number | null;
  readonly timeToPeakSeconds: number | null;
  readonly capitalDays: number | null;
  readonly evidenceIds: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly marketMarkOnly: boolean;
  readonly brokerAuthority: false;
}

const ID = /^[A-Za-z0-9_.:@/-]{1,512}$/;

function time(value: string, reason: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(reason);
  return parsed;
}

export function matureContractPath(input: {
  readonly subjectId: string;
  readonly decisionAt: string;
  readonly requiredCheckpoints: readonly string[];
  readonly points: readonly ContractPathMarkPoint[];
  readonly terminalState?: 'RIGHT_CENSORED' | 'NOT_IDENTIFIABLE' | 'INVALID' | null;
  readonly terminalReasonCode?: string | null;
}): ContractPathMaturationReceipt {
  if (!ID.test(input.subjectId) || input.requiredCheckpoints.length === 0
    || new Set(input.requiredCheckpoints).size !== input.requiredCheckpoints.length) {
    throw new Error('CONTRACT_PATH_MATURATION_IDENTITY_INVALID');
  }
  const decisionAtMs = time(input.decisionAt, 'CONTRACT_PATH_MATURATION_DECISION_TIME_INVALID');
  const ordered = [...input.points].sort((a, b) => a.actualObservedAt.localeCompare(b.actualObservedAt));
  const evidenceIds = new Set<string>();
  for (const point of ordered) {
    if (!ID.test(point.evidenceId) || evidenceIds.has(point.evidenceId)) {
      throw new Error('CONTRACT_PATH_MATURATION_EVIDENCE_ID_INVALID');
    }
    evidenceIds.add(point.evidenceId);
    const targetAtMs = time(point.targetAt, 'CONTRACT_PATH_MATURATION_TARGET_TIME_INVALID');
    const actualAtMs = time(point.actualObservedAt, 'CONTRACT_PATH_MATURATION_ACTUAL_TIME_INVALID');
    const receivedAtMs = time(point.receivedAt, 'CONTRACT_PATH_MATURATION_RECEIVED_TIME_INVALID');
    const providerAtMs = point.providerTimestamp === null ? null
      : time(point.providerTimestamp, 'CONTRACT_PATH_MATURATION_PROVIDER_TIME_INVALID');
    if (targetAtMs < decisionAtMs || actualAtMs < targetAtMs || receivedAtMs > actualAtMs
      || providerAtMs !== null && providerAtMs > receivedAtMs) {
      throw new Error('CONTRACT_PATH_MATURATION_TIME_TRAVEL');
    }
    if (point.markChangeDollars !== null && !Number.isFinite(point.markChangeDollars)) {
      throw new Error('CONTRACT_PATH_MATURATION_MARK_INVALID');
    }
  }
  if (ordered.length === 0) {
    const state = input.terminalState ?? 'PENDING';
    return {
      contractVersion: contractPathLabelMaturationVersion,
      subjectId: input.subjectId,
      decisionAt: new Date(decisionAtMs).toISOString(),
      state,
      labelAvailableAt: null,
      observationCount: 0,
      identifiableObservationCount: 0,
      requiredCheckpointCount: input.requiredCheckpoints.length,
      observedRequiredCheckpointCount: 0,
      mfeDollars: null,
      maeDollars: null,
      peakObservedAt: null,
      worstObservedAt: null,
      givebackDollars: null,
      timeToPeakSeconds: null,
      capitalDays: null,
      evidenceIds: [],
      reasonCodes: input.terminalReasonCode === null || input.terminalReasonCode === undefined
        ? [] : [input.terminalReasonCode],
      marketMarkOnly: true,
      brokerAuthority: false,
    };
  }
  if (input.terminalState !== null && input.terminalState !== undefined) {
    throw new Error('CONTRACT_PATH_MATURATION_TERMINAL_WITH_OBSERVATIONS');
  }
  const identifiable = ordered.filter((point) => point.markChangeDollars !== null);
  const observedRequired = new Set(ordered.map((point) => point.checkpoint)
    .filter((checkpoint) => input.requiredCheckpoints.includes(checkpoint))).size;
  const labelAvailableAtMs = Math.max(...ordered.map((point) => Date.parse(point.actualObservedAt)));
  if (identifiable.length === 0) {
    return {
      contractVersion: contractPathLabelMaturationVersion,
      subjectId: input.subjectId,
      decisionAt: new Date(decisionAtMs).toISOString(),
      state: 'NOT_IDENTIFIABLE',
      labelAvailableAt: new Date(labelAvailableAtMs).toISOString(),
      observationCount: ordered.length,
      identifiableObservationCount: 0,
      requiredCheckpointCount: input.requiredCheckpoints.length,
      observedRequiredCheckpointCount: observedRequired,
      mfeDollars: null,
      maeDollars: null,
      peakObservedAt: null,
      worstObservedAt: null,
      givebackDollars: null,
      timeToPeakSeconds: null,
      capitalDays: (labelAvailableAtMs - decisionAtMs) / 86_400_000,
      evidenceIds: [...evidenceIds],
      reasonCodes: ['MARK_PATH_NOT_IDENTIFIABLE'],
      marketMarkOnly: true,
      brokerAuthority: false,
    };
  }
  const peak = identifiable.reduce((best, point) => (point.markChangeDollars as number)
    > (best.markChangeDollars as number) ? point : best);
  const worst = identifiable.reduce((best, point) => (point.markChangeDollars as number)
    < (best.markChangeDollars as number) ? point : best);
  const last = identifiable[identifiable.length - 1];
  if (last === undefined) throw new Error('CONTRACT_PATH_MATURATION_INTERNAL_EMPTY');
  const evidenceClasses = new Set(ordered.map((point) => point.evidenceClass));
  const complete = observedRequired === input.requiredCheckpoints.length;
  const state: ContractPathMaturationState = !complete ? 'PARTIAL'
    : evidenceClasses.size === 1 && evidenceClasses.has('BROKER_ACTUAL') ? 'MATURED_FACTUAL'
      : evidenceClasses.size === 1 && evidenceClasses.has('MODELED_RESEARCH') ? 'MATURED_MODELED'
        : 'MATURED_MARK_ONLY';
  return {
    contractVersion: contractPathLabelMaturationVersion,
    subjectId: input.subjectId,
    decisionAt: new Date(decisionAtMs).toISOString(),
    state,
    labelAvailableAt: new Date(labelAvailableAtMs).toISOString(),
    observationCount: ordered.length,
    identifiableObservationCount: identifiable.length,
    requiredCheckpointCount: input.requiredCheckpoints.length,
    observedRequiredCheckpointCount: observedRequired,
    mfeDollars: peak.markChangeDollars,
    maeDollars: worst.markChangeDollars,
    peakObservedAt: new Date(Date.parse(peak.actualObservedAt)).toISOString(),
    worstObservedAt: new Date(Date.parse(worst.actualObservedAt)).toISOString(),
    givebackDollars: (peak.markChangeDollars as number) - (last.markChangeDollars as number),
    timeToPeakSeconds: (Date.parse(peak.actualObservedAt) - decisionAtMs) / 1000,
    capitalDays: (labelAvailableAtMs - decisionAtMs) / 86_400_000,
    evidenceIds: [...evidenceIds],
    reasonCodes: complete ? [] : ['REQUIRED_HORIZON_PENDING'],
    marketMarkOnly: state !== 'MATURED_FACTUAL',
    brokerAuthority: false,
  };
}
