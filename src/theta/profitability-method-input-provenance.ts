import type { ProvenanceOrigin } from './theta-shadow-cycle.js';

// Phase 1 Zero-Unknown Reclosure Pass 3 continuation (items 12-16). The
// broad `aegisInputsOrigin === 'CALLER_MANUAL'` exclusion (Pass 2) answers
// only one question for one family. This module separates, per decisive
// method, EXECUTION (did it run) from INPUT REALNESS (were its decisive
// inputs real, partially real, manual, versioned policy, synthetic, or
// unknown) -- a method may execute while its inputs are only partially
// real, and that must never collapse into "current-worker real data."
export type InputRealnessClass =
  | 'REAL' // every decisive input was a real, present observation this cycle
  | 'PARTIAL_REAL' // some decisive inputs were real, at least one was not
  | 'VERSIONED_POLICY' // decisive inputs are versioned policy parameters, not market/account evidence -- legitimate, not a defect, but not "real data" either
  | 'MANUAL' // the caller supplied a hardcoded/manual value for a decisive input, not fetched at all
  | 'SYNTHETIC' // a test/development fixture value stood in for a decisive input
  | 'UNKNOWN'; // provenance was never declared by the caller

export interface MethodInputProvenance {
  readonly methodId: string;
  readonly executed: boolean;
  readonly inputRealness: InputRealnessClass;
  readonly decisiveInputs: readonly { readonly name: string; readonly origin: ProvenanceOrigin | 'VERSIONED_POLICY_CONSTANT' }[];
  readonly notes: string;
}

const originToRealness = (origin: ProvenanceOrigin | undefined): InputRealnessClass => {
  if (origin === undefined) return 'UNKNOWN';
  if (origin === 'REAL_PROVIDER' || origin === 'DERIVED_FROM_REAL') return 'REAL';
  if (origin === 'CALLER_MANUAL') return 'MANUAL';
  if (origin === 'SYNTHETIC_FIXTURE') return 'SYNTHETIC';
  return 'UNKNOWN'; // REAL_PROVIDER_UNKNOWN / REAL_PROVIDER_ERROR / NOT_ATTEMPTED: a real attempt that did not yield a usable real value
};

// Combines several inputs' individual realness into one method-level
// classification. VERSIONED_POLICY inputs never downgrade an otherwise-REAL
// result (a policy parameter is a legitimate, versioned, non-market input,
// per item 15) -- but a genuinely MANUAL/SYNTHETIC/UNKNOWN decisive input
// always prevents a method from claiming REAL, even if other inputs are real.
function combine(classes: readonly InputRealnessClass[]): InputRealnessClass {
  const nonPolicy = classes.filter((c) => c !== 'VERSIONED_POLICY');
  if (nonPolicy.length === 0) return 'VERSIONED_POLICY';
  if (nonPolicy.every((c) => c === 'REAL')) return 'REAL';
  if (nonPolicy.some((c) => c === 'REAL' || c === 'PARTIAL_REAL')) return 'PARTIAL_REAL';
  if (nonPolicy.every((c) => c === 'MANUAL')) return 'MANUAL';
  if (nonPolicy.some((c) => c === 'SYNTHETIC')) return 'SYNTHETIC';
  return 'UNKNOWN';
}

export interface ClassifyMethodInputProvenanceInput {
  readonly executedMethodIds: readonly string[];
  readonly routerPortfolioOrigin: ProvenanceOrigin | undefined;
  readonly aegisInputsOrigin: ProvenanceOrigin;
  // Real market data (contracts/quotes) is fetched from a real provider in
  // every production/shadow entrypoint this repo has -- there is no code
  // path that fabricates option chain data. Declared here explicitly
  // (rather than hardcoded 'REAL' inline) so a future caller that genuinely
  // runs against synthetic/fixture market data can say so honestly.
  readonly marketDataOrigin: ProvenanceOrigin;
}

const decisiveMethodIds = [
  'CURRENT_DECISION_STATE', 'STRATEGY_APPLICABILITY_ROUTER', 'CONVENTIONAL_CANDIDATE_ENUMERATION',
  'HOLD_STRIKE_CANDIDATE_ENUMERATION', 'DEFINED_RISK_CANDIDATE_ENUMERATION',
  'AEGIS_RISK_PERMISSION', 'CONSTRAINED_QUANTITY_SIZING', 'CANONICAL_ENTRY_SELECTION',
] as const;

/**
 * Phase 1 Zero-Unknown Reclosure Pass 3 source-final (items 11-13): the ONE
 * authority for whether a method's real EXECUTION also earns real-DATA
 * (current-worker L7) credit. A methodId only survives this filter when it
 * both executed (present in `executedMethodIds`) AND this classifier says
 * its decisive inputs were fully REAL -- PARTIAL_REAL/MANUAL/SYNTHETIC/
 * UNKNOWN/VERSIONED_POLICY-only never qualify. A method without a
 * provenance row cannot claim current-worker L7 until its decisive inputs
 * are classified and persisted.
 */
export function filterToRealInputEvidence(
  executedMethodIds: readonly string[],
  provenance: readonly MethodInputProvenance[],
): readonly string[] {
  const byId = new Map(provenance.map((row) => [row.methodId, row]));
  return executedMethodIds.filter((methodId) => {
    const row = byId.get(methodId);
    return row?.executed === true && row.inputRealness === 'REAL'
      && row.decisiveInputs.some(value => originToRealness(value.origin === 'VERSIONED_POLICY_CONSTANT' ? undefined : value.origin) === 'REAL')
      && row.decisiveInputs.every(value => value.origin === 'VERSIONED_POLICY_CONSTANT'
        || originToRealness(value.origin) === 'REAL');
  });
}

