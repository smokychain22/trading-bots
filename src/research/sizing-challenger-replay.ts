import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from './point-in-time-evidence.js';

/** Explicit experiment parameters, not new Production sizing policy. */
export const sizingChallengers = ['FIXED_CAPITAL_FRACTION', 'FIXED_RISK_BUDGET', 'STRESS_LOSS_BUDGET',
  'EXPECTED_SHORTFALL_BUDGET', 'VOLATILITY_SCALED', 'DRAWDOWN_SCALED', 'CORRELATION_SCALED', 'FRACTIONAL_KELLY'] as const;
const money = z.number().finite().nonnegative().nullable();
const fraction = z.number().finite().min(0).max(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });

export const sizingChallengerInputSchema = z.object({
  candidateId: z.string().min(1), snapshotId: z.string().min(1), asOf: timestamp, observedAt: timestamp,
  evidenceIds: z.array(z.string().min(1)).min(1),
  truthClass: z.enum(['MARKET_OBSERVED', 'MODELED_RESEARCH', 'NON_EMPIRICAL_TEST_DATA']),
  units: z.literal('USD_AND_DECIMAL_FRACTIONS_ANNUALIZED_VOL'),
  equity: money, buyingPower: money, collateralPerUnit: money, maximumLossPerUnit: money,
  stressLossPerUnit: money, expectedShortfallPerUnit: money,
  annualizedVolatility: z.number().finite().nonnegative().nullable(),
  drawdownFraction: fraction.nullable(), correlatedExposureFraction: fraction.nullable(),
  canonicalQuantityCap: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  policy: z.object({
    version: z.string().min(1), capitalFraction: fraction, riskBudgetDollars: z.number().finite().nonnegative(),
    targetAnnualizedVolatility: z.number().finite().positive(), maximumDrawdownFraction: fraction.positive(),
    kellyFraction: fraction, maximumKellyEquityFraction: fraction,
    minimumOosIndependentN: z.number().int().positive(), maximumOosEce: fraction,
  }).strict(),
  // Exact, already evaluated OOS artifacts are required. Merely providing p
  // and average payoff is insufficient. This does not promote the model.
  kelly: z.object({
    probabilityPositive: fraction, averageWin: z.number().finite().positive(), averageLoss: z.number().finite().positive(),
    modelId: z.string().min(1), modelVersion: z.string().min(1), modelArtifactHash: hash,
    datasetHash: hash, calibrationArtifactHash: hash, validationPolicyVersion: z.string().min(1),
    fitEnd: timestamp, oosStart: timestamp, oosEnd: timestamp, observedAt: timestamp,
    outcomeDefinition: z.literal('RESOLVED_WHOLE_CHAIN_AFTER_COST'),
    calibration: z.object({ modelId: z.string().min(1), modelVersion: z.string().min(1),
      dataProvenance: z.enum(['REAL_EMPIRICAL_DATA', 'NON_EMPIRICAL_TEST_DATA']),
      n: z.number().int().positive(), independentN: z.number().finite().positive(),
      ece: fraction, brierScore: fraction,
    }).strict(),
  }).strict().nullable(),
}).strict().superRefine((input, context) => {
  if (Date.parse(input.observedAt) > Date.parse(input.asOf))
    context.addIssue({ code: 'custom', message: 'SIZING_RESEARCH_FUTURE_INPUT' });
});
export type SizingChallengerInput = z.infer<typeof sizingChallengerInputSchema>;

