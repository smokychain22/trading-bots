import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Canonical business names. The existing THETA_Q/H/A/C/D router codes map here. */
export const thetaStrategyBranch = z.enum([
  'THETA_CONVENTIONAL',
  'THETA_HOLD_STRIKE',
  'THETA_RECOVERY',
  'THETA_CC',
  'THETA_DEFINED_RISK',
]);
export type ThetaStrategyBranch = z.infer<typeof thetaStrategyBranch>;

export const thetaStrategyAction = z.enum([
  'OPEN_CSP', 'OPEN_DEFINED_RISK', 'HOLD', 'CLOSE_FULL', 'ROLL', 'LET_EXPIRE',
  'ACCEPT_ASSIGNMENT', 'REDEPLOY', 'RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC',
  'HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY', 'WAIT', 'PASS',
]);

export const thetaFeatureFamily = z.enum([
  'LIQUIDITY', 'OWNERSHIP', 'DRAWDOWN_RECOVERY', 'TREND', 'MOMENTUM',
  'REALIZED_VOLATILITY', 'IV', 'SKEW', 'TERM_STRUCTURE', 'VOLATILITY_SURFACE',
  'FLOW', 'UNUSUAL_ACTIVITY', 'VOLUME_OPEN_INTEREST', 'EVENT_CONTEXT',
  'SECTOR', 'CORRELATION', 'PORTFOLIO_EXPOSURE', 'FUNDAMENTAL_QUALITY',
  'REGIME', 'EXECUTION_QUALITY',
]);

export const thetaHardRule = z.enum([
  'SUPPORTED_SESSION', 'STANDARD_CONTRACT', 'KNOWN_MULTIPLIER', 'FRESH_BROKER_STATE',
  'FRESH_EXECUTABLE_BBO', 'COLLATERAL_CAPACITY', 'ASSIGNMENT_CAPACITY',
  'PORTFOLIO_RISK_WITHIN_LIMITS', 'RECONCILED_LIFECYCLE', 'AEGIS_NOT_VETOED',
  'VALID_NONZERO_QUANTITY',
]);

const versionRef = z.string().min(1);
const strategyVersionSourceSchema = z.object({
  strategyId: z.string().min(1),
  strategyVersion: z.string().min(1),
  branch: thetaStrategyBranch,
  status: z.enum(['RESEARCH_ONLY', 'SHADOW', 'PAPER', 'LIVE_SMALL', 'LIVE', 'RETIRED']),
  executionEnabled: z.boolean(),
  candidateLatticeVersion: versionRef,
  featureSetVersion: versionRef,
  entryModelVersion: versionRef,
  ownershipModelVersion: versionRef,
  managementPolicyVersion: versionRef,
  riskLimitVersion: versionRef,
  costModelVersion: versionRef,
  executionModelVersion: versionRef,
  promotionStatus: z.enum(['UNVALIDATED', 'RESEARCH_ELIGIBLE', 'PROMOTED', 'DEGRADED', 'RETIRED']),
  lattice: z.object({
    dteMin: z.number().int().nonnegative(),
    dteMax: z.number().int().positive(),
    optionType: z.enum(['PUT', 'CALL', 'PUT_OR_CALL']),
    deltaResearchBuckets: z.array(z.number().finite().min(0).max(1)),
  }),
  multiplierSemantics: z.literal('BROKER_CONTRACT_METADATA_REQUIRED'),
  hardRules: z.array(thetaHardRule).min(1),
  softFeatureFamilies: z.array(thetaFeatureFamily),
  allowedActions: z.array(thetaStrategyAction).min(1),
}).strict().superRefine((config, context) => {
  if (config.lattice.dteMin > config.lattice.dteMax) {
    context.addIssue({ code: 'custom', path: ['lattice'], message: 'dteMin must not exceed dteMax' });
  }
  if (config.executionEnabled && (config.status === 'RESEARCH_ONLY' || config.promotionStatus !== 'PROMOTED')) {
    context.addIssue({ code: 'custom', path: ['executionEnabled'], message: 'research or unpromoted branches cannot execute' });
  }
  if (config.branch === 'THETA_DEFINED_RISK' && config.status !== 'RESEARCH_ONLY') {
    context.addIssue({ code: 'custom', path: ['status'], message: 'defined-risk remains research-only' });
  }
});

