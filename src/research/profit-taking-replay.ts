import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalV7ProfitTakingPolicies, observeFixedProfitTarget, type V7ProfitTakingPolicy } from './profit-taking-experiment.js';

const finite = z.number().finite();
const timestamp = z.string().datetime({ offset: true });
const forecast = z.object({
  modelVersion: z.string().min(1), availableAt: timestamp, validThrough: timestamp,
  horizonEnd: timestamp, units: z.literal('USD_PER_EPISODE_INCREMENTAL_VS_CLOSE_NOW_AFTER_COST'),
  holdValue: finite, uncertainty: finite.nonnegative(), tailLoss: finite.nonnegative().nullable(),
  redeploymentValue: finite.nullable(), evidenceIds: z.array(z.string().min(1)).min(1),
}).strict();

export const profitReplayInputSchema = z.object({
  version: z.literal('theta-profit-taking-replay-input-v1'),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  sourceManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  episodeId: z.string().min(1), chainId: z.string().min(1),
  evidenceClass: z.enum(['REAL_PERSISTED', 'DETERMINISTIC_TEST']),
  entryAt: timestamp, entryCreditDollars: finite.positive(), entryFeesDollars: finite.nonnegative(),
  policy: z.object({ version: z.string().min(1), maxHoldingMinutes: finite.positive(),
    exitDte: finite.nonnegative(), maxTailLossDollars: finite.nonnegative() }).strict(),
  observations: z.array(z.object({
    evidenceId: z.string().min(1), decisionAt: timestamp, dte: finite.nonnegative(),
    closeAskDollars: finite.nonnegative().nullable(), closeFeesDollars: finite.nonnegative().nullable(),
    adverseSlippageDollars: finite.nonnegative().nullable(),
    quoteAt: timestamp.nullable(), quoteReceivedAt: timestamp.nullable(), quoteValidThrough: timestamp.nullable(),
    quoteAuthority: z.enum(['ALPACA_EXECUTABLE_MARKET', 'UNQUALIFIED']),
    hardRiskExitRequired: z.boolean().nullable(), eventExitRequired: z.boolean().nullable(),
    riskAvailableAt: timestamp.nullable(), eventAvailableAt: timestamp.nullable(), eventValidThrough: timestamp.nullable(),
    forecast: forecast.nullable(),
  }).strict()),
}).strict();

export type ProfitReplayInput = z.infer<typeof profitReplayInputSchema>;
type Observation = ProfitReplayInput['observations'][number];
export interface ProfitReplayDecision {
  readonly policy: V7ProfitTakingPolicy;
  readonly evidenceId: string;
  readonly decisionAt: string;
  readonly action: 'CLOSE' | 'HOLD' | 'UNRESOLVED';
  readonly reason: string;
}

const knownTime = (value: string | null, at: number): boolean => value !== null && Date.parse(value) <= at;
const result = (policy: V7ProfitTakingPolicy, o: Observation, action: ProfitReplayDecision['action'], reason: string): ProfitReplayDecision =>
  ({ policy, evidenceId: o.evidenceId, decisionAt: o.decisionAt, action, reason });

