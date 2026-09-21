/**
 * R8 Slice B: universe opportunity-regret schema + underlying-ranking
 * challengers. Research-only, `brokerAuthority: false`. Answers the real
 * question "is THETA missing economically interesting opportunities
 * because the Production champion universe is too narrow?" -- without
 * building a second scanner: this module is schema/classification/
 * ranking tooling meant to consume real
 * `buildUniverseBreadthShadowPlan` (`strategy-quality-shadow-diagnostics.ts`,
 * Codex-owned real plan generator, read-only here) evidence once it is
 * persisted and reachable from this research environment.
 *
 * As of this pass: no persisted `buildUniverseBreadthShadowPlan`
 * evidence, canonical export, or Aiven-safe research artifact was
 * found anywhere in this worktree (no `.env` with real credentials, no
 * committed export files, no local database). This research
 * environment has no read path to the real Production/Aiven database
 * (Codex owns Aiven/runtime access per the ownership split), so
 * `WIDER_UNIVERSE_REAL_ROWS = 0` / `DATA_NOT_YET_OBSERVED` for this
 * pass -- this module builds the schema/consumers/challengers the
 * directive explicitly permits building even with zero real rows, and
 * draws NO empirical conclusion about universe adequacy.
 *
 * "Outside the champion cap" is never equated with "missed trade" --
 * every classification below keeps STRUCTURALLY_INTERESTING,
 * EVENT_BLOCKED, AEGIS_BLOCKED, EVIDENCE_INCOMPLETE, and
 * PAPER_AUTHORIZABLE separate, and every ranking challenger below is
 * explicit about which symbols it CANNOT rank because they were never
 * option-checked (B5) -- a challenger never ranks an unqueried symbol
 * on features that were never collected for it.
 */

export const universeOpportunityRegretVersion = 'theta-universe-opportunity-regret-v1' as const;

// ---------------------------------------------------------------------
// B2. Universe funnel -- real persisted counts per stage, per cycle.
//     Every field null (UNKNOWN) until a real persisted cycle populates it.
// ---------------------------------------------------------------------

export interface UniverseFunnelCounts {
  readonly rawBrokerUniverse: number | null;
  readonly dollarVolumeRanked: number | null;
  readonly optionabilityChecked: number | null;
  readonly optionable: number | null;
  readonly insideChampionCap: number | null;
  readonly outsideChampionCapChallenger: number | null;
  readonly contractsDiscovered: number | null;
  readonly validQuotes: number | null;
  readonly structuralCandidates: number | null;
  readonly eventOwnershipStateResolved: number | null;
  readonly aegisStatePersisted: number | null;
  readonly selected: number | null;
}

export function emptyUniverseFunnelCounts(): UniverseFunnelCounts {
  return {
    rawBrokerUniverse: null, dollarVolumeRanked: null, optionabilityChecked: null, optionable: null,
    insideChampionCap: null, outsideChampionCapChallenger: null, contractsDiscovered: null, validQuotes: null,
    structuralCandidates: null, eventOwnershipStateResolved: null, aegisStatePersisted: null, selected: null,
  };
}

// ---------------------------------------------------------------------
// B5/B6. Symbol observation status -- a challenger must never rank a
// symbol on option-derived features that were never actually collected
// for it (e.g. only the top-N dollar-volume names received chain
// requests).
// ---------------------------------------------------------------------

export type SymbolObservationStatus = 'FULLY_OBSERVED_SYMBOL' | 'PARTIALLY_OBSERVED_SYMBOL' | 'NOT_OPTION_CHECKED';

export function classifySymbolObservation(input: {
  readonly optionabilityChecked: boolean;
  readonly quoteEvidenceAvailable: boolean;
  readonly structuralCandidateAvailable: boolean;
}): SymbolObservationStatus {
  if (!input.optionabilityChecked) return 'NOT_OPTION_CHECKED';
  return input.quoteEvidenceAvailable && input.structuralCandidateAvailable ? 'FULLY_OBSERVED_SYMBOL' : 'PARTIALLY_OBSERVED_SYMBOL';
}

export type ObservationPolicyAdequacy = 'OBSERVATION_POLICY_TOO_NARROW' | 'OBSERVATION_SAMPLE_LOOKS_ADEQUATE' | 'INSUFFICIENT_EVIDENCE_TO_JUDGE';

