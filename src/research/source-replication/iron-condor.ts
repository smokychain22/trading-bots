export const ironCondorResearchVersion = 'theta-iron-condor-range-v1' as const;

export interface CondorLegQuote {
  readonly symbol: string;
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly bid: number;
  readonly ask: number;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
}

export interface IronCondorCandidateInput {
  readonly candidateId: string;
  readonly observedAt: string;
  readonly providerKnownAt: string;
  readonly spot: number;
  readonly longPut: CondorLegQuote;
  readonly shortPut: CondorLegQuote;
  readonly shortCall: CondorLegQuote;
  readonly longCall: CondorLegQuote;
  readonly modeledOpeningCostsUsd: number | null;
}

export interface IronCondorEconomicsReceipt {
  readonly version: typeof ironCondorResearchVersion;
  readonly candidateId: string;
  readonly state: 'READY' | 'INVALID' | 'PIT_UNSAFE';
  readonly reasons: readonly string[];
  readonly expiration: string | null;
  readonly multiplier: number | null;
  readonly netCreditPerShare: number | null;
  readonly grossCreditUsd: number | null;
  readonly netCreditAfterModeledCostsUsd: number | null;
  readonly maxProfitUsd: number | null;
  readonly lowerMaxLossUsd: number | null;
  readonly upperMaxLossUsd: number | null;
  readonly maximumLossUsd: number | null;
  readonly lowerBreakeven: number | null;
  readonly upperBreakeven: number | null;
  readonly putWingWidth: number | null;
  readonly callWingWidth: number | null;
  readonly aggregateGreeks: {
    readonly delta: number | null;
    readonly gamma: number | null;
    readonly theta: number | null;
    readonly vega: number | null;
  };
  readonly authority: 'RESEARCH_ONLY';
  readonly executionAuthorized: false;
  readonly profitabilityStatus: 'EMPIRICALLY_UNPROVEN';
}

export interface IronCondorExitObservation {
  readonly observedAt: string;
  readonly providerKnownAt: string;
  readonly longPutBid: number;
  readonly shortPutAsk: number;
  readonly shortCallAsk: number;
  readonly longCallBid: number;
  readonly modeledClosingCostsUsd: number | null;
}

export interface IronCondorManagementPolicy {
  readonly version: string;
  readonly mode: 'TIME_EXIT' | 'PROFIT_TARGET';
  readonly exitAtOrAfter: string | null;
  readonly profitCaptureFraction: number | null;
}

export interface IronCondorManagementReceipt {
  readonly version: typeof ironCondorResearchVersion;
  readonly policyVersion: string;
  readonly state: 'COMPLETE' | 'BLOCKED_MISSING_POLICY' | 'NO_QUALIFYING_EXIT' | 'INVALID';
  readonly reason: string | null;
  readonly exitAt: string | null;
  readonly closeDebitUsd: number | null;
  readonly grossPnlUsd: number | null;
  readonly netPnlUsd: number | null;
  readonly authority: 'RESEARCH_ONLY';
  readonly executionAuthorized: false;
}

const finite = (value: number): boolean => Number.isFinite(value);
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const validQuote = (leg: CondorLegQuote): boolean => finite(leg.strike) && leg.strike > 0
  && Number.isInteger(leg.multiplier) && leg.multiplier > 0 && finite(leg.bid) && finite(leg.ask)
  && leg.bid >= 0 && leg.ask >= leg.bid;

