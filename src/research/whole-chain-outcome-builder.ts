/**
 * COMMAND 4 item 4. Factual whole-chain research materializer. Research-
 * only, `brokerAuthority: false`. Wraps `whole-chain-economics.ts`'s real
 * `computeWholeChainPnl` (Codex-owned, read-only import) -- this module is
 * NOT a second accounting engine. It only adds the research-layer lifecycle
 * state (`CHAIN_OPEN | CHAIN_CENSORED | CHAIN_RESOLVED`) and capital-days
 * (via `capital-days-definition.ts`) around that real arithmetic, and
 * materializes one dataset row per chain.
 */
import { computeWholeChainPnl, type WholeChainComponents, type WholeChainPnlBreakdown } from '../theta/whole-chain-economics.js';
import { capitalDaysFromDailySeries, type DailyCapitalObservation } from './capital-days-definition.js';
import { identifiabilityTaxonomyVersion, type IdentifiabilityStatus } from './empirical-identifiability-taxonomy.js';

export const wholeChainOutcomeBuilderVersion = 'theta-whole-chain-outcome-builder-v1' as const;

export type WholeChainState = 'CHAIN_OPEN' | 'CHAIN_CENSORED' | 'CHAIN_RESOLVED';

export interface WholeChainOutcomeRow {
  readonly contractVersion: typeof wholeChainOutcomeBuilderVersion;
  readonly taxonomyVersion: typeof identifiabilityTaxonomyVersion;
  readonly chainId: string;
  readonly strategyFamily: string;
  readonly state: WholeChainState;
  readonly rollCount: number;
  readonly pnl: WholeChainPnlBreakdown;
  readonly capitalDays: number | null;
  readonly observationCutoffAt: string;
  /** Always `FACTUAL_OBSERVED` for a `CHAIN_RESOLVED` row (the chain's own
   * realized components are real, observed cash flows); `NOT_IDENTIFIABLE`
   * for an open/censored chain's terminal outcome, since no terminal value
   * exists yet -- the row is still retained, never dropped. */
  readonly identifiabilityStatus: IdentifiabilityStatus;
}

/**
 * `rollCount` is supplied by the caller (a count of real `ROLL_LINK` edges
 * for this `chainId`) rather than inferred here -- this module never
 * counts a roll leg as an independent completed trade; every roll is one
 * link within the SAME chain, and the chain-level P&L already reflects
 * `rollCredits`/`rollCloseCosts` as separate, additive legs (see
 * `whole-chain-economics.ts`'s own doc comment: "kept separate ... so a
 * roll's own gross mechanics stay visible, not netted away"). This function
 * does not renegotiate that invariant; it only reports it at the row level.
 */
export function buildWholeChainOutcomeRow(input: {
  readonly chainId: string;
  readonly strategyFamily: string;
  readonly rollCount: number;
  readonly components: WholeChainComponents;
  readonly dailyCapital: readonly DailyCapitalObservation[];
  readonly observationCutoffAt: string;
  readonly isResolved: boolean;
}): WholeChainOutcomeRow {
  if (!Number.isFinite(Date.parse(input.observationCutoffAt))) throw new Error('WHOLE_CHAIN_INVALID_OBSERVATION_CUTOFF');
  if (input.rollCount < 0) throw new Error('WHOLE_CHAIN_INVALID_ROLL_COUNT');
  const pnl = computeWholeChainPnl(input.components);
  const capitalDays = input.dailyCapital.length === 0 ? null : capitalDaysFromDailySeries(input.dailyCapital);
  // A chain materialized into a dataset row at `observationCutoffAt` is
  // either genuinely RESOLVED (caller confirms terminal disposition) or, if
  // not, it is CENSORED at this cutoff for dataset purposes -- it is never
  // silently dropped, and its non-resolution is a real, named state, not an
  // absence of a row. `CHAIN_OPEN` is reserved for a live, still-running
  // chain view that has not yet been materialized into a frozen dataset
  // snapshot at all (a distinct code path from this builder, which always
  // produces a frozen, cutoff-anchored row).
  const state: WholeChainState = input.isResolved ? 'CHAIN_RESOLVED' : 'CHAIN_CENSORED';
  return {
    contractVersion: wholeChainOutcomeBuilderVersion, taxonomyVersion: identifiabilityTaxonomyVersion,
    chainId: input.chainId, strategyFamily: input.strategyFamily, state,
    rollCount: input.rollCount, pnl, capitalDays, observationCutoffAt: input.observationCutoffAt,
    identifiabilityStatus: state === 'CHAIN_RESOLVED' && pnl.wholeChainPnl !== null ? 'FACTUAL_OBSERVED' : 'NOT_IDENTIFIABLE',
  };
}