/**
 * `minimumObservedFraction` is REQUIRED and caller-supplied -- this
 * module never invents an adequacy threshold. Answers "did the shadow
 * plan observe enough of the outside-cap universe to estimate missed
 * opportunities," which is a DIFFERENT question from "is the Production
 * cap itself too narrow" -- the two are never conflated.
 */
export function classifyObservationPolicyAdequacy(input: {
  readonly outsideCapSymbolsTotal: number;
  readonly outsideCapSymbolsOptionabilityChecked: number;
  readonly minimumObservedFraction: number;
}): ObservationPolicyAdequacy {
  if (input.outsideCapSymbolsTotal <= 0) return 'INSUFFICIENT_EVIDENCE_TO_JUDGE';
  const observedFraction = input.outsideCapSymbolsOptionabilityChecked / input.outsideCapSymbolsTotal;
  return observedFraction < input.minimumObservedFraction ? 'OBSERVATION_POLICY_TOO_NARROW' : 'OBSERVATION_SAMPLE_LOOKS_ADEQUATE';
}

// ---------------------------------------------------------------------
// B3. Opportunity-miss honesty -- "outside cap" != "missed trade".
// ---------------------------------------------------------------------

export type OutsideCapOpportunityStatus = 'STRUCTURALLY_INTERESTING' | 'EVENT_BLOCKED' | 'AEGIS_BLOCKED' | 'EVIDENCE_INCOMPLETE' | 'PAPER_AUTHORIZABLE';

/**
 * `paperAuthorizedBranch` is the REAL registry `executionEnabled` flag
 * for whichever branch would trade this candidate -- today `false` for
 * every THETA branch, so `PAPER_AUTHORIZABLE` cannot occur yet; this
 * function does not hardcode that fact, it reads it from the caller so
 * it stays correct if/when a branch graduates.
 */
export function classifyOutsideCapOpportunity(input: {
  readonly observationStatus: SymbolObservationStatus;
  readonly structuralCandidateAvailable: boolean;
  readonly eventEligible: boolean | null;
  readonly aegisEligible: boolean | null;
  readonly paperAuthorizedBranch: boolean;
}): OutsideCapOpportunityStatus {
  if (input.observationStatus !== 'FULLY_OBSERVED_SYMBOL' || !input.structuralCandidateAvailable) return 'EVIDENCE_INCOMPLETE';
  if (input.eventEligible === null || input.aegisEligible === null) return 'EVIDENCE_INCOMPLETE';
  if (!input.eventEligible) return 'EVENT_BLOCKED';
  if (!input.aegisEligible) return 'AEGIS_BLOCKED';
  return input.paperAuthorizedBranch ? 'PAPER_AUTHORIZABLE' : 'STRUCTURALLY_INTERESTING';
}

// ---------------------------------------------------------------------
// B7. Universe opportunity-regret schema.
// ---------------------------------------------------------------------

export type FutureOutcomeLabelStatus = 'OBSERVED_REAL_CHAIN' | 'COUNTERFACTUAL_ESTIMABLE' | 'NOT_IDENTIFIABLE';

export interface UniverseOpportunityRegretRecord {
  readonly decisionId: string;
  readonly decisionTimestamp: string;
  readonly symbol: string;
  readonly rankUnderDollarVolume: number | null;
  readonly insideProductionCap: boolean;
  readonly observationStatus: SymbolObservationStatus;
  readonly optionable: boolean | null;
  readonly quoteEvidenceAvailable: boolean;
  readonly structuralCandidateAvailable: boolean;
  readonly bestCandidateId: string | null;
  readonly eventState: string | null;
  readonly ownershipState: string | null;
  readonly aegisState: string | null;
  readonly selectedByProduction: boolean;
  /** Keyed by `UnderlyingRankingChallenger`. */
  readonly selectedByChallenger: Readonly<Record<string, boolean>>;
  readonly outsideCapOpportunityStatus: OutsideCapOpportunityStatus | 'NOT_APPLICABLE_INSIDE_CAP';
  readonly futureOutcomeStatus: FutureOutcomeLabelStatus;
}

export interface RegretRecordValidationResult {
  readonly valid: boolean;
  readonly reason: string | null;
}

