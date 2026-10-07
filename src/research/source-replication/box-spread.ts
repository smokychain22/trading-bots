export const boxSpreadScannerVersion = 'theta-box-spread-arbitrage-research-v1' as const;

export interface BoxLegQuote {
  readonly symbol: string;
  readonly optionType: 'CALL' | 'PUT';
  readonly side: 'BUY' | 'SELL';
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  readonly bid: number;
  readonly ask: number;
  readonly exerciseStyle: 'AMERICAN' | 'EUROPEAN' | 'UNKNOWN';
}

export interface BoxSpreadScanInput {
  readonly candidateId: string;
  readonly observedAt: string;
  readonly providerKnownAt: string;
  readonly daysToExpiry: number;
  readonly annualRiskFreeRate: number;
  readonly modeledCommissionsAndFeesUsd: number | null;
  readonly modeledSlippageUsd: number | null;
  readonly nativeAtomicMultiLegSupported: boolean;
  readonly dividendOrEarlyExerciseRiskKnown: boolean;
  readonly brokerCapitalRequirementUsd: number | null;
  readonly legs: readonly BoxLegQuote[];
}

export interface BoxSpreadScanReceipt {
  readonly version: typeof boxSpreadScannerVersion;
  readonly candidateId: string;
  readonly state: 'SCANNED' | 'INVALID' | 'PIT_UNSAFE';
  readonly reasons: readonly string[];
  readonly strikeLow: number | null;
  readonly strikeHigh: number | null;
  readonly strikeWidth: number | null;
  readonly terminalPayoffUsd: number | null;
  readonly fairPresentValueUsd: number | null;
  readonly executableDebitUsd: number | null;
  readonly allInDebitUsd: number | null;
  readonly edgeVsFairValueUsd: number | null;
  readonly terminalProfitUsd: number | null;
  readonly impliedAnnualFinancingRate: number | null;
  readonly practicalRisks: readonly string[];
  readonly scannerVerdict: 'POSITIVE_AFTER_MODELED_COSTS' | 'NO_POSITIVE_EDGE' | 'COSTS_UNKNOWN' | 'INVALID';
  readonly authority: 'SCANNER_ONLY_RESEARCH';
  readonly executionAuthorized: false;
  readonly riskFreeClaimAllowed: false;
}

