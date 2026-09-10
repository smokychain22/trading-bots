// R1D: versioned, staged underlying-universe narrowing engine. THETA must
// choose from a BOUNDED universe, never scan every optionable US security's
// full chain every cycle -- this module performs the cheap, staged
// elimination BEFORE any option-chain fetch is ever attempted for an
// underlying.
//
// Hard gates (structurally cannot be evaluated / cannot be traded at all)
// are kept deliberately rare, per the standing anti-paralysis discipline:
// not tradable, not option-enabled, invalid asset metadata, required
// option-market-data unavailable, unsupported corporate action pending.
// Everything else -- underlying liquidity below a soft threshold, weaker
// ownership suitability, momentary account-capital insufficiency -- is
// DEFERRED (revisit later), never REJECTED outright, and never combined
// into an AND-gate of a dozen technical conditions.

export interface ReasonCode {
  readonly code: string;
  readonly polarity: -1 | 0 | 1;
  readonly detail: string;
}

export type UnderlyingDecisionState = 'ELIGIBLE' | 'DEFERRED' | 'REJECTED';

export type UniverseStage =
  | 'BASE_OPTIONABLE'
  | 'LIQUIDITY_SCREEN'
  | 'ACCOUNT_CAPACITY'
  | 'OWNERSHIP_SUITABILITY'
  | 'EVENT_AWARENESS';

export interface UniversePolicy {
  readonly policyVersion: string;
  readonly minAvgDollarVolume: number; // soft liquidity floor -- see stage B
  readonly minCurrentPrice: number; // structurally required for a meaningful CSP economics computation
}

export interface UnderlyingCandidateInput {
  readonly symbol: string;
  // Stage A: base optionable universe -- hard gates.
  readonly tradable: boolean;
  readonly optionEnabled: boolean;
  readonly assetDataValid: boolean;
  // Stage B: liquidity / usable market-data -- soft (DEFERRED) unless data
  // itself is unavailable (hard).
  readonly avgDollarVolume: number | null; // null = UNKNOWN market data
  readonly currentPrice: number | null; // null = UNKNOWN market data
  readonly hasUsableOptionChain: boolean | null; // null = UNKNOWN whether any option data exists for this underlying at all
  // Stage C: account/collateral feasibility -- soft (Q=0 remains a valid
  // downstream outcome; a momentary capital shortfall defers, it does not
  // permanently reject the underlying).
  readonly accountCollateralFeasible: boolean | null;
  // Stage D: ownership suitability -- soft (a graded/economic judgment, not
  // a binary bullish screen; see ownership_v0.py's own documented question).
  readonly ownershipAcceptable: boolean | null;
  // Stage E: event/corporate-action awareness -- unsupportedCorporateAction
  // is a hard gate (the contract genuinely cannot be safely evaluated);
  // eventNear alone is soft (deferred, not rejected).
  readonly unsupportedCorporateActionPending: boolean;
  readonly eventNear: boolean;
}

export interface UnderlyingDecision {
  readonly symbol: string;
  readonly state: UnderlyingDecisionState;
  readonly terminalStage: UniverseStage;
  readonly reasons: readonly ReasonCode[];
  readonly policyVersion: string;
}

const reason = (code: string, polarity: -1 | 0 | 1, detail: string): ReasonCode => ({ code, polarity, detail });

/**
 * Evaluates one underlying through every stage in order, stopping at the
 * first terminal state (REJECTED or DEFERRED) so later stages are never
 * evaluated needlessly -- this is the actual cost-control mechanism (never
 * fetch a full option chain for an underlying already excluded at Stage A).
 * Only reaching every stage without a terminal state produces ELIGIBLE.
 */
