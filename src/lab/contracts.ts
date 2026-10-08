import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalThetaStrategyRegistry, resolveStrategyVersion, thetaFeatureFamily,
  type ThetaStrategyVersionSource } from '../theta/strategy-package.js';
import { allProfitTakingPolicies } from '../research/profit-taking-experiment.js';

export const dotLabIdentitySchema = z.object({
  version: z.literal('dot-strategy-lab-v1'),
  providerAccountId: z.string().uuid(),
  executionAccountId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  accountNumber: z.string().min(1),
  confirmedAt: z.string().datetime({ offset: true }),
  environment: z.literal('PAPER'),
  brokerExecutionEnabled: z.literal(false),
  workerEnabled: z.literal(false),
}).strict();
export type DotLabIdentity = z.infer<typeof dotLabIdentitySchema>;

const researchRule = z.object({
  feature: thetaFeatureFamily,
  operator: z.enum(['GTE', 'LTE', 'BETWEEN']),
  lower: z.number().finite().nullable(),
  upper: z.number().finite().nullable(),
  role: z.literal('RESEARCH_ONLY'),
}).strict().superRefine((rule, ctx) => {
  if ((rule.operator === 'GTE' && rule.lower === null)
    || (rule.operator === 'LTE' && rule.upper === null)
    || (rule.operator === 'BETWEEN' && (rule.lower === null || rule.upper === null || rule.lower > rule.upper))) {
    ctx.addIssue({ code: 'custom', message: 'research rule bounds missing or invalid' });
  }
});
const sourceInput = z.record(z.string(), z.unknown());
export const dotProposalInputSchema = z.object({
  proposalId: z.string().uuid(),
  parentProposalHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  baselineHash: z.string().regex(/^[a-f0-9]{64}$/),
  strategy: sourceInput,
  hypothesis: z.string().min(10).max(2000),
  researchRules: z.array(researchRule).max(30),
  profitTakingChallengers: z.array(z.string().refine(value => allProfitTakingPolicies.includes(value as typeof allProfitTakingPolicies[number]))).max(17),
  plannedHoldingDays: z.number().int().positive().max(3650),
  experimentId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
}).strict();

export function canonicalHash(value: unknown): string {
  const stable = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(stable).join(',')}]`;
    if (item !== null && typeof item === 'object') return `{${Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
    return JSON.stringify(item);
  };
  return createHash('sha256').update(stable(value)).digest('hex');
}

export function validateDotProposal(input: unknown) {
  const parsed = dotProposalInputSchema.parse(input);
  const text = JSON.stringify(parsed);
  if (/\bPA[A-Z0-9]{8,}\b/.test(text)
    || /APCA-API|ALPACA_(API|SECRET)|Bearer\s|BEGIN .*PRIVATE KEY|account_number|providerAccountId/i.test(text)) throw new Error('DOT_PROPOSAL_SENSITIVE_CONTENT');
  const strategy = resolveStrategyVersion(parsed.strategy as unknown as ThetaStrategyVersionSource);
  const baseline = [...canonicalThetaStrategyRegistry.values()].find(item => item.configurationHash === parsed.baselineHash);
  if (!baseline || strategy.branch !== baseline.branch || strategy.strategyId !== baseline.strategyId) throw new Error('DOT_BASELINE_MISMATCH');
  if (strategy.executionEnabled || strategy.status !== 'RESEARCH_ONLY' || strategy.promotionStatus !== 'UNVALIDATED') throw new Error('DOT_PROPOSAL_AUTHORITY_FORBIDDEN');
  if (strategy.strategyVersion === baseline.strategyVersion) throw new Error('DOT_NEW_VERSION_REQUIRED');
  for (const field of ['riskLimitVersion', 'multiplierSemantics', 'costModelVersion', 'executionModelVersion'] as const) {
    if (strategy[field] !== baseline[field]) throw new Error('DOT_RISK_BOUNDARY_CHANGE_FORBIDDEN');
  }
  if (canonicalHash([...strategy.hardRules].sort()) !== canonicalHash([...baseline.hardRules].sort())) throw new Error('DOT_HARD_RULE_CHANGE_FORBIDDEN');
  if (strategy.allowedActions.some(action => !baseline.allowedActions.includes(action))) throw new Error('DOT_ACTION_EXPANSION_FORBIDDEN');
  const value = { ...parsed, strategy, brokerAuthority: false as const, status: 'DRAFT_RESEARCH_ONLY' as const };
  return { ...value, proposalHash: canonicalHash(value) };
}
export type DotProposal = ReturnType<typeof validateDotProposal>;

/** Normalized public input can be exchanged and revalidated without trusting receipt fields. */
export function dotProposalSource(proposal: DotProposal) {
  const { configurationHash: _hash, ...strategy } = proposal.strategy;
  void _hash;
  return { proposalId: proposal.proposalId, parentProposalHash: proposal.parentProposalHash,
    baselineHash: proposal.baselineHash, strategy, hypothesis: proposal.hypothesis,
    researchRules: proposal.researchRules, profitTakingChallengers: proposal.profitTakingChallengers,
    plannedHoldingDays: proposal.plannedHoldingDays, experimentId: proposal.experimentId };
}
