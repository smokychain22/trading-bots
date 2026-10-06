import { createHash } from 'node:crypto';
import { z } from 'zod';

export const strategyPaperAuthorityVersion = 'theta-strategy-paper-authority-v1' as const;
export type PaperExposureStrategy = 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'THETA_DEFINED_RISK';
export type StrategyPaperMaturity = 'RESEARCH_ONLY' | 'TECHNICALLY_READY_FOR_PAPER'
  | 'PAPER_EXPERIMENTAL_AUTHORIZED' | 'PAPER_CHAMPION' | 'LIVE_NOT_AUTHORIZED';

export interface StrategyPaperAuthorityInput {
  readonly strategy: PaperExposureStrategy;
  readonly ownerPaperAuthorization: boolean;
  readonly technicalStrategyCertification: boolean;
  readonly idempotencyCertified: boolean;
  readonly riskAuthorization: boolean;
  readonly currentActionAuthorization: boolean;
  readonly brokerCapability: 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN';
  readonly decisionPlanBound: boolean;
  readonly reconciliationCertified: boolean;
  readonly managementCoverageCertified: boolean;
  readonly restartRecoveryCertified: boolean;
  readonly wholeChainAccountingCertified: boolean;
  readonly strategyCanaryAccepted: boolean;
  readonly liveAuthorization: false;
  readonly observedAt: string;
  readonly evidenceIds: readonly string[];
}

export interface StrategyPaperAuthorityReceipt extends StrategyPaperAuthorityInput {
  readonly contractVersion: typeof strategyPaperAuthorityVersion;
  readonly maturity: StrategyPaperMaturity;
  readonly paperOpeningOrderAllowed: boolean;
  readonly blockers: readonly string[];
  readonly receiptHash: string;
}