export function evaluateUnderlying(policy: UniversePolicy, input: UnderlyingCandidateInput): UnderlyingDecision {
  const base = { symbol: input.symbol, policyVersion: policy.policyVersion };

  // Stage A: hard gates only.
  if (!input.tradable) {
    return { ...base, state: 'REJECTED', terminalStage: 'BASE_OPTIONABLE', reasons: [reason('NOT_TRADABLE', -1, 'Underlying is not currently tradable.')] };
  }
  if (!input.optionEnabled) {
    return { ...base, state: 'REJECTED', terminalStage: 'BASE_OPTIONABLE', reasons: [reason('NOT_OPTION_ENABLED', -1, 'Underlying does not support options.')] };
  }
  if (!input.assetDataValid) {
    return { ...base, state: 'REJECTED', terminalStage: 'BASE_OPTIONABLE', reasons: [reason('INVALID_ASSET_DATA', -1, 'Asset metadata failed validity checks.')] };
  }

  // Stage B: liquidity/market-data. Missing market data is a hard gate (we
  // structurally cannot evaluate an underlying with no price); low-but-known
  // liquidity is a SOFT deferral, never a permanent rejection.
  if (input.currentPrice === null) {
    return { ...base, state: 'DEFERRED', terminalStage: 'LIQUIDITY_SCREEN', reasons: [reason('CURRENT_PRICE_UNKNOWN', -1, 'Current price is UNKNOWN -- cannot evaluate economics.')] };
  }
  if (input.currentPrice < policy.minCurrentPrice) {
    return { ...base, state: 'DEFERRED', terminalStage: 'LIQUIDITY_SCREEN', reasons: [reason('PRICE_BELOW_FLOOR', 0, `currentPrice ${input.currentPrice} below floor ${policy.minCurrentPrice}.`)] };
  }
  if (input.hasUsableOptionChain === false) {
    return { ...base, state: 'REJECTED', terminalStage: 'LIQUIDITY_SCREEN', reasons: [reason('NO_USABLE_OPTION_CHAIN', -1, 'No usable option-market data exists for this underlying.')] };
  }
  if (input.hasUsableOptionChain === null || input.avgDollarVolume === null) {
    return { ...base, state: 'DEFERRED', terminalStage: 'LIQUIDITY_SCREEN', reasons: [reason('OPTION_CHAIN_AVAILABILITY_UNKNOWN', 0, 'Option-chain availability or underlying liquidity is UNKNOWN, not assumed acceptable.')] };
  }
  if (input.avgDollarVolume < policy.minAvgDollarVolume) {
    return { ...base, state: 'DEFERRED', terminalStage: 'LIQUIDITY_SCREEN', reasons: [reason('LIQUIDITY_BELOW_SOFT_FLOOR', 0, `avgDollarVolume ${input.avgDollarVolume} below soft floor ${policy.minAvgDollarVolume} -- deferred, not rejected.`)] };
  }

  // Stage C: account/collateral feasibility -- soft. Q=0 downstream remains
  // legitimate; a momentary shortfall defers rather than rejects.
  if (input.accountCollateralFeasible === false) {
    return { ...base, state: 'DEFERRED', terminalStage: 'ACCOUNT_CAPACITY', reasons: [reason('COLLATERAL_CURRENTLY_INFEASIBLE', 0, 'Account currently lacks capacity for even one contract at this underlying -- may change.')] };
  }
  if (input.accountCollateralFeasible === null) {
    return { ...base, state: 'DEFERRED', terminalStage: 'ACCOUNT_CAPACITY', reasons: [reason('COLLATERAL_FEASIBILITY_UNKNOWN', 0, 'Account capacity for this underlying is UNKNOWN.')] };
  }

  // Stage D: ownership suitability -- soft, economic/graded question, never
  // "will the stock go up."
  if (input.ownershipAcceptable === false) {
    return { ...base, state: 'DEFERRED', terminalStage: 'OWNERSHIP_SUITABILITY', reasons: [reason('OWNERSHIP_CURRENTLY_UNACCEPTABLE', 0, 'Assignment at the current economic basis is not currently acceptable relative to alternatives.')] };
  }
  if (input.ownershipAcceptable === null) {
    return { ...base, state: 'DEFERRED', terminalStage: 'OWNERSHIP_SUITABILITY', reasons: [reason('OWNERSHIP_UNKNOWN', 0, 'Ownership suitability is UNKNOWN, not assumed acceptable.')] };
  }

  // Stage E: event/corporate-action. Only an UNSUPPORTED corporate action is
  // a hard gate; general event proximity alone is soft.
  if (input.unsupportedCorporateActionPending) {
    return { ...base, state: 'REJECTED', terminalStage: 'EVENT_AWARENESS', reasons: [reason('UNSUPPORTED_CORPORATE_ACTION', -1, 'An unsupported corporate action is pending -- this contract cannot be safely evaluated.')] };
  }
  if (input.eventNear) {
    return { ...base, state: 'DEFERRED', terminalStage: 'EVENT_AWARENESS', reasons: [reason('EVENT_PROXIMITY', 0, 'A known event is near -- deferred, not rejected; may become eligible after the event.')] };
  }

  return { ...base, state: 'ELIGIBLE', terminalStage: 'EVENT_AWARENESS', reasons: [reason('ALL_STAGES_CLEARED', 1, 'Passed every universe stage.')] };
}