export type ThetaStrategyVersionSource = z.input<typeof strategyVersionSourceSchema>;
export type ThetaStrategyVersion = z.output<typeof strategyVersionSourceSchema> & { readonly configurationHash: string };

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function resolveStrategyVersion(source: ThetaStrategyVersionSource): ThetaStrategyVersion {
  const parsed = strategyVersionSourceSchema.parse(source);
  const configurationHash = createHash('sha256').update(stable(parsed)).digest('hex');
  return deepFreeze({ ...parsed, configurationHash });
}

export function buildStrategyRegistry(sources: readonly ThetaStrategyVersionSource[]): ReadonlyMap<string, ThetaStrategyVersion> {
  const versions = sources.map(resolveStrategyVersion);
  const registry = new Map<string, ThetaStrategyVersion>();
  for (const version of versions) {
    const key = `${version.strategyId}@${version.strategyVersion}`;
    if (registry.has(key)) throw new Error(`DUPLICATE_STRATEGY_VERSION:${key}`);
    registry.set(key, version);
  }
  return registry;
}

const sharedHardRules: ThetaStrategyVersionSource['hardRules'] = [
  'SUPPORTED_SESSION', 'STANDARD_CONTRACT', 'KNOWN_MULTIPLIER', 'FRESH_BROKER_STATE',
  'FRESH_EXECUTABLE_BBO', 'COLLATERAL_CAPACITY', 'ASSIGNMENT_CAPACITY',
  'PORTFOLIO_RISK_WITHIN_LIMITS', 'RECONCILED_LIFECYCLE', 'AEGIS_NOT_VETOED',
  'VALID_NONZERO_QUANTITY',
];

const refs = {
  candidateLatticeVersion: 'theta-lattice-v1', featureSetVersion: 'theta-feature-set-v1',
  entryModelVersion: 'EV_MODEL_NOT_EMPIRICALLY_READY', ownershipModelVersion: 'theta-ownership-runtime-v1',
  managementPolicyVersion: 'theta-management-action-frontier-v1', riskLimitVersion: 'theta-aegis-runtime-v1',
  costModelVersion: 'theta-cost-model-v1', executionModelVersion: 'theta-execution-quality-runtime-v2',
  promotionStatus: 'UNVALIDATED' as const, multiplierSemantics: 'BROKER_CONTRACT_METADATA_REQUIRED' as const,
  hardRules: sharedHardRules,
};

