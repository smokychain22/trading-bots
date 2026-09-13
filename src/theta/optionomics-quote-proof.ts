import type { NormalizedOptionomicsChain } from './optionomics-provider.js';

export const OPTIONOMICS_QUOTE_CONTRACT_VERSION = 'optionomics-public-api-reference-2026-09-13';

export interface OptionomicsExecutionQuoteProof {
  readonly contractVersion: typeof OPTIONOMICS_QUOTE_CONTRACT_VERSION;
  readonly provider: 'OPTIONOMICS';
  readonly operationAlias: 'OPTION_CHAIN';
  readonly observationCount: number;
  readonly twoSidedQuoteCount: number;
  readonly twoSidedSizeCount: number;
  readonly providerTimestampCount: number;
  readonly quoteSemantics: 'SESSION_RECORDED_RESEARCH';
  readonly executionQuoteAuthority: 'REJECTED';
  readonly freshTrustedTwoSidedOptionQuoteReady: false;
  readonly blocker: 'PROVIDER_DOCUMENTS_SESSION_INGESTION_NOT_EXECUTION_FEED';
}

const positiveFinite = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;

/**
 * Produces a credential-free capability proof from an authenticated chain.
 * Field presence is measured independently from semantic fitness. A response
 * may contain a valid two-sided recorded quote and still be forbidden for
 * order pricing because the provider documents it as session-ingested data.
 */
export function proveOptionomicsExecutionQuoteContract(
  chain: NormalizedOptionomicsChain,
): OptionomicsExecutionQuoteProof {
  const twoSidedQuoteCount = chain.entries.filter((entry) =>
    positiveFinite(entry.bid) && positiveFinite(entry.ask) && entry.bid <= entry.ask,
  ).length;
  const twoSidedSizeCount = chain.entries.filter((entry) =>
    positiveFinite(entry.bidSize) && positiveFinite(entry.askSize),
  ).length;
  const providerTimestampCount = chain.entries.filter((entry) => entry.asOf !== null).length;

  return {
    contractVersion: OPTIONOMICS_QUOTE_CONTRACT_VERSION,
    provider: 'OPTIONOMICS',
    operationAlias: 'OPTION_CHAIN',
    observationCount: chain.entries.length,
    twoSidedQuoteCount,
    twoSidedSizeCount,
    providerTimestampCount,
    quoteSemantics: 'SESSION_RECORDED_RESEARCH',
    executionQuoteAuthority: 'REJECTED',
    freshTrustedTwoSidedOptionQuoteReady: false,
    blocker: 'PROVIDER_DOCUMENTS_SESSION_INGESTION_NOT_EXECUTION_FEED',
  };
}