export function replaySizingChallengers(raw: unknown) {
  const input = sizingChallengerInputSchema.parse(raw);
  const policy = input.policy;
  const capital = input.equity === null ? null : input.equity * policy.capitalFraction;
  const divide = (amount: number | null, unit: number | null): number | null =>
    amount !== null && unit !== null && unit > 0 ? amount / unit : null;
  const kelly = input.kelly;
  const payoffRatio = kelly === null ? null : kelly.averageWin / kelly.averageLoss;
  const kellyQualified = kelly !== null && kelly.calibration.dataProvenance === 'REAL_EMPIRICAL_DATA'
    && payoffRatio !== null && Number.isFinite(payoffRatio) && payoffRatio > 0
    && kelly.calibration.modelId === kelly.modelId && kelly.calibration.modelVersion === kelly.modelVersion
    && kelly.calibration.independentN >= policy.minimumOosIndependentN
    && kelly.calibration.independentN <= kelly.calibration.n && kelly.calibration.ece <= policy.maximumOosEce
    && Date.parse(kelly.fitEnd) < Date.parse(kelly.oosStart) && Date.parse(kelly.oosStart) < Date.parse(kelly.oosEnd)
    && Date.parse(kelly.oosEnd) <= Date.parse(kelly.observedAt) && Date.parse(kelly.observedAt) <= Date.parse(input.asOf);
  const kellyStake = kellyQualified && kelly !== null && payoffRatio !== null && input.equity !== null
    ? input.equity * Math.min(policy.maximumKellyEquityFraction,
      Math.max(0, kelly.probabilityPositive - (1 - kelly.probabilityPositive) / payoffRatio) * policy.kellyFraction)
    : null;
  const rawQuantities: (number | null)[] = [
    divide(capital, input.collateralPerUnit),
    divide(policy.riskBudgetDollars, input.maximumLossPerUnit),
    divide(policy.riskBudgetDollars, input.stressLossPerUnit),
    divide(policy.riskBudgetDollars, input.expectedShortfallPerUnit),
    divide(capital !== null && input.annualizedVolatility !== null && input.annualizedVolatility > 0
      ? capital * Math.min(1, policy.targetAnnualizedVolatility / input.annualizedVolatility) : null, input.collateralPerUnit),
    divide(capital !== null && input.drawdownFraction !== null
      ? capital * Math.max(0, 1 - input.drawdownFraction / policy.maximumDrawdownFraction) : null, input.collateralPerUnit),
    divide(capital !== null && input.correlatedExposureFraction !== null
      ? capital * (1 - input.correlatedExposureFraction) : null, input.collateralPerUnit),
    // Kelly stakes wealth at risk, not gross collateral. Broker affordability
    // and the existing canonical quantity cap remain independent bounds.
    divide(kellyStake, input.maximumLossPerUnit),
  ];
  const affordable = divide(input.buyingPower, input.collateralPerUnit);
  const results = sizingChallengers.map((method, index) => {
    const rawQuantity = rawQuantities[index] ?? null;
    const reasons: string[] = [];
    if (method === 'FRACTIONAL_KELLY' && !kellyQualified) reasons.push('OOS_CALIBRATED_PROBABILITY_AND_PAYOFF_REQUIRED');
    if (rawQuantity === null) reasons.push('REQUIRED_CHALLENGER_INPUT_UNKNOWN');
    if (input.canonicalQuantityCap === null) reasons.push('CANONICAL_CAP_UNKNOWN');
    if (affordable === null) reasons.push('BROKER_AFFORDABILITY_UNKNOWN');
    if ([rawQuantity, affordable].some(value => value !== null && (!Number.isFinite(value) || value < 0)))
      reasons.push('NUMERIC_RESULT_INVALID');
    const quantity = reasons.length > 0 || rawQuantity === null || affordable === null || input.canonicalQuantityCap === null
      ? null : Math.floor(Math.min(rawQuantity, affordable, input.canonicalQuantityCap));
    return { method, state: quantity === null ? 'BLOCKED_REQUIRED_EVIDENCE' as const : 'RESEARCH_COMPUTED' as const,
      quantity, rawQuantity: rawQuantity !== null && Number.isFinite(rawQuantity) ? rawQuantity : null,
      bindingConstraints: quantity === null ? [] : [
        ...(rawQuantity !== null && Math.floor(rawQuantity) === quantity ? ['CHALLENGER'] : []),
        ...(affordable !== null && Math.floor(affordable) === quantity ? ['BROKER_AFFORDABILITY'] : []),
        ...(input.canonicalQuantityCap === quantity ? ['CANONICAL_CAP'] : []),
      ], reasons };
  });
  const body = { version: 'theta-sizing-challenger-replay-v1', candidateId: input.candidateId, snapshotId: input.snapshotId,
    asOf: input.asOf, policyVersion: policy.version, inputHash: createHash('sha256').update(canonicalJson(input)).digest('hex'),
    truthClass: input.truthClass, inputEvidenceIds: input.evidenceIds, results,
    numberOfTrials: sizingChallengers.length, brokerAuthority: false, changesProductionSizing: false,
    modelPromotion: 'NOT_GRANTED', profitability: 'EMPIRICALLY_UNPROVEN',
    evidenceScope: 'CALLER_SUPPLIED_OFFLINE_EXPERIMENT_NOT_CURRENT_WORKER_CERTIFICATION' };
  return { ...body, contentHash: createHash('sha256').update(canonicalJson(body)).digest('hex') };
}