function evaluate(policy: V7ProfitTakingPolicy, o: Observation, input: ProfitReplayInput): ProfitReplayDecision {
  const at = Date.parse(o.decisionAt);
  const done = (action: ProfitReplayDecision['action'], reason: string) => result(policy, o, action, reason);
  if (o.quoteAuthority !== 'ALPACA_EXECUTABLE_MARKET' || o.closeAskDollars === null || o.closeFeesDollars === null
    || o.adverseSlippageDollars === null || !knownTime(o.quoteAt, at) || !knownTime(o.quoteReceivedAt, at)
    || o.quoteValidThrough === null || Date.parse(o.quoteValidThrough) < at) {
    return done('UNRESOLVED', 'EXECUTABLE_CLOSE_EVIDENCE_UNAVAILABLE');
  }
  if (Date.parse(o.quoteAt as string) > Date.parse(o.quoteReceivedAt as string)) {
    return done('UNRESOLVED', 'QUOTE_PROVIDER_TIME_AFTER_RECEIPT');
  }
  if (policy.startsWith('FIXED_')) {
    const fixed = observeFixedProfitTarget({ policy: policy as Extract<V7ProfitTakingPolicy, `FIXED_${string}`>,
      openCredit: input.entryCreditDollars, executableCloseDebit: o.closeAskDollars });
    return done(fixed.benchmarkAction, 'GROSS_PREMIUM_CAPTURE_BENCHMARK_NET_COSTS_REPORTED_SEPARATELY');
  }
  if (policy === 'TIME_EXIT') return done(at - Date.parse(input.entryAt) >= input.policy.maxHoldingMinutes * 60_000
    ? 'CLOSE' : 'HOLD', 'VERSIONED_ELAPSED_TIME_BENCHMARK');
  if (policy === 'DTE_EXIT') return done(o.dte <= input.policy.exitDte ? 'CLOSE' : 'HOLD', 'VERSIONED_DTE_BENCHMARK');
  if (policy === 'DYNAMIC_EV_PLUS_HARD_RISK') {
    if (o.hardRiskExitRequired === null || !knownTime(o.riskAvailableAt, at)) return done('UNRESOLVED', 'HARD_RISK_UNKNOWN');
    if (o.hardRiskExitRequired) return done('CLOSE', 'OBSERVED_HARD_RISK_EXIT');
  }
  if (policy === 'DYNAMIC_EV_PLUS_EVENT') {
    if (o.eventExitRequired === null || !knownTime(o.eventAvailableAt, at)
      || o.eventValidThrough === null || Date.parse(o.eventValidThrough) < at) return done('UNRESOLVED', 'EVENT_UNKNOWN_OR_STALE');
    if (o.eventExitRequired) return done('CLOSE', 'OBSERVED_EVENT_EXIT');
  }
  const f = o.forecast;
  if (f === null) return done('UNRESOLVED', 'EV_MODEL_NOT_EMPIRICALLY_READY');
  if (!knownTime(f.availableAt, at) || Date.parse(f.validThrough) < at || Date.parse(f.horizonEnd) <= at) {
    return done('UNRESOLVED', 'FORECAST_NOT_POINT_IN_TIME_VALID');
  }
  if (policy === 'DYNAMIC_EV_PLUS_HARD_RISK') {
    if (f.tailLoss === null) return done('UNRESOLVED', 'TAIL_RISK_UNKNOWN');
    if (f.tailLoss > input.policy.maxTailLossDollars) return done('CLOSE', 'VERSIONED_TAIL_RISK_LIMIT');
  }
  let alternative = 0; // Immediate close is the explicit incremental-dollar reference, never missing EV.
  if (policy === 'DYNAMIC_EV_PLUS_CAPITAL_EFFICIENCY') {
    if (f.redeploymentValue === null) return done('UNRESOLVED', 'COMMON_HORIZON_REDEPLOYMENT_VALUE_UNKNOWN');
    alternative = Math.max(0, f.redeploymentValue);
  }
  return done(f.holdValue - f.uncertainty > alternative ? 'HOLD' : 'CLOSE', 'RESEARCH_LOWER_BOUND_CONTINUATION_VS_ALTERNATIVE');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Pure offline R8C execution. No provider, DB, model training or broker client.
 * Missing decisions censor a path. Later quotes cannot repair an earlier unknown
 * exit and no hypothetical fill is reported as a broker-confirmed outcome.
 */
export function runProfitTakingReplay(raw: unknown) {
  const input = profitReplayInputSchema.parse(raw);
  const observations = [...input.observations].sort((a, b) => a.decisionAt.localeCompare(b.decisionAt));
  // ISO strings may use different offsets. Compare their actual instants.
  observations.sort((a, b) => Date.parse(a.decisionAt) - Date.parse(b.decisionAt));
  const seenIds = new Set<string>(); const seenTimes = new Set<number>();
  for (const o of observations) {
    const at = Date.parse(o.decisionAt);
    if (at < Date.parse(input.entryAt) || seenIds.has(o.evidenceId) || seenTimes.has(at)) {
      throw new Error('REPLAY_DUPLICATE_OR_PRE_ENTRY_EVIDENCE');
    }
    seenIds.add(o.evidenceId); seenTimes.add(at);
  }
  const policies = canonicalV7ProfitTakingPolicies.map((policy) => {
    const decisions: ProfitReplayDecision[] = [];
    let netPnl: number | null = null;
    let terminal: 'ESTIMATED_EXIT' | 'CENSORED' | 'OPEN_UNRESOLVED' = 'OPEN_UNRESOLVED';
    for (const observation of observations) {
      const decision = evaluate(policy, observation, input);
      decisions.push(decision);
      if (decision.action === 'UNRESOLVED') { terminal = 'CENSORED'; break; }
      if (decision.action === 'CLOSE') {
        if (observation.closeAskDollars === null || observation.closeFeesDollars === null || observation.adverseSlippageDollars === null) {
          throw new Error('REPLAY_CLOSE_WITHOUT_EXECUTION_COSTS');
        }
        netPnl = input.entryCreditDollars - input.entryFeesDollars - observation.closeAskDollars
          - observation.closeFeesDollars - observation.adverseSlippageDollars;
        if (!Number.isFinite(netPnl)) throw new Error('REPLAY_AFTER_COST_PNL_NONFINITE');
        terminal = 'ESTIMATED_EXIT'; break;
      }
    }
    return { policy, terminal, decisions, estimatedAfterCostPnlDollars: netPnl, actualFill: false as const };
  });
  const payload = { version: 'theta-profit-taking-replay-v2', sourceSha: input.sourceSha,
    sourceManifestHash: input.sourceManifestHash, episodeId: input.episodeId, chainId: input.chainId,
    evidenceClass: input.evidenceClass, policyVersion: input.policy.version,
    inputHash: createHash('sha256').update(canonical({ ...input, observations })).digest('hex'),
    fillAssumption: 'OBSERVED_CLOSE_ASK_PLUS_EXPLICIT_ADVERSE_SLIPPAGE_AND_FEES_NOT_ACTUAL_FILL',
    policies, brokerAuthority: false as const, profitability: 'EMPIRICALLY_UNPROVEN' };
  return { ...payload, contentHash: createHash('sha256').update(canonical(payload)).digest('hex') };
}