export function buildIronCondorEconomics(input: IronCondorCandidateInput): IronCondorEconomicsReceipt {
  const reasons: string[] = [];
  const legs = [input.longPut, input.shortPut, input.shortCall, input.longCall];
  const observed = Date.parse(input.observedAt); const known = Date.parse(input.providerKnownAt);
  if (!finite(observed) || !finite(known)) reasons.push('INVALID_TIMESTAMP');
  if (finite(observed) && finite(known) && known > observed) reasons.push('PROVIDER_EVIDENCE_KNOWN_AFTER_OBSERVATION');
  if (!finite(input.spot) || input.spot <= 0 || !legs.every(validQuote)) reasons.push('INVALID_MARKET_EVIDENCE');
  if (!(input.longPut.strike < input.shortPut.strike && input.shortPut.strike < input.shortCall.strike
    && input.shortCall.strike < input.longCall.strike)) reasons.push('INVALID_IRON_CONDOR_GEOMETRY');
  const expirations = new Set(legs.map((leg) => leg.expiration));
  const multipliers = new Set(legs.map((leg) => leg.multiplier));
  const symbols = new Set(legs.map((leg) => leg.symbol));
  if (expirations.size !== 1) reasons.push('EXPIRATION_MISMATCH');
  if (multipliers.size !== 1) reasons.push('MULTIPLIER_MISMATCH');
  if (symbols.size !== 4) reasons.push('DUPLICATE_LEG_IDENTITY');
  if (input.modeledOpeningCostsUsd !== null
    && (!finite(input.modeledOpeningCostsUsd) || input.modeledOpeningCostsUsd < 0)) reasons.push('INVALID_OPENING_COST');
  const pit = reasons.includes('PROVIDER_EVIDENCE_KNOWN_AFTER_OBSERVATION');
  const empty = { version: ironCondorResearchVersion, candidateId: input.candidateId,
    state: pit ? 'PIT_UNSAFE' as const : 'INVALID' as const, reasons: [...new Set(reasons)].sort(),
    expiration: null, multiplier: null, netCreditPerShare: null, grossCreditUsd: null,
    netCreditAfterModeledCostsUsd: null, maxProfitUsd: null, lowerMaxLossUsd: null, upperMaxLossUsd: null,
    maximumLossUsd: null, lowerBreakeven: null, upperBreakeven: null, putWingWidth: null, callWingWidth: null,
    aggregateGreeks: { delta: null, gamma: null, theta: null, vega: null },
    authority: 'RESEARCH_ONLY' as const, executionAuthorized: false as const,
    profitabilityStatus: 'EMPIRICALLY_UNPROVEN' as const };
  if (reasons.length > 0) return empty;
  const multiplier = input.longPut.multiplier;
  const credit = money(input.shortPut.bid + input.shortCall.bid - input.longPut.ask - input.longCall.ask);
  if (credit <= 0) return { ...empty, state: 'INVALID', reasons: ['NON_POSITIVE_EXECUTABLE_CREDIT'] };
  const putWidth = input.shortPut.strike - input.longPut.strike;
  const callWidth = input.longCall.strike - input.shortCall.strike;
  const grossCredit = credit * multiplier;
  const greek = (name: 'delta' | 'gamma' | 'theta' | 'vega'): number | null => {
    const values = legs.map((leg) => leg[name]);
    if (values.some((value) => value === null || !finite(value as number))) return null;
    return ((input.longPut[name] as number) - (input.shortPut[name] as number)
      - (input.shortCall[name] as number) + (input.longCall[name] as number)) * multiplier;
  };
  return { ...empty, state: 'READY', reasons: [], expiration: input.longPut.expiration, multiplier,
    netCreditPerShare: credit, grossCreditUsd: money(grossCredit),
    netCreditAfterModeledCostsUsd: input.modeledOpeningCostsUsd === null ? null : money(grossCredit - input.modeledOpeningCostsUsd),
    maxProfitUsd: money(grossCredit), lowerMaxLossUsd: money(putWidth * multiplier - grossCredit),
    upperMaxLossUsd: money(callWidth * multiplier - grossCredit),
    maximumLossUsd: money(Math.max(putWidth, callWidth) * multiplier - grossCredit),
    lowerBreakeven: input.shortPut.strike - credit, upperBreakeven: input.shortCall.strike + credit,
    putWingWidth: putWidth, callWingWidth: callWidth,
    aggregateGreeks: { delta: greek('delta'), gamma: greek('gamma'), theta: greek('theta'), vega: greek('vega') } };
}

export function replayIronCondorManagement(entry: IronCondorEconomicsReceipt,
  observations: readonly IronCondorExitObservation[], policy: IronCondorManagementPolicy): IronCondorManagementReceipt {
  const base = { version: ironCondorResearchVersion, policyVersion: policy.version,
    authority: 'RESEARCH_ONLY' as const, executionAuthorized: false as const };
  if (entry.state !== 'READY' || entry.grossCreditUsd === null || entry.multiplier === null) return {
    ...base, state: 'INVALID', reason: 'ENTRY_ECONOMICS_NOT_READY', exitAt: null, closeDebitUsd: null,
    grossPnlUsd: null, netPnlUsd: null };
  if (policy.mode === 'TIME_EXIT' && (policy.exitAtOrAfter === null || !finite(Date.parse(policy.exitAtOrAfter)))) return {
    ...base, state: 'BLOCKED_MISSING_POLICY', reason: 'TIME_EXIT_REQUIRED', exitAt: null,
    closeDebitUsd: null, grossPnlUsd: null, netPnlUsd: null };
  if (policy.mode === 'PROFIT_TARGET' && (policy.profitCaptureFraction === null
    || !finite(policy.profitCaptureFraction) || policy.profitCaptureFraction <= 0 || policy.profitCaptureFraction >= 1)) return {
    ...base, state: 'BLOCKED_MISSING_POLICY', reason: 'PROFIT_CAPTURE_FRACTION_REQUIRED', exitAt: null,
    closeDebitUsd: null, grossPnlUsd: null, netPnlUsd: null };
  const sorted = [...observations].sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  let selected: { observation: IronCondorExitObservation; debit: number; grossPnl: number } | null = null;
  for (const observation of sorted) {
    if (Date.parse(observation.providerKnownAt) > Date.parse(observation.observedAt)) continue;
    const quotes = [observation.longPutBid, observation.shortPutAsk, observation.shortCallAsk, observation.longCallBid];
    if (quotes.some((value) => !finite(value) || value < 0)) continue;
    const debit = Math.max(0, observation.shortPutAsk + observation.shortCallAsk
      - observation.longPutBid - observation.longCallBid) * entry.multiplier;
    const grossPnl = entry.grossCreditUsd - debit;
    const trigger = policy.mode === 'TIME_EXIT' ? observation.observedAt >= (policy.exitAtOrAfter as string)
      : grossPnl >= entry.grossCreditUsd * (policy.profitCaptureFraction as number);
    if (trigger) { selected = { observation, debit, grossPnl }; break; }
  }
  if (selected === null) return { ...base, state: 'NO_QUALIFYING_EXIT', reason: 'POLICY_TRIGGER_NOT_REACHED',
    exitAt: null, closeDebitUsd: null, grossPnlUsd: null, netPnlUsd: null };
  const costs = selected.observation.modeledClosingCostsUsd;
  return { ...base, state: 'COMPLETE', reason: null, exitAt: selected.observation.observedAt,
    closeDebitUsd: money(selected.debit), grossPnlUsd: money(selected.grossPnl),
    netPnlUsd: costs === null || entry.netCreditAfterModeledCostsUsd === null ? null
      : money(entry.netCreditAfterModeledCostsUsd - selected.debit - costs) };
}