const finite = (value: number): boolean => Number.isFinite(value);
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export function scanBoxSpread(input: BoxSpreadScanInput): BoxSpreadScanReceipt {
  const reasons: string[] = [];
  const observed = Date.parse(input.observedAt); const known = Date.parse(input.providerKnownAt);
  if (!finite(observed) || !finite(known)) reasons.push('INVALID_TIMESTAMP');
  if (finite(observed) && finite(known) && known > observed) reasons.push('PROVIDER_EVIDENCE_KNOWN_AFTER_OBSERVATION');
  if (input.legs.length !== 4) reasons.push('BOX_REQUIRES_FOUR_LEGS');
  if (!finite(input.daysToExpiry) || input.daysToExpiry <= 0 || !finite(input.annualRiskFreeRate)) reasons.push('INVALID_RATE_OR_EXPIRY');
  if (input.modeledCommissionsAndFeesUsd !== null
    && (!finite(input.modeledCommissionsAndFeesUsd) || input.modeledCommissionsAndFeesUsd < 0)) reasons.push('INVALID_FEES');
  if (input.modeledSlippageUsd !== null
    && (!finite(input.modeledSlippageUsd) || input.modeledSlippageUsd < 0)) reasons.push('INVALID_SLIPPAGE');
  for (const leg of input.legs) if (!leg.symbol || !finite(leg.strike) || leg.strike <= 0
    || !Number.isInteger(leg.multiplier) || leg.multiplier <= 0 || !finite(leg.bid) || !finite(leg.ask)
    || leg.bid < 0 || leg.ask < leg.bid) reasons.push('INVALID_LEG');
  if (new Set(input.legs.map((leg) => leg.symbol)).size !== input.legs.length) reasons.push('DUPLICATE_LEG_IDENTITY');
  if (new Set(input.legs.map((leg) => leg.expiration)).size !== 1) reasons.push('EXPIRATION_MISMATCH');
  if (new Set(input.legs.map((leg) => leg.multiplier)).size !== 1) reasons.push('MULTIPLIER_MISMATCH');
  const strikes = [...new Set(input.legs.map((leg) => leg.strike))].sort((left, right) => left - right);
  if (strikes.length !== 2) reasons.push('BOX_REQUIRES_TWO_STRIKES');
  const low = strikes[0] ?? null; const high = strikes[1] ?? null;
  const legAt = (type: BoxLegQuote['optionType'], side: BoxLegQuote['side'], strike: number | null) =>
    input.legs.find((leg) => leg.optionType === type && leg.side === side && leg.strike === strike);
  if (low !== null && high !== null && (!legAt('CALL', 'BUY', low) || !legAt('CALL', 'SELL', high)
    || !legAt('PUT', 'BUY', high) || !legAt('PUT', 'SELL', low))) reasons.push('INVALID_LONG_BOX_GEOMETRY');
  const pit = reasons.includes('PROVIDER_EVIDENCE_KNOWN_AFTER_OBSERVATION');
  const base = { version: boxSpreadScannerVersion, candidateId: input.candidateId,
    state: pit ? 'PIT_UNSAFE' as const : 'INVALID' as const, reasons: [...new Set(reasons)].sort(),
    strikeLow: null, strikeHigh: null, strikeWidth: null, terminalPayoffUsd: null, fairPresentValueUsd: null,
    executableDebitUsd: null, allInDebitUsd: null, edgeVsFairValueUsd: null, terminalProfitUsd: null,
    impliedAnnualFinancingRate: null, practicalRisks: [] as string[], scannerVerdict: 'INVALID' as const,
    authority: 'SCANNER_ONLY_RESEARCH' as const, executionAuthorized: false as const, riskFreeClaimAllowed: false as const };
  if (reasons.length > 0 || low === null || high === null) return base;
  const multiplier = input.legs[0]?.multiplier as number;
  const width = high - low; const terminal = width * multiplier; const years = input.daysToExpiry / 365;
  const fair = terminal * Math.exp(-input.annualRiskFreeRate * years);
  const debit = input.legs.reduce((total, leg) => total + (leg.side === 'BUY' ? leg.ask : -leg.bid) * leg.multiplier, 0);
  const costsKnown = input.modeledCommissionsAndFeesUsd !== null && input.modeledSlippageUsd !== null;
  const allIn = costsKnown ? debit + (input.modeledCommissionsAndFeesUsd as number) + (input.modeledSlippageUsd as number) : null;
  const edge = allIn === null ? null : fair - allIn;
  const practicalRisks = [
    ...(input.nativeAtomicMultiLegSupported ? [] : ['ATOMIC_MULTI_LEG_EXECUTION_UNAVAILABLE']),
    ...(input.legs.some((leg) => leg.exerciseStyle !== 'EUROPEAN') ? ['AMERICAN_OR_UNKNOWN_EARLY_EXERCISE_RISK'] : []),
    ...(input.dividendOrEarlyExerciseRiskKnown ? [] : ['DIVIDEND_OR_EARLY_EXERCISE_EVIDENCE_UNKNOWN']),
    ...(input.brokerCapitalRequirementUsd === null ? ['BROKER_CAPITAL_REQUIREMENT_UNKNOWN'] : []),
    'PARTIAL_FILL_RISK_REQUIRES_ATOMIC_EXECUTION', 'PIN_AND_EXPIRY_OPERATIONAL_RISK',
  ];
  return { ...base, state: 'SCANNED', reasons: [], strikeLow: low, strikeHigh: high, strikeWidth: width,
    terminalPayoffUsd: money(terminal), fairPresentValueUsd: money(fair), executableDebitUsd: money(debit),
    allInDebitUsd: allIn === null ? null : money(allIn), edgeVsFairValueUsd: edge === null ? null : money(edge),
    terminalProfitUsd: allIn === null ? null : money(terminal - allIn),
    impliedAnnualFinancingRate: debit > 0 && debit < terminal ? Math.log(terminal / debit) / years : null,
    practicalRisks, scannerVerdict: !costsKnown ? 'COSTS_UNKNOWN' : (edge as number) > 0
      ? 'POSITIVE_AFTER_MODELED_COSTS' : 'NO_POSITIVE_EDGE' };
}
