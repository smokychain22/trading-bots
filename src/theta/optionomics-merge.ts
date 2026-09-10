import type { NormalizedOptionContract } from './option-contract.js';
import {
  classifyProviderDisagreement,
  matchOptionomicsContractIdentity,
  type AlpacaContractIdentity,
  type DisagreementTolerancePolicy,
  type NormalizedOptionomicsEntry,
  type OptionomicsIdentityMatchMethod,
  type ProviderDisagreement,
} from './optionomics-provider.js';

// R1 parallel slice: a deterministic, network-free normalization/merge
// utility between an already-normalized Alpaca contract (canonical
// NormalizedOptionContract, from option-contract.ts -- read-only import,
// never modified) and a NormalizedOptionomicsEntry (optionomics-provider.ts).
//
// NOT wired into option-chain-ingestion.ts's mergeOptionChain (which
// already performs the production per-feature-preference merge used by the
// live cycle) and NOT wired into runThetaShadowCycle/new-risk-orchestrator
// -- those integration points are Codex's active reconciliation surface at
// the time this module was written. This module exists as an additive,
// self-contained capability: given the two already-normalized inputs, it
// produces an explicit source-attributed MergedOptionObservation PLUS a
// provider-disagreement classification on every field both providers
// report, which the existing mergeOptionChain does not compute. A future
// integration step decides whether/how to fold this into the live pipeline.
//
// Hard rule, never violated here: ALPACA's own bid/ask/executable identity
// are passed through completely unchanged. Nothing in this module ever
// reads or writes into those fields from an Optionomics value.

export type MergedFieldSource = 'ALPACA' | 'OPTIONOMICS' | 'UNAVAILABLE';

export interface MergedOptionObservation {
  readonly optionSymbol: string; // Alpaca's own occSymbol/optionSymbol -- executable identity, never replaced
  readonly identityMatch: OptionomicsIdentityMatchMethod; // how (or whether) an Optionomics entry was matched to this Alpaca contract
  // Alpaca execution-facing quote truth, passed through verbatim.
  readonly alpacaBid: number | null;
  readonly alpacaAsk: number | null;
  // Open interest: Alpaca's snapshot endpoint does not supply this field in
  // this environment's observed responses (see option-chain-ingestion.ts) --
  // Optionomics is the only source, or UNAVAILABLE.
  readonly openInterest: number | null;
  readonly openInterestSource: Extract<MergedFieldSource, 'OPTIONOMICS' | 'UNAVAILABLE'>;
  // Volume/IV/Greeks: Alpaca preferred when Alpaca reports a known value;
  // Optionomics is the fallback only, never silently averaged with Alpaca.
  readonly volume: number | null;
  readonly volumeSource: MergedFieldSource;
  readonly volumeDisagreement: ProviderDisagreement; // computed only when BOTH providers report a value
  readonly impliedVolatility: number | null;
  readonly impliedVolatilitySource: MergedFieldSource;
  readonly impliedVolatilityDisagreement: ProviderDisagreement;
  readonly delta: number | null;
  readonly deltaSource: MergedFieldSource;
  readonly deltaDisagreement: ProviderDisagreement;
}

export interface MergeOptionObservationPolicy {
  readonly policyVersion: string;
  readonly disagreementTolerance: DisagreementTolerancePolicy;
}

/**
 * Merges one Alpaca-normalized contract with the full set of Optionomics
 * chain entries for the same underlying. Identity is established via
 * matchOptionomicsContractIdentity -- exact OCC symbol first, exact
 * underlying+expiration+type+strike fallback, UNMATCHED otherwise (never
 * fuzzy). When UNMATCHED, every Optionomics-sourced field is UNAVAILABLE --
 * this function never merges a contract it cannot prove identity for.
 */