/** A candidate Production never actually traded can never be labeled `OBSERVED_REAL_CHAIN` -- only `COUNTERFACTUAL_ESTIMABLE` or `NOT_IDENTIFIABLE`. */
export function validateOpportunityRegretRecord(record: UniverseOpportunityRegretRecord): RegretRecordValidationResult {
  if (record.futureOutcomeStatus === 'OBSERVED_REAL_CHAIN' && !record.selectedByProduction) {
    return { valid: false, reason: 'NEVER_TRADED_CANDIDATE_CANNOT_BE_LABELED_OBSERVED_REAL_CHAIN' };
  }
  if (record.insideProductionCap && record.outsideCapOpportunityStatus !== 'NOT_APPLICABLE_INSIDE_CAP') {
    return { valid: false, reason: 'INSIDE_CAP_RECORD_MUST_USE_NOT_APPLICABLE_INSIDE_CAP' };
  }
  if (!record.insideProductionCap && record.outsideCapOpportunityStatus === 'NOT_APPLICABLE_INSIDE_CAP') {
    return { valid: false, reason: 'OUTSIDE_CAP_RECORD_MUST_HAVE_A_REAL_OPPORTUNITY_STATUS' };
  }
  return { valid: true, reason: null };
}

// ---------------------------------------------------------------------
// B4/B5/B6. Underlying-ranking challengers -- transparent,
// UNWEIGHTED alternatives to the avgDollarVolume Production baseline.
// Every function EXCLUDES symbols it cannot honestly rank rather than
// silently including them with a fabricated/default feature value.
// ---------------------------------------------------------------------

export type UnderlyingRankingChallenger =
  | 'BASELINE_DOLLAR_VOLUME' | 'LIQUIDITY_THEN_OPTIONABILITY_LEXICOGRAPHIC'
  | 'STRUCTURAL_OPTION_ECONOMICS_PARETO' | 'OWNERSHIP_ELIGIBLE_PARETO';

export interface UnderlyingRankingFeatures {
  readonly symbol: string;
  readonly avgDollarVolume: number | null;
  readonly observationStatus: SymbolObservationStatus;
  readonly optionContractCount: number | null;
  readonly medianRelativeSpread: number | null;
  readonly executablePremiumOverCollateral: number | null;
  readonly downsideCushion: number | null;
  readonly ownershipEligible: boolean | null;
  readonly eventEvidenceComplete: boolean | null;
}

export interface ExcludedSymbol {
  readonly symbol: string;
  readonly reason: string;
}

export interface RankingResult {
  readonly challenger: UnderlyingRankingChallenger;
  /** For `BASELINE_DOLLAR_VOLUME`/`LIQUIDITY_THEN_OPTIONABILITY_LEXICOGRAPHIC`: a real ORDERED ranking (best first). For the two Pareto challengers: an UNORDERED non-dominated set -- no manufactured single winner. */
  readonly rankedOrNonDominated: readonly string[];
  readonly excludedSymbols: readonly ExcludedSymbol[];
}

/** The explicit Production baseline, kept as a named challenger for direct comparison -- never silently replaced. */
export function rankBaselineDollarVolume(features: readonly UnderlyingRankingFeatures[]): RankingResult {
  const known = features.filter((f) => f.avgDollarVolume !== null);
  const excludedSymbols = features.filter((f) => f.avgDollarVolume === null).map((f) => ({ symbol: f.symbol, reason: 'MISSING_AVG_DOLLAR_VOLUME' }));
  const ranked = [...known].sort((a, b) => (b.avgDollarVolume as number) - (a.avgDollarVolume as number)).map((f) => f.symbol);
  return { challenger: 'BASELINE_DOLLAR_VOLUME', rankedOrNonDominated: ranked, excludedSymbols };
}

/**
 * Primary key: `avgDollarVolume` (desc). Secondary key: `optionContractCount`
 * (desc) -- ONLY among `FULLY_OBSERVED_SYMBOL` entries, since a
 * `NOT_OPTION_CHECKED`/`PARTIALLY_OBSERVED_SYMBOL` symbol has no real
 * `optionContractCount` evidence to rank on (B5) and is excluded, never
 * defaulted to 0 (which would falsely rank it last rather than
 * "unknown").
 */