export const canonicalThetaStrategySources: readonly ThetaStrategyVersionSource[] = [
  { ...refs, strategyId: 'theta-conventional', strategyVersion: '1.0.0-research', branch: 'THETA_CONVENTIONAL',
    status: 'SHADOW', executionEnabled: false,
    lattice: { dteMin: 25, dteMax: 60, optionType: 'PUT', deltaResearchBuckets: [0.10, 0.15, 0.20, 0.25, 0.30, 0.40] },
    softFeatureFamilies: ['LIQUIDITY', 'OWNERSHIP', 'DRAWDOWN_RECOVERY', 'TREND', 'MOMENTUM', 'REALIZED_VOLATILITY', 'IV', 'SKEW', 'TERM_STRUCTURE', 'VOLATILITY_SURFACE', 'FLOW', 'UNUSUAL_ACTIVITY', 'VOLUME_OPEN_INTEREST', 'EVENT_CONTEXT', 'SECTOR', 'CORRELATION', 'PORTFOLIO_EXPOSURE', 'FUNDAMENTAL_QUALITY', 'REGIME', 'EXECUTION_QUALITY'],
    allowedActions: ['OPEN_CSP', 'HOLD', 'CLOSE_FULL', 'ROLL', 'LET_EXPIRE', 'ACCEPT_ASSIGNMENT', 'REDEPLOY', 'WAIT', 'PASS'] },
  { ...refs, strategyId: 'theta-hold-strike', strategyVersion: '1.0.0-research', branch: 'THETA_HOLD_STRIKE',
    status: 'RESEARCH_ONLY', executionEnabled: false,
    lattice: { dteMin: 2, dteMax: 5, optionType: 'PUT', deltaResearchBuckets: [] },
    softFeatureFamilies: ['LIQUIDITY', 'OWNERSHIP', 'DRAWDOWN_RECOVERY', 'EVENT_CONTEXT', 'REGIME', 'EXECUTION_QUALITY'],
    allowedActions: ['OPEN_CSP', 'HOLD', 'CLOSE_FULL', 'LET_EXPIRE', 'ACCEPT_ASSIGNMENT', 'WAIT', 'PASS'] },
  { ...refs, strategyId: 'theta-recovery', strategyVersion: '1.0.0-research', branch: 'THETA_RECOVERY',
    status: 'SHADOW', executionEnabled: false,
    lattice: { dteMin: 0, dteMax: 3650, optionType: 'PUT_OR_CALL', deltaResearchBuckets: [] },
    softFeatureFamilies: ['OWNERSHIP', 'DRAWDOWN_RECOVERY', 'EVENT_CONTEXT', 'PORTFOLIO_EXPOSURE', 'REGIME'],
    allowedActions: ['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC'] },
  { ...refs, strategyId: 'theta-covered-call', strategyVersion: '1.0.0-research', branch: 'THETA_CC',
    status: 'SHADOW', executionEnabled: false,
    lattice: { dteMin: 1, dteMax: 60, optionType: 'CALL', deltaResearchBuckets: [] },
    softFeatureFamilies: ['LIQUIDITY', 'OWNERSHIP', 'DRAWDOWN_RECOVERY', 'IV', 'SKEW', 'TERM_STRUCTURE', 'EVENT_CONTEXT', 'REGIME', 'EXECUTION_QUALITY'],
    allowedActions: ['SELL_CC', 'HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY', 'RECOVERY_WAIT'] },
  { ...refs, strategyId: 'theta-defined-risk', strategyVersion: '1.0.0-research', branch: 'THETA_DEFINED_RISK',
    status: 'RESEARCH_ONLY', executionEnabled: false,
    lattice: { dteMin: 7, dteMax: 60, optionType: 'PUT_OR_CALL', deltaResearchBuckets: [] },
    softFeatureFamilies: ['LIQUIDITY', 'IV', 'SKEW', 'TERM_STRUCTURE', 'EVENT_CONTEXT', 'REGIME', 'EXECUTION_QUALITY'],
    allowedActions: ['OPEN_DEFINED_RISK', 'HOLD', 'CLOSE_FULL', 'WAIT', 'PASS'] },
] as const;

export const canonicalThetaStrategyRegistry = buildStrategyRegistry(canonicalThetaStrategySources);

export const routerFamilyToBranch = {
  THETA_Q: 'THETA_CONVENTIONAL', THETA_H: 'THETA_HOLD_STRIKE', THETA_A: 'THETA_RECOVERY',
  THETA_C: 'THETA_CC', THETA_D: 'THETA_DEFINED_RISK',
} as const satisfies Readonly<Record<string, ThetaStrategyBranch>>;

/** THETA_R is a management route over the active lifecycle branch, not a sixth product strategy. */
export function canonicalBranchForRouterFamily(family: 'THETA_Q' | 'THETA_H' | 'THETA_R' | 'THETA_A' | 'THETA_C' | 'THETA_D',
  lifecycleState?: 'CSP_OPEN' | 'STOCK_HELD' | 'RECOVERY_WAIT' | 'CC_OPEN'): ThetaStrategyBranch | null {
  if (family !== 'THETA_R') return routerFamilyToBranch[family];
  if (lifecycleState === 'CSP_OPEN') return 'THETA_CONVENTIONAL';
  if (lifecycleState === 'CC_OPEN') return 'THETA_CC';
  if (lifecycleState === 'STOCK_HELD' || lifecycleState === 'RECOVERY_WAIT') return 'THETA_RECOVERY';
  return null;
}
