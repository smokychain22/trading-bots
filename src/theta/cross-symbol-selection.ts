import type { NormalizedOptionContract } from './option-contract.js';

// R1 Phase 2 item H (bounded slice): replaces "select the liquidity-#1
// underlying and evaluate only that one" with a real, cheap, per-
// underlying economic comparison across a small shortlist -- so THETA
// answers "where is the best opportunity right now" rather than "does the
// highest-dollar-volume symbol pass."
//
// This is DELIBERATELY a cheap proxy, not the full after-cost EV/utility
// model (which requires the real Python pipeline -- ownership, regime,
// theta_q_lattice, pareto, AEGIS, opportunity-frontier -- and is still
// only run once per cycle, on the winner of this cheap comparison, to
// keep the expensive stage bounded). The proxy is real, inspectable
// arithmetic over real Alpaca bid/strike/multiplier data -- never a
// probability estimate, never an opaque unexplained "score." Dollar
// volume itself is used only as the earlier, cheaper liquidity
// pre-filter (already implemented in universe-policy.ts) -- it plays NO
// role in this comparison.

export interface UnderlyingReturnProxy {
  readonly underlying: string;
  readonly bestCandidateSymbol: string | null;
  // bid / (strike * multiplier) for the best executable candidate found --
  // a rough, real, per-underlying "premium yield on required collateral"
  // signal. null (UNKNOWN) when no executable candidate with a known,
  // positive bid and positive collateral requirement exists for this
  // underlying this cycle -- never a fabricated 0 or a guess.
  readonly returnProxy: number | null;
}

/**
 * Computes the best available return proxy for one underlying's already-
 * merged option contracts. Only executable candidates (known bid, known
 * strike, positive collateral) are considered -- never a stale/unknown
 * quote's bid, and never a division against a zero/negative collateral
 * requirement.
 */
export function computeUnderlyingReturnProxy(underlying: string, contracts: readonly NormalizedOptionContract[]): UnderlyingReturnProxy {
  let best: { symbol: string; proxy: number } | null = null;
  for (const contract of contracts) {
    if (!contract.executable || contract.bid === null || contract.bid <= 0) continue;
    const collateral = contract.strike * contract.multiplier;
    if (!Number.isFinite(collateral) || collateral <= 0) continue;
    const proxy = contract.bid / collateral;
    if (best === null || proxy > best.proxy) best = { symbol: contract.optionSymbol, proxy };
  }
  return { underlying, bestCandidateSymbol: best?.symbol ?? null, returnProxy: best?.proxy ?? null };
}

/**
 * Ranks a shortlist of per-underlying return proxies, highest first.
 * Underlyings with no real candidate (returnProxy === null) are excluded
 * from the ranked list entirely -- never ranked as if a proxy of 0 -- but
 * are still returned in `excluded` for funnel transparency.
 */
export function rankUnderlyingsByReturnProxy(proxies: readonly UnderlyingReturnProxy[]): {
  readonly ranked: readonly UnderlyingReturnProxy[];
  readonly excluded: readonly UnderlyingReturnProxy[];
} {
  const ranked = proxies.filter((p) => p.returnProxy !== null).sort((a, b) => (b.returnProxy as number) - (a.returnProxy as number));
  const excluded = proxies.filter((p) => p.returnProxy === null);
  return { ranked, excluded };
}