export function rankLiquidityThenOptionabilityLexicographic(features: readonly UnderlyingRankingFeatures[]): RankingResult {
  const excludedSymbols: ExcludedSymbol[] = [];
  const eligible = features.filter((f) => {
    if (f.avgDollarVolume === null) { excludedSymbols.push({ symbol: f.symbol, reason: 'MISSING_AVG_DOLLAR_VOLUME' }); return false; }
    if (f.observationStatus !== 'FULLY_OBSERVED_SYMBOL') { excludedSymbols.push({ symbol: f.symbol, reason: `NOT_FULLY_OBSERVED:${f.observationStatus}` }); return false; }
    if (f.optionContractCount === null) { excludedSymbols.push({ symbol: f.symbol, reason: 'MISSING_OPTION_CONTRACT_COUNT' }); return false; }
    return true;
  });
  const ranked = [...eligible].sort((a, b) =>
    (b.avgDollarVolume as number) - (a.avgDollarVolume as number)
    || (b.optionContractCount as number) - (a.optionContractCount as number),
  ).map((f) => f.symbol);
  return { challenger: 'LIQUIDITY_THEN_OPTIONABILITY_LEXICOGRAPHIC', rankedOrNonDominated: ranked, excludedSymbols };
}

function paretoNonDominated(entries: readonly { symbol: string; vector: readonly number[] }[]): readonly string[] {
  const dominates = (a: readonly number[], b: readonly number[]): boolean =>
    a.every((v, i) => v >= (b[i] as number)) && a.some((v, i) => v > (b[i] as number));
  return entries.filter((e) => !entries.some((other) => other.symbol !== e.symbol && dominates(other.vector, e.vector))).map((e) => e.symbol);
}

/**
 * A real, transparent, UNWEIGHTED Pareto frontier over
 * `executablePremiumOverCollateral` (MAX), `medianRelativeSpread` (MIN),
 * `downsideCushion` (MAX) -- ONLY among `FULLY_OBSERVED_SYMBOL` entries
 * with all three known. No arbitrary weighted super-score.
 */
export function rankStructuralOptionEconomicsPareto(features: readonly UnderlyingRankingFeatures[]): RankingResult {
  const excludedSymbols: ExcludedSymbol[] = [];
  const eligible = features.filter((f) => {
    if (f.observationStatus !== 'FULLY_OBSERVED_SYMBOL') { excludedSymbols.push({ symbol: f.symbol, reason: `NOT_FULLY_OBSERVED:${f.observationStatus}` }); return false; }
    if (f.executablePremiumOverCollateral === null || f.medianRelativeSpread === null || f.downsideCushion === null) {
      excludedSymbols.push({ symbol: f.symbol, reason: 'MISSING_STRUCTURAL_ECONOMICS_DIMENSION' }); return false;
    }
    return true;
  });
  const entries = eligible.map((f) => ({
    symbol: f.symbol,
    vector: [f.executablePremiumOverCollateral as number, -(f.medianRelativeSpread as number), f.downsideCushion as number],
  }));
  return { challenger: 'STRUCTURAL_OPTION_ECONOMICS_PARETO', rankedOrNonDominated: paretoNonDominated(entries), excludedSymbols };
}

/** Same Pareto frontier as `rankStructuralOptionEconomicsPareto`, further restricted to `ownershipEligible === true` symbols -- an ownership-unknown or ineligible symbol is excluded, never defaulted to eligible. */
export function rankOwnershipEligiblePareto(features: readonly UnderlyingRankingFeatures[]): RankingResult {
  const excludedSymbols: ExcludedSymbol[] = [];
  const ownershipFiltered = features.filter((f) => {
    if (f.ownershipEligible !== true) { excludedSymbols.push({ symbol: f.symbol, reason: f.ownershipEligible === null ? 'OWNERSHIP_ELIGIBILITY_UNKNOWN' : 'OWNERSHIP_INELIGIBLE' }); return false; }
    return true;
  });
  const inner = rankStructuralOptionEconomicsPareto(ownershipFiltered);
  return { challenger: 'OWNERSHIP_ELIGIBLE_PARETO', rankedOrNonDominated: inner.rankedOrNonDominated, excludedSymbols: [...excludedSymbols, ...inner.excludedSymbols] };
}

// ---------------------------------------------------------------------
// B8. Report without a winner if data is weak.
// ---------------------------------------------------------------------

export type EmpiricalUniverseConclusion =
  | 'CURRENT_CAP_LOOKS_ADEQUATE_DESCRIPTIVELY' | 'OUTSIDE_CAP_STRUCTURAL_OPPORTUNITIES_OBSERVED'
  | 'OBSERVATION_POLICY_TOO_NARROW' | 'INSUFFICIENT_REAL_EVIDENCE' | 'DATA_NOT_YET_OBSERVED';
