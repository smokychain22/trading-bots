export type TrustedOptionQuoteAuthority =
  | 'ALPACA_OPRA_CONSOLIDATED_BBO'
  | 'OPTIONOMICS_TRUSTED_TWO_SIDED_QUOTE';

export type TrustedOptionQuoteProvider = 'ALPACA' | 'OPTIONOMICS';

export interface TrustedOptionQuoteCandidate {
  readonly provider: TrustedOptionQuoteProvider;
  readonly operationAlias: string;
  readonly contractSymbol: string;
  readonly expectedContractSymbol: string;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly providerTimestamp: string | null;
  readonly ingestionTimestamp: string;
  readonly asOf: string;
  readonly maximumAgeMs: number;
  readonly units: 'USD_PER_SHARE';
  readonly schemaVersion: string;
  readonly responseHash: string;
  readonly quality: 'GOOD' | 'DEGRADED' | 'STALE' | 'UNKNOWN' | 'INVALID' | 'NOT_ENTITLED';
  readonly provenance: {
    readonly documentedTwoSidedQuoteContract: boolean;
    readonly documentedForOrderPricing: boolean;
    readonly feed: 'OPRA' | 'INDICATIVE' | 'UNKNOWN' | null;
    readonly consolidatedNbboClaimProven: boolean;
  };
}

export interface TrustedOptionQuoteAssessment {
  readonly ready: boolean;
  readonly authority: TrustedOptionQuoteAuthority | null;
  readonly blockers: readonly string[];
}

const isPositiveFinite = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

/**
 * Qualifies price evidence without assuming that a provider name establishes
 * execution quality. The caller must supply evidence from a documented,
 * authenticated response. This function never upgrades indicative or
 * undocumented data.
 */
export function assessTrustedOptionQuote(
  candidate: TrustedOptionQuoteCandidate,
  now: string,
): TrustedOptionQuoteAssessment {
  const blockers: string[] = [];
  const providerTime = Date.parse(candidate.providerTimestamp ?? '');
  const ingestionTime = Date.parse(candidate.ingestionTimestamp);
  const asOf = Date.parse(candidate.asOf);
  const currentTime = Date.parse(now);

  if (candidate.contractSymbol !== candidate.expectedContractSymbol) blockers.push('CONTRACT_IDENTITY_MISMATCH');
  if (!isPositiveFinite(candidate.bid) || !isPositiveFinite(candidate.ask)) blockers.push('TWO_SIDED_QUOTE_MISSING');
  else if (candidate.bid > candidate.ask) blockers.push('QUOTE_CROSSED');
  if (candidate.quality !== 'GOOD') blockers.push(`QUOTE_QUALITY_${candidate.quality}`);
  if (!candidate.provenance.documentedTwoSidedQuoteContract) blockers.push('TWO_SIDED_QUOTE_CONTRACT_NOT_DOCUMENTED');
  if (!candidate.provenance.documentedForOrderPricing) blockers.push('ORDER_PRICING_USE_NOT_DOCUMENTED');
  if (!candidate.operationAlias.trim()) blockers.push('OPERATION_ALIAS_MISSING');
  if (!candidate.schemaVersion.trim()) blockers.push('SCHEMA_VERSION_MISSING');
  if (!candidate.responseHash.trim()) blockers.push('RESPONSE_HASH_MISSING');
  if (![providerTime, ingestionTime, asOf, currentTime].every(Number.isFinite)) blockers.push('QUOTE_TIMESTAMP_INVALID');
  else {
    if (providerTime > currentTime || asOf > currentTime || ingestionTime > currentTime) blockers.push('QUOTE_TIMESTAMP_IN_FUTURE');
    if (currentTime - asOf > candidate.maximumAgeMs) blockers.push('QUOTE_STALE');
  }

  let authority: TrustedOptionQuoteAuthority | null = null;
  if (candidate.provider === 'ALPACA') {
    if (candidate.provenance.feed !== 'OPRA') blockers.push('ALPACA_OPRA_REQUIRED');
    if (!candidate.provenance.consolidatedNbboClaimProven) blockers.push('CONSOLIDATED_NBBO_NOT_PROVEN');
    authority = 'ALPACA_OPRA_CONSOLIDATED_BBO';
  } else {
    if (candidate.provenance.feed === 'INDICATIVE') blockers.push('INDICATIVE_QUOTE_FORBIDDEN');
    // Optionomics may qualify as trusted two-sided price evidence without
    // claiming it is consolidated NBBO. Its authenticated developer contract
    // and response provenance must prove the narrower claim first.
    authority = 'OPTIONOMICS_TRUSTED_TWO_SIDED_QUOTE';
  }

  return { ready: blockers.length === 0, authority: blockers.length === 0 ? authority : null, blockers };
}
