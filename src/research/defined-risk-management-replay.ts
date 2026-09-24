import { runProfitTakingReplay, type ProfitReplayInput } from './profit-taking-replay.js';

export const definedRiskManagementReplayVersion = 'theta-defined-risk-management-replay-v1' as const;

export interface DefinedRiskCloseLegObservation {
  readonly occSymbol: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteAt: string | null;
  readonly receivedAt: string | null;
  readonly validThrough: string | null;
  readonly authority: 'ALPACA_EXECUTABLE_MARKET' | 'UNQUALIFIED';
}

export interface DefinedRiskManagementObservation {
  readonly evidenceId: string;
  readonly decisionAt: string;
  readonly dte: number;
  /** Buy-to-close the short leg at ask. */
  readonly shortLeg: DefinedRiskCloseLegObservation;
  /** Sell-to-close the protective long leg at bid. */
  readonly longLeg: DefinedRiskCloseLegObservation;
  readonly closeFeesDollars: number | null;
  readonly adverseSlippageDollars: number | null;
  readonly hardRiskExitRequired: boolean | null;
  readonly hardRiskAvailableAt: string | null;
  readonly eventExitRequired: boolean | null;
  readonly eventAvailableAt: string | null;
  readonly eventValidThrough: string | null;
  readonly forecast: ProfitReplayInput['observations'][number]['forecast'];
}

export interface DefinedRiskManagementReplayInput {
  readonly sourceSha: string;
  readonly sourceManifestHash: string;
  readonly episodeId: string;
  readonly chainId: string;
  readonly evidenceClass: ProfitReplayInput['evidenceClass'];
  readonly entryAt: string;
  readonly entryNetCreditPerShare: number;
  readonly multiplier: number;
  readonly quantity: number;
  readonly entryFeesDollars: number;
  readonly policy: ProfitReplayInput['policy'];
  readonly observations: readonly DefinedRiskManagementObservation[];
}

export type DefinedRiskExpirationState =
  | 'BOTH_OTM_RETAIN_PREMIUM'
  | 'SHORT_ITM_LONG_OTM_ASSIGNMENT_WITH_PROTECTION'
  | 'BOTH_ITM_DEFINED_MAX_LOSS_REGION'
  | 'PIN_RISK'
  | 'UNKNOWN';

export interface DefinedRiskExpirationAssessment {
  readonly state: DefinedRiskExpirationState;
  readonly shortLegAssignmentPossible: boolean | null;
  readonly longProtectionEconomicallyRelevant: boolean | null;
  readonly reason: string;
  readonly brokerAuthority: false;
}

function finiteNonnegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function parsedTimestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function closeObservation(input: DefinedRiskManagementObservation, multiplier: number, quantity: number):
ProfitReplayInput['observations'][number] {
  const short = input.shortLeg;
  const long = input.longLeg;
  const shortQuoteAt = parsedTimestamp(short.quoteAt);
  const longQuoteAt = parsedTimestamp(long.quoteAt);
  const shortReceivedAt = parsedTimestamp(short.receivedAt);
  const longReceivedAt = parsedTimestamp(long.receivedAt);
  const shortValidThrough = parsedTimestamp(short.validThrough);
  const longValidThrough = parsedTimestamp(long.validThrough);
  const timestampsPresent = shortQuoteAt !== null && longQuoteAt !== null && shortReceivedAt !== null
    && longReceivedAt !== null && shortValidThrough !== null && longValidThrough !== null;
  const quotesValid = finiteNonnegative(short.ask) && finiteNonnegative(short.bid)
    && finiteNonnegative(long.ask) && finiteNonnegative(long.bid)
    && (short.bid as number) <= (short.ask as number) && (long.bid as number) <= (long.ask as number);
  const closeDebitPerShare = quotesValid ? (short.ask as number) - (long.bid as number) : null;
  const executable = short.authority === 'ALPACA_EXECUTABLE_MARKET'
    && long.authority === 'ALPACA_EXECUTABLE_MARKET' && timestampsPresent
    && closeDebitPerShare !== null && closeDebitPerShare >= 0;
  const quoteAt = executable
    ? new Date(Math.max(shortQuoteAt as number, longQuoteAt as number)).toISOString() : null;
  const receivedAt = executable
    ? new Date(Math.max(shortReceivedAt as number, longReceivedAt as number)).toISOString() : null;
  const validThrough = executable
    ? new Date(Math.min(shortValidThrough as number, longValidThrough as number)).toISOString() : null;
  const timestampsValid = quoteAt !== null && receivedAt !== null && validThrough !== null
    && Number.isFinite(Date.parse(quoteAt)) && Number.isFinite(Date.parse(receivedAt))
    && Number.isFinite(Date.parse(validThrough));
  return {
    evidenceId: input.evidenceId, decisionAt: input.decisionAt, dte: input.dte,
    closeAskDollars: executable && timestampsValid ? (closeDebitPerShare as number) * multiplier * quantity : null,
    closeFeesDollars: input.closeFeesDollars,
    adverseSlippageDollars: input.adverseSlippageDollars,
    quoteAt: timestampsValid ? quoteAt : null,
    quoteReceivedAt: timestampsValid ? receivedAt : null,
    quoteValidThrough: timestampsValid ? validThrough : null,
    quoteAuthority: executable && timestampsValid ? 'ALPACA_EXECUTABLE_MARKET' : 'UNQUALIFIED',
    hardRiskExitRequired: input.hardRiskExitRequired,
    eventExitRequired: input.eventExitRequired,
    riskAvailableAt: input.hardRiskAvailableAt,
    eventAvailableAt: input.eventAvailableAt,
    eventValidThrough: input.eventValidThrough,
    forecast: input.forecast,
  };
}