export function classifyMethodInputProvenance(input: ClassifyMethodInputProvenanceInput): readonly MethodInputProvenance[] {
  const executed = new Set(input.executedMethodIds);
  const routerRealness = originToRealness(input.routerPortfolioOrigin);
  const marketRealness = originToRealness(input.marketDataOrigin);
  const aegisRealness = originToRealness(input.aegisInputsOrigin);

  const rows: MethodInputProvenance[] = [
    {
      methodId: 'CURRENT_DECISION_STATE', executed: executed.has('CURRENT_DECISION_STATE'),
      inputRealness: routerRealness,
      decisiveInputs: [{ name: 'routerPortfolio (lifecycle/position state)', origin: input.routerPortfolioOrigin ?? 'NOT_ATTEMPTED' }],
      notes: 'Gated on the same portfolio/lifecycle state STRATEGY_APPLICABILITY_ROUTER consumes -- never independently more real than that input.',
    },
    {
      methodId: 'STRATEGY_APPLICABILITY_ROUTER', executed: executed.has('STRATEGY_APPLICABILITY_ROUTER'),
      inputRealness: combine([routerRealness, 'VERSIONED_POLICY']),
      decisiveInputs: [
        { name: 'routerPortfolio (lifecycle/position state)', origin: input.routerPortfolioOrigin ?? 'NOT_ATTEMPTED' },
        { name: 'routerPolicy (versioned thresholds)', origin: 'VERSIONED_POLICY_CONSTANT' },
      ],
      notes: routerRealness === 'MANUAL'
        ? 'Executes for real, but its most decisive input (portfolio/lifecycle state) is a caller-supplied manual value in this entrypoint -- never promote this run to full REAL router input realness.'
        : 'Router policy thresholds are versioned parameters, not market/account evidence -- distinguished from the portfolio state input, per item 15.',
    },
    ...(['CONVENTIONAL_CANDIDATE_ENUMERATION', 'HOLD_STRIKE_CANDIDATE_ENUMERATION', 'DEFINED_RISK_CANDIDATE_ENUMERATION'] as const).map((methodId) => ({
      methodId, executed: executed.has(methodId),
      inputRealness: combine([marketRealness, routerRealness, 'VERSIONED_POLICY' as const]),
      decisiveInputs: [
        { name: 'option contracts/quotes', origin: input.marketDataOrigin },
        { name: 'applicability gate (router output)', origin: input.routerPortfolioOrigin ?? 'NOT_ATTEMPTED' },
        { name: 'lattice/sizing/ownership policy (versioned thresholds)', origin: 'VERSIONED_POLICY_CONSTANT' as const },
      ],
      notes: 'Real market data feeds enumeration, but evaluability is gated by the router\'s own input realness -- a manually-gated router keeps this PARTIAL_REAL, never full REAL, even with genuinely real contracts/quotes.',
    })),
    {
      methodId: 'AEGIS_RISK_PERMISSION', executed: executed.has('AEGIS_RISK_PERMISSION'),
      inputRealness: aegisRealness === 'MANUAL' ? 'PARTIAL_REAL' : aegisRealness,
      decisiveInputs: [{ name: 'aegisInputs (concentration/liquidity/stress family)', origin: input.aegisInputsOrigin }],
      notes: aegisRealness === 'MANUAL'
        ? 'Caller-supplied risk inputs are mixed with real-derived exposure. This run cannot claim fully real AEGIS inputs.'
        : 'Realness follows the declared risk-input origin. A realness label does not prove risk clearance or empirical validation.',
    },
    {
      methodId: 'CONSTRAINED_QUANTITY_SIZING', executed: executed.has('CONSTRAINED_QUANTITY_SIZING'),
      inputRealness: combine([aegisRealness === 'MANUAL' ? 'PARTIAL_REAL' : aegisRealness, 'VERSIONED_POLICY']),
      decisiveInputs: [
        { name: 'AEGIS state (same mixed reality as AEGIS_RISK_PERMISSION)', origin: input.aegisInputsOrigin },
        { name: 'sizing policy (versioned risk/collateral/concentration caps)', origin: 'VERSIONED_POLICY_CONSTANT' },
      ],
      notes: 'Consumes the same AEGIS state as AEGIS_RISK_PERMISSION and cannot be independently more real than that evidence.',
    },
    {
      methodId: 'CANONICAL_ENTRY_SELECTION', executed: executed.has('CANONICAL_ENTRY_SELECTION'),
      inputRealness: combine([marketRealness, routerRealness, aegisRealness === 'MANUAL' ? 'PARTIAL_REAL' : aegisRealness]),
      decisiveInputs: [
        { name: 'cross-branch candidate frontier (mixed realness, see per-branch enumeration rows)', origin: input.marketDataOrigin },
        { name: 'applicability gate (router output)', origin: input.routerPortfolioOrigin ?? 'NOT_ATTEMPTED' },
        { name: 'AEGIS/sizing state feeding candidate feasibility', origin: input.aegisInputsOrigin },
      ],
      notes: 'Selection executing (structuralSelection ran) is never itself proof its inputs were fully real -- this must never be auto-promoted past the weakest real input feeding the frontier it selects over.',
    },
  ];
  const knownIds = new Set<string>(decisiveMethodIds);
  return rows.filter((row) => knownIds.has(row.methodId));
}