export function mergeAlpacaAndOptionomicsObservation(
  alpacaContract: NormalizedOptionContract,
  optionomicsEntries: readonly NormalizedOptionomicsEntry[],
  policy: MergeOptionObservationPolicy,
): MergedOptionObservation {
  const alpacaIdentity: AlpacaContractIdentity = {
    symbol: alpacaContract.optionSymbol,
    underlying: alpacaContract.underlying,
    expiration: alpacaContract.expiration,
    optionType: alpacaContract.optionType,
    strike: alpacaContract.strike,
  };

  // Find the Optionomics entry (if any) whose identity matches THIS Alpaca
  // contract -- evaluated from the Optionomics side, one at a time, so the
  // same exact-match discipline applies regardless of which provider's
  // entry list happens to be the outer loop.
  let matchedEntry: NormalizedOptionomicsEntry | null = null;
  let matchMethod: OptionomicsIdentityMatchMethod = 'UNMATCHED';
  for (const entry of optionomicsEntries) {
    const match = matchOptionomicsContractIdentity(entry, [alpacaIdentity]);
    if (match.method !== 'UNMATCHED' && match.alpacaSymbol === alpacaIdentity.symbol) {
      matchedEntry = entry;
      matchMethod = match.method;
      break;
    }
  }

  const openInterest = matchedEntry?.openInterest ?? null;
  const openInterestSource: MergedOptionObservation['openInterestSource'] = matchedEntry !== null && matchedEntry.openInterest !== null ? 'OPTIONOMICS' : 'UNAVAILABLE';

  const alpacaVolumeKnown = alpacaContract.volume !== null;
  const volumeSource: MergedFieldSource = alpacaVolumeKnown ? 'ALPACA' : matchedEntry !== null && matchedEntry.volume !== null ? 'OPTIONOMICS' : 'UNAVAILABLE';
  const volume = volumeSource === 'ALPACA' ? alpacaContract.volume : volumeSource === 'OPTIONOMICS' ? (matchedEntry?.volume ?? null) : null;
  const volumeDisagreement = classifyProviderDisagreement(alpacaContract.volume, matchedEntry?.volume ?? null, policy.disagreementTolerance);

  const alpacaIvKnown = alpacaContract.iv !== null;
  const impliedVolatilitySource: MergedFieldSource = alpacaIvKnown ? 'ALPACA' : matchedEntry !== null && matchedEntry.impliedVolatility !== null ? 'OPTIONOMICS' : 'UNAVAILABLE';
  const impliedVolatility = impliedVolatilitySource === 'ALPACA' ? alpacaContract.iv : impliedVolatilitySource === 'OPTIONOMICS' ? (matchedEntry?.impliedVolatility ?? null) : null;
  const impliedVolatilityDisagreement = classifyProviderDisagreement(alpacaContract.iv, matchedEntry?.impliedVolatility ?? null, policy.disagreementTolerance);

  const alpacaDeltaKnown = alpacaContract.delta !== null;
  const deltaSource: MergedFieldSource = alpacaDeltaKnown ? 'ALPACA' : matchedEntry !== null && matchedEntry.delta !== null ? 'OPTIONOMICS' : 'UNAVAILABLE';
  const delta = deltaSource === 'ALPACA' ? alpacaContract.delta : deltaSource === 'OPTIONOMICS' ? (matchedEntry?.delta ?? null) : null;
  const deltaDisagreement = classifyProviderDisagreement(alpacaContract.delta, matchedEntry?.delta ?? null, policy.disagreementTolerance);

  return {
    optionSymbol: alpacaContract.optionSymbol,
    identityMatch: matchedEntry !== null ? matchMethod : 'UNMATCHED',
    alpacaBid: alpacaContract.bid,
    alpacaAsk: alpacaContract.ask,
    openInterest, openInterestSource,
    volume, volumeSource, volumeDisagreement,
    impliedVolatility, impliedVolatilitySource, impliedVolatilityDisagreement,
    delta, deltaSource, deltaDisagreement,
  };
}
