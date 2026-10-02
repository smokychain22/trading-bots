/**
 * Cost-basis typing (Phase 2, area Q item 5).
 *
 * A dollar that THETA models (an opening/closing cost assumption, a slippage
 * assumption) must never be recorded, summed or reported as a dollar the broker
 * actually charged. Whole-chain REALIZED truth may only contain
 * BROKER_ACTUAL_FEE; an unproven actual fee is UNKNOWN_ACTUAL_FEE and is never
 * coerced to zero (a genuine, observed zero is a KNOWN BROKER_ACTUAL_FEE of 0).
 *
 * Pure vocabulary and guards only: no clock, no I/O, no policy.
 */
export const costBasisKinds = [
  'BROKER_ACTUAL_FEE', 'MODELED_OPENING_COST', 'MODELED_CLOSING_COST', 'SLIPPAGE_ASSUMPTION', 'UNKNOWN_ACTUAL_FEE',
] as const;
export type CostBasisKind = typeof costBasisKinds[number];

/** Anything THETA assumed rather than the broker reported. */
export const isModeledCostBasis = (kind: CostBasisKind): boolean =>
  kind === 'MODELED_OPENING_COST' || kind === 'MODELED_CLOSING_COST' || kind === 'SLIPPAGE_ASSUMPTION';

export interface TypedCostLine {
  readonly kind: CostBasisKind;
  /** Dollars per position (not per share); null = UNKNOWN. */
  readonly amount: number | null;
  readonly origin: string;
}

/** Broker relations whose `fees`/`amount` columns are broker-reported fill economics. */
const brokerActualRelations: ReadonlySet<string> = new Set(['trade.fill', 'trade.fee_event']);
const modeledOriginPattern = /(^|[._:-])(model|modeled|modelled|assumption|assumed|estimate|estimated|cost_model|slippage|simulated|benchmark)([._:-]|$)/i;

export interface FeeEvidenceLike {
  readonly status: 'KNOWN' | 'KNOWN_ZERO' | 'UNKNOWN';
  readonly sources: readonly { readonly relation: string }[];
  readonly reasons: readonly string[];
}

/**
 * Classifies where a whole-chain `fees` field came from.
 *  - UNKNOWN status                          -> UNKNOWN_ACTUAL_FEE
 *  - a modeled-looking source or reason       -> MODELED_OPENING_COST (never accepted as actual)
 *  - only broker fill / fee-event relations   -> BROKER_ACTUAL_FEE
 *  - anything else                            -> null (origin unproven; callers decide)
 */
export function classifyFeeEvidence(field: FeeEvidenceLike): CostBasisKind | null {
  if (field.status === 'UNKNOWN') return 'UNKNOWN_ACTUAL_FEE';
  const relations = field.sources.map((source) => source.relation);
  if (relations.some((relation) => modeledOriginPattern.test(relation))
    || field.reasons.some((reason) => modeledOriginPattern.test(reason))) return 'MODELED_OPENING_COST';
  if (relations.length > 0 && relations.every((relation) => brokerActualRelations.has(relation))) return 'BROKER_ACTUAL_FEE';
  return null;
}

/** Splits a modeled opening-cost receipt into separately typed lines (commission+fees are one MODELED line; slippage its own). */
export function typedLinesFromModeledOpeningCosts(costs: {
  readonly state: string;
  readonly commission: number | null;
  readonly fees: number | null;
  readonly slippage: number | null;
}): readonly TypedCostLine[] {
  if (costs.state !== 'KNOWN_MODELED') {
    return [{ kind: 'MODELED_OPENING_COST', amount: null, origin: `MODELED_OPENING_COSTS_${costs.state}` }];
  }
  const commissionAndFees = costs.commission === null || costs.fees === null ? null : costs.commission + costs.fees;
  return [
    { kind: 'MODELED_OPENING_COST', amount: commissionAndFees, origin: 'COST_MODEL_COMMISSION_AND_REGULATORY_FEES' },
    { kind: 'SLIPPAGE_ASSUMPTION', amount: costs.slippage, origin: 'COST_MODEL_SLIPPAGE_ASSUMPTION' },
  ];
}

/** Sum only lines of the given kind; any UNKNOWN amount makes the sum null (never a partial sum). */
export function sumCostLines(lines: readonly TypedCostLine[], kind: CostBasisKind): number | null {
  const selected = lines.filter((line) => line.kind === kind);
  if (selected.some((line) => line.amount === null || !Number.isFinite(line.amount))) return null;
  return selected.reduce((total, line) => total + (line.amount as number), 0);
}

/** Lines that must never appear inside a realized, broker-actual figure. */
export function modeledLinesInActual(lines: readonly TypedCostLine[]): readonly TypedCostLine[] {
  return lines.filter((line) => isModeledCostBasis(line.kind));
}