export interface UniverseFunnelReport {
  readonly totalEvaluated: number;
  readonly eligible: number;
  readonly deferred: number;
  readonly rejected: number;
  readonly byStage: Readonly<Record<UniverseStage, { readonly deferred: number; readonly rejected: number }>>;
}

/**
 * Evaluates a batch and reports the funnel (item 24's anti-paralysis
 * observability requirement) -- if a scan produces zero eligible
 * underlyings, this tells a caller exactly which stage(s) did the
 * eliminating, not just that the result was empty.
 */
export function evaluateUniverse(policy: UniversePolicy, inputs: readonly UnderlyingCandidateInput[]): { readonly decisions: readonly UnderlyingDecision[]; readonly funnel: UniverseFunnelReport } {
  const decisions = inputs.map((input) => evaluateUnderlying(policy, input));
  const byStage: Record<UniverseStage, { deferred: number; rejected: number }> = {
    BASE_OPTIONABLE: { deferred: 0, rejected: 0 },
    LIQUIDITY_SCREEN: { deferred: 0, rejected: 0 },
    ACCOUNT_CAPACITY: { deferred: 0, rejected: 0 },
    OWNERSHIP_SUITABILITY: { deferred: 0, rejected: 0 },
    EVENT_AWARENESS: { deferred: 0, rejected: 0 },
  };
  for (const decision of decisions) {
    if (decision.state === 'DEFERRED') byStage[decision.terminalStage].deferred += 1;
    if (decision.state === 'REJECTED') byStage[decision.terminalStage].rejected += 1;
  }
  return {
    decisions,
    funnel: {
      totalEvaluated: decisions.length,
      eligible: decisions.filter((d) => d.state === 'ELIGIBLE').length,
      deferred: decisions.filter((d) => d.state === 'DEFERRED').length,
      rejected: decisions.filter((d) => d.state === 'REJECTED').length,
      byStage,
    },
  };
}

export interface RankedUnderlying {
  readonly symbol: string;
  readonly rank: number; // 1 = top-ranked
  readonly rankingFeature: 'avgDollarVolume';
  readonly rankingValue: number;
  readonly reason: string;
}

/**
 * Transparent, deterministic ranking among ELIGIBLE underlyings -- input
 * order (e.g. array position in a caller-supplied candidate list) is NEVER
 * the selection criterion; picking "whichever happened to come first" is
 * not an economic strategy. v1 ranks by avgDollarVolume descending (higher
 * underlying liquidity -> more reliable option-market conditions), which is
 * an honest, transparent placeholder -- NOT asserted to be THETA's real
 * economic ranking. Real premium-opportunity ranking (ownership-adjusted
 * yield, event-adjusted risk, account-capital efficiency) requires actual
 * option-chain data that is not available at this cheap universe-narrowing
 * stage by design (fetching full chains for every eligible underlying just
 * to rank them would defeat UniversePolicy's whole cost-control purpose).
 * Underlying ranking and option-CONTRACT ranking remain two separate
 * stages, per the standing architectural requirement -- this function
 * performs only the former.
 */
export function rankEligibleUnderlyings(
  decisions: readonly UnderlyingDecision[],
  inputsBySymbol: ReadonlyMap<string, UnderlyingCandidateInput>,
): readonly RankedUnderlying[] {
  const eligible = decisions.filter((d) => d.state === 'ELIGIBLE');
  const withValue = eligible.map((d) => {
    const input = inputsBySymbol.get(d.symbol);
    const value = input?.avgDollarVolume ?? 0; // ELIGIBLE guarantees avgDollarVolume was known and non-null at evaluation time
    return { symbol: d.symbol, value };
  });
  withValue.sort((a, b) => b.value - a.value);
  return withValue.map((entry, index) => ({
    symbol: entry.symbol,
    rank: index + 1,
    rankingFeature: 'avgDollarVolume' as const,
    rankingValue: entry.value,
    reason: `ranked ${index + 1} of ${withValue.length} eligible underlyings by avgDollarVolume (v1 placeholder ranking feature, not final economic ranking)`,
  }));
}