export const strategyPaperAuthorityReceiptSchema = z.object({
  contractVersion:z.literal(strategyPaperAuthorityVersion),
  strategy:z.enum(['THETA_CONVENTIONAL','THETA_HOLD_STRIKE','THETA_DEFINED_RISK']),
  ownerPaperAuthorization:z.boolean(),technicalStrategyCertification:z.boolean(),idempotencyCertified:z.boolean(),
  riskAuthorization:z.boolean(),currentActionAuthorization:z.boolean(),
  brokerCapability:z.enum(['SUPPORTED','UNSUPPORTED','UNKNOWN']),decisionPlanBound:z.boolean(),
  reconciliationCertified:z.boolean(),managementCoverageCertified:z.boolean(),restartRecoveryCertified:z.boolean(),
  wholeChainAccountingCertified:z.boolean(),strategyCanaryAccepted:z.boolean(),liveAuthorization:z.literal(false),
  observedAt:z.string().datetime({offset:true}),evidenceIds:z.array(z.string().min(1)).min(1),
  maturity:z.enum(['RESEARCH_ONLY','TECHNICALLY_READY_FOR_PAPER','PAPER_EXPERIMENTAL_AUTHORIZED','PAPER_CHAMPION','LIVE_NOT_AUTHORIZED']),
  paperOpeningOrderAllowed:z.boolean(),blockers:z.array(z.string()),receiptHash:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
};

/** Paper authority is a conjunction of independent evidence gates. Owner
 * approval can never replace missing lifecycle, reconciliation or broker
 * capability proof, and no Paper receipt can imply Live authorization. */
export function buildStrategyPaperAuthorityReceipt(input: StrategyPaperAuthorityInput): StrategyPaperAuthorityReceipt {
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error('STRATEGY_AUTHORITY_OBSERVED_AT_INVALID');
  if (input.evidenceIds.length === 0 || input.evidenceIds.some((value) => value.trim() === '')) {
    throw new Error('STRATEGY_AUTHORITY_EVIDENCE_REQUIRED');
  }
  const blockers: string[] = [];
  if (!input.ownerPaperAuthorization) blockers.push('OWNER_PAPER_AUTHORIZATION_MISSING');
  if (!input.technicalStrategyCertification) blockers.push('TECHNICAL_STRATEGY_CERTIFICATION_MISSING');
  if (!input.idempotencyCertified) blockers.push('IDEMPOTENCY_NOT_CERTIFIED');
  if (!input.riskAuthorization) blockers.push('RISK_AUTHORIZATION_MISSING');
  if (!input.currentActionAuthorization) blockers.push('CURRENT_ACTION_AUTHORIZATION_MISSING');
  if (input.brokerCapability !== 'SUPPORTED') blockers.push(`BROKER_CAPABILITY_${input.brokerCapability}`);
  if (!input.decisionPlanBound) blockers.push('SOVEREIGN_DECISION_PLAN_BINDING_MISSING');
  if (!input.reconciliationCertified) blockers.push('RECONCILIATION_NOT_CERTIFIED');
  if (!input.managementCoverageCertified) blockers.push('POSITION_MANAGEMENT_COVERAGE_NOT_CERTIFIED');
  if (!input.restartRecoveryCertified) blockers.push('RESTART_RECOVERY_NOT_CERTIFIED');
  if (!input.wholeChainAccountingCertified) blockers.push('WHOLE_CHAIN_ACCOUNTING_NOT_CERTIFIED');
  const paperOpeningOrderAllowed = blockers.length === 0;
  const maturity: StrategyPaperMaturity = paperOpeningOrderAllowed
    ? input.strategyCanaryAccepted ? 'PAPER_CHAMPION' : 'PAPER_EXPERIMENTAL_AUTHORIZED'
    : input.technicalStrategyCertification ? 'TECHNICALLY_READY_FOR_PAPER' : 'RESEARCH_ONLY';
  const normalizedInput: StrategyPaperAuthorityInput = {
    strategy: input.strategy,
    ownerPaperAuthorization: input.ownerPaperAuthorization,
    technicalStrategyCertification: input.technicalStrategyCertification,
    idempotencyCertified: input.idempotencyCertified,
    riskAuthorization: input.riskAuthorization,
    currentActionAuthorization: input.currentActionAuthorization,
    brokerCapability: input.brokerCapability,
    decisionPlanBound: input.decisionPlanBound,
    reconciliationCertified: input.reconciliationCertified,
    managementCoverageCertified: input.managementCoverageCertified,
    restartRecoveryCertified: input.restartRecoveryCertified,
    wholeChainAccountingCertified: input.wholeChainAccountingCertified,
    strategyCanaryAccepted: input.strategyCanaryAccepted,
    liveAuthorization: false,
    observedAt: input.observedAt,
    evidenceIds: [...input.evidenceIds],
  };
  const unsigned = { contractVersion: strategyPaperAuthorityVersion, ...normalizedInput, maturity,
    paperOpeningOrderAllowed, blockers: [...blockers].sort() };
  return { ...unsigned, receiptHash: createHash('sha256').update(canonical(unsigned)).digest('hex') };
}

export function verifyStrategyPaperAuthorityReceipt(receipt: StrategyPaperAuthorityReceipt,
  strategy: PaperExposureStrategy): boolean {
  try {
    const parsed = strategyPaperAuthorityReceiptSchema.parse(receipt);
    const input: StrategyPaperAuthorityInput = {
      strategy: parsed.strategy,
      ownerPaperAuthorization: parsed.ownerPaperAuthorization,
      technicalStrategyCertification: parsed.technicalStrategyCertification,
      idempotencyCertified: parsed.idempotencyCertified,
      riskAuthorization: parsed.riskAuthorization,
      currentActionAuthorization: parsed.currentActionAuthorization,
      brokerCapability: parsed.brokerCapability,
      decisionPlanBound: parsed.decisionPlanBound,
      reconciliationCertified: parsed.reconciliationCertified,
      managementCoverageCertified: parsed.managementCoverageCertified,
      restartRecoveryCertified: parsed.restartRecoveryCertified,
      wholeChainAccountingCertified: parsed.wholeChainAccountingCertified,
      strategyCanaryAccepted: parsed.strategyCanaryAccepted,
      liveAuthorization: false,
      observedAt: parsed.observedAt,
      evidenceIds: parsed.evidenceIds,
    };
    const rebuilt = buildStrategyPaperAuthorityReceipt(input);
    return rebuilt.receiptHash === parsed.receiptHash && parsed.strategy === strategy
      && parsed.paperOpeningOrderAllowed
      && ['PAPER_EXPERIMENTAL_AUTHORIZED','PAPER_CHAMPION'].includes(parsed.maturity);
  } catch {
    return false;
  }
}

export function assertStrategyPaperOrderAllowed(receipt: StrategyPaperAuthorityReceipt,
  strategy: PaperExposureStrategy): void {
  if (!verifyStrategyPaperAuthorityReceipt(receipt, strategy)) throw new Error('STRATEGY_PAPER_AUTHORITY_INVALID');
}
