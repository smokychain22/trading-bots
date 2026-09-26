/**
 * COMMAND 5C-7 item 30: filter interaction analysis. Single-feature
 * effects may be confounded by an interacting family -- this registry
 * bounds interaction testing to a pre-registered, finite list (never
 * unconstrained data mining) and requires every tested interaction to be
 * registered as a DSR/PBO trial (`selection-bias-receipt.ts`'s
 * `trialIdentities`) before its result can be used as evidence.
 */
import type { CanonicalFeatureFamily } from './filter-value-classification.js';

export const filterInteractionRegistryVersion = 'theta-filter-interaction-registry-v1' as const;

export interface FeatureInteractionPair {
  readonly interactionId: string;
  readonly familyA: CanonicalFeatureFamily;
  readonly familyB: CanonicalFeatureFamily;
}

/** The exact, pre-registered set the directive names -- never expanded ad
 * hoc during analysis (that would be exactly the unconstrained data
 * mining §30 forbids). Adding a new interaction requires a deliberate
 * code change to this list, which is itself a real, auditable trial-count
 * event. */
export const REGISTERED_FEATURE_INTERACTIONS: readonly FeatureInteractionPair[] = [
  { interactionId: 'FLOW_X_REGIME', familyA: 'FLOW', familyB: 'REGIME' },
  { interactionId: 'FLOW_X_IV_RV', familyA: 'FLOW', familyB: 'REALIZED_VOLATILITY' },
  { interactionId: 'EVENT_X_DTE', familyA: 'EVENT_CONTEXT', familyB: 'REALIZED_VOLATILITY' },
  { interactionId: 'TREND_X_VOLATILITY', familyA: 'TREND', familyB: 'IV' },
  { interactionId: 'LIQUIDITY_X_EXECUTION_COST', familyA: 'LIQUIDITY', familyB: 'EXECUTION_QUALITY' },
  { interactionId: 'CORRELATION_X_PORTFOLIO_EXPOSURE', familyA: 'CORRELATION', familyB: 'PORTFOLIO_EXPOSURE' },
  { interactionId: 'DELTA_X_DTE', familyA: 'OWNERSHIP', familyB: 'REALIZED_VOLATILITY' },
];

export interface InteractionTrialRecord {
  readonly contractVersion: typeof filterInteractionRegistryVersion;
  readonly interactionId: string;
  readonly trialIdentity: string;
  readonly registeredAt: string;
  readonly evaluated: boolean;
}

/**
 * Real, auditable trial-registration list. Every interaction actually
 * tested (evaluated=true) OR merely attempted-and-abandoned
 * (evaluated=false) must appear here -- `numberOfTrials` in a DSR/PBO
 * campaign that covers interaction testing must equal the length of
 * this list, not just the count of "interesting" results, matching
 * `selection-bias-receipt.ts`'s winner's-curse guard.
 */
export class FilterInteractionTrialLedger {
  private readonly trials: InteractionTrialRecord[] = [];

  register(interactionId: string, evaluated: boolean, registeredAt: string): InteractionTrialRecord {
    const known = REGISTERED_FEATURE_INTERACTIONS.some((i) => i.interactionId === interactionId);
    if (!known) throw new Error(`FILTER_INTERACTION_NOT_PRE_REGISTERED:${interactionId}`);
    const trialIdentity = `${interactionId}::${this.trials.filter((t) => t.interactionId === interactionId).length}`;
    const record: InteractionTrialRecord = {
      contractVersion: filterInteractionRegistryVersion, interactionId, trialIdentity, registeredAt, evaluated,
    };
    this.trials.push(record);
    return record;
  }

  all(): readonly InteractionTrialRecord[] { return [...this.trials]; }

  trialIdentities(): readonly string[] { return this.trials.map((t) => t.trialIdentity); }

  numberOfTrials(): number { return this.trials.length; }
}
