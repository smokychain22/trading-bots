import type { NormalizedOptionContract } from './option-contract.js';

/** Diagnostic labels only. They never turn a rejected quote into an executable one. */
export type OptionExecutabilityCause =
  | 'BID_MISSING' | 'ASK_MISSING' | 'QUOTE_TIMESTAMP_MISSING' | 'QUOTE_TIMESTAMP_INVALID'
  | 'QUOTE_STALE' | 'SPREAD_UNKNOWN' | 'SPREAD_TOO_WIDE' | 'CROSSED_MARKET'
  | 'INVALID_MARKET' | 'MULTIPLIER_UNVERIFIED' | 'PROVIDER_QUALITY_NOT_GOOD'
  | 'QUOTE_AUTHORITY_INVALID' | 'QUOTE_FEED_UNSUPPORTED' | 'CONTRACT_EXPIRED'
  | 'OTHER_NON_EXECUTABLE';

/** Keep the existing rejection category for historical compatibility while
 * exposing all independently observed causes in the durable reasons array. */
export function optionExecutabilityCauses(contract: Pick<NormalizedOptionContract,
  'executable' | 'nonExecutableReason' | 'bid' | 'ask' | 'quoteTimestamp' | 'source' | 'feed' | 'dataQuality'>):
  readonly OptionExecutabilityCause[] {
  if (contract.executable) return [];
  const detail = contract.nonExecutableReason ?? '';
  const causes = new Set<OptionExecutabilityCause>();
  if (contract.bid === null) causes.add('BID_MISSING');
  if (contract.ask === null) causes.add('ASK_MISSING');
  if (contract.quoteTimestamp === null) causes.add('QUOTE_TIMESTAMP_MISSING');
  if (contract.bid !== null && contract.ask !== null) {
    if (contract.bid > contract.ask) causes.add('CROSSED_MARKET');
    if (contract.bid < 0 || contract.ask <= 0) causes.add('INVALID_MARKET');
  }
  if (contract.source !== 'ALPACA') causes.add('QUOTE_AUTHORITY_INVALID');
  if (contract.feed !== 'OPRA' && contract.feed !== 'INDICATIVE') causes.add('QUOTE_FEED_UNSUPPORTED');
  if (contract.dataQuality !== 'GOOD') causes.add('PROVIDER_QUALITY_NOT_GOOD');
  const fragments = new Set(detail.split(';').map((part) => part.trim().toLowerCase()));
  if (fragments.has('quote stale') || fragments.has('stale quote')) causes.add('QUOTE_STALE');
  if (fragments.has('spread too wide')) causes.add('SPREAD_TOO_WIDE');
  if (fragments.has('spread unknown')) causes.add('SPREAD_UNKNOWN');
  if (fragments.has('quote timestamp invalid or in future')) causes.add('QUOTE_TIMESTAMP_INVALID');
  if (fragments.has('multiplier unverified')) causes.add('MULTIPLIER_UNVERIFIED');
  if (fragments.has('contract expired or expires today')) causes.add('CONTRACT_EXPIRED');
  if (causes.size === 0) causes.add('OTHER_NON_EXECUTABLE');
  return [...causes].sort();
}