/**
 * Adapts a real two-leg spread path to the existing 17-policy replay engine.
 * The short ask and protective-long bid are used, never midpoint marks. The
 * output remains a counterfactual estimate and has no broker authority.
 */
export function runDefinedRiskManagementReplay(input: DefinedRiskManagementReplayInput) {
  if (!Number.isFinite(input.entryNetCreditPerShare) || input.entryNetCreditPerShare <= 0) {
    throw new Error('DEFINED_RISK_ENTRY_CREDIT_INVALID');
  }
  if (!Number.isFinite(input.multiplier) || input.multiplier <= 0 || !Number.isInteger(input.multiplier)) {
    throw new Error('DEFINED_RISK_MULTIPLIER_INVALID');
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error('DEFINED_RISK_QUANTITY_INVALID');
  const base = runProfitTakingReplay({
    version: 'theta-profit-taking-replay-input-v1', sourceSha: input.sourceSha,
    sourceManifestHash: input.sourceManifestHash, episodeId: input.episodeId, chainId: input.chainId,
    evidenceClass: input.evidenceClass, entryAt: input.entryAt,
    entryCreditDollars: input.entryNetCreditPerShare * input.multiplier * input.quantity,
    entryFeesDollars: input.entryFeesDollars, policy: input.policy,
    observations: input.observations.map((observation) => closeObservation(observation, input.multiplier, input.quantity)),
  });
  return {
    contractVersion: definedRiskManagementReplayVersion,
    strategy: 'THETA_DEFINED_RISK' as const,
    closeSemantics: 'BUY_SHORT_AT_ASK_PLUS_SELL_LONG_AT_BID_PLUS_EXPLICIT_FEES_AND_SLIPPAGE' as const,
    replay: base,
    brokerAuthority: false as const,
  };
}

export function assessDefinedRiskExpiration(input: {
  readonly spot: number | null;
  readonly shortStrike: number;
  readonly longStrike: number;
  readonly pinBufferDollars: number;
}): DefinedRiskExpirationAssessment {
  if (input.spot === null || !Number.isFinite(input.spot) || input.spot <= 0
    || !Number.isFinite(input.shortStrike) || !Number.isFinite(input.longStrike)
    || !(input.shortStrike > input.longStrike) || !Number.isFinite(input.pinBufferDollars)
    || input.pinBufferDollars < 0) {
    return { state: 'UNKNOWN', shortLegAssignmentPossible: null, longProtectionEconomicallyRelevant: null,
      reason: 'EXPIRATION_INPUT_INVALID_OR_UNKNOWN', brokerAuthority: false };
  }
  if (Math.abs(input.spot - input.shortStrike) <= input.pinBufferDollars
    || Math.abs(input.spot - input.longStrike) <= input.pinBufferDollars) {
    return { state: 'PIN_RISK', shortLegAssignmentPossible: null, longProtectionEconomicallyRelevant: null,
      reason: 'SPOT_WITHIN_VERSIONED_PIN_BUFFER_OF_A_LEG', brokerAuthority: false };
  }
  if (input.spot > input.shortStrike) {
    return { state: 'BOTH_OTM_RETAIN_PREMIUM', shortLegAssignmentPossible: false,
      longProtectionEconomicallyRelevant: false, reason: 'SPOT_ABOVE_SHORT_PUT_STRIKE', brokerAuthority: false };
  }
  if (input.spot > input.longStrike) {
    return { state: 'SHORT_ITM_LONG_OTM_ASSIGNMENT_WITH_PROTECTION', shortLegAssignmentPossible: true,
      longProtectionEconomicallyRelevant: true,
      reason: 'SHORT_PUT_ITM_WHILE_LONG_PUT_REMAINS_OTM', brokerAuthority: false };
  }
  return { state: 'BOTH_ITM_DEFINED_MAX_LOSS_REGION', shortLegAssignmentPossible: true,
    longProtectionEconomicallyRelevant: true, reason: 'SPOT_BELOW_LONG_PUT_STRIKE', brokerAuthority: false };
}
