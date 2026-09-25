/**
 * COMMAND 4 item 9 / COMMAND 3 correction 10. Versioned common-horizon
 * utility contract. Research-only, `brokerAuthority: false`.
 *
 * `PRIMARY_HORIZON` is DERIVED from real strategy configuration
 * (`canonicalThetaStrategySources`, Codex-owned, read-only import) --
 * `max(new-risk strategy DTE maximums)`, never a hardcoded literal.
 * THETA_RECOVERY is deliberately EXCLUDED from this max: per THETA COMMAND 1
 * closure, its `lattice.dteMax` (3650) is confirmed nonbinding schema noise
 * for an inventory-lifecycle management branch, not a real new-risk DTE
 * constraint (`canonical-strategy-frontier.ts`'s real Recovery candidate
 * construction uses a separate, hardcoded `[1,60]` CC window, never this
 * field). Including it here would silently inflate the horizon with an
 * inert value.
 *
 * This module does NOT replace `cross-strategy-common-horizon-contract.ts`
 * (which defines candidate-vs-candidate Pareto comparison identity) -- it
 * supplies the one additional concept that contract does not carry: the
 * utility-AT-horizon-H decomposition (`realizedCashflowsThroughH`,
 * `terminalMarkAtH`, `continuationValueBeyondH`, `costs`, `riskPenalty`,
 * `capitalBasis`), with every unavailable value staying `null`, never `0`.
 */
import { canonicalThetaStrategySources } from '../theta/strategy-package.js';

export const primaryCommonHorizonUtilityVersion = 'theta-primary-common-horizon-utility-v1' as const;

/** Branches excluded from the new-risk DTE-maximum derivation because they
 * are management/inventory-lifecycle routes, not new-risk entry lattices. */
const NON_NEW_RISK_BRANCHES: ReadonlySet<string> = new Set(['THETA_RECOVERY']);

/**
 * `max(current new-risk strategy DTE maximums)`, derived live from
 * `canonicalThetaStrategySources` rather than hardcoded. Versioned with the
 * strategy-policy configuration itself: if the underlying config changes,
 * a caller re-deriving this value gets the new real horizon automatically,
 * never a stale literal.
 */
export function derivePrimaryHorizonCalendarDays(): number {
  const newRiskMaxima = canonicalThetaStrategySources
    .filter((source) => !NON_NEW_RISK_BRANCHES.has(source.branch))
    .map((source) => source.lattice.dteMax);
  if (newRiskMaxima.length === 0) throw new Error('PRIMARY_HORIZON_NO_NEW_RISK_STRATEGIES_FOUND');
  return Math.max(...newRiskMaxima);
}

export interface CommonHorizonUtility {
  readonly contractVersion: typeof primaryCommonHorizonUtilityVersion;
  readonly horizonCalendarDays: number;
  readonly horizonDefinitionVersion: string;
  readonly realizedCashflowsThroughH: number | null;
  readonly terminalMarkAtH: number | null;
  readonly continuationValueBeyondH: number | null;
  readonly costs: number | null;
  readonly riskPenalty: number | null;
  readonly capitalBasis: number | null;
  readonly capitalDays: number | null;
  /** Sum of the six null-safe components, or `null` if ANY component
   * required to be non-null for a meaningful total is missing. Never
   * substitutes `0` for a missing component to force a total. */
  readonly totalUtility: number | null;
}

export function buildCommonHorizonUtility(input: {
  readonly horizonDefinitionVersion: string;
  readonly realizedCashflowsThroughH: number | null;
  readonly terminalMarkAtH: number | null;
  readonly continuationValueBeyondH: number | null;
  readonly costs: number | null;
  readonly riskPenalty: number | null;
  readonly capitalBasis: number | null;
  readonly capitalDays: number | null;
}): CommonHorizonUtility {
  const components = [
    input.realizedCashflowsThroughH, input.terminalMarkAtH, input.continuationValueBeyondH,
    input.costs === null ? null : -input.costs, input.riskPenalty === null ? null : -input.riskPenalty,
  ];
  const totalUtility = components.some((c) => c === null) ? null : components.reduce((a, b) => (a as number) + (b as number), 0);
  return {
    contractVersion: primaryCommonHorizonUtilityVersion, horizonCalendarDays: derivePrimaryHorizonCalendarDays(),
    horizonDefinitionVersion: input.horizonDefinitionVersion,
    realizedCashflowsThroughH: input.realizedCashflowsThroughH, terminalMarkAtH: input.terminalMarkAtH,
    continuationValueBeyondH: input.continuationValueBeyondH, costs: input.costs, riskPenalty: input.riskPenalty,
    capitalBasis: input.capitalBasis, capitalDays: input.capitalDays, totalUtility,
  };
}
